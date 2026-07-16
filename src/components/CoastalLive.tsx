import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Waves, Loader2, Send, Square, CheckCircle2, Circle, ChevronDown, ChevronRight,
  Upload, MessageSquare, RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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

  // --------------------------- session lifecycle -----------------------------
  const restoreSession = useCallback(async (sid: string) => {
    try {
      const r = await fetch(`${apiBase()}/session/${sid}`);
      if (!r.ok) throw new Error(`session gone (${r.status})`);
      const d = await r.json();
      setSessionId(sid);
      setStormName(d.storm);
      setParamsCollapsed(true);
      setMessages((d.messages || []).map((m: any) => ({ role: m.role, content: m.content })));
      drawTrack(d.track);
      for (const run of d.runs || []) await addRunOverlay(sid, run.label);
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  }, [drawTrack, addRunOverlay]);

  useEffect(() => {
    if (!apiBase()) { setFatal("No backend configured — set the coastal API URL (settings/localStorage) first."); return; }
    const sid = localStorage.getItem(SESSION_KEY);
    if (sid) restoreSession(sid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    for (const label of result?.runs || []) await addRunOverlay(sid, label);
  };

  const stopTurn = async () => {
    const jid = activeJobRef.current;
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
    activeJobRef.current = null;
    if (jid) { try { await fetch(`${apiBase()}/cancel/${jid}`, { method: "POST" }); } catch { /* best-effort */ } }
    updateLast({ pending: false, error: "⏹ Stopped by user", status: "" });
    setChatSending(false);
  };

  const sendMessage = async () => {
    const text = chatInput.trim();
    if (!text || !sessionId || chatSending) return;
    setChatInput("");
    setChatSending(true);
    setMessages((prev) => [...prev, { role: "user", content: text },
      { role: "assistant", content: "", pending: true, status: "starting…", startedAt: Date.now() }]);
    try {
      const r = await fetch(`${apiBase()}/session/${sessionId}/message`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { job_id } = await r.json();
      activeJobRef.current = job_id;

      let settled = false;
      const tick = async () => {
        if (settled) return;
        try {
          const s = await fetch(`${apiBase()}/turn/${job_id}`);
          if (!s.ok) throw new Error(`HTTP ${s.status}`);
          const d = await s.json();
          const progress: { msg: string }[] = d.progress || [];
          let planSteps: string[] | undefined;
          const planDone: number[] = [];
          let status = "";
          for (const p of progress) {
            if (p.msg.startsWith("PLAN::")) { try { planSteps = JSON.parse(p.msg.slice(6)); } catch { /* noop */ } }
            else if (p.msg.startsWith("STEP_DONE::")) { const i = parseInt(p.msg.slice(11), 10); if (!Number.isNaN(i)) planDone.push(i); }
            else status = p.msg;
          }
          updateLast({ status, planSteps, planDone });
          if (d.status === "done") {
            settled = true;
            if (pollRef.current) window.clearInterval(pollRef.current);
            pollRef.current = null; activeJobRef.current = null;
            await finishTurn(sessionId, d.result);
            setChatSending(false);
          } else if (d.status === "cancelled") {
            settled = true;
            if (pollRef.current) window.clearInterval(pollRef.current);
            pollRef.current = null; activeJobRef.current = null;
            updateLast({ pending: false, error: "⏹ Stopped by user", status: "" });
            setChatSending(false);
          } else if (d.status === "error") {
            settled = true;
            if (pollRef.current) window.clearInterval(pollRef.current);
            pollRef.current = null; activeJobRef.current = null;
            updateLast({ pending: false, error: d.error || "Turn failed", status: "" });
            setChatSending(false);
          }
        } catch (e: any) {
          settled = true;
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null; activeJobRef.current = null;
          updateLast({
            pending: false, status: "",
            error: e.message?.includes("Failed to fetch") ? "Cannot reach server — check API base URL" : e.message,
          });
          setChatSending(false);
        }
      };
      pollRef.current = window.setInterval(tick, 5000);
      setTimeout(tick, 1500);
    } catch (e: any) {
      updateLast({ pending: false, error: e.message, status: "" });
      setChatSending(false);
    }
  };

  // ------------------------------- render ------------------------------------
  return (
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
                      <div className="prose prose-sm dark:prose-invert max-w-none text-sm [&_table]:text-xs">
                        <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }]]}>{m.content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="p-3 border-t border-border">
            <div className="flex gap-2 items-end">
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
  );
}
