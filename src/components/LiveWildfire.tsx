import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Flame, Loader2, Settings as SettingsIcon, Upload, Pencil, Send, MessageSquare, Lightbulb, AlertTriangle, Layers, GitCompare, DollarSign, Download, Building2, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ConversationSidebar } from "@/components/ConversationSidebar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// Fix leaflet default icon paths
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

type Progress = { t: string; msg: string };
type ScenarioInfo = {
  label: string;
  final_acres: number;
  applied?: any;
  color: string;
  geojson?: any;
};
type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  scenarios?: ScenarioInfo[];
  polygon?: any;
  status?: string;
  pending?: boolean;
  error?: string;
  jobId?: string;
  sessionId?: string;
  sessionFetchBuildings?: boolean;
  startedAt?: number;
};


type ScenarioLegendEntry = { label: string; color: string; acres: number };

const SCENARIO_COLORS = ["#10b981", "#84cc16", "#f59e0b", "#f97316", "#dc2626", "#7f1d1d", "#8b5cf6"];
const MAX_SCENARIOS_ON_MAP = 6;
const SCENARIO_DASHES = ["", "6 4", "2 4", "10 5", "1 5", "12 3 2 3"];

// Pinned least-to-worst scenario ladder. ALWAYS sent in full to /agent.
const SCENARIO_LADDER = [
  {
    label: "real_day",
    coeffs: "global",
    m1_offset: 0, m10_offset: 0, m100_offset: 0,
    suppression: { enabled: false },
    buildings: { enabled: false },
  },
  {
    label: "elevated_wind",
    coeffs: "global", wind_speed_mult: 1.1,
    m1_offset: 0, m10_offset: 0, m100_offset: 0,
    suppression: { enabled: false },
    buildings: { enabled: false },
  },
  {
    label: "critical_fire_weather",
    coeffs: "global", wind_speed_mult: 1.4,
    m1_offset: -1.5, m10_offset: -1.5, m100_offset: -2.0,
    suppression: { enabled: false },
    buildings: { enabled: false },
  },
  {
    label: "extreme_wind_event",
    coeffs: "global", wind_speed_mult: 1.6,
    m1_offset: -2.5, m10_offset: -2.5, m100_offset: -3.5,
    suppression: { enabled: false },
    buildings: { enabled: false },
  },
  {
    label: "urban_spread_contained",
    coeffs: "global", wind_speed_mult: 1.6,
    m1_offset: -2.5, m10_offset: -2.5, m100_offset: -3.5,
    suppression: { enabled: true, max_contain: 60 },
    buildings: { enabled: true, sep: 15, nonburn: 0.80 },
  },
  {
    label: "urban_firestorm",
    coeffs: "global", wind_speed_mult: 1.6,
    m1_offset: -2.5, m10_offset: -2.5, m100_offset: -3.5,
    suppression: { enabled: false },
    buildings: { enabled: true, sep: 15, nonburn: 0.80 },
  },
] as const;

const SCENARIO_DISPLAY_NAMES: Record<string, string> = {
  real_day: "Real Day",
  elevated_wind: "Elevated Wind",
  critical_fire_weather: "Critical Fire Weather",
  extreme_wind_event: "Extreme Wind Event",
  urban_spread_contained: "Urban Spread — with Suppression",
  urban_firestorm: "Urban Firestorm",
};

const displayNameForScenario = (label?: string) =>
  SCENARIO_DISPLAY_NAMES[label ?? ""] ?? label;

const SCENARIO_LABEL_ORDER = SCENARIO_LADDER.map((s) => s.label as string);
const scenarioOrderIndex = (label: string) => {
  const idx = SCENARIO_LABEL_ORDER.indexOf(label);
  return idx === -1 ? SCENARIO_LABEL_ORDER.length : idx;
};

const LADDER_FOOTNOTE =
  "Winds are hourly sustained 10-m winds; gusts run ~1.5× higher. Elevated Wind, Critical Fire Weather, and Extreme Wind Event scale the real-day wind by +10%, +40%, and +60% respectively. Urban Spread — with Suppression and Urban Firestorm use the same +60% wind as Extreme Wind Event, differing only by suppression and building-to-building spread.";

const LADDER_INSTRUCTION =
  "Run the pinned least-to-worst scenario ladder. Report acres, growth_by_day, footprint, structures burned, and intensity per member. Use these display names in the report: Real Day, Elevated Wind, Critical Fire Weather, Extreme Wind Event, Urban Spread — with Suppression, Urban Firestorm."; 

const applyScenarioDisplayNames = (text: string) =>
  Object.entries(SCENARIO_DISPLAY_NAMES).reduce(
    (acc, [slug, name]) => acc.replace(new RegExp(`\\b${slug}\\b`, "g"), name),
    text,
  );

const scenarioStyle = (color: string, index: number): L.PathOptions => ({
  color,
  weight: 3,
  opacity: 0.95,
  fillColor: color,
  fillOpacity: 0.18,
  dashArray: SCENARIO_DASHES[index % SCENARIO_DASHES.length] || undefined,
});

function capScenarioStack<T>(items: T[], onRemove?: (item: T) => void): T[] {
  const next = [...items];
  while (next.length > MAX_SCENARIOS_ON_MAP) {
    const [removed] = next.splice(1, 1);
    if (removed) onRemove?.(removed);
  }
  return next;
}

