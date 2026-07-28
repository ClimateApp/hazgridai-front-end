/**
 * Small, self-contained SVG/HTML visuals for the Capabilities cards. No external
 * dependencies; sized via viewBox / relative units so they scale to their column.
 */

/* ------------------------------------------------------------------ OEP curve */
/** Occurrence Exceedance Probability loss curve — modeled portfolio ground-up
 * loss vs. return period (log x), with 1-in-100 and 1-in-250 PML points marked.
 * Illustrative values, styled after the model's own output. */
export function OepCurveChart({ className }: { className?: string }) {
  const pts =
    "52,235.7 101,230.6 138.3,224.6 187.4,213.5 224.6,199.8 261.7,176.8 310.9,128.1 348,64.8";
  const yTicks = [
    { y: 240, label: "$0B" },
    { y: 197.3, label: "$5B" },
    { y: 154.5, label: "$10B" },
    { y: 111.8, label: "$15B" },
    { y: 69.1, label: "$20B" },
  ];
  const xTicks = [
    { x: 52, label: "2" },
    { x: 101, label: "5" },
    { x: 138.3, label: "10" },
    { x: 187.4, label: "25" },
    { x: 224.6, label: "50" },
    { x: 261.7, label: "100" },
    { x: 310.9, label: "250" },
    { x: 348, label: "500" },
  ];
  return (
    <svg
      className={className}
      viewBox="0 0 360 272"
      role="img"
      aria-label="Occurrence exceedance probability loss curve: modeled portfolio ground-up loss by return period, 1-in-100 at $7.4B and 1-in-250 at $13.1B"
      xmlns="http://www.w3.org/2000/svg"
      fontFamily="inherit"
    >
      <defs>
        <linearGradient id="oepFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563eb" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      <text x="8" y="14" fontSize="10.5" fontWeight="700" fill="#0f172a">
        Occurrence Exceedance Probability (OEP)
      </text>
      <text x="8" y="27" fontSize="8.5" fontStyle="italic" fill="#94a3b8">
        Modeled portfolio ground-up loss by return period
      </text>

      {/* gridlines + y ticks */}
      {yTicks.map((t) => (
        <g key={t.label}>
          <line x1="52" y1={t.y} x2="348" y2={t.y} stroke="#eef2f6" strokeWidth="1" />
          <text x="47" y={t.y + 3} fontSize="7.5" fill="#64748b" textAnchor="end">
            {t.label}
          </text>
        </g>
      ))}

      {/* axes */}
      <line x1="52" y1="40" x2="52" y2="240" stroke="#cbd5e1" strokeWidth="1.4" />
      <line x1="52" y1="240" x2="348" y2="240" stroke="#cbd5e1" strokeWidth="1.4" />

      {/* area + curve */}
      <polygon points={`${pts} 348,240 52,240`} fill="url(#oepFill)" />
      <polyline points={pts} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

      {/* PML markers */}
      <g>
        <line x1="261.7" y1="176.8" x2="261.7" y2="240" stroke="#94a3b8" strokeWidth="1" strokeDasharray="2 2.5" />
        <circle cx="261.7" cy="176.8" r="4" fill="#2563eb" stroke="#ffffff" strokeWidth="1.8" />
        <text x="256" y="160" fontSize="8.5" fontWeight="700" fill="#0f172a" textAnchor="end">1-in-100</text>
        <text x="256" y="170" fontSize="8.5" fontWeight="700" fill="#2563eb" textAnchor="end">$7.4B</text>
      </g>
      <g>
        <line x1="310.9" y1="128.1" x2="310.9" y2="240" stroke="#94a3b8" strokeWidth="1" strokeDasharray="2 2.5" />
        <circle cx="310.9" cy="128.1" r="4" fill="#2563eb" stroke="#ffffff" strokeWidth="1.8" />
        <text x="305" y="112" fontSize="8.5" fontWeight="700" fill="#0f172a" textAnchor="end">1-in-250</text>
        <text x="305" y="122" fontSize="8.5" fontWeight="700" fill="#2563eb" textAnchor="end">$13.1B</text>
      </g>

      {/* x ticks */}
      {xTicks.map((t) => (
        <text key={t.label} x={t.x} y="252" fontSize="7.5" fill="#64748b" textAnchor="middle">
          {t.label}
        </text>
      ))}
      <text x="200" y="267" fontSize="7.5" fill="#94a3b8" textAnchor="middle">
        Return period (years, log scale)
      </text>
      <text x="-140" y="12" transform="rotate(-90)" fontSize="7.5" fill="#94a3b8" textAnchor="middle">
        Modeled ground-up loss
      </text>
    </svg>
  );
}

