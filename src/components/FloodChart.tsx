import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface FloodChartProps {
  data: { returnPeriod: number; waterLevel: number; depthAboveFFE: number }[];
  ffe: number;
}

const CustomXAxisTick = (props: any) => {
  const { x, y, payload } = props;
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        dy={10}
        textAnchor="end"
        transform="rotate(-35)"
        fill="hsl(var(--muted-foreground))"
        fontSize={10}
      >
        {payload?.value}
      </text>
    </g>
  );
};

const FloodChart = ({ data, ffe }: FloodChartProps) => {
  const [activePoint, setActivePoint] = useState<{ returnPeriod: number; waterLevel: number; depthAboveFFE: number } | null>(null);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const point = payload[0].payload;
      const isFlooding = point.depthAboveFFE > 0;
      return (
        <div className="bg-card border border-border rounded-lg p-2.5 shadow-lg text-xs">
          <p className="font-semibold text-foreground mb-1">
            {point.returnPeriod}-Year Flood
          </p>
          <p className="text-muted-foreground">
            Water Level: <span className="text-foreground font-medium">{point.waterLevel.toFixed(1)} ft</span>
          </p>
          <p className={isFlooding ? "text-red-600 font-medium" : "text-green-600"}>
            {isFlooding 
              ? `${point.depthAboveFFE.toFixed(1)} ft above FFE`
              : "Below FFE (No flooding)"}
          </p>
        </div>
      );
    }
    return null;
  };

  const minWater = Math.min(...data.map(d => d.waterLevel));
  const maxWater = Math.max(...data.map(d => d.waterLevel));
  const yMin = Math.floor(Math.min(minWater, ffe) - 1);
  const yMax = Math.ceil(Math.max(maxWater, ffe) + 1);

  return (
    <div className="bg-muted/30 rounded-lg p-3 border border-border">
      <div className="text-xs font-semibold text-foreground mb-3">
        Return Period vs Water Level
      </div>
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 5, right: 10, left: 0, bottom: 22 }}
            onMouseMove={(e) => {
              if (e.activePayload) {
                setActivePoint(e.activePayload[0].payload);
              }
            }}
            onMouseLeave={() => setActivePoint(null)}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="returnPeriod"
              type="number"
              scale="linear"
              domain={[2, 500]}
              ticks={[2, 5, 10, 25, 50, 100, 200, 500]}
              interval={0}
              minTickGap={0}
              tickMargin={6}
              allowDecimals={false}
              tick={<CustomXAxisTick />}
              tickLine={{ stroke: 'hsl(var(--border))' }}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              label={{ value: 'Return Period (Years)', position: 'insideBottom', offset: -3, fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fontSize: 10 }}
              tickLine={{ stroke: 'hsl(var(--border))' }}
              axisLine={{ stroke: 'hsl(var(--border))' }}
              label={{ value: 'Water Level (ft)', angle: -90, position: 'insideLeft', dy: 30, fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine 
              y={ffe} 
              stroke="#16a34a" 
              strokeDasharray="5 5" 
              strokeWidth={2}
              label={{ value: 'FFE', position: 'right', fontSize: 10, fill: '#16a34a' }}
            />
            <Line
              type="monotone"
              dataKey="waterLevel"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={{ fill: 'hsl(var(--primary))', strokeWidth: 0, r: 4 }}
              activeDot={{ r: 6, fill: 'hsl(var(--primary))', stroke: 'hsl(var(--background))', strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {activePoint && (
        <div className="mt-2 text-center text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{activePoint.returnPeriod}-Year:</span>{" "}
          {activePoint.waterLevel.toFixed(1)} ft water level
          {activePoint.depthAboveFFE > 0 && (
            <span className="text-red-600 ml-1">
              ({activePoint.depthAboveFFE.toFixed(1)} ft above FFE)
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default FloodChart;
