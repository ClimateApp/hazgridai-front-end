import { useCallback, useEffect, useRef, useState } from "react";
import { Flame, Send, TrendingUp, BarChart3, MapPin, LineChart, Paperclip, FileText, X, Loader2 } from "lucide-react";
import Papa from "papaparse";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import TypingIndicator from "@/components/TypingIndicator";
import WildfireResults, { type WildfireResult } from "@/components/WildfireResults";
import { ConversationSidebar } from "@/components/ConversationSidebar";
import { useAuth } from "@/hooks/useAuth";

type Msg = {
  role: "user" | "assistant";
  content: string;
  result?: { csvText: string; filename: string };
};

// Local-dev bypass: set VITE_RISK_API_URL (e.g. http://localhost:8010/risk/csv) to call the
// FireRisk service directly instead of the Supabase edge function.
const RISK_API_URL =
  (import.meta.env.VITE_RISK_API_URL as string | undefined) ||
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wildfire-risk-csv`;
const RISK_API_KEY = import.meta.env.VITE_API_KEY as string | undefined;

const parseCsvToResult = (csvText: string, filename: string): WildfireResult => {
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

const formatUsd = (value: string | number) => {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const buildCsvContext = (result: { csvText: string; filename: string }) => {
  const lines = result.csvText.split("\n");
  const capped = lines.slice(0, 501).join("\n");
  const truncatedNote = lines.length > 501 ? `\n\n(Showing first 500 of ${lines.length - 1} rows.)` : "";
  return (
    `Current wildfire risk results CSV (file: ${result.filename}). ` +
    `Use this as the source of truth for questions about properties, EAL, losses, totals, rankings, or patterns. ` +
    `Do not say the table is unavailable when this CSV is present.\n\n` +
    "```csv\n" + capped + "\n```" + truncatedNote
  );
};

const answerFromLatestCsv = (question: string, history: Msg[]) => {
  const latest = [...history].reverse().find((m) => m.result)?.result;
  if (!latest || !/(\beal\b|expected annual loss)/i.test(question)) return null;

  const parsed = Papa.parse<Record<string, string>>(latest.csvText, {
    header: true,
    skipEmptyLines: true,
  });
  const normalizedQuestion = question.toLowerCase();
  const match = parsed.data.find((row) =>
    Object.values(row).some((value) => {
      const normalizedValue = String(value ?? "").trim().toLowerCase();
      return normalizedValue.length > 2 && normalizedQuestion.includes(normalizedValue);
    }),
  );

  const eal = match?.EAL ?? match?.eal;
  if (!match || eal === undefined) return null;

  const label = match.id || match.ID || "that property";
  return `The EAL for **${label}** is **${formatUsd(eal)} per year**.`;
};

const RECALC_INTENT_RE =
  /(recalc|recompute|re-?run|rerun|re-?analyz|reanalyz|replace.*missing|use.*default|set.*default|default.*structure|fill in.*missing|with.*default)/i;

const extractDefaultValue = (text: string): number | null => {
  // Match things like "500000", "500,000", "$500,000", "500k", "1.2m"
  const km = text.match(/\$?\s*([\d,]+(?:\.\d+)?)\s*(k|m)\b/i);
  if (km) {
    const n = parseFloat(km[1].replace(/,/g, ""));
    if (Number.isFinite(n)) return km[2].toLowerCase() === "k" ? n * 1000 : n * 1_000_000;
  }
  const m = text.match(/\$?\s*([\d,]+(?:\.\d+)?)/);
  if (m) {
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n >= 1000) return n;
  }
  return null;
};

// Rebuild an id/lon/lat CSV from a previously returned enriched result, so the
// backend can be re-called even after a page reload (when the original File is gone).
const fileFromLatestResult = (csvText: string, filename: string): File | null => {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  const rows = parsed.data;
  if (!rows.length) return null;
  const fields = parsed.meta.fields ?? Object.keys(rows[0]);
  const idKey = fields.find((f) => f.toLowerCase() === "id");
  const lonKey = fields.find((f) => f.toLowerCase() === "lon" || f.toLowerCase() === "longitude");
  const latKey = fields.find((f) => f.toLowerCase() === "lat" || f.toLowerCase() === "latitude");
  if (!idKey || !lonKey || !latKey) return null;
  const slim = rows.map((r) => ({ id: r[idKey], lon: r[lonKey], lat: r[latKey] }));
  const csv = Papa.unparse({ fields: ["id", "lon", "lat"], data: slim });
  return new File([csv], filename || "input.csv", { type: "text/csv" });
};

const WildfireChat = () => {
  const { user } = useAuth();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [defaultStructureVal, setDefaultStructureVal] = useState<string>("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<WildfireResult | null>(null);
  const [lastUploadedFile, setLastUploadedFile] = useState<File | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [sidebarRefreshTrigger, setSidebarRefreshTrigger] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const saveMessage = useCallback(
    async (
      convId: string,
      role: "user" | "assistant",
      content: string,
      meta?: { csvText?: string; filename?: string },
    ) => {
      if (!user) return;
      await supabase.from("messages").insert({
        conversation_id: convId,
        user_id: user.id,
        role,
        content,
        chart_data: meta ? JSON.parse(JSON.stringify(meta)) : null,
      });
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", convId);
      setSidebarRefreshTrigger((p) => p + 1);
    },
    [user],
  );

  const createConversation = useCallback(
    async (title: string): Promise<string | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("conversations")
        .insert({
          user_id: user.id,
          title: title.slice(0, 80) || "Wildfire analysis",
          conversation_type: "wildfire",
        })
        .select("id")
        .single();
      if (error) return null;
      setSidebarRefreshTrigger((p) => p + 1);
      return data.id;
    },
    [user],
  );

  const loadConversation = useCallback(async (convId: string) => {
    setIsLoadingHistory(true);
    try {
      const { data: msgs } = await supabase
        .from("messages")
        .select("role, content, chart_data")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true });
      const loaded: Msg[] = (msgs || []).map((m) => {
        const meta = (m.chart_data as Record<string, unknown> | null) || {};
        const csvText = typeof meta.csvText === "string" ? (meta.csvText as string) : undefined;
        const filename = typeof meta.filename === "string" ? (meta.filename as string) : undefined;
        return {
          role: m.role as "user" | "assistant",
          content: m.content,
          result: csvText && filename ? { csvText, filename } : undefined,
        };
      });
      setMessages(loaded);
      const lastWithResult = [...loaded].reverse().find((m) => m.result);
      setResult(
        lastWithResult?.result
          ? parseCsvToResult(lastWithResult.result.csvText, lastWithResult.result.filename)
          : null,
      );
      setConversationId(convId);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  // Load most recent wildfire conversation on mount
  useEffect(() => {
    const load = async () => {
      if (!user) { setIsLoadingHistory(false); return; }
      try {
        const { data } = await supabase
          .from("conversations")
          .select("id")
          .eq("user_id", user.id)
          .eq("conversation_type", "wildfire")
          .order("updated_at", { ascending: false })
          .limit(1);
        if (data && data.length > 0) {
          await loadConversation(data[0].id);
        } else {
          setIsLoadingHistory(false);
        }
      } catch {
        setIsLoadingHistory(false);
      }
    };
    load();
  }, [user, loadConversation]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, result, analyzing]);

  const formatBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  };

  const handleFilePick = (f: File | null) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      toast.error("Please upload a CSV file with columns: id, lon, lat");
      return;
    }
    setPendingFile(f);
  };

  const handleNewConversation = () => {
    setMessages([]);
    setResult(null);
    setConversationId(null);
    setPendingFile(null);
    setInput("");
    setDefaultStructureVal("");
    setLastUploadedFile(null);
    setIsLoadingHistory(false);
  };

  const handleSelectConversation = (id: string) => {
    if (id !== conversationId) loadConversation(id);
  };

  const analyzeCsv = async (file: File, overrideDefaultVal?: string) => {
    setAnalyzing(true);
    const dsvToUse = (overrideDefaultVal ?? defaultStructureVal).trim();
    const userContent = dsvToUse
      ? `Analyze wildfire risk for ${file.name} (default structure value $${Number(dsvToUse).toLocaleString()})`
      : `Analyze wildfire risk for ${file.name}`;
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
      if (dsvToUse !== "") {
        const dsvNum = Number(dsvToUse);
        if (!Number.isFinite(dsvNum) || dsvNum < 0) {
          throw new Error("Default structure value must be a number ≥ 0");
        }
        fd.append("default_structure_val", String(dsvNum));
      }
      const headers: Record<string, string> = {};
      if (RISK_API_KEY) headers["X-API-Key"] = RISK_API_KEY;

      const res = await fetch(RISK_API_URL, { method: "POST", headers, body: fd });

      if (!res.ok) {
        let detail = `Request failed (${res.status})`;
        try {
          const j = await res.json();
          if (j?.detail) detail = j.detail;
        } catch {
          // ignore
        }
        if (res.status === 400) detail = `Invalid CSV: ${detail}`;
        else if (res.status === 401) detail = `Unauthorized: ${detail}`;
        else if (res.status === 413) detail = `File too large: ${detail}`;
        throw new Error(detail);
      }

      const text = await res.text();
      const cd = res.headers.get("Content-Disposition") || "";
      const m = cd.match(/filename="([^"]+)"/);
      const filename = m?.[1] || "wildfire_risk.csv";

      const built = parseCsvToResult(text, filename);
      setResult(built);
      setPendingFile(null);
      setLastUploadedFile(file);
      if (overrideDefaultVal !== undefined) setDefaultStructureVal(overrideDefaultVal);

      const replyContent = dsvToUse
        ? `Recalculated ${built.rows.length} location${built.rows.length === 1 ? "" : "s"} using a default structure value of $${Number(dsvToUse).toLocaleString()} for rows missing data. Updated results below.`
        : `Analyzed ${built.rows.length} location${built.rows.length === 1 ? "" : "s"}. Results are shown below.`;
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: replyContent, result: { csvText: text, filename } },
      ]);
      if (convId) await saveMessage(convId, "assistant", replyContent, { csvText: text, filename });
      toast.success(`Analyzed ${built.rows.length} rows`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      toast.error(msg);
      const errContent = `Error: ${msg}`;
      setMessages((prev) => [...prev, { role: "assistant", content: errContent }]);
      if (convId) await saveMessage(convId, "assistant", errContent);
    } finally {
      setAnalyzing(false);
    }
  };

  const send = async () => {
    if (loading || analyzing) return;

    if (pendingFile) {
      await analyzeCsv(pendingFile);
      return;
    }

    const text = input.trim();
    if (!text) return;

    // Intercept "recalculate with default value X" intents → re-call the backend
    // with the previously uploaded CSV (or one rebuilt from the latest result).
    if (RECALC_INTENT_RE.test(text)) {
      const dv = extractDefaultValue(text);
      if (dv !== null) {
        let file: File | null = lastUploadedFile;
        if (!file) {
          const latest = [...messages].reverse().find((m) => m.result)?.result;
          if (latest) file = fileFromLatestResult(latest.csvText, latest.filename);
        }
        if (file) {
          setInput("");
          setMessages((prev) => [...prev, { role: "user", content: text }]);
          let convId = conversationId;
          if (!convId) {
            convId = await createConversation(text);
            setConversationId(convId);
          }
          if (convId) await saveMessage(convId, "user", text);
          await analyzeCsv(file, String(dv));
          return;
        }
      }
    }

    if (!text) return;
    const userMsg: Msg = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);

    let convId = conversationId;
    if (!convId) {
      convId = await createConversation(text);
      setConversationId(convId);
    }
    if (convId) await saveMessage(convId, "user", text);

    try {
      const localAnswer = answerFromLatestCsv(text, next);
      if (localAnswer) {
        setMessages((m) => [...m, { role: "assistant", content: localAnswer }]);
        if (convId) await saveMessage(convId, "assistant", localAnswer);
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const latestResult = [...next].reverse().find((m) => m.result)?.result;
      const payloadMessages = [
        ...(latestResult
          ? [{ role: "assistant" as const, content: buildCsvContext(latestResult) }]
          : []),
        ...next.map((m) => ({ role: m.role, content: m.content })),
      ];

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wildfire-chat`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: payloadMessages }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `Error ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let assistant = "";
      setMessages((m) => [...m, { role: "assistant", content: "" }]);

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistant += delta;
              setMessages((m) => {
                const copy = [...m];
                copy[copy.length - 1] = { role: "assistant", content: assistant };
                return copy;
              });
            }
          } catch {
            // ignore parse errors on partial chunks
          }
        }
      }
      if (convId && assistant) await saveMessage(convId, "assistant", assistant);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      toast.error(msg);
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${msg}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ConversationSidebar
        currentConversationId={conversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        refreshTrigger={sidebarRefreshTrigger}
        conversationType="wildfire"
        limit={20}
      />
      <div className="flex flex-col flex-1 h-full min-h-0 w-full">
        <main ref={scrollRef} className="flex-1 overflow-y-auto">
          {isLoadingHistory ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[60vh]">
              <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Loading your conversation...</p>
            </div>
          ) : (
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          <section className="rounded-2xl border border-border bg-gradient-to-br from-card via-card to-accent/5 p-6 md:p-8 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent to-primary flex items-center justify-center shrink-0 shadow-md">
                <Flame className="w-6 h-6 text-primary-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl md:text-2xl font-semibold text-foreground tracking-tight">
                  Wildfire Financial Risk Estimator
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Estimate financial wildfire risk for properties in California.
                </p>
              </div>
            </div>

            <p className="text-sm text-foreground mt-6 mb-3">I can help you estimate:</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { icon: TrendingUp, label: "Expected Annual Loss (EAL)" },
                { icon: BarChart3, label: "2-, 5-, 10-, 25-, 50-, and 100-year structural losses" },
                { icon: MapPin, label: "Property-level wildfire loss estimates from uploaded data" },
                { icon: LineChart, label: "Deep analysis on the losses" },
              ].map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5"
                >
                  <Icon className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <span className="text-sm text-foreground">{label}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-xl border border-border/60 bg-muted/30 p-4">
              <p className="text-sm text-foreground">
                Upload a CSV file with the following columns:
              </p>
              <pre className="mt-2 inline-block rounded-md bg-background border border-border px-3 py-1.5 text-sm font-mono text-primary">
                id, lon, lat
              </pre>
              <p className="text-xs text-muted-foreground mt-3">
                The app will return the associated wildfire loss estimates for each location.
              </p>
            </div>

            <div className="mt-4 rounded-xl border border-border/60 bg-background/40 p-4 space-y-2">
              <Label htmlFor="default-structure-val" className="text-sm">
                Default structure value (optional)
              </Label>
              <Input
                id="default-structure-val"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                placeholder="e.g. 750000"
                value={defaultStructureVal}
                onChange={(e) => setDefaultStructureVal(e.target.value)}
                disabled={analyzing || loading}
                className="max-w-xs"
              />
              <p className="text-xs text-muted-foreground">
                USD amount we use <span className="font-medium">only</span> when our
                structure-value grid has <span className="font-medium">no data</span> at a
                location — not when the grid intentionally reads $0. Leave blank to use grid
                values exclusively.
              </p>
            </div>
          </section>

          {messages.map((m, i) => (
            <div key={i} className="space-y-3">
              <div
                className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {m.role === "assistant" && (
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-primary flex items-center justify-center shrink-0">
                    <Flame className="w-4 h-4 text-primary-foreground" />
                  </div>
                )}
                <div
                  className={`rounded-2xl px-4 py-2.5 max-w-[80%] text-sm ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-card border border-border text-foreground"
                  }`}
                >
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-table:my-2 prose-table:border-collapse prose-th:border prose-th:border-border prose-th:bg-muted prose-th:px-2 prose-th:py-1 prose-th:text-left prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1 overflow-x-auto">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || "…"}</ReactMarkdown>
                  </div>
                </div>
              </div>
              {m.result && (
                <WildfireResults result={parseCsvToResult(m.result.csvText, m.result.filename)} />
              )}
            </div>
          ))}
          {loading && messages[messages.length - 1]?.role === "user" && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-primary flex items-center justify-center shrink-0">
                <Flame className="w-4 h-4 text-primary-foreground" />
              </div>
              <div className="rounded-2xl px-4 py-2.5 bg-card border border-border">
                <TypingIndicator />
              </div>
            </div>
          )}
          {analyzing && (
            <div className="flex gap-3 justify-start items-center text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing CSV…
            </div>
          )}
          </div>
          )}
        </main>

      <div className="flex-shrink-0 border-t border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 space-y-2">
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
              disabled={loading || analyzing}
              title="Attach a CSV (id, lon, lat)"
            >
              <Paperclip className="h-5 w-5" />
            </Button>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={
                pendingFile
                  ? "Press Analyze to estimate wildfire losses for this CSV…"
                  : "Ask about wildfire risk, or attach a CSV…"
              }
              disabled={loading || analyzing || !!pendingFile}
              className="min-h-[52px] max-h-32 resize-none bg-input border-border"
              rows={1}
            />
            <Button
              onClick={send}
              disabled={loading || analyzing || (!input.trim() && !pendingFile)}
              className="h-[52px] shrink-0"
            >
              {analyzing ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : pendingFile ? (
                <>Submit</>
              ) : (
                <Send className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </div>
      </div>
    </>
  );
};

export default WildfireChat;
