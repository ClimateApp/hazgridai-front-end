import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L, { type LatLngBoundsExpression, type LatLngTuple } from "leaflet";
// @ts-ignore - no types
import parseGeoraster from "georaster";
// @ts-ignore - no types
import GeoRasterLayer from "georaster-layer-for-leaflet";

export type TrackPoint = {
  id?: string;
  time?: string;
  lon: number;
  lat: number;
  vmax?: number;
  cp?: number;
};

export const parseTrackText = (text: string): TrackPoint[] => {
  const points: TrackPoint[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Skip header rows that contain non-numeric tokens like "LON(degree)"
    if (/[A-Za-z(]/.test(line) && !/^\d{4}-\d{2}-\d{2}/.test(line.split(/\s+/).slice(1).join(" "))) {
      // Header detection: try to parse anyway; if fails, skip.
    }
    const parts = line.split(/\s+/);
    // Expected: ID Y-m-d H:M:S LON LAT CP RMW VMAX TSX TSY  -> 10 tokens
    if (parts.length < 5) continue;
    // Try to find lon/lat: after ID + date + time
    let lon: number, lat: number, id: string | undefined, time: string | undefined, vmax: number | undefined, cp: number | undefined;
    if (parts.length >= 10 && /^\d{4}-\d{2}-\d{2}$/.test(parts[1])) {
      id = parts[0];
      time = `${parts[1]} ${parts[2]}`;
      lon = parseFloat(parts[3]);
      lat = parseFloat(parts[4]);
      cp = parseFloat(parts[5]);
      vmax = parseFloat(parts[7]);
    } else {
      // Fallback: first two numbers as lon, lat
      const nums = parts.map(parseFloat).filter((n) => !isNaN(n));
      if (nums.length < 2) continue;
      lon = nums[0];
      lat = nums[1];
    }
    if (isNaN(lon) || isNaN(lat)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    points.push({ id, time, lon, lat, vmax, cp });
  }
  return points;
};

const FitBounds = ({ bounds }: { bounds: LatLngBoundsExpression }) => {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [20, 20] });
  }, [map, bounds]);
  return null;
};