/* ----------------------------------------------------------------- base map */
/** Stylized base-map thumbnail — abstract land / coastline with scattered
 * exposure points and a highlighted analysis area. Decorative. */
function MapThumb({ className }: { className?: string }) {
  const dots = [
    [34, 60], [52, 74], [70, 58], [88, 82], [46, 100], [64, 112],
    [82, 128], [38, 150], [58, 168], [96, 160], [74, 186], [50, 198],
  ];
  return (
    <svg
      className={className}
      viewBox="0 0 130 240"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="130" height="240" fill="#e9f1f6" />
      {/* land masses */}
      <path d="M-5 40 C25 30 55 55 70 48 C95 38 120 60 135 52 L135 245 L-5 245 Z" fill="#dbe8dd" />
      <path d="M-5 150 C20 140 40 165 66 158 C92 151 118 172 135 165 L135 245 L-5 245 Z" fill="#d3e4ee" opacity="0.7" />
      {/* coastline */}
      <path d="M-5 40 C25 30 55 55 70 48 C95 38 120 60 135 52" fill="none" stroke="#b8cdd8" strokeWidth="1.2" />
      {/* roads */}
      <path d="M0 90 C40 100 70 70 130 96" fill="none" stroke="#c5d2da" strokeWidth="1" />
      <path d="M20 0 C30 60 60 120 48 240" fill="none" stroke="#c5d2da" strokeWidth="1" />
      {/* highlighted analysis area */}
      <rect x="40" y="70" width="60" height="80" rx="6" fill="#2563eb" opacity="0.08" stroke="#2563eb" strokeWidth="1" strokeDasharray="4 3" />
      {/* exposure points */}
      {dots.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="2.4" fill={i % 4 === 0 ? "#ef4444" : "#2563eb"} stroke="#ffffff" strokeWidth="0.8" />
      ))}
    </svg>
  );
}

/* ---------------------------------------------------- insurance product mock */
/** A mini mock of the platform: base map on the left, agent response + OEP
 * chart on the right — echoing the model's map + chat layout. */
export function InsuranceProductMock({ className }: { className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-card shadow-sm overflow-hidden text-left ${className ?? ""}`}>
      {/* window bar */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border bg-muted/40">
        <span className="w-2 h-2 rounded-full bg-red-400/70" />
        <span className="w-2 h-2 rounded-full bg-amber-400/70" />
        <span className="w-2 h-2 rounded-full bg-green-400/70" />
        <span className="ml-1.5 text-[8px] font-medium text-muted-foreground">HazGrid · portfolio analysis</span>
      </div>

      <div className="flex items-stretch">
        {/* base map */}
        <div className="w-[36%] flex-shrink-0 border-r border-border">
          <MapThumb className="w-full h-full" />
        </div>

        {/* agent output */}
        <div className="flex-1 min-w-0 p-2">
          <div className="flex items-start gap-1.5 mb-1.5">
            <span className="mt-[1px] flex-shrink-0 w-4 h-4 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[6px] font-bold">
              AI
            </span>
            <span className="text-[9px] leading-snug text-foreground bg-muted/50 rounded-md px-2 py-1">
              Here's the OEP loss curve for your portfolio — 1-in-100 ≈ $7.4B, 1-in-250 ≈ $13.1B.
            </span>
          </div>
          <OepCurveChart className="w-full h-auto" />
        </div>
      </div>
    </div>
  );
}
