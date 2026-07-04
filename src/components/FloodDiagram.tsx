import { motion } from "framer-motion";

interface FloodDiagramProps {
  groundElevation: number;
  ffe: number;
  waterLevel: number;
  depthAboveFFE: number;
  returnPeriod: string;
  isMultiStory?: boolean;
}

const FloodDiagram = ({ groundElevation, ffe, waterLevel, depthAboveFFE, returnPeriod, isMultiStory = false }: FloodDiagramProps) => {
  // Calculate relative positions
  const baseY = 160; // Ground level position
  const scale = 20; // pixels per foot - increased for better visibility
  
  const foundationHeight = ffe - groundElevation;
  const ffeY = baseY - (foundationHeight * scale);
  const waterY = depthAboveFFE > 0 
    ? ffeY - (depthAboveFFE * scale)
    : baseY - ((waterLevel - groundElevation) * scale);
  
  // Clamp water level for display
  const clampedWaterY = Math.max(20, Math.min(baseY, waterY));
  const waterHeight = baseY - clampedWaterY;
  
  const isFlooding = depthAboveFFE > 0;

  // For multi-story, extend the house higher without a roof
  const houseBodyHeight = isMultiStory ? 90 : 70;
  const houseTopY = ffeY - houseBodyHeight;

  return (
    <div className="bg-gradient-to-b from-sky-100 to-sky-50 dark:from-sky-900/20 dark:to-sky-950/20 rounded-lg p-3 border border-border">
      <div className="text-xs font-semibold text-center mb-2 text-foreground">
        {returnPeriod} Flood Scenario {isMultiStory ? "(Multi-Story)" : "(Single-Story)"}
      </div>
      <svg viewBox="0 0 200 200" className="w-full max-w-[200px] mx-auto">
        {/* Sky background */}
        <defs>
          <linearGradient id="waterGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={isFlooding ? "#dc2626" : "#3b82f6"} stopOpacity="0.6" />
            <stop offset="100%" stopColor={isFlooding ? "#991b1b" : "#1d4ed8"} stopOpacity="0.8" />
          </linearGradient>
          <pattern id="wavePattern" patternUnits="userSpaceOnUse" width="20" height="4" patternTransform="rotate(0)">
            <path d="M0 2 Q5 0 10 2 T20 2" fill="none" stroke={isFlooding ? "#dc2626" : "#3b82f6"} strokeWidth="1" opacity="0.5"/>
          </pattern>
        </defs>
        
        {/* Ground */}
        <rect x="0" y={baseY} width="200" height="40" fill="#8B7355" />
        <rect x="0" y={baseY} width="200" height="3" fill="#6B5344" />
        
        {/* House foundation */}
        <rect x="30" y={ffeY} width="140" height={baseY - ffeY} fill="#a3a3a3" stroke="#737373" strokeWidth="1" />
        
        {/* House body */}
        <rect x="20" y={houseTopY} width="160" height={houseBodyHeight} fill="#f5f5f4" stroke="#a3a3a3" strokeWidth="1" />
        
        {isMultiStory ? (
          <>
            {/* Multi-story: extended walls with continuation marks - extend above water level */}
            {/* Calculate wall extension to go above water level */}
            {(() => {
              const wallExtensionTop = Math.min(houseTopY - 25, clampedWaterY - 10);
              return (
                <>
                  {/* Left wall extension */}
                  <line x1="20" y1={houseTopY} x2="20" y2={wallExtensionTop} stroke="#a3a3a3" strokeWidth="1" />
                  {/* Right wall extension */}
                  <line x1="180" y1={houseTopY} x2="180" y2={wallExtensionTop} stroke="#a3a3a3" strokeWidth="1" />
                  
                  {/* Continuation symbols (~~ on both sides) */}
                  <text x="12" y={wallExtensionTop + 10} fontSize="12" fill="#737373" fontWeight="bold">~</text>
                  <text x="12" y={wallExtensionTop} fontSize="12" fill="#737373" fontWeight="bold">~</text>
                  <text x="182" y={wallExtensionTop + 10} fontSize="12" fill="#737373" fontWeight="bold">~</text>
                  <text x="182" y={wallExtensionTop} fontSize="12" fill="#737373" fontWeight="bold">~</text>
                </>
              );
            })()}
            
            {/* Floor separator line for multi-story */}
            <line x1="20" y1={ffeY - 35} x2="180" y2={ffeY - 35} stroke="#a3a3a3" strokeWidth="1" strokeDasharray="4,2" />
          </>
        ) : (
          /* Single-story: Roof */
          <polygon points={`15,${houseTopY} 100,${houseTopY - 45} 185,${houseTopY}`} fill="#78716c" stroke="#57534e" strokeWidth="1" />
        )}
        
        {/* Door */}
        <rect x="82" y={ffeY - 50} width="36" height="50" fill="#78716c" stroke="#57534e" strokeWidth="1" />
        
        {/* Windows - first floor */}
        <rect x="28" y={ffeY - 55} width="32" height="24" fill="#bae6fd" stroke="#57534e" strokeWidth="1" />
        <rect x="140" y={ffeY - 55} width="32" height="24" fill="#bae6fd" stroke="#57534e" strokeWidth="1" />
        
        {/* Windows - second floor (only for multi-story) */}
        {isMultiStory && (
          <>
            <rect x="28" y={ffeY - 82} width="32" height="20" fill="#bae6fd" stroke="#57534e" strokeWidth="1" />
            <rect x="84" y={ffeY - 82} width="32" height="20" fill="#bae6fd" stroke="#57534e" strokeWidth="1" />
            <rect x="140" y={ffeY - 82} width="32" height="20" fill="#bae6fd" stroke="#57534e" strokeWidth="1" />
          </>
        )}
        
        {/* Water */}
        {waterHeight > 0 && (
          <motion.g
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            <rect 
              x="0" 
              y={clampedWaterY} 
              width="200" 
              height={waterHeight} 
              fill="url(#waterGradient)" 
            />
            <rect 
              x="0" 
              y={clampedWaterY} 
              width="200" 
              height="4" 
              fill="url(#wavePattern)" 
            />
          </motion.g>
        )}
        
        {/* FFE Line */}
        <line x1="0" y1={ffeY} x2="20" y2={ffeY} stroke="#16a34a" strokeWidth="2" strokeDasharray="4,2" />
        <line x1="180" y1={ffeY} x2="200" y2={ffeY} stroke="#16a34a" strokeWidth="2" strokeDasharray="4,2" />
        
        {/* Ground level label */}
        <text x="5" y={baseY - 5} fontSize="8" fill="#57534e" fontWeight="500">Ground</text>
        
        {/* FFE label */}
        <text x="5" y={ffeY - 3} fontSize="8" fill="#16a34a" fontWeight="600">FFE</text>
        
        {/* Water level label */}
        {waterHeight > 0 && (
          <text x="170" y={clampedWaterY - 3} fontSize="8" fill={isFlooding ? "#dc2626" : "#3b82f6"} fontWeight="600">
            Water
          </text>
        )}
      </svg>
      
      {/* Legend */}
      <div className="mt-2 space-y-1 text-[10px]">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Ground Elev:</span>
          <span className="font-medium">{groundElevation.toFixed(1)} ft</span>
        </div>
        <div className="flex justify-between">
          <span className="text-green-600 font-medium">FFE:</span>
          <span className="font-medium">{ffe.toFixed(1)} ft</span>
        </div>
        <div className="flex justify-between">
          <span className={isFlooding ? "text-red-600 font-medium" : "text-blue-600"}>Water Level:</span>
          <span className="font-medium">{waterLevel.toFixed(1)} ft</span>
        </div>
        {isFlooding && (
          <div className="flex justify-between text-red-600 font-semibold pt-1 border-t border-border">
            <span>Depth Above FFE:</span>
            <span>{depthAboveFFE.toFixed(1)} ft</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default FloodDiagram;