// Simple blue->red colormap for water-level values
const colorRamp = (t: number) => {
  const clamped = Math.max(0, Math.min(1, t));
  const stops = [
    [0, [33, 102, 172]],
    [0.25, [103, 169, 207]],
    [0.5, [253, 219, 199]],
    [0.75, [239, 138, 98]],
    [1, [178, 24, 43]],
  ] as const;
  for (let i = 1; i < stops.length; i++) {
    if (clamped <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (clamped - t0) / (t1 - t0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
      return `rgb(${r},${g},${b})`;
    }
  }
  return "rgb(178,24,43)";
};

const GeoTiffOverlay = ({ url, onBounds, onRange }: { url: string; onBounds?: (b: LatLngBoundsExpression) => void; onRange?: (r: { min: number; max: number }) => void }) => {
  const map = useMap();
  useEffect(() => {
    let layer: any = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Fetch tif failed (${res.status})`);
        const buf = await res.arrayBuffer();
        const georaster = await parseGeoraster(buf);
        if (cancelled) return;
        const min = georaster.mins?.[0] ?? 0;
        const max = georaster.maxs?.[0] ?? 1;
        const range = max - min || 1;
        const noData = georaster.noDataValue;
        if (onRange) onRange({ min, max });
        layer = new GeoRasterLayer({
          georaster,
          opacity: 0.7,
          resolution: 256,
          pixelValuesToColorFn: (vals: number[]) => {
            const v = vals[0];
            if (v === null || v === undefined || isNaN(v) || v === noData) return null;
            return colorRamp((v - min) / range);
          },
        });
        layer.addTo(map);
        const b = layer.getBounds();
        if (onBounds) onBounds(b as unknown as LatLngBoundsExpression);
      } catch (e) {
        console.error("GeoTIFF overlay failed:", e);
      }
    })();
    return () => {
      cancelled = true;
      if (layer) map.removeLayer(layer);
    };
  }, [url, map, onBounds, onRange]);
  return null;
};

const ColorScaleLegend = ({ min, max, label = "Water level (m)" }: { min: number; max: number; label?: string }) => {
  const stops = [0, 0.25, 0.5, 0.75, 1];
  const gradient = `linear-gradient(to top, ${stops.map((s) => colorRamp(s)).join(", ")})`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + (max - min) * t);
  return (
    <div className="absolute right-3 top-3 z-[1000] bg-background/90 backdrop-blur-sm border border-border rounded-md p-2 shadow-md text-xs text-foreground">
      <div className="font-medium mb-1 text-center">{label}</div>
      <div className="flex items-stretch gap-2">
        <div className="w-3 rounded" style={{ background: gradient, height: 120 }} />
        <div className="flex flex-col-reverse justify-between text-[10px] text-muted-foreground" style={{ height: 120 }}>
          {ticks.map((v, i) => (
            <div key={i}>{v.toFixed(2)}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

const HurricaneTrackMap = ({
  points,
  height = 280,
  tifUrl,
  focusBounds,
}: {
  points: TrackPoint[];
  height?: number;
  tifUrl?: string;
  focusBounds?: LatLngBoundsExpression;
}) => {
  const positions = useMemo<LatLngTuple[]>(() => points.map((p) => [p.lat, p.lon]), [points]);
  const [tifBounds, setTifBounds] = useState<LatLngBoundsExpression | null>(null);
  const [tifRange, setTifRange] = useState<{ min: number; max: number } | null>(null);

  if (positions.length === 0 && !tifUrl && !focusBounds) {
    return (
      <div
        className="rounded-lg border border-border bg-muted text-xs text-muted-foreground flex items-center justify-center"
        style={{ height }}
      >
        No valid coordinates found in track file.
      </div>
    );
  }

  const lats = positions.map((p) => p[0]);
  const lons = positions.map((p) => p[1]);
  const trackBounds: LatLngBoundsExpression | null = positions.length
    ? [
        [Math.min(...lats), Math.min(...lons)],
        [Math.max(...lats), Math.max(...lons)],
      ]
    : null;

  // Priority: explicit focusBounds > combined track+tif > track > tif
  let fitBounds: LatLngBoundsExpression | null = focusBounds || trackBounds;
  if (!focusBounds) {
    if (tifBounds && trackBounds) {
      const tb = L.latLngBounds(trackBounds as L.LatLngBoundsLiteral);
      tb.extend(tifBounds as L.LatLngBoundsExpression);
      fitBounds = [
        [tb.getSouth(), tb.getWest()],
        [tb.getNorth(), tb.getEast()],
      ];
    } else if (tifBounds && !trackBounds) {
      fitBounds = tifBounds;
    }
  }

  const center: LatLngTuple = positions[0] || [0, 0];

  return (
    <div className="relative rounded-lg overflow-hidden border border-border" style={{ height }}>
      <MapContainer
        center={center}
        zoom={5}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {tifUrl && <GeoTiffOverlay url={tifUrl} onBounds={setTifBounds} onRange={setTifRange} />}
        {positions.length > 0 && (
          <Polyline positions={positions} pathOptions={{ color: "hsl(var(--primary))", weight: 3 }} />
        )}
        {points.map((p, i) => (
          <CircleMarker
            key={i}
            center={[p.lat, p.lon]}
            radius={i === 0 || i === points.length - 1 ? 6 : 3}
            pathOptions={{
              color: i === 0 ? "#10b981" : i === points.length - 1 ? "#ef4444" : "hsl(var(--primary))",
              fillColor: i === 0 ? "#10b981" : i === points.length - 1 ? "#ef4444" : "hsl(var(--primary))",
              fillOpacity: 0.9,
              weight: 1,
            }}
          >
            <Tooltip>
              <div className="text-xs">
                {p.time && <div><strong>{p.time}</strong></div>}
                <div>Lat: {p.lat.toFixed(2)}, Lon: {p.lon.toFixed(2)}</div>
                {p.vmax !== undefined && !isNaN(p.vmax) && <div>Vmax: {p.vmax} m/s</div>}
                {p.cp !== undefined && !isNaN(p.cp) && <div>CP: {p.cp} Pa</div>}
              </div>
            </Tooltip>
          </CircleMarker>
        ))}
        {fitBounds && <FitBounds bounds={fitBounds} />}
      </MapContainer>
      {tifUrl && tifRange && <ColorScaleLegend min={tifRange.min} max={tifRange.max} />}
    </div>
  );
};

export default HurricaneTrackMap;