// Decorates "Findings" / "Limitations" headings (and others) with an icon + accent bar.
const SectionHeading = ({
  level,
  children,
}: {
  level: 1 | 2 | 3 | 4;
  children: React.ReactNode;
}) => {
  const text = String(
    Array.isArray(children)
      ? children.map((c) => (typeof c === "string" ? c : "")).join("")
      : typeof children === "string"
      ? children
      : "",
  ).trim();
  const lower = text.toLowerCase();

  const isFindings = /^findings?\b|key findings?/i.test(lower);
  const isLimitations = /^limitations?\b|caveats?/i.test(lower);

  if (isFindings || isLimitations) {
    const Icon = isFindings ? Lightbulb : AlertTriangle;
    const accent = isFindings
      ? "border-emerald-500/70 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : "border-amber-500/70 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    return (
      <div
        className={`mt-3 mb-1.5 flex items-center gap-2 rounded-md border-l-4 px-2.5 py-1.5 ${accent}`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="text-[13px] font-semibold tracking-tight">{text}</span>
      </div>
    );
  }

  const sizeCls =
    level === 1
      ? "text-base font-semibold"
      : level === 2
      ? "text-sm font-semibold"
      : "text-[13px] font-semibold";
  return <div className={`mt-2 mb-1 text-foreground ${sizeCls}`}>{children}</div>;
};



const formatElapsed = (sec: number) => {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
};

// Pick a phase icon from the status text so the indicator itself conveys what's happening,
// instead of a generic spinner. Pulses to show it's active.
const StageIcon = ({ status }: { status: string }) => {
  const s = (status || "").toLowerCase();
  const cls = "w-4 h-4 mt-0.5 shrink-0 animate-pulse";
  if (/loss|exposure|ground-up|structures|damage/.test(s)) return <DollarSign className={cls} />;
  if (/footprint|building/.test(s)) return <Building2 className={cls} />;
  if (/metric|footprint & metrics|extracting/.test(s)) return <BarChart3 className={cls} />;
  if (/fire-spread|running scenario|scenario/.test(s)) return <Flame className={cls} />;
  if (/fetch|prepar|weather|terrain|fuel|wind|bundle|downscal|3dep|hrrr|landfire/.test(s))
    return <Download className={cls} />;
  return <Loader2 className="w-4 h-4 mt-0.5 shrink-0 animate-spin" />; // submitting / unknown
};

const StageStatus = ({ status, startedAt }: { status: string; startedAt?: number }) => {
  const [stageStart, setStageStart] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());
  const prevStatus = useRef<string>(status);

  useEffect(() => {
    if (prevStatus.current !== status) {
      prevStatus.current = status;
      setStageStart(Date.now());
    }
  }, [status]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const stageSec = Math.max(0, Math.floor((now - stageStart) / 1000));
  const totalSec = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : null;

  return (
    <span className="text-xs break-words">
      {status || "Working…"}{" "}
      <span className="text-muted-foreground/70 tabular-nums">
        · {formatElapsed(stageSec)}
        {totalSec !== null ? ` (total ${formatElapsed(totalSec)})` : ""}
      </span>
    </span>
  );
};

const LiveWildfire = () => {
  const { user } = useAuth();
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);
  const ignitionLayerRef = useRef<L.GeoJSON | null>(null);
  const footprintLayerRef = useRef<L.GeoJSON | null>(null);
  const scenarioLayersRef = useRef<Map<string, L.Layer>>(new Map());
  const containmentLayerRef = useRef<L.GeoJSON | null>(null);
  const pollRef = useRef<number | null>(null);
  const agentPollRef = useRef<number | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const sessionInputsRef = useRef<string | null>(null);
  const sessionFetchBuildingsRef = useRef<boolean>(false);


  const [polygon, setPolygon] = useState<any>(null);
  const [containmentLine, setContainmentLine] = useState<any>(null);
  const [holdPct, setHoldPct] = useState<number>(50);
  const [ignitionDate, setIgnitionDate] = useState<string>("2018-11-08T17:54");
  const [duration, setDuration] = useState<number>(24);
  const [useWindninja, setUseWindninja] = useState<boolean>(false);
  const [running, setRunning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(
    () => localStorage.getItem("wf_api_base") || "http://localhost:8000"
  );
  const [apiKey, setApiKey] = useState<string>(() => localStorage.getItem("wf_api_key") || "");

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [scenarioLegend, setScenarioLegend] = useState<ScenarioLegendEntry[]>([]);
  const [hiddenScenarios, setHiddenScenarios] = useState<Set<string>>(new Set());
  const [baselineHidden, setBaselineHidden] = useState(false);

  // Conversation persistence
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sidebarRefreshTrigger, setSidebarRefreshTrigger] = useState(0);

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem("wf_panel_width"));
    return saved && saved >= 280 ? saved : 380;
  });
  const resizingRef = useRef(false);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const w = Math.min(Math.max(window.innerWidth - e.clientX, 280), Math.min(900, window.innerWidth - 200));
      setPanelWidth(w);
      mapRef.current?.invalidateSize();
    };
    const onUp = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem("wf_panel_width", String(panelWidth));
      setTimeout(() => mapRef.current?.invalidateSize(), 50);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [panelWidth]);

  const saveMessage = useCallback(
    async (
      convId: string,
      role: "user" | "assistant",
      content: string,
      meta?: {
        scenarios?: ChatMessage["scenarios"];
        polygon?: any;
        error?: string;
        status?: string;
        pending?: boolean;
        jobId?: string;
        sessionId?: string;
          sessionFetchBuildings?: boolean;
        startedAt?: number;
      },
    ): Promise<string | null> => {

      if (!user) return null;
      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: convId,
          user_id: user.id,
          role,
          content,
          chart_data: meta ? JSON.parse(JSON.stringify(meta)) : null,
        })
        .select("id")
        .single();
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", convId);
      setSidebarRefreshTrigger((p) => p + 1);
      if (error) return null;
      return data?.id ?? null;
    },
    [user],
  );

  const updateMessageRow = useCallback(
    async (
      msgId: string,
      content: string,
      meta?: Record<string, unknown>,
    ) => {
      await supabase
        .from("messages")
        .update({
          content,
          chart_data: meta ? JSON.parse(JSON.stringify(meta)) : null,
        })
        .eq("id", msgId);
    },
    [],
  );

  const createConversation = useCallback(
    async (title: string): Promise<string | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("conversations")
        .insert({
          user_id: user.id,
          title: title.slice(0, 80) || "Live wildfire scenario",
          conversation_type: "live-wildfire",
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
    const { data: msgs } = await supabase
      .from("messages")
      .select("id, role, content, chart_data")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    const loaded: ChatMessage[] = (msgs || []).map((m) => {
      const meta = (m.chart_data as Record<string, unknown> | null) || {};
      const scenarios = Array.isArray(meta.scenarios)
        ? (meta.scenarios as ChatMessage["scenarios"])
        : undefined;
      const poly = (meta as any).polygon ?? undefined;
      const err = typeof meta.error === "string" ? (meta.error as string) : undefined;
      const status = typeof meta.status === "string" ? (meta.status as string) : undefined;
      const pending = Boolean((meta as any).pending);
      const jobId = typeof (meta as any).jobId === "string" ? (meta as any).jobId : undefined;
      const sessionId = typeof (meta as any).sessionId === "string" ? (meta as any).sessionId : undefined;
      const sessionFetchBuildings =
        typeof (meta as any).sessionFetchBuildings === "boolean" ? (meta as any).sessionFetchBuildings : undefined;
      const startedAt = typeof (meta as any).startedAt === "number" ? (meta as any).startedAt : undefined;
      return {
        id: m.id as string,
        role: m.role as "user" | "assistant",
        content: m.content,
        scenarios,
        polygon: poly,
        error: err,
        status,
        pending,
        jobId,
        sessionId,
        sessionFetchBuildings,
        startedAt,
      };
    });
    setMessages(loaded);
    setConversationId(convId);
    clearScenarioLayersNoState();

    // Restore ignition polygon from most recent message that has one
    const lastWithPoly = [...loaded].reverse().find((m) => m.polygon);
    if (lastWithPoly?.polygon) {
      setPolygon(lastWithPoly.polygon);
      restoreIgnitionLayer(lastWithPoly.polygon);
    } else {
      setPolygon(null);
    }

    // Restore session id from most recent message that carries one
    const lastWithSession = [...loaded].reverse().find((m) => m.sessionId);
    const sid = lastWithSession?.sessionId || localStorage.getItem(`wf_session_${convId}`) || null;
    setSessionId(sid);
    if (sid) localStorage.setItem(`wf_session_${convId}`, sid);
    const storedFetchBuildings = localStorage.getItem(`wf_session_fetch_buildings_${convId}`);
    sessionFetchBuildingsRef.current =
      lastWithSession?.sessionFetchBuildings ?? (storedFetchBuildings === "true" ? true : false);
    // Clear the inputs fingerprint — we don't know what inputs the persisted session was opened with,
    // so the next sendTurn will treat it as "unchanged" (no false reopen) but openSession will refresh it.
    sessionInputsRef.current = null;

    // Restore scenario footprints from ALL assistant messages (across runs)
    const allScenarios: ScenarioInfo[] = [];
    const seenLabels = new Set<string>();
    loaded.forEach((m) => {
      if (m.role !== "assistant" || !m.scenarios) return;
      m.scenarios.forEach((s) => {
        if (!s?.geojson) return;
        let label = s.label;
        let n = 2;
        while (seenLabels.has(label)) label = `${s.label} (${n++})`;
        seenLabels.add(label);
        allScenarios.push({ ...s, label });
      });
    });
    if (allScenarios.length) restoreScenarioLayers(allScenarios);

    // Resume polling for any in-flight (pending) assistant message
    const pendingMsg = loaded.find((m) => m.role === "assistant" && m.pending && m.jobId && m.sessionId);
    if (pendingMsg?.jobId && pendingMsg.id && pendingMsg.sessionId) {
      resumePolling(pendingMsg.id, pendingMsg.jobId, pendingMsg.sessionId, convId);
    }
  }, []);



  // Load most recent live-wildfire conversation on mount
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("id")
        .eq("user_id", user.id)
        .eq("conversation_type", "live-wildfire")
        .order("updated_at", { ascending: false })
        .limit(1);
      if (data && data.length > 0) await loadConversation(data[0].id);
    })();
  }, [user, loadConversation]);

  const clearScenarioLayersNoState = () => {
    if (!mapRef.current) return;
    scenarioLayersRef.current.forEach((l) => mapRef.current!.removeLayer(l));
    scenarioLayersRef.current = new Map();
    setScenarioLegend([]);
    setHiddenScenarios(new Set());
  };

  const removeScenarioLayer = (label: string) => {
    const layer = scenarioLayersRef.current.get(label);
    if (layer && mapRef.current) mapRef.current.removeLayer(layer);
    scenarioLayersRef.current.delete(label);
  };

  const restyleScenarioStack = (legend: ScenarioLegendEntry[]) => {
    legend.forEach((entry, index) => {
      const layer = scenarioLayersRef.current.get(entry.label) as any;
      if (!layer) return;
      if (typeof layer.setStyle === "function") layer.setStyle(scenarioStyle(entry.color, index));
      if (typeof layer.bringToFront === "function") layer.bringToFront();
    });
  };

  const appendScenarioLegendEntries = (entries: ScenarioLegendEntry[]) => {
    setScenarioLegend((prev) => {
      const removedLabels: string[] = [];
      const next = capScenarioStack(
        [...prev, ...entries].sort((a, b) => scenarioOrderIndex(a.label) - scenarioOrderIndex(b.label)),
        (removed) => removedLabels.push(removed.label)
      );
      removedLabels.forEach(removeScenarioLayer);
      if (removedLabels.length) {
        setHiddenScenarios((hidden) => {
          const n = new Set(hidden);
          removedLabels.forEach((label) => n.delete(label));
          return n;
        });
      }
      restyleScenarioStack(next);
      return next;
    });
  };

  // Wait until Leaflet map is initialized (loadConversation can fire before the map effect runs)
  const waitForMap = (): Promise<L.Map> =>
    new Promise((resolve) => {
      if (mapRef.current) return resolve(mapRef.current);
      const iv = window.setInterval(() => {
        if (mapRef.current) {
          window.clearInterval(iv);
          resolve(mapRef.current);
        }
      }, 100);
    });

  const restoreIgnitionLayer = async (geom: any) => {
    const map = await waitForMap();
    if (ignitionLayerRef.current) {
      map.removeLayer(ignitionLayerRef.current);
      ignitionLayerRef.current = null;
    }
    drawnItemsRef.current?.clearLayers();
    const layer = L.geoJSON(geom, {
      style: { color: "#3b82f6", weight: 3, fillOpacity: 0.1 },
    }).addTo(map);
    ignitionLayerRef.current = layer;
    try {
      map.fitBounds(layer.getBounds(), { padding: [30, 30] });
    } catch {}
  };

  const restoreScenarioLayers = async (scenarios: ScenarioInfo[]) => {
    const map = await waitForMap();
    // Clear any prior scenario layers
    scenarioLayersRef.current.forEach((l) => map.removeLayer(l));
    scenarioLayersRef.current = new Map();

    const legend: ScenarioLegendEntry[] = [];
    const cappedScenarios = capScenarioStack(scenarios);
    const sortedScenarios = [...cappedScenarios].sort(
      (a, b) => scenarioOrderIndex(a.label) - scenarioOrderIndex(b.label)
    );
    sortedScenarios.forEach((s, index) => {
      if (!s.geojson) return;
      const layer = L.geoJSON(s.geojson, {
        style: scenarioStyle(s.color, index),
      }).addTo(map);
      scenarioLayersRef.current.set(s.label, layer);
      legend.push({ label: s.label, color: s.color, acres: s.final_acres });
    });
    setScenarioLegend(legend);
    setHiddenScenarios(new Set());

    const all = Array.from(scenarioLayersRef.current.values());
    if (all.length) {
      try {
        map.fitBounds(L.featureGroup(all as any).getBounds(), { padding: [30, 30] });
      } catch {}
    }
  };

  const handleNewConversation = async () => {
    setMessages([]);
    setConversationId(null);
    setSessionId(null);
    sessionInputsRef.current = null;
    sessionFetchBuildingsRef.current = false;
    setChatInput("");
    setPolygon(null);
    setContainmentLine(null);

    if (ignitionLayerRef.current && mapRef.current) {
      mapRef.current.removeLayer(ignitionLayerRef.current);
      ignitionLayerRef.current = null;
    }
    if (containmentLayerRef.current && mapRef.current) {
      mapRef.current.removeLayer(containmentLayerRef.current);
      containmentLayerRef.current = null;
    }
    drawnItemsRef.current?.clearLayers();
    clearScenarioLayersNoState();

    // Eagerly create an empty conversation so it shows up in the sidebar immediately
    const newId = await createConversation("New wildfire scenario");
    if (newId) setConversationId(newId);
  };


  const handleSelectConversation = (id: string) => {
    if (id !== conversationId) loadConversation(id);
  };


  // Init map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = L.map(mapContainerRef.current, { zoomControl: true }).setView([37.5, -119.5], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    drawnItemsRef.current = drawnItems;

    map.on((L as any).Draw.Event.CREATED, (e: any) => {
      const layer = e.layer;
      const layerType = e.layerType;
      if (layerType === "polyline") {
        if (containmentLayerRef.current) {
          map.removeLayer(containmentLayerRef.current);
          containmentLayerRef.current = null;
        }
        layer.setStyle({ color: "#000000", weight: 3, dashArray: "8 6", opacity: 0.9 });
        layer.addTo(map);
        containmentLayerRef.current = layer;
        const gj = layer.toGeoJSON();
        // Store the full Feature (geometry + properties) so the backend sees
        // a valid GeoJSON LineString Feature with hold_pct in properties.
        setContainmentLine(gj);
        toast.success("Confinement line captured");
        return;
      }
      drawnItems.clearLayers();
      if (ignitionLayerRef.current) {
        map.removeLayer(ignitionLayerRef.current);
        ignitionLayerRef.current = null;
      }
      layer.setStyle({ color: "#3b82f6", weight: 3, fillOpacity: 0.1 });
      drawnItems.addLayer(layer);
      const geojson = layer.toGeoJSON();
      setPolygon(geojson.geometry);
      toast.success("Fire perimeter captured");
    });

    mapRef.current = map;

    // Ensure tiles render correctly when container size changes (sidebar toggle, tab switch, etc.)
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
    });
    ro.observe(mapContainerRef.current);
    const onWinResize = () => map.invalidateSize();
    window.addEventListener("resize", onWinResize);
    // initial nudge after layout settles
    const t1 = window.setTimeout(() => map.invalidateSize(), 100);
    const t2 = window.setTimeout(() => map.invalidateSize(), 500);

    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      if (agentPollRef.current) window.clearInterval(agentPollRef.current);
      ro.disconnect();
      window.removeEventListener("resize", onWinResize);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      map.remove();
      mapRef.current = null;
    };
  }, []);


  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  const startDrawing = () => {
    if (!mapRef.current || !drawnItemsRef.current) return;
    drawnItemsRef.current.clearLayers();
    if (ignitionLayerRef.current) {
      mapRef.current.removeLayer(ignitionLayerRef.current);
      ignitionLayerRef.current = null;
    }
    setPolygon(null);
    const polyDraw = new (L as any).Draw.Polygon(mapRef.current, {
      shapeOptions: { color: "#3b82f6", weight: 3 },
    });
    polyDraw.enable();
    toast.info("Click on the map to draw a polygon. Click first point to finish.");
  };


  const startDrawingLine = () => {
    if (!mapRef.current) return;
    if (containmentLayerRef.current) {
      mapRef.current.removeLayer(containmentLayerRef.current);
      containmentLayerRef.current = null;
    }
    setContainmentLine(null);
    const lineDraw = new (L as any).Draw.Polyline(mapRef.current, {
      shapeOptions: { color: "#000000", weight: 3, dashArray: "8 6", opacity: 0.9 },
    });
    lineDraw.enable();
    toast.info("Click on the map to draw the confinement line. Double-click to finish.");
  };

  const clearConfinementLine = () => {
    if (containmentLayerRef.current && mapRef.current) {
      mapRef.current.removeLayer(containmentLayerRef.current);
    }
    containmentLayerRef.current = null;
    setContainmentLine(null);
  };



  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !mapRef.current) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        let geom: any = null;
        if (data.type === "FeatureCollection") geom = data.features[0]?.geometry;
        else if (data.type === "Feature") geom = data.geometry;
        else if (data.type === "Polygon" || data.type === "MultiPolygon") geom = data;
        if (!geom) throw new Error("No polygon found");

        drawnItemsRef.current?.clearLayers();
        if (ignitionLayerRef.current) mapRef.current!.removeLayer(ignitionLayerRef.current);
        const layer = L.geoJSON(geom, {
          style: { color: "#3b82f6", weight: 3, fillOpacity: 0.1 },
        }).addTo(mapRef.current!);
        ignitionLayerRef.current = layer;
        mapRef.current!.fitBounds(layer.getBounds());
        setPolygon(geom);
        toast.success("GeoJSON loaded");
      } catch (err: any) {
        toast.error("Invalid GeoJSON: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const apiHeaders = (): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) h["x-api-key"] = apiKey;
    return h;
  };

  const saveSettings = () => {
    localStorage.setItem("wf_api_base", apiBaseUrl);
    localStorage.setItem("wf_api_key", apiKey);
    toast.success("Settings saved");
    setShowSettings(false);
  };

  const updateAssistantById = useCallback((msgId: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = 0; i < next.length; i++) {
        if (next[i].id === msgId) {
          next[i] = { ...next[i], ...patch };
          break;
        }
      }
      return next;
    });
  }, []);

  // ============ SESSION-BASED CHAT ============
  // NOTE: the backend now builds building footprints lazily from NSI the first time a
  // building-spread scenario runs (and ignores the `fetch_buildings` request flag), so we
  // NEVER need to re-open a session for buildings. A session is reused for the whole fire;
  // only a NEW polygon opens a new session. `needsBuildingsForText` now only tweaks the
  // "opening session…" status label — it does not affect session reuse.
  const needsBuildingsForText = (text: string): boolean => {
    const t = text.toLowerCase();
    // Explicit building / loss / urban / WUI intent → true
    if (/(ladder|urban spread|urban firestorm|building|structures?|\bwui\b|loss(es)?|damage|estimate loss)/.test(t)) {
      return true;
    }
    // Known non-building scenarios → false
    if (/^\s*run\s+(a\s+)?(real[- ]day|the\s+(real[- ]day|extreme wind event|elevated wind|critical fire weather)\s+scenario)/.test(t)) {
      return false;
    }
    // Unsure → default TRUE (cheap safety: only cost is a slower first prepare).
    return true;
  };

  // Open a new conversational session for one fire (polygon + ignition).
  const openSession = useCallback(
    async (name: string, fetchBuildings: boolean): Promise<string> => {
      if (!polygon) throw new Error("Draw or upload a fire perimeter first");
      const isoDate = new Date(ignitionDate).toISOString().replace(/\.\d{3}Z$/, "Z");
      const body = {
        name,
        polygon,
        ignition_date: isoDate,
        duration_hours: Number(duration) || 24,
        margin_km: 30,
        // Backend ignores this and builds footprints lazily from NSI; kept false so prepare
        // never triggers the old (slow) OSM path.
        fetch_buildings: false,
        use_windninja: useWindninja,
      };
      console.log("[wildfire] POST /session body:", { ...body, polygon: "<polygon>" });
      const res = await fetch(`${apiBaseUrl}/session`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`POST /session HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const sid = data.session_id as string;
      if (!sid) throw new Error("No session_id returned");
      // Only key on polygon — a NEW polygon means a new session. Ignition date/duration/wind changes
      // do NOT open a new session; the follow-up message goes to the existing session.
      sessionInputsRef.current = JSON.stringify({ p: polygon });
      sessionFetchBuildingsRef.current = fetchBuildings;
      return sid;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiBaseUrl, apiKey, polygon, ignitionDate, duration, useWindninja],
  );

  // Fetch full session state to enrich scenarios with final_acres etc.
  const fetchSessionState = useCallback(
    async (sid: string): Promise<any> => {
      const res = await fetch(`${apiBaseUrl}/session/${sid}`, { headers: apiHeaders() });
      if (!res.ok) throw new Error(`GET /session HTTP ${res.status}`);
      return res.json();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiBaseUrl, apiKey],
  );

  // After a turn completes: render reply, fetch footprints for new scenarios, add to map.
  const finishTurn = useCallback(
    async (
      jobId: string,
      sid: string,
      msgId: string,
      _convId: string | null,
    ) => {
      try {
        const res = await fetch(`${apiBaseUrl}/result/${jobId}`, { headers: apiHeaders() });
        if (!res.ok) throw new Error(`GET /result HTTP ${res.status}`);
        const data = await res.json();
        const r = data.result || {};
        const reply: string = applyScenarioDisplayNames((r.reply || "(no reply)").trim());
        const labels: string[] = Array.isArray(r.scenarios) ? r.scenarios : [];

        // Get authoritative scenario info (final_acres, etc.) from session state
        let stateScenarios: any[] = [];
        try {
          const state = await fetchSessionState(sid);
          stateScenarios = Array.isArray(state?.scenarios) ? state.scenarios : [];
        } catch (e) {
          console.warn("[wildfire] session state fetch failed", e);
        }
        const acresByLabel: Record<string, number> = {};
        stateScenarios.forEach((s) => {
          if (s?.label) acresByLabel[s.label] = Number(s.final_acres ?? 0);
        });

        const isLadderResult = labels.some((l) => SCENARIO_DISPLAY_NAMES[l]);
        let summary = reply;
        if (isLadderResult && !summary.includes(LADDER_FOOTNOTE.slice(0, 50))) {
          summary += `\n\n*${LADDER_FOOTNOTE}*`;
        }

        // Skip scenarios already rendered (backend returns full session list on every turn)
        const existingLabels = new Set(scenarioLayersRef.current.keys());
        const newLabels = labels.filter((l) => !existingLabels.has(l));

        const colorOffset = scenarioLegend.length;
        const colored = newLabels.map((origLabel, i) => ({
          origLabel,
          label: origLabel,
          final_acres: acresByLabel[origLabel] ?? 0,
          color: SCENARIO_COLORS[(colorOffset + i) % SCENARIO_COLORS.length],
        }));

        updateAssistantById(msgId, {
          pending: false,
          content: summary,
          scenarios: colored.map(({ origLabel: _o, ...rest }) => rest),
          status: "",
        });

        const newLegendEntries: ScenarioLegendEntry[] = [];
        const scenariosWithGeo: ScenarioInfo[] = await Promise.all(
          colored.map(async (s, i) => {
            try {
              const fpRes = await fetch(
                `${apiBaseUrl}/session/${sid}/footprint?scenario=${encodeURIComponent(s.origLabel)}`,
                { headers: apiHeaders() }
              );
              if (!fpRes.ok) {
                return { label: s.label, final_acres: s.final_acres, color: s.color };
              }
              const fp = await fpRes.json();
              if (mapRef.current) {
                const layer = L.geoJSON(fp, {
                  style: scenarioStyle(s.color, colorOffset + i),
                }).addTo(mapRef.current);
                scenarioLayersRef.current.set(s.label, layer);
                newLegendEntries.push({ label: s.label, color: s.color, acres: s.final_acres });
              }
              return { label: s.label, final_acres: s.final_acres, color: s.color, geojson: fp };
            } catch (e) {
              console.error("footprint fetch failed", s.label, e);
              return { label: s.label, final_acres: s.final_acres, color: s.color };
            }
          })
        );

        appendScenarioLegendEntries(newLegendEntries);

        await updateMessageRow(msgId, summary, {
          scenarios: scenariosWithGeo,
          polygon,
          sessionId: sid,
          sessionFetchBuildings: sessionFetchBuildingsRef.current,
        });

        const allLayers = Array.from(scenarioLayersRef.current.values());
        if (mapRef.current && allLayers.length) {
          try {
            mapRef.current.fitBounds(L.featureGroup(allLayers as any).getBounds(), { padding: [30, 30] });
          } catch {}
        }
      } catch (err: any) {
        updateAssistantById(msgId, { pending: false, error: err.message, status: "" });
        await updateMessageRow(msgId, "", {
          error: err.message,
          polygon,
          sessionId: sid,
          sessionFetchBuildings: sessionFetchBuildingsRef.current,
        });
      } finally {
        setChatSending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiBaseUrl, apiKey, polygon, scenarioLegend.length, fetchSessionState, updateAssistantById, updateMessageRow],
  );

  // Poll /status/{job_id} every 5s until done/error.
  const pollJob = useCallback(
    (jobId: string, sid: string, msgId: string, convId: string | null) => {
      if (agentPollRef.current) window.clearInterval(agentPollRef.current);
      let settled = false;
      let inFlight = false;

      const tick = async () => {
        if (settled || inFlight) return;
        inFlight = true;
        try {
          const res = await fetch(`${apiBaseUrl}/status/${jobId}`, { headers: apiHeaders() });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const progress: Progress[] = data.progress || [];
          if (progress.length) {
            updateAssistantById(msgId, { status: progress[progress.length - 1].msg });
          }
          if (data.status === "done") {
            settled = true;
            if (agentPollRef.current) window.clearInterval(agentPollRef.current);
            agentPollRef.current = null;
            await finishTurn(jobId, sid, msgId, convId);
          } else if (data.status === "error") {
            settled = true;
            if (agentPollRef.current) window.clearInterval(agentPollRef.current);
            agentPollRef.current = null;
            const errMsg = data.error || "Turn failed";
            updateAssistantById(msgId, { pending: false, error: errMsg, status: "" });
            await updateMessageRow(msgId, "", { error: errMsg, polygon, sessionId: sid });
            setChatSending(false);
          }
        } catch (err: any) {
          settled = true;
          if (agentPollRef.current) window.clearInterval(agentPollRef.current);
          agentPollRef.current = null;
          const msg = err.message?.includes("Failed to fetch")
            ? "Cannot reach server — check API base URL"
            : err.message;
          updateAssistantById(msgId, { pending: false, error: msg, status: "" });
          await updateMessageRow(msgId, "", {
            error: msg,
            polygon,
            sessionId: sid,
            sessionFetchBuildings: sessionFetchBuildingsRef.current,
          });
          setChatSending(false);
        } finally {
          inFlight = false;
        }
      };
      agentPollRef.current = window.setInterval(tick, 5000);
      tick();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiBaseUrl, apiKey, polygon, finishTurn, updateAssistantById, updateMessageRow],
  );


  const resumePolling = useCallback(
    (msgId: string, jobId: string, sid: string, convId: string) => {
      setChatSending(true);
      pollJob(jobId, sid, msgId, convId);
    },
    [pollJob],
  );

  // Send one turn (POST /session/{id}/message). Opens a session if none yet.
  const sendTurn = useCallback(
    async (text: string, opts?: { fetchBuildings?: boolean; forceNewSession?: boolean }) => {
      if (!text.trim()) return;
      if (chatSending) {
        toast.error("Wait for the current turn to finish");
        return;
      }
      if (!polygon) {
        toast.error("Draw or upload a fire perimeter first");
        return;
      }

      // Decide whether this turn requires building footprints.
      const needBuildings =
        opts?.fetchBuildings !== undefined ? opts.fetchBuildings : needsBuildingsForText(text);

      setChatSending(true);
      setError("");

      // Optimistic UI
      setMessages((prev) => [
        ...prev,
        { role: "user", content: text, polygon },
        { role: "assistant", content: "", pending: true, status: "Submitting…", startedAt: Date.now() },
      ]);

      let convId = conversationId;
      if (!convId) {
        convId = await createConversation(text);
        if (convId) setConversationId(convId);
      }
      if (convId) await saveMessage(convId, "user", text, { polygon });

      // Open session ONLY if not already open, or if the polygon changed (new fire).
      // All other follow-up turns (re-run, add wind, estimate losses, ladder, …) reuse
      // the existing session so the prepared bundle + building footprints are reused.
      let sid = sessionId;
      const currentInputs = JSON.stringify({ p: polygon });
      const polygonChanged = sid && sessionInputsRef.current && sessionInputsRef.current !== currentInputs;
      if (polygonChanged) {
        console.log("[wildfire] New polygon drawn — opening a new session");
        sid = null;
        setSessionId(null);
        if (convId) {
          localStorage.removeItem(`wf_session_${convId}`);
          localStorage.removeItem(`wf_session_fetch_buildings_${convId}`);
        }
        sessionFetchBuildingsRef.current = false;
      }
      try {
        if (!sid) {
          updateAssistantById(""/* not yet */, {}); // no-op
          // We don't have the assistant msgId yet; update via setMessages
          setMessages((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].role === "assistant") {
                next[i] = {
                  ...next[i],
                  status: needBuildings
                    ? "Opening session (fetching weather, buildings…)"
                    : "Opening session (fetching weather…)",
                };
                break;
              }
            }
            return next;
          });
          sid = await openSession(text.slice(0, 60) || "live wildfire", needBuildings);
          setSessionId(sid);
          if (convId) {
            localStorage.setItem(`wf_session_${convId}`, sid);
            localStorage.setItem(`wf_session_fetch_buildings_${convId}`, String(sessionFetchBuildingsRef.current));
          }
        }
      } catch (err: any) {
        const msg = err.message?.includes("Failed to fetch")
          ? "Cannot reach server — check API base URL"
          : err.message;
        setMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === "assistant") {
              next[i] = { ...next[i], pending: false, error: msg, status: "" };
              break;
            }
          }
          return next;
        });
        if (convId) await saveMessage(convId, "assistant", "", { error: msg });
        setChatSending(false);
        return;
      }

      // Submit the turn
      let jobId: string;
      try {
        console.log("[wildfire] POST /session/.../message:", { sessionId: sid, text });
        const res = await fetch(`${apiBaseUrl}/session/${sid}/message`, {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const data = await res.json();
        jobId = data.job_id;
        if (!jobId) throw new Error("No job_id returned");
      } catch (err: any) {
        const msg = err.message?.includes("Failed to fetch")
          ? "Cannot reach server — check API base URL"
          : err.message;
        setMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === "assistant") {
              next[i] = { ...next[i], pending: false, error: msg, status: "" };
              break;
            }
          }
          return next;
        });
        if (convId) {
          await saveMessage(convId, "assistant", "", {
            error: msg,
            sessionId: sid,
            sessionFetchBuildings: sessionFetchBuildingsRef.current,
          });
        }
        setChatSending(false);
        return;
      }

      const status = `Queued: ${jobId}`;
      let msgId: string | null = null;
      if (convId) {
        msgId = await saveMessage(convId, "assistant", "", {
          pending: true,
          jobId,
          status,
          polygon,
          sessionId: sid,
          sessionFetchBuildings: sessionFetchBuildingsRef.current,
          startedAt: Date.now(),
        });
      }
      // No-auth / no-persistence mode: saveMessage returns null (no Supabase user). Use a
      // client-side id so the UI can still track the message and poll (updateAssistantById
      // matches in-memory by id; the Supabase update just no-ops with no matching row).
      if (!msgId) msgId = crypto.randomUUID();
      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === "assistant") {
            next[i] = {
              ...next[i],
              id: msgId ?? undefined,
              jobId,
              status,
              sessionId: sid ?? undefined,
              sessionFetchBuildings: sessionFetchBuildingsRef.current,
            };
            break;
          }
        }
        return next;
      });

      pollJob(jobId, sid, msgId, convId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiBaseUrl, apiKey, polygon, chatSending, conversationId, sessionId, createConversation, saveMessage, openSession, pollJob, updateAssistantById],
  );

  const sendChatMessage = async () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    await sendTurn(text);
  };

  const runScenarioLadder = async () => {
    // Reuse the existing session — the ladder is just another message.
    // The prepared bundle + building footprints from the first turn are reused.
    await sendTurn(LADDER_INSTRUCTION);
  };

  const runRealDay = async () => {
    await sendTurn(
      containmentLine
        ? `Run a real-day baseline simulation. Apply the drawn confinement line at ${holdPct}% holding.`
        : "Run a real-day baseline simulation.",
      { fetchBuildings: false },
    );
  };

  const runExtremeWindEvent = async () => {
    await sendTurn(
      containmentLine
        ? `Run the Extreme Wind Event scenario. Apply the drawn confinement line at ${holdPct}% holding.`
        : "Run the Extreme Wind Event scenario.",
      { fetchBuildings: false },
    );
  };

  const estimateLosses = async () => {
    await sendTurn("Estimate losses for the current scenarios.", { fetchBuildings: true });
  };





  return (
    <>
      <ConversationSidebar
        currentConversationId={conversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        refreshTrigger={sidebarRefreshTrigger}
        conversationType="live-wildfire"
        limit={20}
      />
    <div className="flex flex-1 h-full min-h-0">
      {/* Map */}
      <div className="flex-1 relative">
        <div ref={mapContainerRef} className="absolute inset-0" />
        {/* Legend */}
        <div className="absolute bottom-4 left-4 z-[1000] bg-card/95 backdrop-blur border border-border rounded-lg px-3 py-2 shadow-lg text-xs space-y-1 max-w-[280px]">
          <div className="flex items-center gap-2">
            <span className="inline-block w-4 h-2 border-2 border-blue-500 bg-blue-500/10" />
            <span className="text-foreground">Ignition perimeter</span>
          </div>
          {containmentLine && (
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-4 h-0 border-t-2 border-black"
                style={{ borderStyle: "dashed" }}
              />
              <span className="text-foreground">Confinement line ({holdPct}% hold)</span>
            </div>
          )}
          {(footprintLayerRef.current || scenarioLegend.length > 0) && (
            <>
              <div className="border-t border-border pt-1 mt-1 font-medium text-foreground">Scenarios</div>
              {footprintLayerRef.current && (
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!baselineHidden}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      const layer = footprintLayerRef.current;
                      if (layer && mapRef.current) {
                        if (checked) mapRef.current.addLayer(layer);
                        else mapRef.current.removeLayer(layer);
                      }
                      setBaselineHidden(!checked);
                    }}
                    className="h-3 w-3 cursor-pointer"
                    style={{ accentColor: "#dc2626" }}
                  />
                  <span className="inline-block w-4 h-2 bg-orange-500/60 border border-red-600" />
                  <span className="text-foreground truncate">
                    Baseline{(() => {
                      const a = result?.scenarios?.[0]?.final_acres ?? result?.scenario?.final_acres;
                      return a ? ` — ${Math.round(a).toLocaleString()} ac` : "";
                    })()}
                  </span>
                </label>
              )}
              {scenarioLegend.map((s) => {
                const visible = !hiddenScenarios.has(s.label);
                return (
                  <label key={s.label} className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        const layer = scenarioLayersRef.current.get(s.label);
                        if (layer && mapRef.current) {
                          if (checked) mapRef.current.addLayer(layer);
                          else mapRef.current.removeLayer(layer);
                        }
                        setHiddenScenarios((prev) => {
                          const next = new Set(prev);
                          if (checked) next.delete(s.label);
                          else next.add(s.label);
                          return next;
                        });
                      }}
                      className="h-3 w-3 cursor-pointer"
                      style={{ accentColor: s.color }}
                    />
                    <span
                      className="inline-block w-4 h-2 border"
                      style={{ backgroundColor: s.color + "80", borderColor: s.color }}
                    />
                    <span className="text-foreground truncate">
                      {displayNameForScenario(s.label)} — {Math.round(s.acres).toLocaleString()} ac
                    </span>
                  </label>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          resizingRef.current = true;
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";
        }}
        className="w-1 cursor-col-resize bg-border hover:bg-primary/50 transition-colors shrink-0"
        title="Drag to resize"
      />

      {/* Control panel */}
      <div
        style={{ width: panelWidth }}
        className="border-l border-border bg-background flex flex-col min-h-0 shrink-0"
      >
        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-accent" />
              <h2 className="text-lg font-semibold text-foreground">Wildfire Simulator</h2>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettings((s) => !s)}
              aria-label="Settings"
            >
              <SettingsIcon className="w-4 h-4" />
            </Button>
          </div>

          {showSettings && (
            <Card className="p-3 space-y-3">
              <div className="space-y-1">
                <Label htmlFor="api-base">API Base URL</Label>
                <Input
                  id="api-base"
                  value={apiBaseUrl}
                  onChange={(e) => setApiBaseUrl(e.target.value)}
                  placeholder="http://localhost:8000"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="api-key">API Key (optional)</Label>
                <Input
                  id="api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
              <Button size="sm" onClick={saveSettings} className="w-full">
                Save Settings
              </Button>
            </Card>
          )}

          <Card className="p-3 space-y-3">
            <Label className="text-sm font-medium">Fire parameters</Label>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2 items-center">
                <Button onClick={startDrawing} variant="outline" disabled={running} className="flex-1">
                  <Pencil className="w-4 h-4 mr-2" />
                  Draw fire perimeter
                </Button>
                <span className="text-xs text-muted-foreground">or</span>
                <div className="flex-1">
                  <input
                    type="file"
                    accept=".geojson,application/geo+json,application/json"
                    onChange={handleUpload}
                    className="hidden"
                    id="geojson-upload"
                    disabled={running}
                  />
                  <label htmlFor="geojson-upload" className="block">
                    <Button asChild variant="outline" disabled={running} className="w-full">
                      <span className="cursor-pointer">
                        <Upload className="w-4 h-4 mr-2" />
                        Upload GeoJSON
                      </span>
                    </Button>
                  </label>
                </div>
              </div>
              {polygon && (
                <p className="text-xs text-muted-foreground">✓ Polygon ready</p>
              )}
            </div>

            <div className="flex gap-2">
              <div className="flex-[2] space-y-1">
                <Label htmlFor="ignition-date" className="text-xs">Ignition date & time</Label>
                <Input
                  id="ignition-date"
                  type="datetime-local"
                  value={ignitionDate}
                  onChange={(e) => setIgnitionDate(e.target.value)}
                  disabled={running}
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label htmlFor="duration" className="text-xs">Duration (hours)</Label>
                <Input
                  id="duration"
                  type="number"
                  min={1}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  disabled={running}
                />
              </div>
            </div>

            <div className="space-y-2 rounded-md border border-border p-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="use-windninja" className="text-xs font-medium cursor-pointer">
                  Terrain winds
                </Label>
                <Switch
                  id="use-windninja"
                  checked={useWindninja}
                  onCheckedChange={setUseWindninja}
                  disabled={running}
                />
              </div>
              {useWindninja && (
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Terrain winds make the first run slower (it computes wind over the terrain
                  hour-by-hour). Applies to the whole session — flip before preparing the fire,
                  or start a new conversation for the change to take effect.
                </p>
              )}
            </div>

            <div className="border-t border-border pt-3 space-y-2">
              <Label className="text-xs font-medium">Confinement line (optional)</Label>
              <div className="flex gap-2">
                <Button
                  onClick={startDrawingLine}
                  variant="outline"
                  size="sm"
                  disabled={running}
                  className="flex-1"
                >
                  <Pencil className="w-4 h-4 mr-2" />
                  Draw confinement line
                </Button>
                <div className="flex items-center gap-2 flex-1">
                  <Label htmlFor="hold-pct" className="text-xs whitespace-nowrap">
                    Line hold %
                  </Label>
                  <Input
                    id="hold-pct"
                    type="number"
                    min={0}
                    max={100}
                    value={holdPct}
                    onChange={(e) =>
                      setHoldPct(Math.max(0, Math.min(100, Number(e.target.value))))
                    }
                    disabled={running}
                    className="h-8 flex-1"
                  />
                </div>
              </div>
              {containmentLine && (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    ✓ Line ready — will hold at {holdPct}%
                  </p>
                  <Button
                    onClick={clearConfinementLine}
                    variant="ghost"
                    size="sm"
                    disabled={running}
                  >
                    Clear
                  </Button>
                </div>
              )}
            </div>
          </Card>



          {(running || statusMsg) && (
            <Card className="p-3">
              <div className="flex items-start gap-2">
                {running && <Loader2 className="w-4 h-4 animate-spin mt-0.5 shrink-0" />}
                <p className="text-xs text-muted-foreground break-words">{statusMsg}</p>
              </div>
            </Card>
          )}

          {error && (
            <Card className="p-3 border-destructive bg-destructive/10">
              <p className="text-xs text-destructive break-words">{error}</p>
            </Card>
          )}

          {result && (
            <Card className="p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Results</h3>
              {(() => {
                const baseline = Array.isArray(result.scenarios) && result.scenarios.length > 0
                  ? result.scenarios[0]
                  : result.scenario;
                return (
                  <>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Baseline burned area</p>
                      <p className="text-2xl font-bold text-accent">
                        {Math.round(baseline?.final_acres ?? 0).toLocaleString()} acres
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      {baseline?.seed_acres != null && (
                        <div>
                          <p className="text-muted-foreground">Seed acres</p>
                          <p className="font-medium text-foreground">
                            {Math.round(baseline.seed_acres).toLocaleString()}
                          </p>
                        </div>
                      )}
                      {baseline?.contained != null && (
                        <div>
                          <p className="text-muted-foreground">Contained</p>
                          <p className="font-medium text-foreground">
                            {baseline.contained ? "Yes" : "No"}
                          </p>
                        </div>
                      )}
                      {result.bundle?.domain && (
                        <div className="col-span-2">
                          <p className="text-muted-foreground">Domain size</p>
                          <p className="font-medium text-foreground">
                            {result.bundle.domain.width_km} × {result.bundle.domain.height_km} km
                          </p>
                        </div>
                      )}
                      {result.bundle?.fuel_summary?.mean_canopy_cover_pct != null && (
                        <div className="col-span-2">
                          <p className="text-muted-foreground">Mean canopy cover</p>
                          <p className="font-medium text-foreground">
                            {result.bundle.fuel_summary.mean_canopy_cover_pct}%
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </Card>
          )}
        </div>

        {/* Chat panel — fixed at bottom */}
        <div className="border-t border-border bg-card/30 flex flex-col" style={{ height: "45%", minHeight: 280 }}>
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
            <MessageSquare className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold text-foreground">Agent Chat</h3>
          </div>

          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="space-y-3 py-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  You can run:
                  <br />
                  1. <strong className="text-foreground">The ladder</strong> — 6 fire scenarios from Real Day → Elevated Wind → Critical Fire Weather → Extreme Wind Event → Urban Spread — Contained → Urban Firestorm.
                  <br />
                  2. <strong className="text-foreground">Selected scenarios</strong> — e.g. Real Day and Urban Firestorm.
                  <br />
                  3. <strong className="text-foreground">Estimate losses</strong> for any run scenarios.
                </p>
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-muted-foreground">Suggested</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={runScenarioLadder}
                        disabled={running || chatSending}
                        className="rounded-full border-border hover:bg-accent hover:text-accent-foreground w-full"
                      >
                        <Layers className="w-4 h-4 mr-2" />
                        Run the ladder
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={runRealDay}
                        disabled={running || chatSending}
                        className="rounded-full border-border hover:bg-accent hover:text-accent-foreground w-full"
                      >
                        <Flame className="w-4 h-4 mr-2" />
                        Run real day
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={runExtremeWindEvent}
                        disabled={running || chatSending}
                        className="rounded-full border-border hover:bg-accent hover:text-accent-foreground w-full"
                      >
                        <GitCompare className="w-4 h-4 mr-2" />
                        Run Extreme Wind Event
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={estimateLosses}
                        disabled={running || chatSending}
                        className="rounded-full border-border hover:bg-accent hover:text-accent-foreground w-full"
                      >
                        <DollarSign className="w-4 h-4 mr-2" />
                        Estimate losses
                      </Button>
                    </div>
                  </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                {m.role === "user" ? (
                  <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm max-w-[85%] break-words">
                    {m.content}
                  </div>
                ) : (
                  <div className="text-sm text-foreground space-y-2 max-w-full">
                    {m.pending ? (
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <StageIcon status={m.status || ""} />
                        <StageStatus status={m.status || ""} startedAt={m.startedAt} />
                      </div>
                    ) : m.error ? (
                      <div className="text-xs text-destructive break-words">{m.error}</div>
                    ) : (
                      <>
                        <div className="text-sm text-foreground space-y-2 max-w-full">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              h1: ({ children }) => <SectionHeading level={1}>{children}</SectionHeading>,
                              h2: ({ children }) => <SectionHeading level={2}>{children}</SectionHeading>,
                              h3: ({ children }) => <SectionHeading level={3}>{children}</SectionHeading>,
                              h4: ({ children }) => <SectionHeading level={4}>{children}</SectionHeading>,
                              p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
                              ul: ({ children }) => <ul className="my-1 ml-4 list-disc space-y-0.5">{children}</ul>,
                              ol: ({ children }) => <ol className="my-1 ml-4 list-decimal space-y-0.5">{children}</ol>,
                              li: ({ children }) => <li className="leading-snug">{children}</li>,
                              strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                              code: ({ children }) => (
                                <code className="rounded bg-muted px-1 py-0.5 text-[11px] font-mono">{children}</code>
                              ),
                              table: ({ children }) => (
                                <div className="my-2 -mx-1 overflow-x-auto rounded-md border border-border">
                                  <table className="w-full border-collapse text-xs">{children}</table>
                                </div>
                              ),
                              thead: ({ children }) => <thead className="bg-muted/70">{children}</thead>,
                              tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
                              tr: ({ children }) => <tr className="hover:bg-muted/30">{children}</tr>,
                              th: ({ children }) => (
                                <th className="px-2 py-1.5 text-left font-semibold text-foreground border-b border-border whitespace-nowrap">
                                  {children}
                                </th>
                              ),
                              td: ({ children }) => (
                                <td className="px-2 py-1.5 text-foreground/90 align-top">{children}</td>
                              ),
                            }}
                          >
                            {applyScenarioDisplayNames(m.content)}
                          </ReactMarkdown>
                        </div>
                        {m.scenarios && m.scenarios.length > 0 && (
                          <div className="space-y-1 pt-1 border-t border-border">
                            {[...m.scenarios].sort(
                              (a, b) => scenarioOrderIndex(a.label) - scenarioOrderIndex(b.label)
                            ).map((s) => (
                              <div key={s.label} className="flex items-center gap-2 text-xs">
                                <span
                                  className="inline-block w-3 h-3 rounded-sm border shrink-0"
                                  style={{ backgroundColor: s.color + "80", borderColor: s.color }}
                                />
                                <span className="font-medium text-foreground">{displayNameForScenario(s.label)}:</span>
                                <span className="text-muted-foreground">
                                  {Math.round(s.final_acres).toLocaleString()} ac
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
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
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendChatMessage();
                  }
                }}
                placeholder={polygon ? "Ask the agent…" : "Ask anything, or draw a perimeter to run a scenario…"}
                disabled={chatSending}
                rows={1}
                className="min-h-[40px] max-h-24 resize-none text-sm"
              />
              <Button
                onClick={sendChatMessage}
                disabled={chatSending || !chatInput.trim()}
                size="icon"
                className="h-10 w-10 shrink-0"
              >
                {chatSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
};

export default LiveWildfire;
