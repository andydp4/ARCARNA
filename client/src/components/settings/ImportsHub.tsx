import { useQuery } from "@tanstack/react-query";
import { Download, History } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SpreadsheetImport } from "@/components/import/SpreadsheetImport";
import { resolveApiUrl } from "@/lib/appPaths";
import { ContactsImport } from "@/components/import/ContactsImport";

export function ImportsHub() {
  const { data: history = [] } = useQuery<any[]>({
    queryKey: ["/api/imports/history"],
  });

  return (
    <div className="space-y-6">
      <SpreadsheetImport
        kind="products"
        title="Product import"
        description="CSV or XLSX with column mapping and mandatory preview."
        duplicateModes={["skip", "overwrite"]}
        defaultDuplicateMode="skip"
        fieldOptions={[
          { key: "name", label: "Name *" },
          { key: "productId", label: "SKU" },
          { key: "defaultSalePrice", label: "Sale price *" },
          { key: "costPrice", label: "Cost" },
          { key: "stock", label: "Stock" },
          { key: "barcode", label: "Barcode" },
        ]}
      />

      <ContactsImport />

      <SpreadsheetImport
        kind="customers"
        title="Customer spreadsheet import"
        description="CSV or XLSX with column mapping. For Apple Contacts, use Import from Contacts above."
        duplicateModes={["skip", "merge", "overwrite"]}
        defaultDuplicateMode="skip"
        fieldOptions={[
          { key: "name", label: "Name *" },
          { key: "email", label: "Email" },
          { key: "phone", label: "Phone" },
          { key: "address", label: "Address" },
          { key: "category", label: "Category" },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Import history
          </CardTitle>
          <CardDescription>Recent imports for this organization</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No imports yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="text-sm">
                      {h.createdAt ? new Date(h.createdAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>{h.importType}</TableCell>
                    <TableCell className="max-w-[120px] truncate">{h.fileName || "—"}</TableCell>
                    <TableCell className="text-sm">
                      +{h.importedCount} / skip {h.skippedCount} / fail {h.failedCount}
                      {h.duplicateMode ? ` (${h.duplicateMode})` : ""}
                    </TableCell>
                    <TableCell>
                      {h.failedCount > 0 && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={resolveApiUrl(`/api/imports/failed/${h.id}`)} download>
                            <Download className="h-3 w-3 mr-1" />
                            Errors
                          </a>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
