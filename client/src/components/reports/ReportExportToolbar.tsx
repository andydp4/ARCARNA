/**
 * Export toolbar for a report — PNG / JPEG / PDF / CSV.
 *
 * The PNG/JPEG/PDF exporters rasterise the branded report node so the saved
 * file matches the screen exactly (ARC-RPT-SPEC-001, Export Format Spec).
 * The toolbar itself is marked `data-export-exclude` so it never appears in
 * the captured image.
 */
import { useState, type RefObject } from "react";
import { Download, FileImage, FileText, Table as TableIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  exportNodePng,
  exportNodeJpeg,
  exportNodePdf,
  exportCsv,
  type CsvColumn,
} from "@/lib/reportExport";

export interface ReportExportToolbarProps<T> {
  /** Ref to the branded report node to rasterise (the ReportFrame root). */
  targetRef: RefObject<HTMLElement>;
  /** Spec report reference, e.g. "ARC-T1-001". */
  reportRef: string;
  /** Optional CSV data. When omitted, the CSV option is hidden. */
  csv?: { rows: T[]; columns: CsvColumn<T>[] };
}

export function ReportExportToolbar<T>({ targetRef, reportRef, csv }: ReportExportToolbarProps<T>) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<null | "png" | "jpeg" | "pdf" | "csv">(null);

  async function run(kind: "png" | "jpeg" | "pdf" | "csv") {
    try {
      setBusy(kind);
      if (kind === "csv") {
        if (!csv) return;
        exportCsv(csv.rows, csv.columns, reportRef);
      } else {
        const node = targetRef.current;
        if (!node) throw new Error("Report is still rendering. Try again in a moment.");
        if (kind === "png") await exportNodePng(node, reportRef);
        else if (kind === "jpeg") await exportNodeJpeg(node, reportRef);
        else await exportNodePdf(node, reportRef);
      }
      toast({
        title: "Report exported",
        description: `Saved ${reportRef} as ${kind.toUpperCase()}.`,
      });
    } catch (err: any) {
      toast({
        title: "Export failed",
        description: err?.message || "Could not generate the export. Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-export-exclude="true" className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy !== null} data-testid={`export-${reportRef}`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span className="ml-2">{busy ? "Exporting…" : "Export"}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => run("pdf")} disabled={busy !== null}>
            <FileText className="mr-2 h-4 w-4" /> PDF
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => run("png")} disabled={busy !== null}>
            <FileImage className="mr-2 h-4 w-4" /> PNG image
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => run("jpeg")} disabled={busy !== null}>
            <FileImage className="mr-2 h-4 w-4" /> JPEG image
          </DropdownMenuItem>
          {csv && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => run("csv")} disabled={busy !== null}>
                <TableIcon className="mr-2 h-4 w-4" /> CSV data
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
