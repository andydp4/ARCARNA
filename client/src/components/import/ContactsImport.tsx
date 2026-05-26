import { useCallback, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Upload,
  Download,
  AlertTriangle,
  CheckCircle2,
  Contact,
  FileUp,
} from "lucide-react";
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
import { cn } from "@/lib/utils";

const CUSTOMER_GROUPS = ["Bronze", "Silver", "Gold", "Platinum"] as const;
const DUPLICATE_MODES = ["skip", "merge", "overwrite"] as const;

type PreviewRow = {
  rowIndex: number;
  data: { name?: string; email?: string; phone?: string; category?: string };
  errors: string[];
  action: string;
  duplicateOf?: { name: string };
};

interface ContactsImportProps {
  /** Compact layout for dialogs (e.g. Customers page). */
  compact?: boolean;
  onImported?: () => void;
}

export function ContactsImport({ compact, onImported }: ContactsImportProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [duplicateMode, setDuplicateMode] = useState<string>("skip");
  const [defaultCategory, setDefaultCategory] = useState<string>("Bronze");
  const [preview, setPreview] = useState<{
    rows: PreviewRow[];
    summary: { total: number; valid: number; invalid: number; duplicates: number };
    source?: string;
  } | null>(null);

  const acceptFiles = (f: File | null) => {
    if (!f) return;
    const ok = /\.(vcf|csv)$/i.test(f.name);
    if (!ok) {
      toast({
        title: "Unsupported file",
        description: "Use a .vcf export from Apple Contacts or a .csv file.",
        variant: "destructive",
      });
      return;
    }
    setFile(f);
    setPreview(null);
  };

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first");
      const contentBase64 = await fileToBase64(file);
      const res = await apiRequest("POST", "/api/customers/import/preview", {
        contentBase64,
        fileName: file.name,
        duplicateMode,
        defaultCategory,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setPreview(data);
      toast({ title: "Preview ready", description: "Review contacts before importing." });
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
          (r) =>
            r.errors.length === 0 &&
            ["insert", "overwrite", "merge"].includes(r.action),
        )
        .map((r) => r.data);
      const res = await apiRequest("POST", "/api/customers/import", {
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
        description: `Imported ${(result.imported ?? 0) + (result.merged ?? 0)}, skipped ${result.skipped ?? 0}, failed ${result.failed ?? 0}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/imports/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      setPreview(null);
      setFile(null);
      onImported?.();
    },
    onError: (e: Error) => {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    },
  });

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    acceptFiles(dropped ?? null);
  }, []);

  const wrapper = compact ? "space-y-4" : "space-y-6";

  return (
    <Card className={compact ? "border-0 shadow-none" : undefined}>
      {!compact && (
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Contact className="h-5 w-5" />
            Import from Contacts
          </CardTitle>
          <CardDescription>
            Import Apple Contacts (.vcf) or CSV. Duplicates are detected by phone or email.
            Preview is required before import.
          </CardDescription>
        </CardHeader>
      )}
      <CardContent className={cn(wrapper, compact && "pt-0")}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".vcf,.csv"
          className="hidden"
          onChange={(e) => acceptFiles(e.target.files?.[0] ?? null)}
          data-testid="input-contacts-file"
        />

        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors min-h-[140px]",
            dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30",
          )}
          data-testid="contacts-drop-zone"
        >
          <FileUp className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drag and drop a .vcf or .csv file here
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] gap-2"
            onClick={() => fileInputRef.current?.click()}
            data-testid="button-import-from-contacts"
          >
            <Contact className="h-4 w-4" />
            Import from Contacts
          </Button>
          {file && (
            <p className="text-xs text-foreground font-medium">{file.name}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button variant="outline" className="min-h-[44px]" asChild>
            <a href="/api/imports/templates/customers" download data-testid="download-customers-csv">
              <Download className="mr-2 h-4 w-4" />
              CSV template
            </a>
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Customer group (category)</Label>
            <Select value={defaultCategory} onValueChange={setDefaultCategory}>
              <SelectTrigger className="min-h-[44px]" data-testid="contacts-default-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOMER_GROUPS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Applied to imported contacts unless the file includes its own category.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Duplicate handling</Label>
            <Select value={duplicateMode} onValueChange={setDuplicateMode}>
              <SelectTrigger className="min-h-[44px]" data-testid="contacts-duplicate-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DUPLICATE_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Match existing customers by email or phone number.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => previewMutation.mutate()}
            disabled={!file || previewMutation.isPending}
            className="min-h-[44px]"
            data-testid="button-preview-contacts"
          >
            <Upload className="mr-2 h-4 w-4" />
            Preview import
          </Button>
          <Button
            onClick={() => commitMutation.mutate()}
            disabled={!preview?.summary?.valid || commitMutation.isPending}
            className="min-h-[44px]"
            data-testid="button-commit-contacts"
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Confirm import
          </Button>
        </div>

        {preview && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {preview.summary.valid} valid · {preview.summary.invalid} invalid ·{" "}
              {preview.summary.duplicates} duplicates · {preview.summary.total} contacts
              {preview.source === "vcard" ? " (vCard)" : preview.source ? ` (${preview.source})` : ""}
            </p>
            {preview.summary.valid === 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>No valid contacts to import</AlertTitle>
                <AlertDescription>
                  Each row needs a name and at least one valid phone or email.
                </AlertDescription>
              </Alert>
            )}
            <div className="max-h-72 overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Validation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.slice(0, 100).map((row) => (
                    <TableRow key={row.rowIndex}>
                      <TableCell>{row.rowIndex}</TableCell>
                      <TableCell className="max-w-[120px] truncate">
                        {row.data.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{row.data.phone ?? "—"}</TableCell>
                      <TableCell className="text-xs max-w-[140px] truncate">
                        {row.data.email ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.duplicateOf
                          ? `${row.action} (dup: ${row.duplicateOf.name})`
                          : row.action}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-xs",
                          row.errors.length ? "text-destructive" : "text-muted-foreground",
                        )}
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
