import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import miamiMap from "@/assets/miami-fema-ai-01.png";

type FemaPoint = {
  id: string;
  name: string;
  // Percent coordinates over the map image (0-100), origin top-left
  x: number;
  y: number;
  lon: number;
  lat: number;
  aiTwl: number;
  femaTwl: number;
};

type FemaComparisonMapProps = {
  imageSrc: string;
  alt: string;
  caption?: string;
  title?: string;
  points: FemaPoint[];
};

const FemaComparisonMap = ({ imageSrc, alt, caption, title = "Miami", points }: FemaComparisonMapProps) => {
  return (
    <div className="relative w-full max-w-[32rem]">
      <h4 className="text-center text-sm font-semibold text-foreground mb-2">{title}</h4>
      <div className="relative rounded-lg overflow-hidden border border-border bg-card shadow-sm">
        <img
          src={imageSrc}
          alt={alt}
          className="w-full h-auto block select-none"
          draggable={false}
        />

        {points.map((p) => (
          <HoverCard key={p.id} openDelay={80} closeDelay={120}>
            <HoverCardTrigger asChild>
              <button
                type="button"
                aria-label={`${p.name} flood comparison`}
                className="group absolute -translate-x-1/2 -translate-y-1/2 focus:outline-none"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              >
                <svg
                  viewBox="-50 -50 100 100"
                  className="block h-6 w-6 text-yellow-400 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] transition-transform duration-200 group-hover:scale-125 group-focus-visible:scale-125"
                  aria-hidden="true"
                >
                  {[0, 60, 120].map((a) => (
                    <rect
                      key={a}
                      x="-6"
                      y="-40"
                      width="12"
                      height="80"
                      rx="3"
                      fill="currentColor"
                      transform={`rotate(${a})`}
                    />
                  ))}
                </svg>
              </button>
            </HoverCardTrigger>
            <HoverCardContent side="top" align="center" className="w-60 p-3">
              <div className="space-y-1">
                <h5 className="text-sm font-semibold text-foreground">{p.name}</h5>
                <div className="text-xs text-muted-foreground grid grid-cols-2 gap-x-2 gap-y-1">
                  <span>Lon</span><span className="text-foreground">{p.lon}</span>
                  <span>Lat</span><span className="text-foreground">{p.lat}</span>
                  <span>AI TWL</span><span className="text-foreground">{p.aiTwl} ft</span>
                  <span>FEMA TWL</span><span className="text-foreground">{p.femaTwl} ft</span>
                </div>
              </div>
            </HoverCardContent>
          </HoverCard>
        ))}
      </div>

      {caption && <p className="mt-3 text-xs text-muted-foreground text-center italic">{caption}</p>}
    </div>
  );
};

export default FemaComparisonMap;
export type { FemaPoint };
