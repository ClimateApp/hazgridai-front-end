import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import Papa from "papaparse";
import ChatMessage from "@/components/ChatMessage";
import ChatInput from "@/components/ChatInput";
import TypingIndicator from "@/components/TypingIndicator";
import { ConversationSidebar } from "@/components/ConversationSidebar";
import FloodResults, { type FloodResult } from "@/components/FloodResults";
import { Button } from "@/components/ui/button";
import { Waves, Loader2, Paperclip, FileText, X } from "lucide-react";
import { extractAllFloodData, type FloodChartPoint } from "@/lib/flood-data";
import { recalculateGrossLossInContent } from "@/lib/recalculate-gross-loss";

type Message = {
  role: "user" | "assistant";
  content: string;
  chart?: { data: FloodChartPoint[]; ffe: number };
  result?: { csvText: string; filename: string };
};

export type InsuranceSettings = { deductible: number; policyLimit: number };

// Local-dev bypass: set VITE_FLOOD_API_URL (e.g. http://localhost:8030/raster/csv) to call
// the floodrisk service directly instead of the Supabase edge function.
// Per-browser override first: localStorage.setItem("flood_api_url", "http://localhost:8030/raster/csv")
const OASIS_API_URL =
  (typeof localStorage !== "undefined" ? localStorage.getItem("oasis_api_url") : null) ||
  "http://localhost:8040";

const CSV_API_URL =
  (typeof localStorage !== "undefined" ? localStorage.getItem("flood_api_url") : null) ||
  (import.meta.env.VITE_FLOOD_API_URL as string | undefined) ||
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/flood-risk-csv`;
const CSV_API_KEY = import.meta.env.VITE_API_KEY as string | undefined;

const parseCsvToResult = (csvText: string, filename: string): FloodResult => {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  const columns = parsed.meta.fields ?? Object.keys(parsed.data[0] ?? {});
  return {
    columns,
    rows: parsed.data,
    blob: new Blob([csvText], { type: "text/csv" }),
    filename,
  };
};

// ---- fmGrid in-chat flow: intent + deductible parsing + result formatting ----
const FIN_RPS = ["2", "5", "10", "25", "50", "100", "200", "500"];

const isFinancialIntent = (t: string) => {
  const l = t.toLowerCase();
  if (/fmgrid/.test(l)) return true;
  if (/financial model|portfolio (financial|model|loss|losses)/.test(l)) return true;
  return (
    /\b(run|calculate|compute|estimate|model)\b/.test(l) &&
    /\b(aal|oep|aep|insured|exceedance|average annual loss)\b/.test(l)
  );
};

// deductible stated inside the request itself ("run fmGrid with a $5k deductible")
const dedFromIntent = (t: string): number | null => {
  const s = t.replace(/,/g, "");
  if (/\b(no|without|zero)\b[^.]*deductible|deductible[^.]*\b(none|zero)\b/i.test(s)) return 0;
  const m =
    s.match(/deductible\D{0,12}\$?\s*(\d+(?:\.\d+)?)\s*(k)?/i) ||
    s.match(/\$\s*(\d+(?:\.\d+)?)\s*(k)?\s*(?:deductible|ded\b)/i);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * (m[2] ? 1000 : 1));
};

// the follow-up answer to "what deductible?" — strict so coordinates never match
const dedFromReply = (t: string): number | null => {
  const s = t.trim().replace(/,/g, "");
  if (/^(no|none|zero|nothing|skip|0)\.?$/i.test(s)) return 0;
  const m =
    s.match(/^\$?\s*(\d+(?:\.\d+)?)\s*(k)?\.?$/i) ||
    s.match(/\$\s*(\d+(?:\.\d+)?)\s*(k)?/) ||
    s.match(/deductible\D{0,12}(\d+(?:\.\d+)?)\s*(k)?/i);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * (m[2] ? 1000 : 1));
};

const fmtB = (v: number) => `$${(v / 1e9).toFixed(2)}B`;
const fmtM = (v: number) => `$${(v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 0 })}M`;

const formatFinancialReply = (d: any, deductible: number): string => {
  const gu = d.groundup ?? {};
  const ins = d.insured;
  const oepRows = FIN_RPS.map((rp) => {
    const g = gu.oep_curve?.[rp];
    const i = ins?.oep_curve?.[rp];
    return ins
      ? `| ${rp}-year | ${g != null ? fmtB(g) : "N/A"} | ${i != null ? fmtB(i) : "N/A"} |`
      : `| ${rp}-year | ${g != null ? fmtB(g) : "N/A"} |`;
  }).join("\n");
  const insAal = ins?.aal_usd != null ? `\n| **Average annual loss (insured)** | **${fmtM(ins.aal_usd)}** |` : "";
  return `# Portfolio Financial Model (fmGrid)

