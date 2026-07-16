import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import TypingIndicator from "@/components/TypingIndicator";
import { ConversationSidebar } from "@/components/ConversationSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Wind,
  Loader2,
  Paperclip,
  Send,
  FileDown,
  FileText,
  Settings2,
  X,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import HurricaneTrackMap, { parseTrackText, type TrackPoint } from "@/components/HurricaneTrackMap";

type HurricaneFile = { name: string; path: string; signedUrl: string; size: number };

type Message = {
  role: "user" | "assistant";
  content: string;
  files?: HurricaneFile[];
  attachmentName?: string;
  trackPoints?: TrackPoint[];
  tifUrl?: string;
  trackText?: string;
};

type Modification = {
  field: "cp" | "vmax" | "lon" | "lat" | "rmw";
  op: "scale" | "add" | "set";
  value: number;
};

const FIELD_TOKEN_INDEX: Record<Modification["field"], number> = {
  lon: 3,
  lat: 4,
  cp: 5,
  rmw: 6,
  vmax: 7,
};

const applyOp = (n: number, op: Modification["op"], v: number) => {
  if (op === "scale") return n * v;
  if (op === "add") return n + v;
  return v;
};

const modifyTrackText = (text: string, mods: Modification[]): string => {
  const lines = text.split(/\r?\n/);
  return lines
    .map((line) => {
      const tokens: { start: number; end: number; text: string }[] = [];
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        tokens.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
      }
      if (tokens.length < 10) return line;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tokens[1].text)) return line;
      let newLine = line;
      const edits = mods
        .map((mod) => ({ mod, idx: FIELD_TOKEN_INDEX[mod.field] }))
        .filter((e) => e.idx !== undefined && tokens[e.idx])
        .sort((a, b) => b.idx - a.idx);
      for (const { mod, idx } of edits) {
        const tok = tokens[idx];
        const num = parseFloat(tok.text);
        if (isNaN(num)) continue;
        const newNum = applyOp(num, mod.op, mod.value);
        const dot = tok.text.indexOf(".");
        const decimals = dot >= 0 ? tok.text.length - dot - 1 : 0;
        const newText = newNum.toFixed(decimals);
        newLine = newLine.slice(0, tok.start) + newText + newLine.slice(tok.end);
      }
      return newLine;
    })
    .join("\n");
};

type Params = {
  n_stations: number;
  station_stride: number;
  num_workers: number;
  raster_res: number;
};

const DEFAULT_PARAMS: Params = {
  n_stations: 73,
  station_stride: 2,
  num_workers: 16,
  raster_res: 0.003,
};

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

