import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Waves, Loader2, Send, Square, CheckCircle2, Circle, ChevronDown, ChevronRight,
  Upload, MessageSquare, RotateCcw, Paperclip,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConversationSidebar } from "@/components/ConversationSidebar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Backend resolution: per-browser override -> build-time env. The conversational agent
// lives on the CoastalFloodAI service itself (e.g. http://localhost:8020); there is no
// edge-function fallback for it.
const apiBase = () =>
  ((typeof localStorage !== "undefined" ? localStorage.getItem("coastal_api_url") : null) ||
    (import.meta.env.VITE_COASTAL_API_URL as string | undefined) ||
    ""
  ).trim().replace(/\/+$/, "");   // tolerate trailing slashes in saved URLs

type Msg = {
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  status?: string;
  planSteps?: string[];
  planDone?: number[];
  stepSecs?: Record<number, number>;   // completed step index -> duration (s)
  curStepStart?: number;               // epoch ms when the current step began
  error?: string;
  startedAt?: number;
};

type RunInfo = { label: string; summary?: any };

const SESSION_KEY = "coastal_live_session_id";

export default function CoastalLive() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const trackLayerRef = useRef<L.Polyline | null>(null);
  const overlaysRef = useRef<Map<string, L.ImageOverlay>>(new Map());
  const pollRef = useRef<number | null>(null);
  const activeJobRef = useRef<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pointsInputRef = useRef<HTMLInputElement | null>(null);

  const { user } = useAuth();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sidebarRefreshTrigger, setSidebarRefreshTrigger] = useState(0);
  const initDoneRef = useRef(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stormName, setStormName] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [legend, setLegend] = useState<{ label: string; scale?: { min_m: number; max_m: number } }[]>([]);
  const [hiddenRuns, setHiddenRuns] = useState<Set<string>>(new Set());
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [paramsCollapsed, setParamsCollapsed] = useState(false);
  const [opening, setOpening] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [, setClockTick] = useState(0);
  useEffect(() => {
    if (!chatSending) return;
    const id = window.setInterval(() => setClockTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [chatSending]);

  // ------------------------------- map ---------------------------------------
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current, { zoomControl: true }).setView([27.5, -82.5], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  const drawTrack = useCallback((pts: [number, number][]) => {
    if (!mapRef.current || !pts?.length) return;
    if (trackLayerRef.current) mapRef.current.removeLayer(trackLayerRef.current);
    trackLayerRef.current = L.polyline(pts, { color: "#2563eb", weight: 3, dashArray: "6 6" })
      .addTo(mapRef.current)
      .bindTooltip("Storm track", { sticky: true });
    mapRef.current.fitBounds(trackLayerRef.current.getBounds(), { padding: [40, 40] });
  }, []);

  const addRunOverlay = useCallback(async (sid: string, label: string) => {
    if (overlaysRef.current.has(label) || !mapRef.current) return;
    try {
      const r = await fetch(`${apiBase()}/session/${sid}/runlayer?label=${encodeURIComponent(label)}`);
      if (!r.ok) return;
      const d = await r.json();
      const ov = L.imageOverlay(d.image, d.bounds as any, { opacity: 0.7 }).addTo(mapRef.current);
      overlaysRef.current.set(label, ov);
      setLegend((prev) => prev.some((e) => e.label === label) ? prev : [...prev, { label, scale: d.scale }]);
      mapRef.current.fitBounds(d.bounds as any, { padding: [30, 30] });
    } catch (e) {
      console.warn("[coastal] overlay fetch failed", label, e);
    }
  }, []);

  const toggleRun = (label: string) => {
    const ov = overlaysRef.current.get(label);
    if (!ov || !mapRef.current) return;
    setHiddenRuns((prev) => {
      const next = new Set(prev);
      if (next.has(label)) { ov.addTo(mapRef.current!); next.delete(label); }
      else { mapRef.current!.removeLayer(ov); next.add(label); }
      return next;
    });
  };

  // --------------------------- conversation persistence ----------------------
  const createConversation = useCallback(async (title: string) => {
    if (!user) return null;
    const { data, error } = await supabase.from("conversations")
      .insert({ user_id: user.id, title: title.slice(0, 80), conversation_type: "coastal-live" })
      .select("id").single();
    setSidebarRefreshTrigger((p) => p + 1);
    return error ? null : (data?.id as string);
  }, [user]);

  const saveMessage = useCallback(async (convId: string | null, role: "user" | "assistant",
                                         content: string) => {
    if (!user || !convId || !content) return;
    await supabase.from("messages").insert({
      conversation_id: convId, user_id: user.id, role, content, chart_data: null,
    });
    await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
    setSidebarRefreshTrigger((p) => p + 1);
  }, [user]);

  // --------------------------- session lifecycle -----------------------------
  const restoreSession = useCallback(async (sid: string, useBackendMessages = true) => {
    try {
      const r = await fetch(`${apiBase()}/session/${sid}`);
      if (!r.ok) throw new Error(`session gone (${r.status})`);
      const d = await r.json();
      setSessionId(sid);
      setStormName(d.storm);
      setParamsCollapsed(true);
      if (useBackendMessages) {
        setMessages((d.messages || []).map((m: any) => ({ role: m.role, content: m.content })));
      }
      drawTrack(d.track);
      for (const run of d.runs || []) await addRunOverlay(sid, run.label);
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }, [drawTrack, addRunOverlay]);

  const handleSelectConversation = useCallback(async (id: string) => {
    setConversationId(id);
    setFatal(null);
    const { data: msgs } = await supabase.from("messages")
      .select("role, content").eq("conversation_id", id).order("created_at", { ascending: true });
    setMessages((msgs || []).map((m: any) => ({ role: m.role, content: m.content })));
    // map/runs live on the backend session tied to this conversation
    overlaysRef.current.forEach((ov) => mapRef.current?.removeLayer(ov));
    overlaysRef.current = new Map();
    setLegend([]); setHiddenRuns(new Set());
    const sid = localStorage.getItem(`coastal_session_${id}`);
    if (sid) { await restoreSession(sid, false); await resumeActiveTurn(sid); }
    else { setSessionId(null); setStormName(null); setParamsCollapsed(false); }
  }, [restoreSession]);

  const handleNewConversation = useCallback(() => {
    setConversationId(null);
    newStorm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (initDoneRef.current) return;
    if (!apiBase()) { setFatal("No backend configured — set the coastal API URL (settings/localStorage) first."); return; }
    if (user) {
      initDoneRef.current = true;
      (async () => {
        const { data } = await supabase.from("conversations").select("id")
          .eq("user_id", user.id).eq("conversation_type", "coastal-live")
          .order("updated_at", { ascending: false }).limit(1);
        if (data && data.length) handleSelectConversation(data[0].id);
        else { const sid = localStorage.getItem(SESSION_KEY); if (sid) restoreSession(sid); }
      })();
    } else {
      const sid = localStorage.getItem(SESSION_KEY);
      if (sid) { initDoneRef.current = true; restoreSession(sid).then(() => resumeActiveTurn(sid)); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const openSession = async (form: FormData, name: string) => {
    setOpening(true);
    try {
      const r = await fetch(`${apiBase()}/session`, { method: "POST", body: form });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.detail || `HTTP ${r.status}`);
      const d = await r.json();
      overlaysRef.current.forEach((ov) => mapRef.current?.removeLayer(ov));
      overlaysRef.current = new Map();
      setLegend([]); setHiddenRuns(new Set()); setMessages([]);
      setSessionId(d.session_id);
      setStormName(d.storm || name);
      localStorage.setItem(SESSION_KEY, d.session_id);
      drawTrack(d.track);
      setParamsCollapsed(true);
      const convId = await createConversation(`Storm: ${d.storm || name}`);
      if (convId) {
        setConversationId(convId);
        localStorage.setItem(`coastal_session_${convId}`, d.session_id);
      }
    } catch (e: any) {
      setFatal(`Could not open session: ${e.message}`);
    } finally {
      setOpening(false);
    }
  };

  const newStorm = () => {
    localStorage.removeItem(SESSION_KEY);
    overlaysRef.current.forEach((ov) => mapRef.current?.removeLayer(ov));
    overlaysRef.current = new Map();
    if (trackLayerRef.current && mapRef.current) mapRef.current.removeLayer(trackLayerRef.current);
    setSessionId(null); setStormName(null); setMessages([]); setLegend([]);
    setHiddenRuns(new Set()); setParamsCollapsed(false); setFatal(null);
  };

  // ------------------------------- chat --------------------------------------
  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const updateLast = (patch: Partial<Msg>) =>
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "assistant") { next[i] = { ...next[i], ...patch }; break; }
      }
      return next;
    });

  const finishTurn = async (sid: string, result: any) => {
    updateLast({ pending: false, content: result?.reply || "(no reply)", status: "" });
    saveMessage(conversationId, "assistant", result?.reply || "");
    for (const label of result?.runs || []) await addRunOverlay(sid, label);
  };

  const stopTurn = async () => {
    const jid = activeJobRef.current;
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
    activeJobRef.current = null;
    if (jid) { try { await fetch(`${apiBase()}/cancel/${jid}`, { method: "POST" }); } catch { /* best-effort */ } }
    localStorage.removeItem(ACTIVE_JOB_KEY);
    updateLast({ pending: false, error: "⏹ Stopped by user", status: "" });
    setChatSending(false);
  };

  const ACTIVE_JOB_KEY = "coastal_active_job";

  const startPolling = (job_id: string, sid: string) => {
    activeJobRef.current = job_id;
    localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ job_id, sid, convId: conversationId }));
    let settled = false;
    const clear = () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null; activeJobRef.current = null;
      localStorage.removeItem(ACTIVE_JOB_KEY);
    };
    const tick = async () => {
      if (settled) return;
      try {
        const s = await fetch(`${apiBase()}/turn/${job_id}`);
        if (!s.ok) throw new Error(`HTTP ${s.status}`);
        const d = await s.json();
        const progress: { msg: string; t?: string }[] = d.progress || [];
        let planSteps: string[] | undefined;
        const planDone: number[] = [];
        const stepSecs: Record<number, number> = {};
        let status = "";
        let boundary: number | null = null;   // epoch ms when the current step started
        for (const p of progress) {
          const ts = p.t ? Date.parse(p.t) : NaN;
          if (p.msg.startsWith("PLAN::")) {
            try { planSteps = JSON.parse(p.msg.slice(6)); } catch { /* noop */ }
            if (!Number.isNaN(ts)) boundary = ts;
          } else if (p.msg.startsWith("STEP_DONE::")) {
            const i = parseInt(p.msg.slice(11), 10);
            if (!Number.isNaN(i)) {
              planDone.push(i);
              if (boundary != null && !Number.isNaN(ts)) stepSecs[i] = Math.max(0, Math.round((ts - boundary) / 1000));
              if (!Number.isNaN(ts)) boundary = ts;
            }
          } else status = p.msg;
        }
        updateLast({ status, planSteps, planDone, stepSecs, curStepStart: boundary ?? undefined });
        if (d.status === "done") {
          settled = true; clear();
          await finishTurn(sid, d.result);
          setChatSending(false);
        } else if (d.status === "cancelled") {
          settled = true; clear();
          updateLast({ pending: false, error: "⏹ Stopped by user", status: "" });
          setChatSending(false);
        } else if (d.status === "error") {
          settled = true; clear();
          updateLast({ pending: false, error: d.error || "Turn failed", status: "" });
          setChatSending(false);
        }
      } catch (e: any) {
        settled = true; clear();
        updateLast({
          pending: false, status: "",
          error: e.message?.includes("Failed to fetch") ? "Cannot reach server — check API base URL" : e.message,
        });
        setChatSending(false);
      }
    };
    pollRef.current = window.setInterval(tick, 5000);
    setTimeout(tick, 1500);
  };

  // Re-attach to a turn that was in flight when the tab unmounted (the backend
  // kept running it; only the page lost track).
  const resumeActiveTurn = async (sid: string) => {
    const raw = localStorage.getItem(ACTIVE_JOB_KEY);
    if (!raw) return;
    try {
      const { job_id, sid: jobSid } = JSON.parse(raw);
      if (jobSid !== sid) return;
      const r = await fetch(`${apiBase()}/turn/${job_id}`);
      if (!r.ok) { localStorage.removeItem(ACTIVE_JOB_KEY); return; }
      const d = await r.json();
      if (d.status === "queued" || d.status === "running") {
        setMessages((prev) => [...prev, { role: "assistant", content: "", pending: true,
          status: "resuming…", startedAt: Date.now() }]);
        setChatSending(true);
        startPolling(job_id, sid);
      } else {
        if (d.status === "done" && d.result?.reply) {
          setMessages((prev) => [...prev, { role: "assistant", content: d.result.reply }]);
          saveMessage(conversationId, "assistant", d.result.reply);
          for (const label of d.result.runs || []) await addRunOverlay(sid, label);
        }
        localStorage.removeItem(ACTIVE_JOB_KEY);
      }
    } catch { localStorage.removeItem(ACTIVE_JOB_KEY); }
  };

  const uploadPoints = async (f: File) => {
    if (!sessionId) return;
    const fd = new FormData();
    fd.append("file", f);
    try {
      const r = await fetch(`${apiBase()}/session/${sessionId}/points`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.detail || `HTTP ${r.status}`);
      const note = `📎 Attached ${d.points} exposure locations from ${f.name} — ask me to "calculate losses at my locations".`;
      setMessages((prev) => [...prev, { role: "assistant", content: note }]);
      saveMessage(conversationId, "assistant", note);
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: "", error: `CSV upload failed: ${e.message}` }]);
    }
  };

  const sendMessage = async () => {
    const text = chatInput.trim();
    if (!text || !sessionId || chatSending) return;
    setChatInput("");
    setChatSending(true);
    setMessages((prev) => [...prev, { role: "user", content: text },
      { role: "assistant", content: "", pending: true, status: "starting…", startedAt: Date.now() }]);
    saveMessage(conversationId, "user", text);
    try {
      const r = await fetch(`${apiBase()}/session/${sessionId}/message`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { job_id } = await r.json();
      startPolling(job_id, sessionId);
    } catch (e: any) {
      updateLast({ pending: false, error: e.message, status: "" });
      setChatSending(false);
    }
  };

  // ------------------------------- render ------------------------------------
  return (
    <>
      {user && (
        <ConversationSidebar
          currentConversationId={conversationId}
          onSelectConversation={handleSelectConversation}
          onNewConversation={handleNewConversation}
          refreshTrigger={sidebarRefreshTrigger}
          conversationType="coastal-live"
          limit={20}
        />
      )}
    <div className="flex flex-1 h-full min-h-0">
      <div className="flex-1 relative">
        <div ref={mapContainerRef} className="absolute inset-0" />
        {(legend.length > 0 || trackLayerRef.current) && (
          <Card className="absolute bottom-4 left-4 z-[1000] p-3 space-y-2 max-w-xs bg-background/95">
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-block w-6 border-t-2 border-dashed border-blue-600" />
              <span className="font-medium">Storm track</span>
            </div>
            {legend.length > 0 && (
              <div className="space-y-1 border-t border-border pt-2">
                <p className="text-xs font-semibold">Inundation runs</p>
                {legend.map((e) => (
                  <label key={e.label} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={!hiddenRuns.has(e.label)} onChange={() => toggleRun(e.label)} />
                    <span className="font-medium">{e.label}</span>
                    {e.scale && (
                      <span className="text-muted-foreground">{e.scale.min_m}–{e.scale.max_m} m</span>
                    )}
                  </label>
                ))}
                <div className="h-2 rounded" style={{ background: "linear-gradient(to right, #2166ac, #67a9cf, #fddbc7, #d6604d, #b2182b)" }} />
                <div className="flex justify-between text-[10px] text-muted-foreground"><span>lower</span><span>water level</span><span>higher</span></div>
              </div>
            )}
          </Card>
        )}
      </div>

      <div className="border-l border-border bg-background flex flex-col min-h-0 shrink-0" style={{ width: 460 }}>
        <div className={paramsCollapsed ? "p-4 space-y-4 overflow-y-auto shrink-0" : "p-4 space-y-4 overflow-y-auto flex-1"}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Waves className="w-5 h-5 text-accent" />
              <h2 className="text-lg font-semibold text-foreground">Coastal Flood Live</h2>
            </div>
            {sessionId && (
              <Button variant="ghost" size="sm" onClick={newStorm} title="Start over with a new storm">
                <RotateCcw className="w-4 h-4 mr-1" /> New storm
              </Button>
            )}
          </div>

          {fatal && <Card className="p-3 text-xs text-destructive">{fatal}</Card>}

          <Card className="p-3 space-y-3">
            <button type="button" onClick={() => setParamsCollapsed((c) => !c)}
                    className="flex w-full items-center justify-between text-left">
              <Label className="text-sm font-medium cursor-pointer">
                Storm parameters
                {paramsCollapsed && stormName && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">✓ {stormName}</span>
                )}
              </Label>
              {paramsCollapsed ? <ChevronRight className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {!paramsCollapsed && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Provide a hurricane track to open a session (columns: ID, datetime, lon, lat,
                  pressure, RMW, Vmax, translation speed).
                </p>
                <input ref={fileInputRef} type="file" accept=".txt" className="hidden"
                       onChange={(e) => {
                         const f = e.target.files?.[0];
                         if (!f) return;
                         const fd = new FormData();
                         fd.append("file", f);
                         openSession(fd, f.name);
                         e.target.value = "";
                       }} />
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" disabled={opening}
                          onClick={() => fileInputRef.current?.click()}>
                    <Upload className="w-4 h-4 mr-2" /> Upload track file
                  </Button>
                </div>
                <div className="flex gap-2 items-center">
                  <span className="text-xs text-muted-foreground">or example:</span>
                  {["Ian", "Idalia"].map((n) => (
                    <Button key={n} size="sm" variant="secondary" disabled={opening}
                            onClick={() => { const fd = new FormData(); fd.append("example", n.toLowerCase()); openSession(fd, n); }}>
                      {opening ? <Loader2 className="w-3 h-3 animate-spin" /> : n}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>

        <div className="border-t border-border bg-card/30 flex flex-col min-h-0"
             style={paramsCollapsed ? { flex: 1 } : { height: "45%", minHeight: 280 }}>
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
            <MessageSquare className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold text-foreground">Agent Chat</h3>
          </div>

          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <p className="text-xs text-muted-foreground leading-relaxed py-4">
                {sessionId
                  ? <>Try: <strong className="text-foreground">"run the baseline prediction"</strong>, then{" "}
                     <strong className="text-foreground">"rerun with 20% stronger winds"</strong> or{" "}
                     <strong className="text-foreground">"shift landfall 50 km north"</strong>, then{" "}
                     <strong className="text-foreground">"compare the runs"</strong>.</>
                  : "Load a storm track above to start."}
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                {m.role === "user" ? (
                  <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm max-w-[85%] break-words">{m.content}</div>
                ) : (
                  <div className="text-sm text-foreground space-y-2 max-w-full">
                    {m.pending ? (
                      <div className="space-y-1.5">
                        {m.planSteps && m.planSteps.length > 0 && (
                          <div className="rounded-md border border-border bg-muted/40 px-2.5 py-2 space-y-1">
                            {m.planSteps.map((step, si) => {
                              const isDone = m.planDone?.includes(si);
                              const isCurrent = !isDone && (m.planDone?.length ?? 0) === si;
                              return (
                                <div key={si}>
                                  <div className={`flex items-center gap-2 text-xs ${isDone ? "text-muted-foreground line-through" : isCurrent ? "text-foreground" : "text-muted-foreground"}`}>
                                    {isDone ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
                                      : isCurrent ? <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
                                      : <Circle className="w-3.5 h-3.5 shrink-0 opacity-40" />}
                                    <span>{step}</span>
                                    {isDone && m.stepSecs?.[si] != null && (
                                      <span className="ml-auto text-[10px] tabular-nums no-underline text-muted-foreground">{m.stepSecs[si]}s</span>
                                    )}
                                    {isCurrent && m.curStepStart && (
                                      <span className="ml-auto text-[10px] tabular-nums text-primary">
                                        {Math.max(0, Math.round((Date.now() - m.curStepStart) / 1000))}s
                                      </span>
                                    )}
                                  </div>
                                  {isCurrent && m.status && (
                                    <div key={m.status} className="ml-[22px] mt-0.5 text-[11px] italic text-muted-foreground truncate">{m.status}</div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {(!m.planSteps || m.planSteps.length === 0) && (
                          <div className="flex items-center gap-2 text-muted-foreground text-xs">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>{m.status || "Working…"}</span>
                          </div>
                        )}
                      </div>
                    ) : m.error ? (
                      <div className="text-xs text-destructive break-words">{m.error}</div>
                    ) : (
                      <div className="text-sm space-y-2 max-w-full">
                        <ReactMarkdown
                          remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
                          components={{
                            h1: ({ children }) => <h3 className="text-sm font-bold mt-3 mb-1">{children}</h3>,
                            h2: ({ children }) => <h3 className="text-sm font-bold mt-3 mb-1">{children}</h3>,
                            h3: ({ children }) => <h4 className="text-[13px] font-semibold mt-2 mb-1">{children}</h4>,
                            p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
                            ul: ({ children }) => <ul className="my-1 ml-4 list-disc space-y-0.5">{children}</ul>,
                            ol: ({ children }) => <ol className="my-1 ml-4 list-decimal space-y-0.5">{children}</ol>,
                            li: ({ children }) => <li className="leading-snug">{children}</li>,
                            strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                            code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-[11px] font-mono">{children}</code>,
                            table: ({ children }) => (
                              <div className="my-2 -mx-1 overflow-x-auto rounded-md border border-border">
                                <table className="w-full border-collapse text-xs">{children}</table>
                              </div>
                            ),
                            thead: ({ children }) => <thead className="bg-muted/70">{children}</thead>,
                            tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
                            tr: ({ children }) => <tr className="hover:bg-muted/30">{children}</tr>,
                            th: ({ children }) => <th className="px-2 py-1.5 text-left font-semibold text-foreground border-b border-border whitespace-nowrap">{children}</th>,
                            td: ({ children }) => <td className="px-2 py-1.5 text-foreground/90 align-top">{children}</td>,
                          }}
                        >{m.content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="p-3 border-t border-border">
            <div className="flex gap-2 items-end">
              <input ref={pointsInputRef} type="file" accept=".csv" className="hidden"
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPoints(f); e.target.value = ""; }} />
              <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0"
                      disabled={!sessionId || chatSending}
                      onClick={() => pointsInputRef.current?.click()}
                      title="Attach a CSV of locations (id, lon, lat) for loss estimation">
                <Paperclip className="w-4 h-4" />
              </Button>
              <Textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder={sessionId ? "Ask the agent…" : "Load a storm track first…"}
                disabled={!sessionId || chatSending}
                rows={1}
                className="min-h-[40px] max-h-24 resize-none text-sm"
              />
              {chatSending ? (
                <Button onClick={stopTurn} variant="destructive" size="icon" className="h-10 w-10 shrink-0" title="Stop this run">
                  <Square className="w-4 h-4 fill-current" />
                </Button>
              ) : (
                <Button onClick={sendMessage} disabled={!sessionId || !chatInput.trim()} size="icon" className="h-10 w-10 shrink-0">
                  <Send className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
