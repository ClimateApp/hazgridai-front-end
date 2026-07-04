import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import floridaStationsMap from "@/assets/florida-stations-map.png";
import station2MaxSurgeScatter from "@/assets/station2-max-surge-scatter.png";
import station2SurgeTimeseries from "@/assets/station2-surge-timeseries.png";
import station2MaxWaterLevelScatter from "@/assets/station2-max-waterlevel-scatter.png";
import station2WaterLevelTimeseries from "@/assets/station2-waterlevel-timeseries.png";
import station12MaxSurgeScatter from "@/assets/station12-max-surge-scatter.png";
import station12SurgeTimeseries from "@/assets/station12-surge-timeseries.png";
import station12MaxWaterLevelScatter from "@/assets/station12-max-waterlevel-scatter.png";
import station12WaterLevelTimeseries from "@/assets/station12-waterlevel-timeseries.png";
import station19MaxSurgeScatter from "@/assets/station19-max-surge-scatter.png";
import station19SurgeTimeseries from "@/assets/station19-surge-timeseries.png";
import station19MaxWaterLevelScatter from "@/assets/station19-max-waterlevel-scatter.png";
import station19WaterLevelTimeseries from "@/assets/station19-waterlevel-timeseries.png";
import station36MaxSurgeScatter from "@/assets/station36-max-surge-scatter.png";
import station36SurgeTimeseries from "@/assets/station36-surge-timeseries.png";
import station36MaxWaterLevelScatter from "@/assets/station36-max-waterlevel-scatter.png";
import station36WaterLevelTimeseries from "@/assets/station36-waterlevel-timeseries.png";
import station50MaxSurgeScatter from "@/assets/station50-max-surge-scatter.png";
import station50SurgeTimeseries from "@/assets/station50-surge-timeseries.png";
import station50MaxWaterLevelScatter from "@/assets/station50-max-waterlevel-scatter.png";
import station50WaterLevelTimeseries from "@/assets/station50-waterlevel-timeseries.png";
import station59MaxSurgeScatter from "@/assets/station59-max-surge-scatter.png";
import station59SurgeTimeseries from "@/assets/station59-surge-timeseries.png";
import station59MaxWaterLevelScatter from "@/assets/station59-max-waterlevel-scatter.png";
import station59WaterLevelTimeseries from "@/assets/station59-waterlevel-timeseries.png";
import station70MaxSurgeScatter from "@/assets/station70-max-surge-scatter.png";
import station70SurgeTimeseries from "@/assets/station70-surge-timeseries.png";
import station70MaxWaterLevelScatter from "@/assets/station70-max-waterlevel-scatter.png";
import station70WaterLevelTimeseries from "@/assets/station70-waterlevel-timeseries.png";

type StationPlot = { src: string; caption: string };
type Station = {
  id: string;
  name: string;
  // Percent coordinates over the map image (0-100), origin top-left
  x: number;
  y: number;
  plots?: StationPlot[];
};

