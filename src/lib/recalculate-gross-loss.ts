import type { InsuranceSettings } from "@/pages/Index";

/**
 * Extracts the replacement value from message content
 */
export const extractReplacementValue = (content: string): number | null => {
  const match = content.match(/\*\*Replacement Value\*\*\s*\|\s*\$?([\d,]+)/);
  if (match) {
    return parseInt(match[1].replace(/,/g, ''), 10);
  }
  return null;
};

/**
 * Calculates Gross Loss = max(0, min(Groundup Loss - Deductible, Policy Limit))
 */
export const calculateGrossLoss = (
  damageRatioPercent: number,
  replacementValue: number,
  settings: InsuranceSettings
): number => {
  const groundupLoss = (damageRatioPercent / 100) * replacementValue;
  const { deductible, policyLimit } = settings;
  return Math.max(0, Math.min(groundupLoss - deductible, policyLimit));
};

/**
 * Formats a number as currency string
 */
const formatCurrency = (value: number): string => {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

/**
 * Recalculates Gross Loss values in message content based on new insurance settings
 */
export const recalculateGrossLossInContent = (
  content: string,
  settings: InsuranceSettings
): string => {
  const replacementValue = extractReplacementValue(content);
  if (!replacementValue) return content;

  const lines = content.split('\n');
  const updatedLines: string[] = [];
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    
    // Check for table start (Flood Risk by Return Period table)
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].match(/^\|?[\s-:|]+\|?$/)) {
      // Check if this is the flood risk table (has Gross Loss column)
      if (line.toLowerCase().includes('gross') && line.toLowerCase().includes('loss')) {
        // Parse table headers
        const headers = line.split('|').map(h => h.trim()).filter(h => h);
        const grossLossColIdx = headers.findIndex(
          h => h.toLowerCase().includes('gross') && h.toLowerCase().includes('loss')
        );
        const damageRatioColIdx = headers.findIndex(
          h => h.toLowerCase().includes('damage') && h.toLowerCase().includes('ratio')
        );
        
        if (grossLossColIdx !== -1 && damageRatioColIdx !== -1) {
          // Add header line
          updatedLines.push(line);
          i++;
          
          // Add separator line
          if (i < lines.length) {
            updatedLines.push(lines[i]);
            i++;
          }
          
          // Process data rows
          while (i < lines.length && lines[i].includes('|')) {
            const cells = lines[i].split('|').map(c => c.trim());
            // cells[0] is empty due to leading |
            const actualCells = cells.slice(1, -1); // Remove empty first and last
            
            if (actualCells.length > damageRatioColIdx && actualCells.length > grossLossColIdx) {
              // Extract damage ratio
              const damageRatioMatch = actualCells[damageRatioColIdx]?.match(/([\d.]+)%/);
              if (damageRatioMatch) {
                const damageRatio = parseFloat(damageRatioMatch[1]);
                const newGrossLoss = calculateGrossLoss(damageRatio, replacementValue, settings);
                actualCells[grossLossColIdx] = formatCurrency(newGrossLoss);
                
                // Reconstruct the line
                updatedLines.push('| ' + actualCells.join(' | ') + ' |');
                i++;
                continue;
              }
            }
            
            updatedLines.push(lines[i]);
            i++;
          }
          continue;
        }
      }
    }
    
    // Also update Property Profile table with new deductible/policy limit values
    if (line.toLowerCase().includes('deductible') && line.includes('|')) {
      const cells = line.split('|').map(c => c.trim());
      const actualCells = cells.slice(1, -1);
      if (actualCells.length >= 2 && actualCells[0].toLowerCase().includes('deductible')) {
        actualCells[1] = formatCurrency(settings.deductible);
        updatedLines.push('| ' + actualCells.join(' | ') + ' |');
        i++;
        continue;
      }
    }
    
    if (line.toLowerCase().includes('policy limit') && line.includes('|')) {
      const cells = line.split('|').map(c => c.trim());
      const actualCells = cells.slice(1, -1);
      if (actualCells.length >= 2 && actualCells[0].toLowerCase().includes('policy limit')) {
        actualCells[1] = formatCurrency(settings.policyLimit);
        updatedLines.push('| ' + actualCells.join(' | ') + ' |');
        i++;
        continue;
      }
    }
    
    updatedLines.push(line);
    i++;
  }
  
  return updatedLines.join('\n');
};
