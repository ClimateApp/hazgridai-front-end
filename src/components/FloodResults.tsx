import { useMemo, useState } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type FloodResult = {
  columns: string[];
  rows: Record<string, string>[];
  blob: Blob;
  filename: string;
};

const PAGE_SIZE = 10;

const NUMERIC_HINTS = ["lon", "lat", "id", "depth", "elev", "level", "loss", "ratio", "ffe", "value"];
const isNumericCol = (c: string) => {
  const lc = c.toLowerCase();
  return NUMERIC_HINTS.some((h) => lc.includes(h));
};

const fmt = (v: string | number) => {
  if (v === undefined || v === null || v === "") return "—";
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
};

interface Props {
  result: FloodResult;
}

const FloodResults = ({ result }: Props) => {
  const { columns, rows, blob, filename } = result;
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const num = isNumericCol(sort.col);
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = a[sort.col] ?? "";
      const vb = b[sort.col] ?? "";
      let cmp = 0;
      if (num) {
        const na = parseFloat(va);
        const nb = parseFloat(vb);
        cmp = (Number.isFinite(na) ? na : -Infinity) - (Number.isFinite(nb) ? nb : -Infinity);
      } else {
        cmp = String(va).localeCompare(String(vb));
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pageRows = sortedRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const toggleSort = (col: string) => {
    setPage(0);
    setSort((s) => {
      if (!s || s.col !== col) return { col, dir: "asc" };
      if (s.dir === "asc") return { col, dir: "desc" };
      return null;
    });
  };

  const handleDownload = () => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "flood_results.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Showing {pageRows.length} of {rows.length} rows
        </p>
        <Button size="sm" onClick={handleDownload}>
          <Download className="w-4 h-4" /> Download results CSV
        </Button>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
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
              {pageRows.map((r, i) => (
                <TableRow key={i}>
                  {columns.map((c) => {
                    const v = r[c] ?? "";
                    if (isNumericCol(c)) {
                      return (
                        <TableCell key={c} className="font-mono text-right whitespace-nowrap">
                          {fmt(v)}
                        </TableCell>
                      );
                    }
                    return (
                      <TableCell key={c} className="whitespace-nowrap">
                        {String(v)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
    </div>
  );
};

export default FloodResults;
