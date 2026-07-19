// FmGridResults — planner + results block for fmGrid portfolio financial runs
// (Flood Risk: Stochastic chat). Renders the live step checklist while the run
// executes, then AAL stat tiles, the OEP/AEP exceedance-curve chart, and the
// full loss tables (event losses per return-period band, EP curves).
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type FmPlannerStep = { label: string; done: boolean; seconds: number };

export type FmGridSide = {
  event_losses?: Record<string, number>;
  aal_usd?: number;
  oep_curve?: Record<string, number>;
  aep_curve?: Record<string, number>;
};

export type FmGridData = {
  locations_modeled: number;
  locations_total_wet?: number;
  samples?: number;
  simulated_years?: number;
  exposed_value_usd?: number;
  groundup?: FmGridSide;
  insured?: FmGridSide;
  terms?: { deductible_usd?: number; limit_usd?: number };
};

const RPS = [2, 5, 10, 25, 50, 100, 200, 500];

// Categorical slots 1 (blue) + 2 (aqua) from the validated palette; light/dark
// steps swap via CSS variables. Ground-up = blue, insured = aqua; OEP solid,
// AEP dashed (curve type is line-style, so color stays with the entity).
const PALETTE_VARS =
  "[--fm-gu:#2a78d6] dark:[--fm-gu:#3987e5] [--fm-ins:#1baf7a] dark:[--fm-ins:#199e70]";