const STATIONS: Station[] = [
  {
    id: "s70",
    name: "Station 70",
    x: 10.82,
    y: 13.09,
    plots: [
      { src: station70MaxSurgeScatter, caption: "Max surge of all test set storms: AI vs numerical" },
      { src: station70SurgeTimeseries, caption: "Surge time series of a representative storm: AI vs numerical" },
      { src: station70MaxWaterLevelScatter, caption: "Max water level of all test set storms: AI vs numerical" },
      { src: station70WaterLevelTimeseries, caption: "Water level time series of a representative storm: AI vs numerical" },
    ],
  },
  {
    id: "s59",
    name: "Station 59",
    x: 31.96,
    y: 19.42,
    plots: [
      { src: station59MaxSurgeScatter, caption: "Max surge of all test set storms: AI vs numerical" },
      { src: station59SurgeTimeseries, caption: "Surge time series of a representative storm: AI vs numerical" },
      { src: station59MaxWaterLevelScatter, caption: "Max water level of all test set storms: AI vs numerical" },
      { src: station59WaterLevelTimeseries, caption: "Water level time series of a representative storm: AI vs numerical" },
    ],
  },
  {
    id: "s2",
    name: "Station 2",
    x: 60.32,
    y: 11.0,
    plots: [
      { src: station2MaxSurgeScatter, caption: "Max surge of all test set storms: AI vs numerical" },
      { src: station2SurgeTimeseries, caption: "Surge time series of a representative storm: AI vs numerical" },
      { src: station2MaxWaterLevelScatter, caption: "Max water level of all test set storms: AI vs numerical" },
      { src: station2WaterLevelTimeseries, caption: "Water level time series of a representative storm: AI vs numerical" },
    ],
  },
  {
    id: "s50",
    name: "Station 50",
    x: 48.17,
    y: 35.31,
    plots: [
      { src: station50MaxSurgeScatter, caption: "Max surge of all test set storms: AI vs numerical" },
      { src: station50SurgeTimeseries, caption: "Surge time series of a representative storm: AI vs numerical" },
      { src: station50MaxWaterLevelScatter, caption: "Max water level of all test set storms: AI vs numerical" },
      { src: station50WaterLevelTimeseries, caption: "Water level time series of a representative storm: AI vs numerical" },
    ],
  },
  {
    id: "s12",
    name: "Station 12",
    x: 68.38,
    y: 38.77,
    plots: [
      { src: station12MaxSurgeScatter, caption: "Max surge of all test set storms: AI vs numerical" },
      { src: station12SurgeTimeseries, caption: "Surge time series of a representative storm: AI vs numerical" },
      { src: station12MaxWaterLevelScatter, caption: "Max water level of all test set storms: AI vs numerical" },
      { src: station12WaterLevelTimeseries, caption: "Water level time series of a representative storm: AI vs numerical" },
    ],
  },
  {
    id: "s19",
    name: "Station 19",
    x: 73.12,
    y: 64.34,
    plots: [
      { src: station19MaxSurgeScatter, caption: "Max surge of all test set storms: AI vs numerical" },
      { src: station19SurgeTimeseries, caption: "Surge time series of a representative storm: AI vs numerical" },
      { src: station19MaxWaterLevelScatter, caption: "Max water level of all test set storms: AI vs numerical" },
      { src: station19WaterLevelTimeseries, caption: "Water level time series of a representative storm: AI vs numerical" },
    ],
  },
  {
    id: "s36",
    name: "Station 36",
    x: 56.83,
    y: 69.3,
    plots: [
      { src: station36MaxSurgeScatter, caption: "Max surge of all test set storms: AI vs numerical" },
      { src: station36SurgeTimeseries, caption: "Surge time series of a representative storm: AI vs numerical" },
      { src: station36MaxWaterLevelScatter, caption: "Max water level of all test set storms: AI vs numerical" },
      { src: station36WaterLevelTimeseries, caption: "Water level time series of a representative storm: AI vs numerical" },
    ],
  },
];

const StationMap = () => {
  return (
    <div className="relative mx-auto max-w-3xl">
      <div className="relative rounded-lg overflow-hidden border border-border bg-card shadow-sm">
        <img
          src={floridaStationsMap}
          alt="Map of Florida showing coastal validation stations."
          className="w-full h-auto block select-none"
          draggable={false}
        />

        {/* Interactive hotspots */}
        {STATIONS.map((station) => (
          <HoverCard key={station.id} openDelay={80} closeDelay={120}>
            <HoverCardTrigger asChild>
              <button
                type="button"
                aria-label={`${station.name} validation plots`}
                className="group absolute -translate-x-1/2 -translate-y-1/2 focus:outline-none"
                style={{ left: `${station.x}%`, top: `${station.y}%` }}
              >
                {/* Pulse ring */}
                <span className="absolute inset-0 m-auto h-5 w-5 rounded-full bg-accent/50 animate-ping" />
                {/* Hit target / visible dot */}
                <span className="relative block h-5 w-5 rounded-full bg-accent border-2 border-background shadow-md transition-transform duration-200 group-hover:scale-125 group-focus-visible:scale-125 ring-2 ring-accent/0 group-hover:ring-accent/40" />
              </button>
            </HoverCardTrigger>
            <HoverCardContent
              side="top"
              align="center"
              className={station.plots ? "w-[760px] p-3" : "w-64 p-3"}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h5 className="text-sm font-semibold text-foreground">{station.name}</h5>
                  {station.plots ? (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Validation
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Coming soon
                    </span>
                  )}
                </div>

                {station.plots ? (
                  <div className="grid grid-cols-[1.3fr_1.5fr] gap-2">
                    {station.plots.map((p) => (
                      <figure
                        key={p.src}
                        className="rounded-md overflow-hidden border border-border bg-background"
                      >
                        <img src={p.src} alt={p.caption} className="w-full h-44 object-contain bg-card" />
                        <figcaption className="text-[10px] text-muted-foreground text-center px-1 py-1 leading-tight">
                          {p.caption}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Validation plots will be added here.
                  </p>
                )}
              </div>
            </HoverCardContent>
          </HoverCard>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted-foreground text-center italic">
        Coastal validation stations across Florida used for AI vs numerical model
        evaluation. Hover over a station to preview its validation plots.
      </p>
    </div>
  );
};

export default StationMap;
