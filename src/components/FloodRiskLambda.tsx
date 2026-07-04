import { useEffect, useRef, useState } from "react";
import { Waves, Loader2 } from "lucide-react";
import ChatMessage from "@/components/ChatMessage";
import ChatInput from "@/components/ChatInput";
import TypingIndicator from "@/components/TypingIndicator";
import { useToast } from "@/hooks/use-toast";

const ENDPOINT =
  "https://6bwbe6krn4xer6ire2mt6eizy40iddvm.lambda-url.us-east-1.on.aws/raster/read5070";

const RETURN_PERIODS = [2, 5, 10, 25, 50, 100, 200, 500] as const;

type LambdaResponse = {
  water_level: (number | null)[];
  depth_above_FFE: (number | null)[];
  damage_ratio: (number | null)[];
  found_ht: number | null;
  ground_elv: number | null;
  num_stories: "singlestory" | "multistory" | null;
  val_struct: number | null;
};

type Message = { role: "user" | "assistant"; content: string };

const fmt = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined || !Number.isFinite(v as number)
    ? "N/A"
    : (v as number).toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });

const fmtPct = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v as number)
    ? "N/A"
    : `${((v as number) * 100).toFixed(1)}%`;

const fmtCurrency = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v as number)
    ? "N/A"
    : (v as number).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });

// Parse two decimal numbers (lon, lat) from free text.
// Accepts "-80.19, 25.76", "lon -80.19 lat 25.76", "@-80.19 25.76", etc.
const parseCoords = (text: string): { lon: number; lat: number } | null => {
  const nums = text.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const a = parseFloat(nums[0]);
  const b = parseFloat(nums[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  // Heuristic: if first looks like latitude (|a|<=90) and second like longitude,
  // and user wrote "lat" before "lon", swap. Default: lon, lat.
  const lower = text.toLowerCase();
  const latIdx = lower.indexOf("lat");
  const lonIdx = lower.indexOf("lon");
  if (latIdx !== -1 && lonIdx !== -1 && latIdx < lonIdx) {
    return { lat: a, lon: b };
  }
  return { lon: a, lat: b };
};

const formatResultMarkdown = (
  lon: number,
  lat: number,
  data: LambdaResponse,
): string => {
  const stories =
    data.num_stories === "singlestory"
      ? "Single Story"
      : data.num_stories === "multistory"
        ? "Multi Story"
        : "N/A";

  const profile = `### Property Profile

| Field | Value |
| --- | --- |
| **Longitude** | ${lon.toFixed(5)} |
| **Latitude** | ${lat.toFixed(5)} |
| **Ground Elevation** | ${data.ground_elv === null ? "N/A" : `${fmt(data.ground_elv)} ft`} |
| **Foundation Height** | ${data.found_ht === null ? "N/A" : `${fmt(data.found_ht)} ft`} |
| **Stories** | ${stories} |
| **Structure Value** | ${fmtCurrency(data.val_struct)} |`;

  const rows = RETURN_PERIODS.map((rp, i) => {
    const wl = fmt(data.water_level?.[i]);
    const depth = fmt(data.depth_above_FFE?.[i]);
    const dmg = fmtPct(data.damage_ratio?.[i]);
    return `| ${rp}-year | ${wl} | ${depth} | ${dmg} |`;
  }).join("\n");

  const table = `### Return-Period Flood Risk

| Return Period | Water Level (ft) | Depth Above FFE (ft) | Damage Ratio |
| --- | --- | --- | --- |
${rows}`;

  return `${profile}\n\n${table}`;
};

const FloodRiskLambda = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (messages.length > 0) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, isLoading]);

  const callLambda = async (lon: number, lat: number): Promise<LambdaResponse> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input_crs: "EPSG:4326",
          point_lonlat: { lon, lat },
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Request failed (${res.status} ${res.statusText})`);
      }
      return (await res.json()) as LambdaResponse;
    } finally {
      clearTimeout(timeout);
    }
  };

  const sendMessage = async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;

    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);

    const coords = parseCoords(trimmed);
    if (!coords) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I couldn't find longitude and latitude in your message. Please provide them as decimal degrees, for example: `-80.19, 25.76` (lon, lat).",
        },
      ]);
      return;
    }

    setIsLoading(true);
    try {
      const data = await callLambda(coords.lon, coords.lat);
      const md = formatResultMarkdown(coords.lon, coords.lat, data);
      setMessages((prev) => [...prev, { role: "assistant", content: md }]);
    } catch (err: unknown) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      const msg = isAbort
        ? "Request timed out after 60 seconds. Please try again (cold starts can be slow)."
        : err instanceof Error
          ? err.message
          : "Failed to fetch flood risk data.";
      toast({ title: "Lambda error", description: msg, variant: "destructive" });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `**Error:** ${msg}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 h-full min-h-0">
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent to-primary flex items-center justify-center mb-6">
                <Waves className="w-10 h-10 text-primary-foreground" />
              </div>
              <h2 className="text-2xl font-semibold text-foreground mb-2">
                Flood Risk Lookup (Lambda)
              </h2>
              <p className="text-muted-foreground max-w-md mb-8">
                Provide a longitude and latitude in decimal degrees (WGS84) and I'll
                query the flood-risk raster for return-period water levels, depth
                above FFE, and damage ratio. Cold starts can take up to ~30 seconds.
              </p>
              <div className="grid gap-3 w-full max-w-md">
                {[
                  "Check flood risk at -80.19, 25.76",
                  "lon -80.13493, lat 25.85401",
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
                <ChatMessage key={i} role={m.role} content={m.content} />
              ))}
              {isLoading && (
                <div className="space-y-2">
                  <TypingIndicator />
                  <div className="flex gap-2 items-center text-xs text-muted-foreground pl-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Querying flood raster (cold start can take ~30s)…
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          )}
        </div>
      </main>
      <footer className="flex-shrink-0 border-t border-border bg-card/50 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <ChatInput onSend={sendMessage} disabled={isLoading} />
        </div>
      </footer>
    </div>
  );
};

export default FloodRiskLambda;
