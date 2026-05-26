import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Upload, Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fileToBase64 } from "@/lib/fileImport";
import { useToast } from "@/hooks/use-toast";
import { matchProductImportHeader } from "@shared/productImport";

type ImportKind = "products" | "customers";

interface SpreadsheetImportProps {
  kind: ImportKind;
  title: string;
  description: string;
  duplicateModes: readonly string[];
  defaultDuplicateMode: string;
  fieldOptions: { key: string; label: string }[];
  onImported?: () => void;
}

export function SpreadsheetImport({
  kind,
  title,
  description,
  duplicateModes,
  defaultDuplicateMode,
  fieldOptions,
  onImported,
}: SpreadsheetImportProps) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [duplicateMode, setDuplicateMode] = useState(defaultDuplicateMode);
  const [preview, setPreview] = useState<any>(null);

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first");
      const contentBase64 = await fileToBase64(file);
      const endpoint =
        kind === "products"
          ? "/api/products/import/preview"
          : "/api/customers/import/preview";
      const res = await apiRequest("POST", endpoint, {
        contentBase64,
        fileName: file.name,
        mapping,
        duplicateMode,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setPreview(data);
      toast({ title: "Preview ready", description: "Review rows before importing." });
    },
    onError: (e: Error) => {
      toast({ title: "Preview failed", description: e.message, variant: "destructive" });
    },
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!preview?.rows) throw new Error("Run preview first");
      const validRows = preview.rows
        .filter(
          (r: any) =>
            r.errors.length === 0 &&
            ["insert", "overwrite", "merge"].includes(r.action),
        )
        .map((r: any) => r.data);
      const endpoint =
        kind === "products" ? "/api/products/import" : "/api/customers/import";
      const res = await apiRequest("POST", endpoint, {
        rows: validRows,
        duplicateMode,
        confirmed: true,
        fileName: file?.name,
      });
      return res.json();
    },
    onSuccess: (result) => {
      toast({
        title: "Import complete",
        description: `Imported ${result.imported ?? 0}, skipped ${result.skipped ?? 0}, failed ${result.failed ?? 0}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/history"] });
      if (kind === "products") queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      if (kind === "customers") queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      setPreview(null);
      setFile(null);
      onImported?.();
    },
    onError: (e: Error) => {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    },
  });

  const onFileChange = async (f: File | null) => {
    setFile(f);
    setPreview(null);
    if (!f) return;
    try {
      const contentBase64 = await fileToBase64(f);
      const res = await apiRequest("POST", `/api/${kind}/import/preview`, {
        contentBase64,
        fileName: f.name,
        mapping: {},
        duplicateMode,
      });
      const data = await res.json();
      setHeaders(data.headers ?? []);
      const auto: Record<string, string> = {};
      fieldOptions.forEach((field) => {
        const match = (data.headers as string[]).find((h) =>
          kind === "products"
            ? matchProductImportHeader(h, field.key)
            : h.toLowerCase() === field.key.toLowerCase() ||
              h.toLowerCase().replace(/[\s_]+/g, "").includes(field.key.toLowerCase()),
        );
        if (match) auto[field.key] = match;
      });
      setMapping(auto);
    } catch {
      setHeaders([]);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <Button variant="outline" className="min-h-[44px]" asChild>
            <a href={`/api/imports/templates/${kind}`} download data-testid={`download-template-${kind}`}>
              <Download className="mr-2 h-4 w-4" />
              Download template
            </a>
          </Button>
          <div className="flex-1">
            <Label htmlFor={`file-${kind}`} className="sr-only">Upload file</Label>
            <input
              id={`file-${kind}`}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground"
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
              data-testid={`input-file-${kind}`}
            />
          </div>
        </div>

        {headers.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {fieldOptions.map((field) => (
              <div key={field.key} className="space-y-1">
                <Label>{field.label}</Label>
                <Select
                  value={mapping[field.key] ?? ""}
                  onValueChange={(v) => setMapping((m) => ({ ...m, [field.key]: v }))}
                >
                  <SelectTrigger className="min-h-[44px]">
                    <SelectValue placeholder="Column" />
                  </SelectTrigger>
                  <SelectContent>
                    {headers.map((h) => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2 max-w-xs">
          <Label>Duplicate handling</Label>
          <Select value={duplicateMode} onValueChange={setDuplicateMode}>
            <SelectTrigger data-testid={`duplicate-mode-${kind}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {duplicateModes.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {kind === "products" && duplicateMode === "overwrite" && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Overwrite enabled</AlertTitle>
              <AlertDescription>Existing SKUs will be replaced. Default is skip.</AlertDescription>
            </Alert>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => previewMutation.mutate()}
            disabled={!file || previewMutation.isPending}
            className="min-h-[44px]"
            data-testid={`button-preview-${kind}`}
          >
            <Upload className="mr-2 h-4 w-4" />
            Preview import
          </Button>
          <Button
            variant="default"
            onClick={() => commitMutation.mutate()}
            disabled={!preview || !preview.summary?.valid || commitMutation.isPending}
            className="min-h-[44px]"
            data-testid={`button-commit-${kind}`}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Confirm import
          </Button>
        </div>

        {preview && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {preview.summary.valid} valid · {preview.summary.invalid} invalid ·{" "}
              {preview.summary.duplicates} duplicates · {preview.summary.total} rows
            </p>
            {preview.summary.valid === 0 && preview.summary.invalid > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>No valid rows to import</AlertTitle>
                <AlertDescription>
                  Check sale price and cost price columns use plain numbers (e.g. 4.00), not £
                  symbols. Re-download the template if needed.
                </AlertDescription>
              </Alert>
            )}
            <div className="max-h-64 overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Errors</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.slice(0, 50).map((row: any) => (
                    <TableRow key={row.rowIndex}>
                      <TableCell>{row.rowIndex}</TableCell>
                      <TableCell>{row.action}</TableCell>
                      <TableCell
                        className={
                          row.errors.length ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                        }
                      >
                        {row.errors.length ? row.errors.join("; ") : "OK"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
