import { useState } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { Info, Pencil, Check, X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import FloodChart from "./FloodChart";
import MathRenderer from "./MathRenderer";

import { extractAllFloodData, type FloodChartPoint } from "@/lib/flood-data";
import type { InsuranceSettings } from "@/pages/Index";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  showChart?: boolean;
  chartDataOverride?: FloodChartPoint[];
  ffeOverride?: number;
  insuranceSettings?: InsuranceSettings;
  onInsuranceSettingsChange?: (settings: InsuranceSettings) => void;
}

// Parse markdown table into rows
const parseTable = (lines: string[]): { headers: string[]; rows: string[][] } | null => {
  if (lines.length < 2) return null;
  
  const headerLine = lines[0];
  const separatorLine = lines[1];
  
  // Check if it's a valid table (has | and separator line with dashes)
  if (!headerLine.includes('|') || !separatorLine.match(/^\|?[\s-:|]+\|?$/)) {
    return null;
  }
  
  const parseRow = (line: string): string[] => {
    return line.split('|')
      .map(cell => cell.trim())
      .filter((_, i, arr) => i > 0 && i < arr.length); // Remove empty first/last from split
  };
  
  const headers = parseRow(headerLine);
  const rows = lines.slice(2).map(parseRow).filter(row => row.length > 0);
  
  return { headers, rows };
};

// Render text with bold formatting and damage ratio coloring (for tables)
const renderTableCellText = (text: string, isDamageRatioColumn: boolean = false): React.ReactNode => {
  // Check for damage ratio percentage pattern (with or without emoji)
  if (isDamageRatioColumn) {
    const percentMatch = text.match(/([🟢🟡🔴]\s*)?(\d+\.?\d*)%/);
    if (percentMatch) {
      const value = parseFloat(percentMatch[2]);
      let colorClass = "text-green-600"; // Low risk: 0-25%
      if (value > 50) {
        colorClass = "text-red-600"; // High risk: >50%
      } else if (value > 25) {
        colorClass = "text-yellow-600"; // Moderate risk: 25-50%
      }
      return <span className={`font-semibold ${colorClass}`}>{value.toFixed(1)}%</span>;
    }
  }
  
  // Handle bold formatting
  const parts = text.split('**');
  return parts.map((part, j) => 
    j % 2 === 1 ? <strong key={j}>{part}</strong> : part
  );
};

// Check if text contains LaTeX math markers
const hasMathContent = (text: string): boolean => {
  // First check for LaTeX commands that are unambiguous
  const hasLatexCommands = 
    text.includes('\\[') || 
    text.includes('\\]') ||
    text.includes('$$') || 
    text.includes('\\frac') ||
    text.includes('\\sum') ||
    text.includes('\\int') ||
    text.includes('\\sqrt') ||
    text.includes('\\cdot') ||
    text.includes('\\times') ||
    text.includes('\\alpha') ||
    text.includes('\\beta') ||
    text.includes('\\lambda') ||
    text.includes('\\sigma') ||
    text.includes('\\mu') ||
    text.includes('\\pi') ||
    text.includes('\\theta') ||
    text.includes('\\begin{') ||
    text.includes('{,}'); // LaTeX number formatting

  if (hasLatexCommands) return true;

  // Check for inline math $...$ but exclude currency patterns like $123 or $1,234
  // Currency: $ followed by digits/commas, not closed by $
  // Math: $ followed by content and closed by $, with math-like content inside
  const mathPattern = /\$(?!\d[\d,]*(?:\.\d+)?(?:\s|$|[^$]))([^$]+)\$/;
  return mathPattern.test(text);
};