| Metric | Value |
|-----------|-------|
| Locations modeled | ${(d.locations_modeled ?? 0).toLocaleString()} |
| Exposed value | ${fmtB(d.exposed_value_usd ?? 0)} |
| Deductible | $${deductible.toLocaleString()} per location |
| Simulated years | ${(d.simulated_years ?? 10000).toLocaleString()} |
| **Average annual loss (ground-up)** | **${fmtM(gu.aal_usd ?? 0)}** |${insAal}

# Loss Exceedance (OEP)

| Return Period | Ground-up Loss ${ins ? "| Insured Loss " : ""}|
|---------------|----------------${ins ? "|--------------" : ""}|
${oepRows}

*OEP = occurrence exceedance probability: the loss exceeded by the worst event in a year at the given return period.*`;
};

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

const FloodChat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showChartForIndex, setShowChartForIndex] = useState<number | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [oasisBusy, setOasisBusy] = useState(false);
  const [oasisResult, setOasisResult] = useState<any>(null);
  const [oasisDed, setOasisDed] = useState("5000");

  const runOasis = async () => {
    setOasisBusy(true);
    setOasisResult(null);
    try {
      const r = await fetch(`${OASIS_API_URL}/flood/stochastic`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deductible: Number(oasisDed) || 0, samples: 25 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.detail || `HTTP ${r.status}`);
      setOasisResult(d);
    } catch (e: any) {
      setOasisResult({ error: e.message?.includes("Failed to fetch")
        ? "Cannot reach the fmGrid service (localhost:8040) — is the local stack running?"
        : e.message });
    } finally {
      setOasisBusy(false);
    }
  };
  const [awaitingDeductible, setAwaitingDeductible] = useState(false);

  // In-chat fmGrid run: user message + progress note, then swap in the results.
  const runFinancialInChat = async (content: string, deductible: number) => {
    const userMessage: Message = { role: "user", content };
    const note =
      `Running the fmGrid portfolio financial model with a $${deductible.toLocaleString()}` +
      `/location deductible — the full coastal building stock over 10,000 simulated years. ` +
      `This takes ~2–4 minutes…`;
    setMessages((prev) => [...prev, userMessage, { role: "assistant", content: note }]);
    setIsLoading(true);
    let convId = conversationId;
    if (!convId) {
      convId = await createConversation(content.slice(0, 50));
      setConversationId(convId);
    }
    if (convId) await saveMessage(convId, "user", content);
    try {
      const r = await fetch(`${OASIS_API_URL}/flood/stochastic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deductible, samples: 25 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.detail || `HTTP ${r.status}`);
      const reply = formatFinancialReply(d, deductible);
      setMessages((prev) => {
        const u = [...prev];
        u[u.length - 1] = { role: "assistant", content: reply };
        return u;
      });
      if (convId) await saveMessage(convId, "assistant", reply);
    } catch (e: any) {
      const msg = e?.message?.includes("Failed to fetch")
        ? "Cannot reach the fmGrid service (localhost:8040) — is the local stack running?"
        : e?.message || "fmGrid run failed";
      setMessages((prev) => {
        const u = [...prev];
        u[u.length - 1] = { role: "assistant", content: `Error: ${msg}` };
        return u;
      });
      if (convId) await saveMessage(convId, "assistant", `Error: ${msg}`);
    } finally {
      setIsLoading(false);
    }
  };

  const [sidebarRefreshTrigger, setSidebarRefreshTrigger] = useState(0);
  const [insuranceSettings, setInsuranceSettingsState] = useState<InsuranceSettings>({
    deductible: 1000,
    policyLimit: 100000,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { user, session } = useAuth();
  const navigate = useNavigate();

  const updateInsuranceSettings = useCallback(
    async (newSettings: InsuranceSettings, updatedMessages?: Message[]) => {
      setInsuranceSettingsState(newSettings);
      if (conversationId) {
        await supabase
          .from("conversations")
          .update({ insurance_settings: newSettings })
          .eq("id", conversationId);
        if (updatedMessages) {
          const { data: existingMsgs } = await supabase
            .from("messages")
            .select("id, content")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true });
          if (existingMsgs) {
            for (let i = 0; i < Math.min(existingMsgs.length, updatedMessages.length); i++) {
              if (existingMsgs[i].content !== updatedMessages[i].content) {
                await supabase
                  .from("messages")
                  .update({ content: updatedMessages[i].content })
                  .eq("id", existingMsgs[i].id);
              }
            }
          }
        }
      }
    },
    [conversationId]
  );

  const setInsuranceSettings = (settings: InsuranceSettings) => {
    const updatedMessages = messages.map((msg) => ({
      ...msg,
      content: recalculateGrossLossInContent(msg.content, settings),
    }));
    setMessages(updatedMessages);
    updateInsuranceSettings(settings, updatedMessages);
  };

  useEffect(() => {
    const loadRecentConversation = async () => {
      if (!user) { setIsLoadingHistory(false); return; }
      try {
        const { data: conversations, error: convError } = await supabase
          .from("conversations")
          .select("id, title")
          .eq("user_id", user.id)
          .eq("conversation_type", "flood")
          .order("updated_at", { ascending: false })
          .limit(1);
        if (convError) {
          setIsLoadingHistory(false);
          return;
        }
        if (conversations && conversations.length > 0) {
          await loadConversation(conversations[0].id);
        } else {
          setIsLoadingHistory(false);
        }
      } catch (err) {
        console.error(err);
        setIsLoadingHistory(false);
      }
    };
    loadRecentConversation();
  }, [user]);

  const loadConversation = async (convId: string) => {
    setIsLoadingHistory(true);
    try {
      const { data: convData } = await supabase
        .from("conversations")
        .select("insurance_settings")
        .eq("id", convId)
        .single();
      if (convData?.insurance_settings) {
        const s = convData.insurance_settings as InsuranceSettings;
        setInsuranceSettingsState({
          deductible: s.deductible ?? 1000,
          policyLimit: s.policyLimit ?? 100000,
        });
      } else {
        setInsuranceSettingsState({ deductible: 1000, policyLimit: 100000 });
      }
      const { data: msgs } = await supabase
        .from("messages")
        .select("role, content, chart_data")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true });
      const loaded: Message[] = (msgs || []).map((m) => {
        const meta = (m.chart_data as Record<string, unknown> | null) || {};
        const csvText = typeof meta.csvText === "string" ? (meta.csvText as string) : undefined;
        const filename = typeof meta.filename === "string" ? (meta.filename as string) : undefined;
        const chart =
          meta && Array.isArray((meta as { data?: unknown }).data)
            ? (meta as Message["chart"])
            : undefined;
        return {
          role: m.role as "user" | "assistant",
          content: m.content,
          chart,
          result: csvText && filename ? { csvText, filename } : undefined,
        };
      });
      setMessages(loaded);
      setConversationId(convId);
      setShowChartForIndex(null);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (messages.length > 0) messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const findLastFloodDataIndex = (): number => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== "assistant") continue;
      if (extractAllFloodData(messages[i].content)) return i;
    }
    return -1;
  };

  const saveMessage = useCallback(
    async (
      convId: string,
      role: "user" | "assistant",
      content: string,
      meta?: Message["chart"] | { csvText: string; filename: string }
    ) => {
      if (!user) return;
      await supabase.from("messages").insert({
        conversation_id: convId,
        user_id: user.id,
        role,
        content,
        chart_data: meta ? (JSON.parse(JSON.stringify(meta)) as never) : null,
      });
      await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
      setSidebarRefreshTrigger((p) => p + 1);
    },
    [user]
  );

  const createConversation = useCallback(
    async (title?: string): Promise<string | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("conversations")
        .insert({ user_id: user.id, title: title || "New Conversation", conversation_type: "flood" })
        .select("id")
        .single();
      if (error) return null;
      setSidebarRefreshTrigger((p) => p + 1);
      return data.id;
    },
    [user]
  );

  const handleFilePick = (f: File | null) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      toast({ title: "Please upload a CSV file with columns: id, lon, lat", variant: "destructive" });
      return;
    }
    setPendingFile(f);
  };

  const analyzeCsv = async (file: File) => {
    setAnalyzing(true);
    const userContent = `Analyze flood risk for ${file.name}`;
    setMessages((prev) => [...prev, { role: "user", content: userContent }]);

    let convId = conversationId;
    if (!convId) {
      convId = await createConversation(file.name.replace(/\.csv$/i, ""));
      setConversationId(convId);
    }
    if (convId) await saveMessage(convId, "user", userContent);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const headers: Record<string, string> = {};
      if (CSV_API_KEY) headers["X-API-Key"] = CSV_API_KEY;

      const res = await fetch(CSV_API_URL, { method: "POST", headers, body: fd });

      if (!res.ok) {
        let detail = `Request failed (${res.status})`;
        try {
          const j = await res.json();
          if (j?.detail) detail = j.detail;
        } catch {
          // ignore
        }
        throw new Error(detail);
      }

      const text = await res.text();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename="([^"]+)"/);
      const filename = m?.[1] || "flood_results.csv";

      const built = parseCsvToResult(text, filename);
      setPendingFile(null);

      const replyContent = `Analyzed ${built.rows.length} location${built.rows.length === 1 ? "" : "s"}. Results are shown below.`;
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: replyContent, result: { csvText: text, filename } },
      ]);
      if (convId) await saveMessage(convId, "assistant", replyContent, { csvText: text, filename });
      toast({ title: `Analyzed ${built.rows.length} rows` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      toast({ title: msg, variant: "destructive" });
      const errContent = `Error: ${msg}`;
      setMessages((prev) => [...prev, { role: "assistant", content: errContent }]);
      if (convId) await saveMessage(convId, "assistant", errContent);
    } finally {
      setAnalyzing(false);
    }
  };

  // Local-dev: when VITE_FLOOD_API_URL is set and the message is plain "lon, lat"
  // coordinates, query the local floodrisk service directly and render the same
  // report the flood-chat edge function would produce (no LLM/auth needed).
  const runLocalPointLookup = async (content: string): Promise<boolean> => {
    const csvUrl =
      (typeof localStorage !== "undefined" ? localStorage.getItem("flood_api_url") : null) ||
      (import.meta.env.VITE_FLOOD_API_URL as string | undefined);
    if (!csvUrl) return false;
    // exact "lon, lat" message — or, when there is no cloud session to fall back to,
    // a coordinate pair embedded anywhere in the text ("flood risk at -80.13, 25.85")
    // any message containing a coordinate pair is handled locally when the env is set
    const m =
      content.trim().match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/) ||
      content.match(/(-?\d{1,3}\.\d+)[,\s]+(-?\d{1,3}\.\d+)/);
    if (!m) return false;
    const lon = parseFloat(m[1]);
    const lat = parseFloat(m[2]);
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return false;
    const base = csvUrl.replace(/\/raster\/csv\/?$/, "");

    const userMessage: Message = { role: "user", content };
    setMessages((prev) => [...prev, userMessage, { role: "assistant", content: "" }]);
    setIsLoading(true);
    try {
      const res = await fetch(`${base}/raster/value?lon=${lon}&lat=${lat}`);
      if (!res.ok) throw new Error(`Flood service error (${res.status})`);
      const d = await res.json();
      const periods = ["2-year", "5-year", "10-year", "25-year", "50-year", "100-year", "200-year", "500-year"];
      const deductible = 1000;
      const policyLimit = 100000;
      const valStruct: number | null = d.val_struct ?? null;
      let rows = "";
      for (let i = 0; i < periods.length; i++) {
        const wl = d.water_level?.[i];
        const dffe = d.depth_above_FFE?.[i];
        const dr = d.damage_ratio?.[i];
        const wlStr = wl != null ? `${wl.toFixed(2)} ft` : "N/A";
        const dffeStr = dffe != null ? `${dffe.toFixed(2)} ft` : "N/A";
        const drStr = dr != null ? `${dr.toFixed(1)}%` : "N/A";
        let guStr = "N/A", grStr = "N/A";
        if (dr != null && valStruct != null) {
          const gu = (dr / 100) * valStruct;
          const gr = Math.max(0, Math.min(gu - deductible, policyLimit));
          guStr = "$" + gu.toLocaleString("en-US", { maximumFractionDigits: 0 });
          grStr = "$" + gr.toLocaleString("en-US", { maximumFractionDigits: 0 });
        }
        rows += `| ${periods[i]} | ${wlStr} | ${dffeStr} | ${drStr} | ${guStr} | ${grStr} |\n`;
      }
      const reply = `📍 **Location**: ${lon}, ${lat}

---

# Property Profile

| Attribute | Value |
|-----------|-------|
| **Building Type** | ${d.num_stories === "singlestory" ? "Single-Story" : d.num_stories === "multistory" ? "Multi-Story" : d.num_stories ?? "N/A"} |
| **Ground Elevation** | ${d.ground_elv != null ? d.ground_elv.toFixed(2) + " ft (NAVD88)" : "N/A"} |
| **Foundation Height** | ${d.found_ht ?? "N/A"} ft |
| **First Floor Elevation** | ${d.ground_elv != null && d.found_ht != null ? (d.ground_elv + d.found_ht).toFixed(2) + " ft" : "N/A"} |
| **Replacement Value** | ${valStruct != null ? "$" + valStruct.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "N/A"} |
| **Deductible** | $${deductible.toLocaleString()} |
| **Policy Limit** | $${policyLimit.toLocaleString()} |

---

# Flood Risk by Return Period

| Return Period | Water Level | Depth Above FFE | Damage Ratio | Groundup Loss ($) | Gross Loss ($) |
|---------------|-------------|-----------------|--------------|-------------------|----------------|
${rows}
*FFE = First Floor Elevation*`;
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: reply };
        return next;
      });
      let convId = conversationId;
      if (!convId) {
        convId = await createConversation(content.slice(0, 50));
        setConversationId(convId);
      }
      if (convId) {
        await saveMessage(convId, "user", content);
        await saveMessage(convId, "assistant", reply);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Flood lookup failed";
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: `Error: ${msg}` };
        return next;
      });
    } finally {
      setIsLoading(false);
    }
    return true;
  };

  const sendMessage = async (content: string) => {
    // fmGrid agent flow: answer to the pending "what deductible?" question
    if (awaitingDeductible) {
      setAwaitingDeductible(false);
      const ded = dedFromReply(content);
      if (ded != null) {
        await runFinancialInChat(content, ded);
        return;
      }
      // not a deductible answer — fall through to normal handling
    }
    // fmGrid agent flow: request to run the portfolio financial model
    if (isFinancialIntent(content)) {
      const ded = dedFromIntent(content);
      if (ded != null) {
        await runFinancialInChat(content, ded);
        return;
      }
      const q =
        "I can run the fmGrid portfolio financial model — the return-period hazard as a " +
        "stochastic event set over 10,000 simulated years across the coastal building stock, " +
        "giving average annual loss and OEP exceedance curves.\n\n" +
        'What **deductible** should I apply per location? Reply with an amount (e.g. **$5,000**) or **"none"**.';
      const userMessage: Message = { role: "user", content };
      setMessages((prev) => [...prev, userMessage, { role: "assistant", content: q }]);
      let convId = conversationId;
      if (!convId) {
        convId = await createConversation(content.slice(0, 50));
        setConversationId(convId);
      }
      if (convId) {
        await saveMessage(convId, "user", content);
        await saveMessage(convId, "assistant", q);
      }
      setAwaitingDeductible(true);
      return;
    }

    if (await runLocalPointLookup(content)) return;

    if (!session?.access_token) {
      toast({ title: "Authentication required", variant: "destructive" });
      navigate("/auth");
      return;
    }

    const lower = content.toLowerCase();
    const plotKw = ["plot", "graph", "chart", "visualize", "show curve", "draw"];
    if (plotKw.some((k) => lower.includes(k))) {
      const idx = findLastFloodDataIndex();
      if (idx >= 0) {
        const extracted = extractAllFloodData(messages[idx].content);
        if (extracted) {
          const userMessage: Message = { role: "user", content };
          const chartData = { data: extracted.chartData, ffe: extracted.ffe };
          const assistantMessage: Message = {
            role: "assistant",
            content:
              "Here's the flood risk visualization showing Water Level vs Return Period, with the First Floor Elevation (FFE) reference line.",
            chart: chartData,
          };
          setShowChartForIndex(messages.length + 1);
          setMessages((prev) => [...prev, userMessage, assistantMessage]);
          let convId = conversationId;
          if (!convId) {
            convId = await createConversation(content.slice(0, 50));
            setConversationId(convId);
          }
          if (convId) {
            await saveMessage(convId, "user", content);
            await saveMessage(convId, "assistant", assistantMessage.content, chartData);
          }
          return;
        }
      }
    }

    const userMessage: Message = { role: "user", content };
    const allMsgs = [...messages, userMessage];
    const latestResult = [...allMsgs].reverse().find((m) => m.result)?.result;
    const csvContext = latestResult
      ? (() => {
          const lines = latestResult.csvText.split("\n");
          const capped = lines.slice(0, 501).join("\n");
          const note = lines.length > 501 ? `\n\n(Showing first 500 of ${lines.length - 1} rows.)` : "";
          return (
            `Current flood risk results CSV (file: ${latestResult.filename}). ` +
            `Use this as the source of truth for any question about the table, properties, locations, depths, water levels, losses, totals, rankings, or comparisons. ` +
            `Do not say the table is unavailable when this CSV is present.\n\n` +
            "```csv\n" + capped + "\n```" + note
          );
        })()
      : null;
    const messagesForApi = [
      ...(csvContext ? [{ role: "assistant" as const, content: csvContext }] : []),
      ...allMsgs
        .filter((m) => m.content.trim() !== "")
        .map((m) => ({ role: m.role, content: m.content })),
    ];

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setShowChartForIndex(null);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    let convId = conversationId;
    if (!convId) {
      convId = await createConversation(content.slice(0, 50));
      setConversationId(convId);
    }
    if (convId) await saveMessage(convId, "user", content);

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/flood-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ messages: messagesForApi, stream: true }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to get response");
      }
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const j = line.slice(6).trim();
            if (j === "[DONE]") continue;
            try {
              const parsed = JSON.parse(j);
              const d = parsed.choices?.[0]?.delta?.content;
              if (d) {
                acc += d;
                setMessages((prev) => {
                  const u = [...prev];
                  u[u.length - 1] = { role: "assistant", content: acc };
                  return u;
                });
              }
            } catch {
              // ignore
            }
          }
        }
      }
      if (convId && acc) await saveMessage(convId, "assistant", acc);
    } catch (error) {
      setMessages((prev) => prev.slice(0, -1));
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to get response",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewConversation = () => {
    setMessages([]);
    setShowChartForIndex(null);
    setConversationId(null);
    setIsLoadingHistory(false);
    setPendingFile(null);
    setAwaitingDeductible(false);
    setInsuranceSettingsState({ deductible: 1000, policyLimit: 100000 });
  };

  const handleSelectConversation = (id: string) => {
    if (id !== conversationId) loadConversation(id);
  };

  return (
    <>
      <ConversationSidebar
        currentConversationId={conversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        refreshTrigger={sidebarRefreshTrigger}
        conversationType="flood"
      />
      <div className="flex flex-col flex-1 h-full min-h-0">
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-4 py-6">
            {isLoadingHistory ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[60vh]">
                <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground">Loading your conversation...</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent to-primary flex items-center justify-center mb-6">
                  <Waves className="w-10 h-10 text-primary-foreground" />
                </div>
                <h2 className="text-2xl font-semibold text-foreground mb-2">Welcome to Flood Level Assistant</h2>
                <p className="text-muted-foreground max-w-md mb-8">
                  I can help you check flood levels at any location. Just provide me with coordinates, or attach a CSV with columns id, lon, lat for batch analysis.
                </p>
                <div className="grid gap-3 w-full max-w-md">
                  {[
                    "Check flood risk at -80.13493, 25.85401",
                    "Run the portfolio financial model (fmGrid)",
                  ].map((ex, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(ex)}
                      className="text-left px-4 py-3 rounded-xl bg-card border border-border hover:border-ring hover:bg-accent/50 transition-colors text-sm text-muted-foreground hover:text-foreground"
                    >
                      "{ex}"
                    </button>
                  ))}
                </div>

                <div className="w-full max-w-md mt-6 rounded-xl border border-border bg-card p-4 text-left">
                  <p className="text-sm font-semibold text-foreground mb-1">Portfolio financial model (fmGrid)</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Runs the return-period hazard as a stochastic event set over 10,000
                    simulated years — average annual loss and OEP/AEP exceedance curves
                    across the coastal building stock. Local computation (~2–4 min).
                  </p>
                  <div className="flex items-center gap-2 mb-3">
                    <label className="text-xs text-muted-foreground">Deductible $</label>
                    <input value={oasisDed} onChange={(e) => setOasisDed(e.target.value)}
                           className="h-8 w-28 rounded-md border border-input bg-background px-2 text-xs" />
                    <button onClick={runOasis} disabled={oasisBusy}
                            className="ml-auto h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50">
                      {oasisBusy ? "Running…" : "Run fmGrid"}
                    </button>
                  </div>
                  {oasisResult?.error && (
                    <p className="text-xs text-destructive">{oasisResult.error}</p>
                  )}
                  {oasisResult && !oasisResult.error && (
                    <div className="space-y-2 text-xs">
                      <p>
                        <span className="font-semibold">{oasisResult.locations_modeled?.toLocaleString()}</span> locations ·
                        exposure <span className="font-semibold">${(oasisResult.exposed_value_usd / 1e9).toFixed(1)}B</span> ·
                        AAL <span className="font-semibold text-foreground">${(oasisResult.groundup?.aal_usd / 1e6).toFixed(0)}M</span>
                        {oasisResult.insured?.aal_usd != null && (
                          <> · insured AAL <span className="font-semibold">${(oasisResult.insured.aal_usd / 1e6).toFixed(0)}M</span></>
                        )}
                      </p>
                      <div className="overflow-x-auto rounded-md border border-border">
                        <table className="w-full text-[11px]">
                          <thead className="bg-muted/70">
                            <tr><th className="px-2 py-1 text-left">Return period</th>
                                <th className="px-2 py-1 text-right">Ground-up loss (OEP)</th>
                                {oasisResult.insured && <th className="px-2 py-1 text-right">Insured (OEP)</th>}</tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {[2, 5, 10, 25, 50, 100, 200, 500].map((rp) => (
                              <tr key={rp}>
                                <td className="px-2 py-1">{rp}-year</td>
                                <td className="px-2 py-1 text-right">
                                  {oasisResult.groundup?.oep_curve?.[rp] != null
                                    ? `$${(oasisResult.groundup.oep_curve[rp] / 1e9).toFixed(2)}B` : "—"}
                                </td>
                                {oasisResult.insured && (
                                  <td className="px-2 py-1 text-right">
                                    {oasisResult.insured?.oep_curve?.[rp] != null
                                      ? `$${(oasisResult.insured.oep_curve[rp] / 1e9).toFixed(2)}B` : "—"}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((m, i) => (
                  <div key={i} className="space-y-3">
                    <ChatMessage
                      role={m.role}
                      content={m.content}
                      showChart={showChartForIndex === i || !!m.chart}
                      chartDataOverride={m.chart?.data}
                      ffeOverride={m.chart?.ffe}
                      insuranceSettings={insuranceSettings}
                      onInsuranceSettingsChange={setInsuranceSettings}
                    />
                    {m.result && (
                      <FloodResults result={parseCsvToResult(m.result.csvText, m.result.filename)} />
                    )}
                  </div>
                ))}
                {isLoading && <TypingIndicator />}
                {analyzing && (
                  <div className="flex gap-3 items-center text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing CSV…
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </main>
        <footer className="flex-shrink-0 border-t border-border bg-card/50 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto px-4 py-4 space-y-2">
            {pendingFile && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted text-sm">
                <FileText className="w-4 h-4 text-primary" />
                <span className="flex-1 truncate text-left">{pendingFile.name}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(pendingFile.size)}</span>
                <button
                  onClick={() => setPendingFile(null)}
                  className="p-1 hover:bg-background rounded"
                  aria-label="Remove file"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <div className="flex gap-2 items-end">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  handleFilePick(e.target.files?.[0] || null);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-[52px] w-[52px] shrink-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || analyzing}
                title="Attach a CSV (id, lon, lat)"
              >
                <Paperclip className="h-5 w-5" />
              </Button>
              {pendingFile ? (
                <Button
                  onClick={() => analyzeCsv(pendingFile)}
                  disabled={analyzing}
                  className="h-[52px] flex-1"
                >
                  {analyzing ? <Loader2 className="h-5 w-5 animate-spin" /> : <>Analyze CSV</>}
                </Button>
              ) : (
                <div className="flex-1">
                  <ChatInput onSend={sendMessage} disabled={isLoading || isLoadingHistory || analyzing} />
                </div>
              )}
            </div>
          </div>
        </footer>
      </div>
    </>
  );
};

export default FloodChat;
