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