const fmtUsd = (v?: number | null): string => {
  if (v == null) return "—";
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
};
const fmtAxis = (v: number): string =>
  v === 0 ? "$0" :
  Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(v < 1e10 ? 1 : 0)}B` : `$${(v / 1e6).toFixed(0)}M`;

// ---------- planner checklist ----------
export const FmGridPlanner = ({ steps }: { steps: FmPlannerStep[] }) => {
  if (!steps.length) {
    return (
      <div className="ml-11 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Starting the fmGrid run…
      </div>
    );
  }
  return (
    <div className="ml-11 max-w-md rounded-xl border border-border bg-card p-3">
      <p className="text-xs font-semibold text-foreground mb-2">fmGrid run plan</p>
      <ul className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            {s.done ? (
              <CheckCircle2 className="w-3.5 h-3.5 mt-[1px] shrink-0 text-[#008300] dark:text-[#4dbf4d]" />
            ) : (
              <Loader2 className="w-3.5 h-3.5 mt-[1px] shrink-0 animate-spin text-primary" />
            )}
            <span className={s.done ? "text-muted-foreground" : "text-foreground"}>
              {s.label}
            </span>
            <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
              {s.seconds >= 1 ? `${Math.round(s.seconds)}s` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ---------- EP-curve chart ----------
type EpRow = {
  rp: number;
  guOep?: number;
  guAep?: number;
  insOep?: number;
  insAep?: number;
};

const SERIES: { key: keyof EpRow; name: string; color: string; dash?: string }[] = [
  { key: "guOep", name: "Ground-up OEP", color: "var(--fm-gu)" },
  { key: "guAep", name: "Ground-up AEP", color: "var(--fm-gu)", dash: "6 4" },
  { key: "insOep", name: "Insured OEP", color: "var(--fm-ins)" },
  { key: "insAep", name: "Insured AEP", color: "var(--fm-ins)", dash: "6 4" },
];

const EpTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md">
      <p className="text-xs font-semibold text-foreground mb-1">{label}-year return period</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 text-xs text-muted-foreground">
          <svg width="16" height="6">
            <line x1="0" y1="3" x2="16" y2="3" stroke={p.stroke} strokeWidth="2"
                  strokeDasharray={p.strokeDasharray} />
          </svg>
          <span>{p.name}</span>
          <span className="ml-auto pl-3 tabular-nums text-foreground">{fmtUsd(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

const EpCurveChart = ({ fin }: { fin: FmGridData }) => {
  const gu = fin.groundup ?? {};
  const ins = fin.insured;
  const rows: EpRow[] = RPS.map((rp) => ({
    rp,
    guOep: gu.oep_curve?.[rp],
    guAep: gu.aep_curve?.[rp],
    insOep: ins?.oep_curve?.[rp],
    insAep: ins?.aep_curve?.[rp],
  }));
  const active = SERIES.filter((s) => rows.some((r) => r[s.key] != null));
  return (
    <div className={PALETTE_VARS}>
      <p className="text-xs font-semibold text-foreground mb-1">
        Loss exceedance curves — 10,000 simulated years
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          {/* discrete RPs on a point axis (≈ even in log space); numeric log scale
              breaks recharts' hover/tooltip hit-testing */}
          <XAxis
            dataKey="rp"
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }}
            padding={{ left: 8, right: 8 }}
            label={{ value: "Return period (years)", position: "insideBottom", offset: -2,
                     fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          />
          <YAxis
            tickFormatter={fmtAxis} width={52}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false} axisLine={false}
          />
          <Tooltip content={<EpTooltip />} />
          {active.map((s) => (
            <Line
              key={s.key} dataKey={s.key} name={s.name} type="monotone"
              stroke={s.color} strokeWidth={2} strokeDasharray={s.dash}
              dot={{ r: 2.5, fill: s.color, strokeWidth: 0 }}
              activeDot={{ r: 4 }} isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
        {active.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <svg width="18" height="6">
              <line x1="0" y1="3" x2="18" y2="3" stroke={s.color} strokeWidth="2"
                    strokeDasharray={s.dash} />
            </svg>
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
};

// ---------- results block ----------
const Tile = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <div className="rounded-lg border border-border bg-background px-3 py-2">
    <p className="text-[11px] text-muted-foreground">{label}</p>
    <p className={`tabular-nums ${strong ? "text-lg font-semibold text-foreground" : "text-sm font-medium text-foreground"}`}>
      {value}
    </p>
  </div>
);

const th = "px-2 py-1.5 text-right font-medium text-muted-foreground";
const td = "px-2 py-1 text-right tabular-nums";

export const FmGridResults = ({ fin }: { fin: FmGridData }) => {
  const gu = fin.groundup ?? {};
  const ins = fin.insured;
  const ded = fin.terms?.deductible_usd;
  return (
    <div className="ml-11 max-w-2xl rounded-xl border border-border bg-card p-4 space-y-4">
      {/* headline metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile label="Average annual loss (ground-up)" value={fmtUsd(gu.aal_usd)} strong />
        {ins && <Tile label={`AAL (insured${ded ? `, $${ded.toLocaleString()} ded` : ""})`} value={fmtUsd(ins.aal_usd)} strong />}
        <Tile label="Exposed value" value={fmtUsd(fin.exposed_value_usd)} />
        <Tile label="Locations modeled" value={(fin.locations_modeled ?? 0).toLocaleString()} />
      </div>

      <EpCurveChart fin={fin} />

      {/* event losses per return-period band */}
      <div className="overflow-x-auto">
        <p className="text-xs font-semibold text-foreground mb-1">Event losses by hazard band</p>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Band</th>
              <th className={th}>Ground-up loss</th>
              {ins && <th className={th}>Insured loss</th>}
            </tr>
          </thead>
          <tbody>
            {RPS.map((rp) => (
              <tr key={rp} className="border-b border-border/50">
                <td className="px-2 py-1 text-left">{rp}-year flood</td>
                <td className={td}>{fmtUsd(gu.event_losses?.[rp])}</td>
                {ins && <td className={td}>{fmtUsd(ins.event_losses?.[rp])}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* EP curves table */}
      <div className="overflow-x-auto">
        <p className="text-xs font-semibold text-foreground mb-1">Exceedance losses (OEP / AEP)</p>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Return period</th>
              <th className={th}>Ground-up OEP</th>
              <th className={th}>Ground-up AEP</th>
              {ins && <th className={th}>Insured OEP</th>}
              {ins && <th className={th}>Insured AEP</th>}
            </tr>
          </thead>
          <tbody>
            {RPS.map((rp) => (
              <tr key={rp} className="border-b border-border/50">
                <td className="px-2 py-1 text-left">{rp}-year</td>
                <td className={td}>{fmtUsd(gu.oep_curve?.[rp])}</td>
                <td className={td}>{fmtUsd(gu.aep_curve?.[rp])}</td>
                {ins && <td className={td}>{fmtUsd(ins.oep_curve?.[rp])}</td>}
                {ins && <td className={td}>{fmtUsd(ins.aep_curve?.[rp])}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        OEP = loss exceeded by the single worst event in a year; AEP = loss exceeded by the
        annual total across events. {fin.samples ?? 25} Monte-Carlo samples over{" "}
        {(fin.simulated_years ?? 10000).toLocaleString()} simulated years
        {fin.locations_total_wet != null &&
          ` · ${fin.locations_total_wet.toLocaleString()} exposed locations in coverage`}.
      </p>
    </div>
  );
};