// Render text with KaTeX math support - processes entire text for math expressions
const renderWithMath = (text: string): React.ReactNode => {
  const elements: React.ReactNode[] = [];
  let key = 0;
  
  // Combined regex to find all math expressions
  // Order matters: check display math first ($$...$$ and \[...\]), then inline ($...$)
  // For inline math, use negative lookahead to exclude currency like $123 or $1,234.56
  const mathRegex = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$(?!\d[\d,]*(?:\.\d+)?(?:\s|$|[^$]))[^$\n]+\$)/g;
  
  let lastIndex = 0;
  let match;
  
  while ((match = mathRegex.exec(text)) !== null) {
    // Add text before this math expression
    if (match.index > lastIndex) {
      const beforeText = text.slice(lastIndex, match.index);
      elements.push(<span key={key++}>{renderFormattedText(beforeText)}</span>);
    }
    
    const mathStr = match[1];
    
    // Determine if display or inline math and extract content
    if (mathStr.startsWith('$$') && mathStr.endsWith('$$')) {
      // Display math: $$...$$
      const mathContent = mathStr.slice(2, -2).trim();
      elements.push(<MathRenderer key={key++} math={mathContent} display={true} />);
    } else if (mathStr.startsWith('\\[') && mathStr.endsWith('\\]')) {
      // Display math: \[...\]
      const mathContent = mathStr.slice(2, -2).trim();
      elements.push(<MathRenderer key={key++} math={mathContent} display={true} />);
    } else if (mathStr.startsWith('$') && mathStr.endsWith('$')) {
      // Inline math: $...$
      const mathContent = mathStr.slice(1, -1);
      elements.push(<MathRenderer key={key++} math={mathContent} display={false} />);
    }
    
    lastIndex = match.index + mathStr.length;
  }
  
  // Add remaining text after last match
  if (lastIndex < text.length) {
    elements.push(<span key={key++}>{renderFormattedText(text.slice(lastIndex))}</span>);
  }
  
  return elements.length > 0 ? elements : renderFormattedText(text);
};

// Render formatted text with bold and code support
const renderFormattedText = (text: string): React.ReactNode => {
  const elements: React.ReactNode[] = [];
  // Match bold **, inline code ``, or regular text
  const regex = /(\*\*[^*]+\*\*)|(`[^`]+`)|([^*`]+)/g;
  
  let match;
  let key = 0;
  
  while ((match = regex.exec(text)) !== null) {
    const [fullMatch] = match;
    
    if (fullMatch.startsWith('**') && fullMatch.endsWith('**')) {
      elements.push(<strong key={key++}>{fullMatch.slice(2, -2)}</strong>);
    } else if (fullMatch.startsWith('`') && fullMatch.endsWith('`')) {
      elements.push(
        <code key={key++} className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono text-primary">
          {fullMatch.slice(1, -1)}
        </code>
      );
    } else {
      elements.push(<span key={key++}>{fullMatch}</span>);
    }
  }
  
  return elements.length > 0 ? elements : text;
};

// Render text with bold formatting and math support
const renderBoldText = (text: string): React.ReactNode => {
  if (hasMathContent(text)) {
    return renderWithMath(text);
  }
  return renderFormattedText(text);
};

