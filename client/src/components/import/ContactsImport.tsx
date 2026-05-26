import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parseContactsFileToRows } from "@/lib/contactsFileParse";
import { IMPORT_MAX_UPLOAD_BYTES } from "@shared/importLimits";
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

function isImportableRow(row: PreviewRow): boolean {
  return (
    row.errors.length === 0 && ["insert", "overwrite", "merge"].includes(row.action)
  );
}

export function ContactsImport({ compact, onImported }: ContactsImportProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [duplicateMode, setDuplicateMode] = useState<string>("skip");
  const [defaultCategory, setDefaultCategory] = useState<string>("Bronze");
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<{
    rows: PreviewRow[];
    summary: { total: number; valid: number; invalid: number; duplicates: number };
    source?: string;
  } | null>(null);
  const [selectedRowIndexes, setSelectedRowIndexes] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");

  const importableRows = useMemo(
    () => (preview?.rows ?? []).filter(isImportableRow),
    [preview],
  );

  const filteredRows = useMemo(() => {
    if (!preview) return [];
    const q = searchTerm.trim().toLowerCase();
    if (!q) return preview.rows;
    return preview.rows.filter((row) => {
      const name = (row.data.name ?? "").toLowerCase();
      const phone = (row.data.phone ?? "").toLowerCase();
      const email = (row.data.email ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q) || email.includes(q);
    });
  }, [preview, searchTerm]);

  const selectedImportableCount = useMemo(
    () => importableRows.filter((r) => selectedRowIndexes.has(r.rowIndex)).length,
    [importableRows, selectedRowIndexes],
  );

  useEffect(() => {
    if (!preview) {
      setSelectedRowIndexes(new Set());
      setSearchTerm("");
      return;
    }
    const defaultSelected = preview.rows
      .filter((r) => isImportableRow(r) && r.action === "insert")
      .map((r) => r.rowIndex);
    setSelectedRowIndexes(new Set(defaultSelected));
  }, [preview]);

  const toggleRow = (rowIndex: number, checked: boolean) => {
    setSelectedRowIndexes((prev) => {
      const next = new Set(prev);
      if (checked) next.add(rowIndex);
      else next.delete(rowIndex);
      return next;
    });
  };

  const selectRowIndexes = (indexes: number[]) => {
    setSelectedRowIndexes(new Set(indexes));
  };

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
    if (f.size > IMPORT_MAX_UPLOAD_BYTES) {
      toast({
        title: "File too large",
        description: `Maximum size is ${IMPORT_MAX_UPLOAD_BYTES / (1024 * 1024)} MB. Try exporting fewer contacts.`,
        variant: "destructive",
      });
      return;
    }
    setFile(f);
    setPreview(null);
    setSelectedRowIndexes(new Set());
    setSearchTerm("");
  };

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first");
      setParsing(true);
      let rows: Record<string, unknown>[];
      let source: "vcard" | "csv";
      try {
        ({ rows, source } = await parseContactsFileToRows(file, defaultCategory));
      } finally {
        setParsing(false);
      }
      const res = await apiRequest("POST", "/api/customers/import/preview-rows", {
        rows,
        duplicateMode,
        source,
        fileName: file.name,
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
        .filter((r) => isImportableRow(r) && selectedRowIndexes.has(r.rowIndex))
        .map((r) => r.data);
      if (validRows.length === 0) {
        throw new Error("Select at least one contact to import.");
      }
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
            Import Apple Contacts (.vcf) or CSV up to 32MB (photo data in the file is ignored).
            Parsed on your device — choose which contacts to import before confirming.
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
            disabled={!file || previewMutation.isPending || parsing}
            className="min-h-[44px]"
            data-testid="button-preview-contacts"
          >
            <Upload className="mr-2 h-4 w-4" />
            {parsing ? "Parsing contacts…" : "Preview import"}
          </Button>
          <Button
            onClick={() => commitMutation.mutate()}
            disabled={selectedImportableCount === 0 || commitMutation.isPending}
            className="min-h-[44px]"
            data-testid="button-commit-contacts"
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Import selected ({selectedImportableCount})
          </Button>
        </div>

        {preview && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {preview.summary.valid} valid · {preview.summary.invalid} invalid ·{" "}
              {preview.summary.duplicates} duplicates · {preview.summary.total} contacts
              {preview.source === "vcard" ? " (vCard)" : preview.source ? ` (${preview.source})` : ""}
            </p>
            <p
              className="text-sm font-medium text-foreground"
              data-testid="contacts-preview-list-count"
            >
              Showing all {filteredRows.length.toLocaleString()} contacts — scroll the table to browse
              every row.
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
            {preview.summary.valid > 0 && (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                  <p className="text-sm font-medium">
                    {selectedImportableCount} of {importableRows.length} importable selected
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-[36px]"
                      onClick={() =>
                        selectRowIndexes(importableRows.map((r) => r.rowIndex))
                      }
                    >
                      Select all
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-[36px]"
                      onClick={() =>
                        selectRowIndexes(
                          importableRows.filter((r) => r.action === "insert").map((r) => r.rowIndex),
                        )
                      }
                    >
                      New only
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-[36px]"
                      onClick={() => setSelectedRowIndexes(new Set())}
                    >
                      Clear
                    </Button>
                    {searchTerm.trim() && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-[36px]"
                        onClick={() => {
                          setSelectedRowIndexes((prev) => {
                            const next = new Set(prev);
                            filteredRows.filter(isImportableRow).forEach((r) => next.add(r.rowIndex));
                            return next;
                          });
                        }}
                      >
                        Select shown
                      </Button>
                    )}
                  </div>
                </div>
                <Input
                  placeholder="Search name, phone, or email…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="min-h-[44px]"
                  data-testid="contacts-import-search"
                />
              </div>
            )}
            <div className="max-h-[min(70vh,42rem)] overflow-auto border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={
                          importableRows.length > 0 &&
                          importableRows.every((r) => selectedRowIndexes.has(r.rowIndex))
                            ? true
                            : importableRows.some((r) => selectedRowIndexes.has(r.rowIndex))
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={(checked) => {
                          if (checked) {
                            selectRowIndexes(importableRows.map((r) => r.rowIndex));
                          } else {
                            setSelectedRowIndexes(new Set());
                          }
                        }}
                        aria-label="Select all importable contacts"
                        data-testid="contacts-select-all"
                      />
                    </TableHead>
                    <TableHead>#</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Validation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-6">
                        No contacts match your search.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRows.map((row) => {
                      const canImport = isImportableRow(row);
                      const checked = selectedRowIndexes.has(row.rowIndex);
                      return (
                        <TableRow
                          key={row.rowIndex}
                          className={cn(!canImport && "opacity-60", checked && canImport && "bg-muted/40")}
                        >
                          <TableCell>
                            <Checkbox
                              checked={canImport && checked}
                              disabled={!canImport}
                              onCheckedChange={(v) => toggleRow(row.rowIndex, v === true)}
                              aria-label={`Select ${row.data.name ?? "contact"}`}
                            />
                          </TableCell>
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
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            {searchTerm && filteredRows.length < preview.rows.length && (
              <p className="text-xs text-muted-foreground">
                Search matches {filteredRows.length.toLocaleString()} of{" "}
                {preview.rows.length.toLocaleString()} contacts. Selection is kept for contacts not
                shown in the filtered list.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
