import { useMemo, useState } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, Download, X, ChevronLeft, ChevronRight } from "lucide-react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const HIDDEN_COLS = new Set<string>(["error", "BP", "CRPS"]);
const NUMERIC_DISPLAY_COLS = new Set<string>([]);

export type WildfireResult = {
  columns: string[];
  rows: Record<string, string>[];
  blob: Blob;
  filename: string;
};

const DOLLAR_COLS = new Set([
  "EAL",
  "2yr_loss",
  "5yr_loss",
  "10yr_loss",
  "25yr_loss",
  "50yr_loss",
  "100yr_loss",
]);

const PAGE_SIZE = 10;

const fmtUSD = (v: string | number) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const sumCol = (rows: Record<string, string>[], col: string) =>
  rows.reduce((acc, r) => {
    const n = parseFloat(r[col]);
    return acc + (isFinite(n) ? n : 0);
  }, 0);

interface Props {
  result: WildfireResult;
  onClear?: () => void;
}

const WildfireResults = ({ result, onClear }: Props) => {
  const { columns: allColumns, rows, filename } = result;
  // Show all columns except "error" (rendered inline as a badge on the first column).
  const columns = useMemo(() => allColumns.filter((c) => !HIDDEN_COLS.has(c)), [allColumns]);
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const isNum =
      DOLLAR_COLS.has(sort.col) ||
      NUMERIC_DISPLAY_COLS.has(sort.col) ||
      ["lat", "lon", "id", "structure_val"].includes(sort.col);
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = a[sort.col] ?? "";
      const vb = b[sort.col] ?? "";
      let cmp = 0;
      if (isNum) {
        const na = parseFloat(va);
        const nb = parseFloat(vb);
        cmp = (isFinite(na) ? na : -Infinity) - (isFinite(nb) ? nb : -Infinity);
      } else {
        cmp = String(va).localeCompare(String(vb));
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pageRows = sortedRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const totalEAL = useMemo(() => sumCol(rows, "EAL"), [rows]);
  const total100 = useMemo(() => sumCol(rows, "100yr_loss"), [rows]);
  const exposed = useMemo(
    () =>
      rows.filter((r) => {
        const sv = parseFloat(r.structure_val ?? "");
        const err = (r.error ?? "").trim();
        return !err && isFinite(sv) && sv > 0;
      }).length,
    [rows],
  );

  const toggleSort = (col: string) => {
    setPage(0);
    setSort((s) => {
      if (!s || s.col !== col) return { col, dir: "asc" };
      if (s.dir === "asc") return { col, dir: "desc" };
      return null;
    });
  };

  const handleDownload = () => {
    const exportCols = allColumns.filter((c) => !["BP", "CRPS"].includes(c));
    const exportRows = rows.map((r) => {
      const o: Record<string, string> = {};
      for (const c of exportCols) o[c] = r[c] ?? "";
      return o;
    });
    const csv = Papa.unparse({ fields: exportCols, data: exportRows });
    const outBlob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(outBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "wildfire_risk.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const fmtNum = (v: string | number, digits = 4) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    if (!isFinite(n)) return "—";
    return n.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Properties analyzed</p>
            <p className="text-2xl font-semibold mt-1">{rows.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">With structural exposure</p>
            <p className="text-2xl font-semibold mt-1">{exposed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total EAL</p>
            <p className="text-2xl font-semibold mt-1">{fmtUSD(totalEAL)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total 100yr loss</p>
            <p className="text-2xl font-semibold mt-1">{fmtUSD(total100)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Showing {pageRows.length} of {rows.length} rows
        </p>
        <div className="flex gap-2">
          {onClear && (
            <Button size="sm" variant="outline" onClick={onClear}>
              <X className="w-4 h-4" /> Clear
            </Button>
          )}
          <Button size="sm" onClick={handleDownload}>
            <Download className="w-4 h-4" /> Download enriched CSV
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <TooltipProvider>
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => {
                    const active = sort?.col === c;
                    return (
                      <TableHead key={c}>
                        <button
                          type="button"
                          onClick={() => toggleSort(c)}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          {c}
                          {!active && <ArrowUpDown className="w-3 h-3 opacity-50" />}
                          {active && sort?.dir === "asc" && <ArrowUp className="w-3 h-3" />}
                          {active && sort?.dir === "desc" && <ArrowDown className="w-3 h-3" />}
                        </button>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((r, i) => {
                  const rowError = (r.error ?? "").trim();
                  return (
                    <TableRow key={i}>
                      {columns.map((c, ci) => {
                        const v = r[c] ?? "";
                        const isFirst = ci === 0;
                        if (c === "structure_val") {
                          const n = parseFloat(v);
                          const missing = !isFinite(n);
                          return (
                            <TableCell key={c} className="font-mono text-right whitespace-nowrap">
                              {missing ? "—" : fmtUSD(n)}
                            </TableCell>
                          );
                        }
                        if (NUMERIC_DISPLAY_COLS.has(c)) {
                          return (
                            <TableCell key={c} className="font-mono text-right whitespace-nowrap">
                              {fmtNum(v)}
                            </TableCell>
                          );
                        }
                        if (DOLLAR_COLS.has(c)) {
                          return (
                            <TableCell key={c} className="font-mono text-right whitespace-nowrap">
                              {fmtUSD(v)}
                            </TableCell>
                          );
                        }
                        return (
                          <TableCell key={c} className="whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span>{String(v)}</span>
                              {isFirst && rowError && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="destructive" className="cursor-help">Error</Badge>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs">{rowError}</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TooltipProvider>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Page {page + 1} of {totalPages}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft className="w-4 h-4" /> Prev
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            Next <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Note: <span className="font-medium">structure_val</span> is the value sampled from our
        coverage grid at each location. If the grid has <em>no data</em> for a location, your
        optional default value (when provided) is used instead. An intentional <code>$0</code>
        from the grid is kept as <code>$0</code> — the default is not substituted in that case.
      </p>
    </div>
  );
};

export default WildfireResults;