// Render content with support for headers, tables, and text
const renderContent = (content: string): React.ReactNode => {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    
    // Render H1 headers
    if (line.startsWith('# ')) {
      elements.push(
        <h3 key={i} className="text-lg font-bold mt-4 mb-2 first:mt-0">
          {line.slice(2)}
        </h3>
      );
      i++;
      continue;
    }
    
    // Render horizontal rules
    if (line.trim() === '---') {
      elements.push(<hr key={i} className="my-3 border-border" />);
      i++;
      continue;
    }
    
    // Check for table start
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].match(/^\|?[\s-:|]+\|?$/)) {
      // Collect all table lines
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      
      const tableData = parseTable(tableLines);
      if (tableData) {
        // Find the index of Damage Ratio column
        const damageRatioColIdx = tableData.headers.findIndex(
          h => h.toLowerCase().includes('damage') && h.toLowerCase().includes('ratio')
        );
        
        const hasDamageRatio = damageRatioColIdx !== -1;
        
        const tableElement = (
          <div className="rounded-lg overflow-hidden border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  {tableData.headers.map((header, j) => (
                    <TableHead key={j} className="font-semibold text-foreground py-1.5 px-2 text-xs">
                      {renderBoldText(header)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableData.rows.map((row, rowIdx) => {
                  const is100Year = row[0]?.toLowerCase().includes('100-year') || 
                                    row[0]?.toLowerCase().includes('100 year');
                  return (
                    <TableRow 
                      key={rowIdx}
                      className={cn(
                        is100Year && "bg-primary/10 border-l-2 border-l-primary font-medium"
                      )}
                    >
                      {row.map((cell, cellIdx) => (
                        <TableCell key={cellIdx} className="py-1.5 px-2 text-xs">
                          <span className="flex items-center gap-1">
                            {renderTableCellText(cell, cellIdx === damageRatioColIdx)}
                            {is100Year && cellIdx === 0 && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Info className="w-3.5 h-3.5 text-primary cursor-help" />
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[250px] text-xs">
                                    <p>The 100-year flood (1% annual chance) is FEMA's standard for flood zone mapping and insurance requirements.</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </span>
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        );
        
        const riskLegend = (
          <div className="flex flex-col gap-1.5 text-xs bg-muted/30 rounded-lg p-2.5 border border-border">
            <span className="font-semibold text-foreground mb-1">Risk Level</span>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-green-600"></span>
              <span className="text-muted-foreground">Low (0-25%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500"></span>
              <span className="text-muted-foreground">Moderate (25-50%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600"></span>
              <span className="text-muted-foreground">High (&gt;50%)</span>
            </div>
          </div>
        );
        
        elements.push(
          <div key={`table-${i}`} className="my-3">
            {hasDamageRatio ? (
              <div className="flex gap-3 items-start">
                <div className="flex-1 overflow-x-auto">{tableElement}</div>
                {riskLegend}
              </div>
            ) : (
              tableElement
            )}
          </div>
        );
        continue;
      }
    }
    
    // Render regular text with bold formatting
    if (line.trim()) {
      elements.push(
        <p key={i} className="mb-1 last:mb-0 whitespace-pre-wrap">
          {renderBoldText(line)}
        </p>
      );
    } else {
      elements.push(<div key={i} className="h-1" />);
    }
    i++;
  }
  
  return elements;
};

const ChatMessage = ({
  role,
  content,
  showChart = false,
  chartDataOverride,
  ffeOverride,
  insuranceSettings,
  onInsuranceSettingsChange,
}: ChatMessageProps) => {
  const isUser = role === "user";
  const floodData = !isUser ? extractAllFloodData(content) : null;

  const chartData = chartDataOverride ?? floodData?.chartData ?? null;
  const chartFfe = ffeOverride ?? floodData?.ffe ?? null;

  // Show chart if explicitly requested AND we have data
  const shouldShowChart = !!showChart && !!chartData && chartFfe !== null;

  // Editing states for deductible and policy limit
  const [editingDeductible, setEditingDeductible] = useState(false);
  const [editingPolicyLimit, setEditingPolicyLimit] = useState(false);
  const [tempDeductible, setTempDeductible] = useState(insuranceSettings?.deductible?.toString() || "1000");
  const [tempPolicyLimit, setTempPolicyLimit] = useState(insuranceSettings?.policyLimit?.toString() || "100000");

  // Extract replacement value from content
  const extractReplacementValue = (content: string): number | null => {
    const match = content.match(/\*\*Replacement Value\*\*\s*\|\s*\$?([\d,]+)/);
    if (match) {
      return parseInt(match[1].replace(/,/g, ''), 10);
    }
    return null;
  };

  const replacementValue = extractReplacementValue(content);

  // Function to recalculate Groundup Loss with new insurance settings
  const recalculateGroundupLoss = (damageRatioPercent: number): string => {
    if (replacementValue === null) return "N/A";
    const groundupLoss = (damageRatioPercent / 100) * replacementValue;
    return '$' + groundupLoss.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  // Function to calculate Gross Loss = min(Groundup Loss - Deductible, Policy Limit)
  const calculateGrossLoss = (damageRatioPercent: number): string => {
    if (replacementValue === null) return "N/A";
    const groundupLoss = (damageRatioPercent / 100) * replacementValue;
    const deductible = insuranceSettings?.deductible || 1000;
    const policyLimit = insuranceSettings?.policyLimit || 100000;
    const grossLoss = Math.max(0, Math.min(groundupLoss - deductible, policyLimit));
    return '$' + grossLoss.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  const handleSaveDeductible = () => {
    const value = parseInt(tempDeductible.replace(/,/g, ''), 10);
    if (!isNaN(value) && value >= 0 && onInsuranceSettingsChange && insuranceSettings) {
      onInsuranceSettingsChange({ ...insuranceSettings, deductible: value });
    }
    setEditingDeductible(false);
  };

  const handleSavePolicyLimit = () => {
    const value = parseInt(tempPolicyLimit.replace(/,/g, ''), 10);
    if (!isNaN(value) && value >= 0 && onInsuranceSettingsChange && insuranceSettings) {
      onInsuranceSettingsChange({ ...insuranceSettings, policyLimit: value });
    }
    setEditingPolicyLimit(false);
  };

  const handleCancelDeductible = () => {
    setTempDeductible(insuranceSettings?.deductible?.toString() || "1000");
    setEditingDeductible(false);
  };

  const handleCancelPolicyLimit = () => {
    setTempPolicyLimit(insuranceSettings?.policyLimit?.toString() || "100000");
    setEditingPolicyLimit(false);
  };

  // Render editable insurance row
  const renderEditableRow = (label: string, isDeductible: boolean): React.ReactNode => {
    const isEditing = isDeductible ? editingDeductible : editingPolicyLimit;
    const value = isDeductible 
      ? (insuranceSettings?.deductible || 1000)
      : (insuranceSettings?.policyLimit || 100000);
    const tempValue = isDeductible ? tempDeductible : tempPolicyLimit;
    const setTempValue = isDeductible ? setTempDeductible : setTempPolicyLimit;
    const handleSave = isDeductible ? handleSaveDeductible : handleSavePolicyLimit;
    const handleCancel = isDeductible ? handleCancelDeductible : handleCancelPolicyLimit;
    const setEditing = isDeductible ? setEditingDeductible : setEditingPolicyLimit;

    return (
      <TableRow key={label}>
        <TableCell className="py-1.5 px-2 text-xs">
          <strong>{label}</strong>
        </TableCell>
        <TableCell className="py-1.5 px-2 text-xs">
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <span className="text-muted-foreground">$</span>
                <Input
                  type="text"
                  value={tempValue}
                  onChange={(e) => setTempValue(e.target.value.replace(/[^0-9]/g, ''))}
                  className="h-6 w-24 text-xs"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave();
                    if (e.key === 'Escape') handleCancel();
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 w-5 p-0"
                  onClick={handleSave}
                >
                  <Check className="h-3 w-3 text-green-600" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 w-5 p-0"
                  onClick={handleCancel}
                >
                  <X className="h-3 w-3 text-red-600" />
                </Button>
              </>
            ) : (
              <>
                <span>${value.toLocaleString('en-US')}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 w-5 p-0 ml-1"
                  onClick={() => {
                    setTempValue(value.toString());
                    setEditing(true);
                  }}
                >
                  <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                </Button>
              </>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  };

  // Custom rendering for Property Profile table with editable fields
  const renderPropertyProfileTable = (tableData: { headers: string[]; rows: string[][] }): React.ReactNode => {
    const isPropertyProfile = tableData.headers.some(h => h.toLowerCase().includes('attribute'));
    
    if (!isPropertyProfile || !insuranceSettings) {
      return null;
    }

    // Filter out deductible and policy limit rows (we'll render them specially)
    const filteredRows = tableData.rows.filter(row => {
      const firstCell = row[0]?.toLowerCase() || '';
      return !firstCell.includes('deductible') && !firstCell.includes('policy limit');
    });

    return (
      <div className="rounded-lg overflow-hidden border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              {tableData.headers.map((header, j) => (
                <TableHead key={j} className="font-semibold text-foreground py-1.5 px-2 text-xs">
                  {renderBoldText(header)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.map((row, rowIdx) => (
              <TableRow key={rowIdx}>
                {row.map((cell, cellIdx) => (
                  <TableCell key={cellIdx} className="py-1.5 px-2 text-xs">
                    {renderBoldText(cell)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {renderEditableRow("Deductible", true)}
            {renderEditableRow("Policy Limit", false)}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-card text-card-foreground border border-border rounded-bl-md"
        )}
      >
        <div className="flex items-start gap-3">
          {!isUser && (
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-accent to-primary flex items-center justify-center">
              <span className="text-sm">🌊</span>
            </div>
          )}
          <div className="flex-1">
            <div className="prose prose-sm max-w-none">
              <RenderContentWithEditableTable 
                content={content} 
                renderPropertyProfileTable={renderPropertyProfileTable}
                insuranceSettings={insuranceSettings}
                calculateGrossLoss={calculateGrossLoss}
                replacementValue={replacementValue}
              />
            </div>
            {shouldShowChart && (
              <div className="mt-4">
                <FloodChart data={chartData!} ffe={chartFfe!} />
              </div>
            )}

          </div>
        </div>
      </div>
    </motion.div>
  );
};

// Separate component to handle content rendering with editable tables
const RenderContentWithEditableTable = ({ 
  content, 
  renderPropertyProfileTable,
  insuranceSettings,
  calculateGrossLoss,
  replacementValue
}: { 
  content: string; 
  renderPropertyProfileTable: (tableData: { headers: string[]; rows: string[][] }) => React.ReactNode;
  insuranceSettings?: InsuranceSettings;
  calculateGrossLoss?: (damageRatioPercent: number) => string;
  replacementValue?: number | null;
}) => {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    
    // Render H1 headers
    if (line.startsWith('# ')) {
      elements.push(
        <h3 key={i} className="text-lg font-bold mt-4 mb-2 first:mt-0">
          {line.slice(2)}
        </h3>
      );
      i++;
      continue;
    }
    
    // Render horizontal rules
    if (line.trim() === '---') {
      elements.push(<hr key={i} className="my-3 border-border" />);
      i++;
      continue;
    }
    
    // Check for table start
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].match(/^\|?[\s-:|]+\|?$/)) {
      // Collect all table lines
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      
      const tableData = parseTable(tableLines);
      if (tableData) {
        // Check if this is the Property Profile table
        const isPropertyProfile = tableData.headers.some(h => h.toLowerCase().includes('attribute'));
        
        if (isPropertyProfile && insuranceSettings) {
          const customTable = renderPropertyProfileTable(tableData);
          if (customTable) {
            elements.push(<div key={`table-${i}`} className="my-3">{customTable}</div>);
            continue;
          }
        }
        
        // Find the index of Damage Ratio column
        const damageRatioColIdx = tableData.headers.findIndex(
          h => h.toLowerCase().includes('damage') && h.toLowerCase().includes('ratio')
        );
        
        // Find the index of Gross Loss column
        const grossLossColIdx = tableData.headers.findIndex(
          h => h.toLowerCase().includes('gross') && h.toLowerCase().includes('loss')
        );
        
        const hasDamageRatio = damageRatioColIdx !== -1;
        
        // Helper to extract damage ratio value from a cell
        const extractDamageRatio = (cell: string | undefined): number | null => {
          if (!cell) return null;
          // Extract number from strings like "🟢 10.5%" or "10.5%"
          const match = cell.match(/([\d.]+)%/);
          if (match) {
            return parseFloat(match[1]);
          }
          return null;
        };
        
        const tableElement = (
          <div className="rounded-lg overflow-hidden border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  {tableData.headers.map((header, j) => (
                    <TableHead key={j} className="font-semibold text-foreground py-1.5 px-2 text-xs">
                      {renderBoldText(header)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableData.rows.map((row, rowIdx) => {
                  const is100Year = row[0]?.toLowerCase().includes('100-year') || 
                                    row[0]?.toLowerCase().includes('100 year');
                  
                  // Extract damage ratio for this row to recalculate Gross Loss
                  const damageRatio = damageRatioColIdx !== -1 ? extractDamageRatio(row[damageRatioColIdx]) : null;
                  
                  return (
                    <TableRow 
                      key={rowIdx}
                      className={cn(
                        is100Year && "bg-primary/10 border-l-2 border-l-primary font-medium"
                      )}
                    >
                      {row.map((cell, cellIdx) => {
                        // Recalculate Gross Loss if this is the Gross Loss column and we have the function
                        let displayValue = cell;
                        if (cellIdx === grossLossColIdx && calculateGrossLoss && damageRatio !== null) {
                          displayValue = calculateGrossLoss(damageRatio);
                        }
                        
                        return (
                          <TableCell key={cellIdx} className="py-1.5 px-2 text-xs">
                            <span className="flex items-center gap-1">
                              {renderTableCellText(displayValue, cellIdx === damageRatioColIdx)}
                              {is100Year && cellIdx === 0 && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="w-3.5 h-3.5 text-primary cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-[250px] text-xs">
                                      <p>The 100-year flood (1% annual chance) is FEMA's standard for flood zone mapping and insurance requirements.</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </span>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        );
        
        const riskLegend = (
          <div className="flex flex-col gap-1.5 text-xs bg-muted/30 rounded-lg p-2.5 border border-border">
            <span className="font-semibold text-foreground mb-1">Risk Level</span>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-green-600"></span>
              <span className="text-muted-foreground">Low (0-25%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-yellow-500"></span>
              <span className="text-muted-foreground">Moderate (25-50%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600"></span>
              <span className="text-muted-foreground">High (&gt;50%)</span>
            </div>
          </div>
        );
        
        elements.push(
          <div key={`table-${i}`} className="my-3">
            {hasDamageRatio ? (
              <div className="flex gap-3 items-start">
                <div className="flex-1 overflow-x-auto">{tableElement}</div>
                {riskLegend}
              </div>
            ) : (
              tableElement
            )}
          </div>
        );
        continue;
      }
    }
    
    // Render regular text with bold formatting
    if (line.trim()) {
      elements.push(
        <p key={i} className="mb-1 last:mb-0 whitespace-pre-wrap">
          {renderBoldText(line)}
        </p>
      );
    } else {
      elements.push(<div key={i} className="h-1" />);
    }
    i++;
  }
  
  return <>{elements}</>;
};

export default ChatMessage;
