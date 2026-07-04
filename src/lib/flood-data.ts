// Flood data parsing utilities shared by chat UI components.

export const RETURN_PERIODS = [2, 5, 10, 25, 50, 100, 200, 500] as const;

export type FloodChartPoint = {
  returnPeriod: number;
  waterLevel: number;
  depthAboveFFE: number;
};

export type FloodExtractedData = {
  groundElevation: number;
  ffe: number;
  chartData: FloodChartPoint[];
  flood100Year: { waterLevel: number; depthAboveFFE: number } | null;
  isMultiStory: boolean;
};

// Extract all flood data from assistant message content for chart and diagram.
export const extractAllFloodData = (content: string): FloodExtractedData | null => {
  // Look for Ground Elevation in Property Profile table (handles bold and various formats)
  const groundMatch =
    content.match(/Ground Elevation\**\s*\|\s*(\d+\.?\d*)\s*ft/i) ||
    content.match(/Ground Elevation[:\s]+(\d+\.?\d*)\s*ft/i);

  // Look for FFE/First Floor Elevation in Property Profile table
  const ffeMatch =
    content.match(/First Floor Elevation\**\s*\|\s*(\d+\.?\d*)\s*ft/i) ||
    content.match(/FFE[:\s]+(\d+\.?\d*)\s*ft/i) ||
    content.match(/First Floor Elevation[:\s]+(\d+\.?\d*)\s*ft/i);

  if (!groundMatch || !ffeMatch) return null;

  const groundElevation = parseFloat(groundMatch[1]);
  const ffe = parseFloat(ffeMatch[1]);

  // Detect building type (multi-story vs single-story)
  const isMultiStory = /multi[- ]?story/i.test(content);

  const lines = content.split("\n");
  const chartData: FloodChartPoint[] = [];
  let flood100Year: { waterLevel: number; depthAboveFFE: number } | null = null;

  for (const line of lines) {
    for (const period of RETURN_PERIODS) {
      const periodPattern = new RegExp(`${period}-?\\s*year`, "i");
      if (periodPattern.test(line)) {
        const cells = line
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean);

        if (cells.length >= 3) {
          const wlMatch = cells[1]?.match(/(\d+\.?\d*)/);
          const depthMatch = cells[2]?.match(/(-?\d+\.?\d*)/);

          if (wlMatch) {
            const dataPoint = {
              returnPeriod: period,
              waterLevel: parseFloat(wlMatch[1]),
              depthAboveFFE: depthMatch ? parseFloat(depthMatch[1]) : 0,
            };

            chartData.push(dataPoint);

            if (period === 100) {
              flood100Year = {
                waterLevel: dataPoint.waterLevel,
                depthAboveFFE: dataPoint.depthAboveFFE,
              };
            }
          }
        }

        break;
      }
    }
  }

  if (chartData.length === 0) return null;

  // Deduplicate by return period (keep first occurrence) and sort
  const uniqueChartData = chartData.reduce((acc, point) => {
    if (!acc.find((p) => p.returnPeriod === point.returnPeriod)) {
      acc.push(point);
    }
    return acc;
  }, [] as FloodChartPoint[]);

  uniqueChartData.sort((a, b) => a.returnPeriod - b.returnPeriod);

  return { groundElevation, ffe, chartData: uniqueChartData, flood100Year, isMultiStory };
};
