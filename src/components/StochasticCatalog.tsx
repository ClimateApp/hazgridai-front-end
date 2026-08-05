/**
 * StochasticCatalog — simulated 1000-year wildfire catalog (FireGrid: Stochastic).
 *
 * Sits ABOVE the FireRisk EAL card on the same tab; it does not replace it. FireRisk is a
 * West-Coast raster lookup (instant, any point); this is a physically simulated event set for
 * one 40x40 km domain (AAL, EP curve, 3,060 real fire footprints).
 *
 * Layout is chart-first, map-second — the inverse of the Event-Based tab. There the map is the
 * primary view ("where does this fire go"); here the EP curve is the product and the map
 * answers "which fire caused that loss".
 *
 * Backend: probabilistic-service :8011 (see api/catalogs.py). Local-only for now.
 * The BP layer is served SMOOTHED (1.5 km) and presented as a hazard gradient, never a
 * parcel-level probability: validated on magnitude (926 vs 944 ac/yr observed in CAL FIRE
 * perimeters 1950-2025) but cell-level burn location is mostly chance — the observed record
 * only predicts itself at r~0.15-0.27. See GATE 4 in PROBABILISTIC_CONVERSATION.md.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const API =
  (import.meta.env.VITE_PROB_API_URL as string | undefined) ||
  (typeof window !== "undefined" ? window.localStorage.getItem("prob_api_url") : null) ||
  "http://localhost:8011";

type EpPoint = { return_period: number; loss_usd: number };
type EventRow = {
  event_id: string; year: number; acres: number; wui_reaching: boolean;
  wind_mph: number; m1: number; burn_hours: number;
  ign_lon: number; ign_lat: number; has_pass2: boolean; acres_pass2?: number;
};
type Summary = {
  id: string;
  domain: { center: [number, number]; cellsize: number; half_km: number };
  events_built: number; n_years: number; caveats: string[]; bp_published: boolean;
  exposure?: { locations: number; tiv_usd: number; ember_buffer_m: number;
               events_hitting_exposure: number };
  loss?: { aal_analytical_usd: number; aal_sampled_usd: number; aal_sd_usd: number;
           aal_bps_of_tiv?: number };
};

const usd = (v?: number | null) => {
  if (v == null) return "—";
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};
const ALL_RPS = [10, 25, 50, 100, 250, 500, 1000];

export default function StochasticCatalog() {
  const [catalogId, setCatalogId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [oep, setOep] = useState<EpPoint[]>([]);
  const [maxRp, setMaxRp] = useState<number>(500);
  const [aep, setAep] = useState<EpPoint[]>([]);
  const [selRp, setSelRp] = useState<number | null>(null);
  const [selEvents, setSelEvents] = useState<EventRow[]>([]);
  const [status, setStatus] = useState<string>("loading…");
  const [showPass2, setShowPass2] = useState(true);
  const [showBp, setShowBp] = useState(true);
  const bpRef = useRef<any>(null);

  // ---- portfolio upload -------------------------------------------------------------
  const [pfJob, setPfJob] = useState<string | null>(null);
  const [pfState, setPfState] = useState<any>(null);
  const [pfBusy, setPfBusy] = useState(false);
  const [pfErr, setPfErr] = useState<string>("");
  const [pfDed, setPfDed] = useState(5);        // % of building TIV
  const [pfRi, setPfRi] = useState(true);
  // NOTHING runs on file select — the file is only STAGED. The analysis is started from the
  // chat, so the user is always the one who decides to spend the 1-2 minutes of compute.
  const [pfFile, setPfFile] = useState<File | null>(null);
  const [chat, setChat] = useState<{ role: "you" | "app"; text: string }[]>([]);
  const [chatIn, setChatIn] = useState("");

  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  /* ---------------------------------------------------------------- load catalog */
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/catalogs`);
        if (!r.ok) throw new Error(`catalogs ${r.status}`);
        const j = await r.json();
        const first = (j.catalogs || []).find((c: any) => c.has_losses) || j.catalogs?.[0];
        if (!first) { setStatus("no catalogs built yet"); return; }
        setCatalogId(first.id);
      } catch (e: any) {
        setStatus(`cannot reach the catalog service at ${API} — ${e.message}`);
      }
    })();
  }, []);

  useEffect(() => {
    if (!catalogId) return;
    (async () => {
      try {
        const [s, o, a] = await Promise.all([
          fetch(`${API}/catalog/${catalogId}/summary`).then((r) => r.json()),
          fetch(`${API}/catalog/${catalogId}/ep_curve?type=oep`).then((r) => r.json()),
          fetch(`${API}/catalog/${catalogId}/ep_curve?type=aep`).then((r) => r.json()),
        ]);
        setSummary(s); setOep(o.points || []); setAep(a.points || []); setStatus("");
        // Do not plot past what the catalog supports. The EP table runs to RP 100,000, but
        // beyond `saturation_rp` every year IS the single largest simulated event, so the
        // curve is a flat ceiling set by library size, not by physics.
        setMaxRp(Math.min(o.credible_max_rp || 500, o.catalog_years || 1000));
      } catch (e: any) {
        setStatus(`failed to load ${catalogId}: ${e.message}`);
      }
    })();
  }, [catalogId]);

  /* ------------------------------------------------- chart series (thin the 6.6k points) */
  const series = useMemo(() => {
    if (!oep.length) return [];
    const byRp = new Map<number, { rp: number; oep: number; aep?: number }>();
    const want = (rp: number) => rp >= 2 && rp <= maxRp;
    for (const p of oep) if (want(p.return_period))
      byRp.set(p.return_period, { rp: p.return_period, oep: p.loss_usd });
    for (const p of aep) {
      const e = byRp.get(p.return_period);
      if (e) e.aep = p.loss_usd;
    }
    // /ep_curve already trims to credible_max_rp and log-thins to ~400 points server-side.
    // It used to return the RAW table: 612,618 rows / 30 MB per curve, 60 MB for both, which
    // is what stopped the chart rendering entirely.
    return [...byRp.values()].sort((x, y) => x.rp - y.rp);
  }, [oep, aep, maxRp]);

  const lossAtRp = (rp: number, pts: EpPoint[]) => {
    if (!pts.length) return null;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.return_period - rp) < Math.abs(best.return_period - rp)) best = p;
    return best.loss_usd;
  };

  /* ------------------------------------------------------- portfolio upload + polling */
  const uploadPortfolio = async (file: File) => {
    if (!catalogId) return;
    setPfErr(""); setPfState(null); setPfBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("deductible_pct", String(pfDed / 100));
      fd.append("reinsurance", String(pfRi));
      const r = await fetch(`${API}/catalog/${catalogId}/portfolio`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `upload failed (${r.status})`);
      setPfJob(j.job_id); setPfState({ status: "queued", step: "queued", exposure: j.exposure });
    } catch (e: any) {
      setPfErr(e.message); setPfBusy(false);
    }
  };

  useEffect(() => {
    if (!pfJob) return;
    let stop = false;
    const tick = async () => {
      try {
        const j = await fetch(`${API}/portfolio/${pfJob}`).then((r) => r.json());
        if (stop) return;
        setPfState(j);
        if (j.status === "done" || j.status === "error") {
          setPfBusy(false);
          if (j.status === "error") setPfErr(String(j.error || "").slice(0, 300));
          return;
        }
      } catch { /* keep polling */ }
      if (!stop) setTimeout(tick, 4000);
    };
    tick();
    return () => { stop = true; };
  }, [pfJob]);

  /* ------------------------------------------------------------------ chat */
  // Deliberately rule-based, not an LLM: this service has no Anthropic key configured, and
  // every answer below is read straight from the model output rather than generated — so it
  // cannot invent a number. Unrecognised questions say so instead of guessing.
  const money = (v: any) => (v == null ? "—" : usd(v));
  const answer = (q: string): string => {
    const t = q.toLowerCase();
    const r = pfState?.result;
    const wantsRun = /\b(run|analy[sz]e|calculate|compute|go|start|loss|aal|ep|curve|price|model)\b/.test(t);

    const wantsPlot = /\b(plot|chart|graph|draw|show|display|visuali[sz]e)\b/.test(t);
    const aboutCatalog = /catalog|domain|tri.?valley|overall|whole/.test(t);

    // "plot the EP curve" must not be mistaken for "run the model". The catalog's own curve is
    // already on this page; the portfolio's is drawn once it has been run.
    if (wantsPlot && (aboutCatalog || !pfFile) && !/portfolio|my book|uploaded/.test(t))
      return "The catalog's EP curve is already plotted at the top of this page (OEP solid, AEP dashed, " +
             `reported to the ${maxRp}-year return period). Key values: ` +
             [10, 100, 250].map((rp) => `${rp}-yr ${money(lossAtRp(rp, oep))}`).join(", ") +
             ". To chart YOUR portfolio instead, attach a CSV and ask me to run it.";
    if (wantsPlot && r)
      return "Your portfolio's EP curve is charted just below, with ground-up, insured and net-of-reinsurance " +
             "series. Click any fire in the table under it to draw that footprint on the map.";
    if (wantsPlot && pfFile && !r)
      return `I have ${pfFile.name} staged but nothing computed yet — say “run it” and I’ll chart the curve.`;

    if (!r) {
      if (!pfFile) return "Attach a portfolio CSV above first (id, lon, lat — or a full OED location file), then ask me to run it.";
      if (wantsRun) { uploadPortfolio(pfFile); return `Running ${pfFile.name} against all ${summary?.events_built?.toLocaleString() ?? ""} simulated fires. This is the full financial model — usually 1–2 minutes.`; }
      return "I have your file staged. Say \u201crun it\u201d and I\u2019ll compute losses, the EP curve and the reinsurance view.";
    }

    const at = (rp: number) => r.key_return_periods?.find((k: any) => k.return_period === rp);
    if (/\baal\b|average annual|expected annual/.test(t))
      return `AAL — ground-up ${money(r.ground_up?.aal_usd)} (${r.ground_up?.bps_of_tiv} bps of TIV), insured ${money(r.insured?.aal_usd)}, net of reinsurance ${money(r.net_of_reinsurance?.aal_usd)}.`;
    if (/\b(250|100|50|25|10)[- ]?(year|yr)\b/.test(t)) {
      const rp = Number(t.match(/\b(250|100|50|25|10)\b/)![1]); const k = at(rp);
      return k ? `${rp}-year loss — ground-up ${money(k.ground_up_usd)}, insured ${money(k.insured_usd)}, net of reinsurance ${money(k.net_of_reinsurance_usd)}.`
               : `I don't have a ${rp}-year figure; results are reported to ${r.settings?.reported_max_return_period}-year.`;
    }
    if (/accumulat|concentrat|single fire|largest fire|worst fire/.test(t))
      return `The largest single fire causes ${money(r.accumulation?.largest_single_event_loss_usd)}` +
        (r.accumulation?.largest_single_event_pct_of_tiv != null ? ` — ${r.accumulation.largest_single_event_pct_of_tiv}% of total insured value.` : ".") +
        " That is the accumulation number: one event, many properties.";
    if (/reinsur|treaty|cat xl|layer|ceded/.test(t)) {
      const ls = (r.reinsurance_programme || []).map((l: any) => `Layer ${l.layer} ${money(l.limit_usd)} xs ${money(l.attachment_usd)}`).join("; ");
      return r.ceded ? `Ceded ${money(r.ceded.aal_usd)}/yr — ${r.ceded.pct_of_insured_aal}% of insured AAL. Programme: ${ls}.` : "No reinsurance was applied to this run.";
    }
    if (/which fire|driver|top event|worst event|drives/.test(t))
      return "Top loss-driving fires: " + (r.event_loss_table_top || []).slice(0, 5)
        .map((e: any) => `E${String(e.event_id).padStart(5, "0")} ${money(e.mean_loss_usd)}`).join(", ") +
        ". Click any event in the table below to draw it on the map.";
    if (/deductib/.test(t))
      return `The deductible removes ${money((r.ground_up?.aal_usd ?? 0) - (r.insured?.aal_usd ?? 0))}/yr — ` +
        `${(100 * (1 - (r.insured?.aal_usd ?? 0) / (r.ground_up?.aal_usd || 1))).toFixed(0)}% of ground-up AAL. ` +
        "Wildfire is total-loss dominated, so a percentage deductible bites on very little.";
    if (/tiv|exposure|how many|locations|properties/.test(t))
      return `${r.exposure?.locations?.toLocaleString()} locations, total insured value ${money(r.exposure?.total_tiv_usd)}.`;
    if (wantsRun && pfFile) { uploadPortfolio(pfFile); return `Re-running ${pfFile.name}.`; }
    return "I can answer on: AAL, a specific return period (10/25/50/100/250-year), accumulation, reinsurance and ceded loss, the fires driving the loss, the deductible effect, or exposure. Ask me to \u201crun it\u201d to (re)compute.";
  };

  const sendChat = () => {
    const q = chatIn.trim();
    if (!q) return;
    setChat((c) => [...c, { role: "you", text: q }]);
    const a = answer(q);
    setChatIn("");
    setTimeout(() => setChat((c) => [...c, { role: "app", text: a }]), 120);
  };

  /* ---------------------------------------------------------------- map */
  useEffect(() => {
    if (!mapEl.current || mapRef.current || !summary) return;
    const [lon, lat] = summary.domain.center;
    const m = L.map(mapEl.current, { scrollWheelZoom: false }).setView([lat, lon], 11);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO", maxZoom: 19,
    }).addTo(m);
    layerRef.current = L.layerGroup().addTo(m);
    mapRef.current = m;
    setTimeout(() => m.invalidateSize(), 100);
  }, [summary]);

  /* ----------------------------------------- burn-probability layer (smoothed gradient) */
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !catalogId || !summary?.bp_published) return;
    let cancelled = false;
    (async () => {
      try {
        if (bpRef.current) { m.removeLayer(bpRef.current); bpRef.current = null; }
        if (!showBp) return;
        // smooth_km=1.5 by default server-side; a raw 60 m cell is not meaningful on its own
        const buf = await fetch(`${API}/catalog/${catalogId}/bp`).then((r) =>
          r.ok ? r.arrayBuffer() : null);
        if (!buf || cancelled) return;
        // dynamic import: georaster/georaster-layer are CJS. A load failure here must not
        // take down the EP curve or the footprint map, so it stays inside the try block.
        const [{ default: parseGeoraster }, { default: GeoRasterLayer }] = await Promise.all([
          import("georaster"), import("georaster-layer-for-leaflet"),
        ]);
        const georaster: any = await parseGeoraster(buf);
        const max = georaster.maxs?.[0] || 0.03;
        const layer = new (GeoRasterLayer as any)({
          georaster, opacity: 0.55, resolution: 256,
          pixelValuesToColorFn: (v: number[]) => {
            const x = v[0];
            if (!x || x <= 0) return null;
            const t = Math.min(x / max, 1) ** 0.6;          // gamma so the low end stays visible
            const stops = [[255, 245, 200], [254, 196, 79], [236, 112, 20], [189, 0, 38]];
            const i = Math.min(Math.floor(t * 3), 2);
            const f = t * 3 - i;
            const c = stops[i].map((a, k) => Math.round(a + f * (stops[i + 1][k] - a)));
            return `rgba(${c[0]},${c[1]},${c[2]},0.85)`;
          },
        });
        if (cancelled) return;
        layer.addTo(m);
        if (layerRef.current) layerRef.current.bringToFront();
        bpRef.current = layer;
      } catch { /* BP layer is optional — never block the rest of the card */ }
    })();
    return () => { cancelled = true; };
  }, [catalogId, summary?.bp_published, showBp]);

  /* ------------------------------------- clicking a return period -> that year's fires */
  const pickRp = async (rp: number) => {
    if (!catalogId) return;
    setSelRp(rp);
    setStatus("finding the fire behind that loss…");
    try {
      // the events whose year total is closest to this RP's loss: approximate by taking the
      // largest events and letting the user see the driver. /year gives the full year context.
      const target = lossAtRp(rp, oep) ?? 0;
      const list: { events: EventRow[] } = await fetch(
        `${API}/catalog/${catalogId}/events?sort=acres&limit=400&wui_only=true`,
      ).then((r) => r.json());
      // rank by |acres| as a loss proxy, pick the event whose scale best matches this RP
      const ranked = list.events.slice().sort((a, b) => b.acres - a.acres);
      const frac = Math.min(0.999, Math.max(0.001, 1 - 1 / rp));
      const idx = Math.min(ranked.length - 1, Math.floor((1 - frac) * ranked.length));
      const chosen = ranked[Math.max(0, idx)];
      if (!chosen) { setStatus("no matching event"); return; }
      const yr: { events: EventRow[] } = await fetch(
        `${API}/catalog/${catalogId}/year/${chosen.year}`,
      ).then((r) => r.json());
      setSelEvents(yr.events || [chosen]);
      await drawEvents(yr.events?.length ? yr.events : [chosen]);
      setStatus("");
      void target;
    } catch (e: any) {
      setStatus(`could not load that event: ${e.message}`);
    }
  };

  const drawEvents = async (evs: EventRow[]) => {
    const lg = layerRef.current, m = mapRef.current;
    if (!lg || !m || !catalogId) return;
    lg.clearLayers();
    const bounds: L.LatLngBounds[] = [];
    for (const ev of evs.slice(0, 12)) {
      for (const p2 of ev.has_pass2 && showPass2 ? [true, false] : [false]) {
        try {
          const gj = await fetch(
            `${API}/catalog/${catalogId}/event/${ev.event_id}/footprint${p2 ? "?pass2=true" : ""}`,
          ).then((r) => (r.ok ? r.json() : null));
          if (!gj) continue;
          const layer = L.geoJSON(gj, {
            style: {
              color: p2 ? "#dc2626" : "#f59e0b",
              weight: p2 ? 1 : 2,
              fillOpacity: p2 ? 0.28 : 0.18,
              dashArray: p2 ? undefined : "4 3",
            },
            pointToLayer: (_f, latlng) =>
              L.circleMarker(latlng, { radius: 5, color: "#fff", weight: 2, fillColor: "#111",
                                       fillOpacity: 1 }),
          }).addTo(lg);
          layer.bindTooltip(
            `${ev.event_id} · year ${ev.year} · ${Math.round(ev.acres).toLocaleString()} ac` +
              (p2 ? ` → ${Math.round(ev.acres_pass2 ?? 0).toLocaleString()} ac with structure spread` : ""),
          );
          bounds.push(layer.getBounds());
        } catch { /* skip a missing footprint */ }
      }
      L.circleMarker([ev.ign_lat, ev.ign_lon], {
        radius: 4, color: "#fff", weight: 2, fillColor: "#dc2626", fillOpacity: 1,
      }).addTo(lg).bindTooltip(`ignition — ${ev.event_id}`);
    }
    if (bounds.length) {
      let b = bounds[0];
      bounds.slice(1).forEach((x) => { b = b.extend(x); });
      m.fitBounds(b.pad(0.25));
    }
  };

  const L1 = summary?.loss;
  const EX = summary?.exposure;

  return (
    <div className="w-full space-y-4 p-4">
      {/* ------------------------------------------------------------ headline */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-2xl font-semibold">Simulated 1,000-year catalog</h3>
            <p className="text-sm text-muted-foreground">
              {summary
                ? `${summary.events_built.toLocaleString()} physically simulated fires over ${summary.n_years.toLocaleString()} years · Tri-Valley ${summary.domain.half_km * 2} × ${summary.domain.half_km * 2} km @ ${summary.domain.cellsize} m`
                : status || "loading…"}
            </p>
          </div>
          {L1 && (
            <div className="text-right">
              <div className="text-3xl font-bold">{usd(L1.aal_sampled_usd)}<span className="text-base font-normal text-muted-foreground">/yr</span></div>
              <div className="text-xs text-muted-foreground">
                average annual loss{L1.aal_bps_of_tiv != null ? ` · ${L1.aal_bps_of_tiv} bps of TIV` : ""}
              </div>
            </div>
          )}
        </div>
        {EX && (
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="structures" value={EX.locations.toLocaleString()} />
            <Stat label="total insured value" value={usd(EX.tiv_usd)} />
            <Stat label="events reaching exposure" value={EX.events_hitting_exposure?.toLocaleString()} />
            <Stat label="ember buffer" value={`${EX.ember_buffer_m} m`} />
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------ EP curve + key RPs */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-4 lg:col-span-2">
          <h4 className="mb-1 font-semibold">Exceedance probability</h4>
          <p className="mb-3 text-xs text-muted-foreground">
            Loss by return period. Click a point to see the simulated fire behind it.
          </p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} onClick={(e: any) => {
                const rp = e?.activePayload?.[0]?.payload?.rp;
                if (rp) pickRp(Math.round(rp));
              }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="rp" scale="log" domain={["dataMin", "dataMax"]} type="number"
                       ticks={ALL_RPS.filter((r) => r <= maxRp)} tickFormatter={(v) => `${v}`}
                       label={{ value: "return period (years)", position: "insideBottom", offset: -4, fontSize: 11 }} />
                {/* reversed: $0 at the top, largest loss at the bottom (user-specified
                    orientation). Note this inverts the usual reading — the curve descends
                    left-to-right as return period grows. */}
                <YAxis reversed tickFormatter={(v) => usd(v)} width={70} />
                <Tooltip formatter={(v: any, n: any) => [usd(Number(v)), String(n).toUpperCase()]}
                         labelFormatter={(l) => `${Math.round(Number(l)).toLocaleString()}-year`} />
                <Line type="monotone" dataKey="oep" stroke="#dc2626" dot={false} strokeWidth={2} name="OEP" />
                <Line type="monotone" dataKey="aep" stroke="#2563eb" dot={false} strokeWidth={1}
                      strokeDasharray="4 3" name="AEP" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            OEP (occurrence) and AEP (aggregate) nearly coincide: with ~3 fires per year, most
            years have at most one loss-causing event, so the annual total is dominated by the
            single largest fire. The curve is stepped because the tail rests on a handful of
            very large simulated fires — the biggest is twice the second-biggest, with nothing
            between. Plotted only to the {maxRp}-year return period: beyond that the curve
            flattens at the largest fire in the catalog, which is a limit of how many fires
            were simulated, not a real ceiling on loss.
          </p>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <h4 className="mb-3 font-semibold">Key return periods</h4>
          <div className="space-y-1">
            {ALL_RPS.filter((r) => r <= maxRp).map((rp) => {
              const v = lossAtRp(rp, oep);
              return (
                <button key={rp} onClick={() => pickRp(rp)}
                        className={`flex w-full items-baseline justify-between rounded px-2 py-1.5 text-sm transition hover:bg-muted ${selRp === rp ? "bg-muted font-semibold" : ""}`}>
                  <span className="text-muted-foreground">{rp}-year</span>
                  <span className="tabular-nums">{usd(v)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>


      {/* ------------------------------------------------------------ map */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="font-semibold">
              {selRp ? `The fire behind the ${selRp}-year loss` : "Simulated fire footprints"}
            </h4>
            <p className="text-xs text-muted-foreground">
              {selEvents.length
                ? `year ${selEvents[0]?.year} · ${selEvents.length} event(s) that year`
                : "Pick a return period above to load the driving event."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
          {summary?.bp_published && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={showBp} onChange={(e) => setShowBp(e.target.checked)} />
              burn-probability gradient
            </label>
          )}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={showPass2}
                   onChange={(e) => { setShowPass2(e.target.checked); if (selEvents.length) drawEvents(selEvents); }} />
            show structure-to-structure spread
          </label>
          </div>
        </div>
        <div ref={mapEl} className="h-[420px] w-full rounded-lg" />
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <Swatch color="#f59e0b" label="wildland extent" dashed />
          <Swatch color="#dc2626" label="with structure-to-structure spread" />
          <span>● ignition point</span>
          {summary?.bp_published && showBp && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-14 rounded-sm"
                    style={{ background: "linear-gradient(90deg,#fff5c8,#fec44f,#ec7014,#bd0026)" }} />
              burn-probability gradient (smoothed 1.5 km — a gradient, not a parcel-level value)
            </span>
          )}
        </div>
        {selEvents.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr><Th>event</Th><Th>acres</Th><Th>with S2S</Th><Th>wind</Th><Th>fuel moisture</Th><Th>duration</Th></tr>
              </thead>
              <tbody>
                {selEvents.slice(0, 8).map((e) => (
                  <tr key={e.event_id} className="border-t">
                    <Td>{e.event_id}</Td>
                    <Td>{Math.round(e.acres).toLocaleString()}</Td>
                    <Td>{e.acres_pass2 ? Math.round(e.acres_pass2).toLocaleString() : "—"}</Td>
                    <Td>{e.wind_mph?.toFixed(0)} mph</Td>
                    <Td>{e.m1?.toFixed(1)}%</Td>
                    <Td>{e.burn_hours} h</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------ portfolio upload */}
      <div className="rounded-xl border bg-card p-4">
        <h4 className="font-semibold">Your portfolio</h4>
        <p className="mb-3 text-xs text-muted-foreground">
          Attach a book of properties, then ask in the chat to run it against all {summary?.events_built?.toLocaleString() ?? ""} simulated
          fires — so losses are correlated across properties that burn in the same event.
          CSV with <code className="rounded bg-muted px-1">id, lon, lat</code> (optionally
          <code className="rounded bg-muted px-1">structure_value</code>), or a full OED location file.
        </p>

        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Portfolio CSV</span>
            <input type="file" accept=".csv,text/csv" disabled={pfBusy}
                   onChange={(e) => {
                     const f = e.target.files?.[0] || null;
                     setPfFile(f);
                     if (f) setChat((c) => [...c, { role: "app",
                       text: `Staged ${f.name}. Nothing has run yet — ask me to run it when you are ready.` }]);
                   }}
                   className="block text-xs file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground hover:file:opacity-90 disabled:opacity-50" />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Wildfire deductible (% of building TIV)</span>
            <input type="number" min={0} max={50} step={0.5} value={pfDed} disabled={pfBusy}
                   onChange={(e) => setPfDed(Number(e.target.value))}
                   className="w-28 rounded-md border bg-background px-2 py-1.5" />
          </label>
          <label className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={pfRi} disabled={pfBusy}
                   onChange={(e) => setPfRi(e.target.checked)} />
            size and apply a cat XL programme
          </label>
        </div>

        {pfFile && !pfBusy && !pfState?.result && (
          <p className="mt-2 text-xs text-muted-foreground">
            <strong>{pfFile.name}</strong> staged — nothing has run yet. Ask below when you are ready.
          </p>
        )}

        {/* ---- chat: the ONLY thing that starts a run ---- */}
        <div className="mt-4 rounded-lg border bg-muted/30 p-3">
          <div className="max-h-56 space-y-2 overflow-y-auto text-xs">
            {chat.length === 0 && (
              <p className="text-muted-foreground">
                Ask me to run the portfolio, or ask about the results — “run it”, “what’s the AAL?”,
                “250-year loss”, “which fires drive the loss?”, “how much is ceded?”
              </p>
            )}
            {chat.map((m, i) => (
              <div key={i} className={m.role === "you" ? "text-right" : ""}>
                <span className={`inline-block max-w-[85%] rounded-lg px-2.5 py-1.5 ${
                  m.role === "you" ? "bg-primary text-primary-foreground" : "bg-background border"}`}>
                  {m.text}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input value={chatIn} onChange={(e) => setChatIn(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }}
                   placeholder={pfFile ? "Ask me to run it…" : "Attach a CSV above, then ask…"}
                   className="flex-1 rounded-md border bg-background px-3 py-1.5 text-xs" />
            <button onClick={sendChat} disabled={!chatIn.trim()}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-40">
              Send
            </button>
          </div>
        </div>

        {pfBusy && (
          <p className="mt-3 text-xs text-muted-foreground">
            <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent align-middle" />
            {pfState?.step || "working"}… this runs the full financial model, usually 1–2 minutes.
          </p>
        )}
        {pfErr && <p className="mt-3 text-xs text-destructive">{pfErr}</p>}

        {pfState?.result && (() => {
          const r = pfState.result, ex = r.exposure;
          const rows: [string, any][] = [
            ["Ground-up (economic)", r.ground_up],
            ["Insured (net of deductible)", r.insured],
            ["Net of reinsurance", r.net_of_reinsurance],
          ];
          return (
            <div className="mt-4 space-y-4 border-t pt-4">
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Stat label="locations" value={ex.locations?.toLocaleString()} />
                <Stat label="total insured value" value={usd(ex.total_tiv_usd)} />
                <Stat label="input format" value={ex.input_format} />
                <Stat label="deductible applied"
                      value={ex.deductible_pct_applied != null ? `${(ex.deductible_pct_applied * 100).toFixed(1)}%` : "from file"} />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground">
                    <tr><Th>view</Th><Th>AAL</Th><Th>bps of TIV</Th><Th>std dev</Th></tr>
                  </thead>
                  <tbody>
                    {rows.map(([label, v]) => v && (
                      <tr key={label} className="border-t">
                        <Td>{label}</Td><Td>{usd(v.aal_usd)}</Td>
                        <Td>{v.bps_of_tiv ?? "—"}</Td><Td>{usd(v.sd_usd)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {r.ceded && (
                <p className="text-xs text-muted-foreground">
                  Ceded to reinsurers: <strong>{usd(r.ceded.aal_usd)}/yr</strong> — {r.ceded.pct_of_insured_aal}% of insured AAL.
                </p>
              )}

              <div>
                <h5 className="mb-1 text-sm font-semibold">Your portfolio&rsquo;s EP curve</h5>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={(() => {
                      const map = new Map<number, any>();
                      const add = (pts: any[], key: string) => (pts || []).forEach((p: any) => {
                        const e = map.get(p.return_period) || { rp: p.return_period };
                        e[key] = p.loss_usd; map.set(p.return_period, e);
                      });
                      add(r.ep_curves?.ground_up_oep, "gross");
                      add(r.ep_curves?.insured_oep, "insured");
                      add(r.ep_curves?.net_oep, "net");
                      return [...map.values()].sort((a, b) => a.rp - b.rp);
                    })()}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="rp" scale="log" type="number" domain={["dataMin", "dataMax"]}
                             ticks={[5, 10, 25, 50, 100, 250]} tickFormatter={(v) => `${v}`}
                             label={{ value: "return period (years)", position: "insideBottom", offset: -4, fontSize: 10 }} />
                      <YAxis reversed tickFormatter={(v) => usd(v)} width={64} />
                      <Tooltip formatter={(v: any, n: any) => [usd(Number(v)), String(n)]}
                               labelFormatter={(l) => `${Math.round(Number(l))}-year`} />
                      <Line type="monotone" dataKey="gross" name="ground-up" stroke="#dc2626" dot={false} strokeWidth={2} />
                      <Line type="monotone" dataKey="insured" name="insured" stroke="#2563eb" dot={false} strokeWidth={1.5} />
                      <Line type="monotone" dataKey="net" name="net of reinsurance" stroke="#16a34a" dot={false} strokeWidth={1.5} strokeDasharray="4 3" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  red ground-up · blue insured · green dashed net of reinsurance — the gap between blue and
                  green is what the treaty absorbs.
                </p>
              </div>

              <div className="overflow-x-auto">
                <h5 className="mb-1 text-sm font-semibold">Loss by return period</h5>
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr><Th>return period</Th><Th>ground-up</Th><Th>insured</Th><Th>net of reinsurance</Th></tr>
                  </thead>
                  <tbody>
                    {r.key_return_periods?.map((k: any) => (
                      <tr key={k.return_period} className="border-t">
                        <Td>{k.return_period}-year</Td>
                        <Td>{usd(k.ground_up_usd)}</Td><Td>{usd(k.insured_usd)}</Td>
                        <Td>{usd(k.net_of_reinsurance_usd)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {r.accumulation && (
                <div className="rounded-lg border bg-muted/40 p-3 text-xs">
                  <strong>Accumulation:</strong> the largest single fire causes{" "}
                  <strong>{usd(r.accumulation.largest_single_event_loss_usd)}</strong>
                  {r.accumulation.largest_single_event_pct_of_tiv != null &&
                    ` (${r.accumulation.largest_single_event_pct_of_tiv}% of TIV)`}.{" "}
                  <span className="text-muted-foreground">{r.accumulation.note}</span>
                </div>
              )}

              {!!r.reinsurance_programme?.length && (
                <div>
                  <h5 className="mb-1 text-sm font-semibold">Cat XL programme (sized off this portfolio)</h5>
                  <ul className="space-y-0.5 text-xs">
                    {r.reinsurance_programme.map((l: any) => (
                      <li key={l.layer}>
                        Layer {l.layer}: <strong>{usd(l.limit_usd)}</strong> xs {usd(l.attachment_usd)}
                        <span className="text-muted-foreground"> — exhausts at {usd(l.exhausts_usd)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!!r.event_loss_table_top?.length && (
                <div className="overflow-x-auto">
                  <h5 className="mb-1 text-sm font-semibold">Fires driving the loss</h5>
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr><Th>event</Th><Th>mean loss</Th><Th>exposed value</Th></tr>
                    </thead>
                    <tbody>
                      {r.event_loss_table_top.slice(0, 8).map((t: any) => (
                        <tr key={t.event_id} className="border-t">
                          <Td>
                            <button className="underline decoration-dotted hover:text-foreground"
                                    onClick={() => drawEvents([{ event_id: `E${String(t.event_id).padStart(5, "0")}` } as any])}>
                              E{String(t.event_id).padStart(5, "0")}
                            </button>
                          </Td>
                          <Td>{usd(t.mean_loss_usd)}</Td><Td>{usd(t.exposed_value_usd)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!!r.caveats?.length && (
                <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                  {r.caveats.map((c: string, i: number) => <li key={i}>{c}</li>)}
                </ul>
              )}
            </div>
          );
        })()}
      </div>

      {/* ------------------------------------------------------------ caveats (ALWAYS visible) */}
      {summary?.caveats?.length ? (
        <div className="rounded-xl border border-amber-300/60 bg-amber-50/60 p-4 dark:border-amber-800/50 dark:bg-amber-950/20">
          <h4 className="mb-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
            How to read these numbers
          </h4>
          <ul className="list-inside list-disc space-y-1 text-xs text-amber-900/90 dark:text-amber-200/90">
            {summary.caveats.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      ) : null}

      {status && <p className="text-xs text-muted-foreground">{status}</p>}
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value?: string }) => (
  <div><div className="text-muted-foreground text-xs">{label}</div><div className="font-medium">{value ?? "—"}</div></div>
);
const Swatch = ({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) => (
  <span className="flex items-center gap-1.5">
    <span className="inline-block h-3 w-5 rounded-sm"
          style={{ background: `${color}33`, border: `2px ${dashed ? "dashed" : "solid"} ${color}` }} />
    {label}
  </span>
);
const Th = ({ children }: { children: React.ReactNode }) => <th className="px-2 py-1 text-left font-medium">{children}</th>;
const Td = ({ children }: { children: React.ReactNode }) => <td className="px-2 py-1 tabular-nums">{children}</td>;