const HurricaneChat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingTrackPoints, setPendingTrackPoints] = useState<TrackPoint[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [sidebarRefreshTrigger, setSidebarRefreshTrigger] = useState(0);
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { user, session } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      if (!user) { setIsLoadingHistory(false); return; }
      try {
        const { data } = await supabase
          .from("conversations")
          .select("id")
          .eq("user_id", user.id)
          .eq("conversation_type", "hurricane")
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
  }, [user]);

  const loadConversation = async (convId: string) => {
    setIsLoadingHistory(true);
    try {
      const { data: msgs } = await supabase
        .from("messages")
        .select("role, content, chart_data")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true });
      const loaded: Message[] = (msgs || []).map((m) => {
        const meta = (m.chart_data as Record<string, unknown> | null) || {};
        return {
          role: m.role as "user" | "assistant",
          content: m.content,
          files: (meta.files as HurricaneFile[] | undefined) || undefined,
          attachmentName: (meta.attachmentName as string | undefined) || undefined,
          trackPoints: (meta.trackPoints as TrackPoint[] | undefined) || undefined,
          tifUrl: (meta.tifUrl as string | undefined) || undefined,
          trackText: (meta.trackText as string | undefined) || undefined,
        };
      });
      setMessages(loaded);
      setConversationId(convId);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (messages.length > 0)
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const saveMessage = useCallback(
    async (
      convId: string,
      role: "user" | "assistant",
      content: string,
      meta?: { files?: HurricaneFile[]; attachmentName?: string; trackPoints?: TrackPoint[]; tifUrl?: string; trackText?: string }
    ) => {
      if (!user) return;
      const payload = {
        conversation_id: convId,
        user_id: user.id,
        role,
        content,
        chart_data: meta ? JSON.parse(JSON.stringify(meta)) : null,
      };
      await supabase.from("messages").insert(payload);
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", convId);
      setSidebarRefreshTrigger((p) => p + 1);
    },
    [user]
  );

  const createConversation = useCallback(
    async (title?: string): Promise<string | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("conversations")
        .insert({
          user_id: user.id,
          title: title || "Hurricane analysis",
          conversation_type: "hurricane",
        })
        .select("id")
        .single();
      if (error) return null;
      setSidebarRefreshTrigger((p) => p + 1);
      return data.id;
    },
    [user]
  );

  const handleFilePick = async (f: File | null) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".txt")) {
      toast({
        title: "Invalid file",
        description: "Please upload a .txt hurricane track file.",
        variant: "destructive",
      });
      return;
    }
    setPendingFile(f);
    try {
      const text = await f.text();
      const points = parseTrackText(text);
      setPendingTrackPoints(points);
      if (points.length === 0) {
        toast({
          title: "No track points found",
          description: "Could not parse lon/lat from the file.",
          variant: "destructive",
        });
      }
    } catch {
      setPendingTrackPoints(null);
    }
  };

  const getLatestTrack = useCallback((): { text: string; name: string } | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.trackText && m.attachmentName) {
        return { text: m.trackText, name: m.attachmentName };
      }
    }
    return null;
  }, [messages]);

  const runPrediction = useCallback(
    async (
      file: File,
      trackText: string,
      trackPoints: TrackPoint[] | undefined,
      userContent: string,
      convIdIn: string | null
    ) => {
      // Local-dev bypass: set VITE_COASTAL_API_URL (e.g. http://localhost:8020) to call the
      // CoastalFloodAIModel service directly (no Supabase function, no auth required).
      // Per-browser override first (production browser -> local backend), then build-time env:
      // localStorage.setItem("coastal_api_url", "http://localhost:8020")
      const localApi =
        (typeof localStorage !== "undefined" ? localStorage.getItem("coastal_api_url") : null) ||
        (import.meta.env.VITE_COASTAL_API_URL as string | undefined);
      if (!localApi && !session?.access_token) return;
      const baseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hurricane-predict`;
      const authHeaders: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};

      let convId = convIdIn;
      if (!convId) {
        convId = await createConversation(file.name.replace(/\.txt$/i, "").slice(0, 50));
        setConversationId(convId);
      }

      const userMessage: Message = {
        role: "user",
        content: userContent,
        attachmentName: file.name,
        trackPoints,
        trackText,
      };
      setMessages((prev) => [...prev, userMessage, { role: "assistant", content: "Submitting job..." }]);
      if (convId)
        await saveMessage(convId, "user", userContent, {
          attachmentName: file.name,
          trackPoints,
          trackText,
        });

      const startedAt = Date.now();
      let currentStage = "Submitting job...";
      const updateLastAssistant = (content: string) => {
        setMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === "assistant") {
              next[i] = { ...next[i], content };
              break;
            }
          }
          return next;
        });
      };
      const renderProgress = () => {
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        updateLastAssistant(`${currentStage} (elapsed ${elapsed}s)`);
      };
      const updateProgress = (text: string) => {
        currentStage = text;
        renderProgress();
      };
      const tickInterval = setInterval(renderProgress, 2000);

      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("n_stations", String(params.n_stations));
        fd.append("station_stride", String(params.station_stride));
        fd.append("num_workers", String(params.num_workers));
        fd.append("raster_res", String(params.raster_res));

        const submitRes = await fetch(localApi ? `${localApi}/predict` : baseUrl, {
          method: "POST",
          headers: authHeaders,
          body: fd,
        });
        const submitData = await submitRes.json().catch(() => ({}));
        if (!submitRes.ok) throw new Error(submitData?.error || `Submit failed (${submitRes.status})`);
        const jobId = submitData.job_id as string | undefined;
        if (!jobId) throw new Error("No job_id returned");

        updateProgress(`Job ${jobId.slice(0, 8)}… queued`);

        let status = "pending";
        while (status !== "complete" && status !== "completed" && status !== "done") {
          await new Promise((r) => setTimeout(r, 2000));
          const sRes = await fetch(
            localApi
              ? `${localApi}/status/${encodeURIComponent(jobId)}`
              : `${baseUrl}?action=status&job_id=${encodeURIComponent(jobId)}`,
            { headers: authHeaders }
          );
          const sData = await sRes.json().catch(() => ({}));
          if (!sRes.ok) throw new Error(sData?.error || `Status check failed (${sRes.status})`);
          status = String(sData.status || "").toLowerCase();
          if (status === "failed" || status === "error") {
            throw new Error(sData.error || sData.message || "Prediction job failed");
          }
          const progress = sData.progress ? ` — ${sData.progress}` : sData.message ? ` — ${sData.message}` : "";
          updateProgress(`Processing${progress}`);
        }

        updateProgress("Fetching results...");
        let files: HurricaneFile[] = [];
        if (localApi) {
          // local mode: the API returns a ZIP; unzip in the browser and expose blob URLs
          const rRes = await fetch(`${localApi}/result/${encodeURIComponent(jobId)}`);
          if (!rRes.ok) throw new Error(`Result fetch failed (${rRes.status})`);
          const { unzipSync } = await import("fflate");
          const raw = new Uint8Array(await rRes.arrayBuffer());
          const entries = unzipSync(raw);
          files = Object.entries(entries).map(([name, bytes]) => {
            const type = /\.tiff?$/i.test(name) ? "image/tiff" : "text/csv";
            const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
            return { name, path: name, signedUrl: url, size: bytes.length };
          });
        } else {
          const rRes = await fetch(`${baseUrl}?action=result`, {
            method: "POST",
            headers: { ...authHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ job_id: jobId, conversation_id: convId }),
          });
          const data = await rRes.json().catch(() => ({}));
          if (!rRes.ok) throw new Error(data?.error || `Result fetch failed (${rRes.status})`);
          files = (data.files as HurricaneFile[]) || [];
        }
        const tifFile = files.find((f) => /\.tiff?$/i.test(f.name));
        const replyText =
          files.length > 0
            ? `Prediction complete. ${files.length} file${files.length === 1 ? "" : "s"} ready to download below.`
            : "Prediction completed but no files were returned.";

        const assistantMessage: Message = {
          role: "assistant",
          content: replyText,
          files,
          trackPoints,
          tifUrl: tifFile?.signedUrl,
        };
        setMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === "assistant") {
              next[i] = assistantMessage;
              break;
            }
          }
          return next;
        });
        if (convId)
          await saveMessage(convId, "assistant", replyText, {
            files,
            trackPoints,
            tifUrl: tifFile?.signedUrl,
          });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Prediction failed";
        updateLastAssistant(`Error: ${msg}`);
        if (convId) await saveMessage(convId, "assistant", `Error: ${msg}`);
        toast({ title: "Prediction error", description: msg, variant: "destructive" });
      } finally {
        clearInterval(tickInterval);
      }
    },
    [session, params, createConversation, saveMessage, toast]
  );

  const runConversational = async (text: string) => {
    if (!session?.access_token) {
      toast({ title: "Authentication required", variant: "destructive" });
      navigate("/auth");
      return;
    }
    const latestTrack = getLatestTrack();
    const userMessage: Message = { role: "user", content: text };
    const historyForApi = [...messages, userMessage].map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMessage, { role: "assistant", content: "" }]);
    setInput("");
    setIsLoading(true);

    let convId = conversationId;
    if (!convId) {
      convId = await createConversation(text.slice(0, 50));
      setConversationId(convId);
    }
    if (convId) await saveMessage(convId, "user", text);

    let acc = "";
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hurricane-predict?action=chat`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ messages: historyForApi, has_track: !!latestTrack }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Chat failed (${res.status})`);
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
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
                // Hide the action tag while streaming
                const visible = acc.replace(/<run_prediction>[\s\S]*?(<\/run_prediction>|$)/, "").trimEnd();
                setMessages((prev) => {
                  const u = [...prev];
                  u[u.length - 1] = { role: "assistant", content: visible };
                  return u;
                });
              }
            } catch {
              // ignore
            }
          }
        }
      }

      // Parse action tag
      const tagMatch = acc.match(/<run_prediction>([\s\S]*?)<\/run_prediction>/);
      const cleanText = tagMatch ? acc.replace(tagMatch[0], "").trim() : acc;

      // Finalize assistant text
      setMessages((prev) => {
        const u = [...prev];
        u[u.length - 1] = { role: "assistant", content: cleanText };
        return u;
      });
      if (convId && cleanText) await saveMessage(convId, "assistant", cleanText);

      if (tagMatch && latestTrack) {
        let spec: { modifications?: Modification[]; note?: string };
        try {
          spec = JSON.parse(tagMatch[1].trim());
        } catch {
          toast({
            title: "Invalid modification",
            description: "AI returned a malformed action tag.",
            variant: "destructive",
          });
          return;
        }
        const mods = (spec.modifications || []).filter(
          (m) => m && FIELD_TOKEN_INDEX[m.field] !== undefined && typeof m.value === "number"
        );
        if (mods.length === 0) return;
        const newText = modifyTrackText(latestTrack.text, mods);
        const baseName = latestTrack.name.replace(/\.txt$/i, "");
        const newName = `${baseName}_modified.txt`;
        const newFile = new File([newText], newName, { type: "text/plain" });
        const newPoints = parseTrackText(newText);
        const summary = mods
          .map((m) => `${m.field} ${m.op} ${m.value}`)
          .join(", ");
        await runPrediction(
          newFile,
          newText,
          newPoints,
          spec.note || `Re-run with: ${summary}`,
          convId
        );
      } else if (tagMatch && !latestTrack) {
        toast({
          title: "No track to modify",
          description: "Attach a .txt track file first.",
          variant: "destructive",
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Chat failed";
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: `Error: ${msg}` };
        return next;
      });
      toast({ title: "Chat error", description: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!session?.access_token) {
      toast({ title: "Authentication required", variant: "destructive" });
      navigate("/auth");
      return;
    }
    const text = input.trim();
    if (!pendingFile && !text) return;

    if (!pendingFile) {
      await runConversational(text);
      return;
    }

    const file = pendingFile;
    const trackPoints = pendingTrackPoints || undefined;
    const userContent = text || `Run hurricane prediction on ${file.name}`;
    setInput("");
    setPendingFile(null);
    setPendingTrackPoints(null);
    setIsLoading(true);
    try {
      const trackText = await file.text();
      await runPrediction(file, trackText, trackPoints, userContent, conversationId);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewConversation = () => {
    setMessages([]);
    setConversationId(null);
    setIsLoadingHistory(false);
    setPendingFile(null);
    setPendingTrackPoints(null);
    setInput("");
  };

  const handleSelectConversation = (id: string) => {
    if (id !== conversationId) loadConversation(id);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const inputBar = (
    <div className="space-y-2">
      {pendingFile && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted text-sm">
            <FileText className="w-4 h-4 text-primary" />
            <span className="flex-1 truncate text-left">{pendingFile.name}</span>
            <span className="text-xs text-muted-foreground">{formatBytes(pendingFile.size)}</span>
            {pendingTrackPoints && pendingTrackPoints.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {pendingTrackPoints.length} pts
              </span>
            )}
            <button
              onClick={() => {
                setPendingFile(null);
                setPendingTrackPoints(null);
              }}
              className="p-1 hover:bg-background rounded"
              aria-label="Remove file"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {pendingTrackPoints && pendingTrackPoints.length > 0 && (
            <HurricaneTrackMap points={pendingTrackPoints} height={240} />
          )}
        </div>
      )}
      <div className="flex gap-2 items-end">
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          onClick={(e) => {
            (e.currentTarget as HTMLInputElement).value = "";
          }}
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
          disabled={isLoading}
          title="Attach hurricane track .txt file"
        >
          <Paperclip className="h-5 w-5" />
        </Button>

        <Popover modal={false}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-[52px] w-[52px] shrink-0"
              disabled={isLoading}
              title="Prediction parameters"
            >
              <Settings2 className="h-5 w-5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-72 z-[2000]"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <div className="space-y-3">
              <h4 className="font-medium text-sm">Prediction Parameters</h4>
              {([
                ["n_stations", "Number of stations", "integer"],
                ["station_stride", "Station stride", "integer"],
                ["num_workers", "Workers", "integer"],
                ["raster_res", "Raster resolution", "float"],
              ] as const).map(([key, label, kind]) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={key} className="text-xs">{label}</Label>
                  <Input
                    id={key}
                    type="number"
                    step={kind === "float" ? "0.001" : "1"}
                    value={params[key]}
                    onChange={(e) =>
                      setParams((p) => ({
                        ...p,
                        [key]: kind === "float" ? parseFloat(e.target.value) : parseInt(e.target.value || "0", 10),
                      }))
                    }
                  />
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setParams(DEFAULT_PARAMS)}
              >
                Reset to defaults
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            pendingFile
              ? "Add a note (optional) and press Send to run prediction..."
              : "Ask about coastal flood prediction, or attach a .txt track file..."
          }
          disabled={isLoading || isLoadingHistory}
          className="min-h-[52px] max-h-32 resize-none bg-input border-border focus:border-ring flex-1"
          rows={1}
        />
        <Button
          onClick={handleSend}
          disabled={isLoading || isLoadingHistory || (!pendingFile && !input.trim())}
          size="icon"
          className="h-[52px] w-[52px] shrink-0"
        >
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <ConversationSidebar
        currentConversationId={conversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        refreshTrigger={sidebarRefreshTrigger}
        conversationType="hurricane"
      />
      <div className="flex flex-col flex-1 h-full min-h-0">
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 py-6">
            {isLoadingHistory ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[60vh]">
                <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground">Loading your conversation...</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent to-primary flex items-center justify-center mb-6">
                  <Wind className="w-10 h-10 text-primary-foreground" />
                </div>
                <h2 className="text-2xl font-semibold text-foreground mb-2">
                  Coastal Flood Prediction
                </h2>
                <p className="text-muted-foreground max-w-lg mb-6">
                  Chat with me about coastal flood prediction, or attach a hurricane track{" "}
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">.txt</code> file (paperclip)
                  to run the surge & wind model.
                </p>

                <div className="max-w-2xl w-full mb-6 text-left">
                  <p className="text-xs text-muted-foreground mb-2">Expected track file format:</p>
                  <pre className="text-xs bg-muted text-muted-foreground rounded-md p-3 overflow-x-auto font-mono">
{`ID    Y-m-d H:M:S         LON(degree) LAT(degree) CP(pascal) RMW(m) VMAX(m/s) TRANSPEEDX(m/s) TRANSPEEDY(m/s)

6597  2026-07-28 21:00:00  -84.90      22.50       94820      37040  47.60     -0.95           9.27
6597  2026-07-28 22:00:00  -84.93      22.80       94993      41155  46.73     -0.95           9.27`}
                  </pre>
                </div>

                <div className="w-full max-w-2xl mb-6">{inputBar}</div>

                <div className="grid gap-2 w-full max-w-2xl sm:grid-cols-2">
                  {[
                    "What does this tool do?",
                    "Explain the .txt hurricane track file format",
                    "What do the prediction parameters mean?",
                    "What output files will I get back?",
                  ].map((ex) => (
                    <button
                      key={ex}
                      onClick={() => runConversational(ex)}
                      disabled={isLoading}
                      className="text-left px-4 py-3 rounded-xl bg-card border border-border hover:border-ring hover:bg-accent/50 transition-colors text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <details open className="rounded-lg border border-border bg-card/50">
                  <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                    Expected track file format
                  </summary>
                  <pre className="text-xs bg-muted text-muted-foreground rounded-b-md p-3 overflow-x-auto font-mono">
{`ID    Y-m-d H:M:S         LON(degree) LAT(degree) CP(pascal) RMW(m) VMAX(m/s) TRANSPEEDX(m/s) TRANSPEEDY(m/s)

6597  2026-07-28 21:00:00  -84.90      22.50       94820      37040  47.60     -0.95           9.27
6597  2026-07-28 22:00:00  -84.93      22.80       94993      41155  46.73     -0.95           9.27`}
                  </pre>
                </details>

                {messages.map((m, i) => (
                  <div
                    key={i}
                    className="flex justify-center"
                  >
                    <div
                      className={`${m.tifUrl ? "w-full" : "max-w-[85%]"} rounded-2xl px-4 py-3 ${
                        m.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-card border border-border"
                      }`}
                    >
                      {m.attachmentName && (
                        <div
                          className={`flex items-center gap-2 mb-2 text-xs ${
                            m.role === "user"
                              ? "text-primary-foreground/80"
                              : "text-muted-foreground"
                          }`}
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span className="truncate">{m.attachmentName}</span>
                        </div>
                      )}
                      <div className="whitespace-pre-wrap text-sm">{m.content}</div>
                      {((m.trackPoints && m.trackPoints.length > 0) || m.tifUrl) && (
                        <div className="mt-3">
                          <HurricaneTrackMap
                            points={m.trackPoints || []}
                            tifUrl={m.tifUrl}
                            height={m.tifUrl ? 480 : 260}
                            focusBounds={m.tifUrl ? [[24.4, -87.7], [31.1, -79.9]] : undefined}
                          />
                        </div>
                      )}
                      {m.files && m.files.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {m.files.map((f) => (
                            <a
                              key={f.path}
                              href={f.signedUrl}
                              download={f.name}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-background border border-border hover:border-ring transition-colors"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <FileDown className="w-4 h-4 text-primary shrink-0" />
                                <span className="text-sm truncate text-foreground">{f.name}</span>
                              </div>
                              <span className="text-xs text-muted-foreground shrink-0">
                                {formatBytes(f.size)}
                              </span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {isLoading && <TypingIndicator />}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </main>

        {messages.length > 0 && (
          <footer className="flex-shrink-0 border-t border-border bg-card/50 backdrop-blur-sm">
            <div className="max-w-4xl mx-auto px-4 py-4">{inputBar}</div>
          </footer>
        )}
      </div>
    </>
  );
};

export default HurricaneChat;
