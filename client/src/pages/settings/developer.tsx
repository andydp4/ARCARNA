import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import AuditLogsPage from "@/pages/audit-logs";
import WorkerLogsPage from "@/pages/worker-logs";
import RulesPage from "@/pages/rules";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Key,
  Plus,
  Copy,
  Check,
  Trash2,
  Eye,
  EyeOff,
  Code2,
  Webhook,
  ShieldCheck,
} from "lucide-react";

const ALL_SCOPES: { id: string; label: string; description: string; group: string }[] = [
  // Products
  { id: "products:read",   label: "Products — read",   description: "List products, prices, stock", group: "Products" },
  { id: "products:write",  label: "Products — write",  description: "Create, update, delete products", group: "Products" },
  // Orders
  { id: "orders:read",     label: "Orders — read",     description: "View orders and order details", group: "Orders" },
  { id: "orders:write",    label: "Orders — write",    description: "Create and update orders", group: "Orders" },
  // Customers
  { id: "customers:read",  label: "Customers — read",  description: "View customer profiles", group: "Customers" },
  { id: "customers:write", label: "Customers — write", description: "Create and update customers", group: "Customers" },
  // Inventory
  { id: "inventory:read",  label: "Inventory — read",  description: "Read stock levels and movements", group: "Inventory" },
  { id: "inventory:write", label: "Inventory — write", description: "Adjust stock, transfers, receipts", group: "Inventory" },
  // Shifts
  { id: "shifts:read",     label: "Shifts — read",     description: "View open/closed shifts", group: "Shifts" },
  // Expenses
  { id: "expenses:read",   label: "Expenses — read",   description: "View expenses and profit reports", group: "Expenses" },
  // Locations
  { id: "locations:read",  label: "Locations — read",  description: "List store locations", group: "Locations" },
  // Reports
  { id: "reports:read",    label: "Reports — read",    description: "Access analytics and reports", group: "Reports" },
  // Full access
  { id: "*",               label: "Full access (★)",   description: "All scopes — use carefully", group: "Admin" },
];

const SCOPE_GROUPS = [...new Set(ALL_SCOPES.map((s) => s.group))];

interface ApiKey {
  id: string;
  name: string;
  keyLookup: string;
  scopes: string[];
  createdAt: string;
  revokedAt: string | null;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button variant="ghost" size="icon" onClick={copy} className="h-8 w-8">
      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

function NewKeyDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["products:read"]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(true);

  const toggleScope = (scope: string) => {
    if (scope === "*") {
      setSelectedScopes((prev) => (prev.includes("*") ? [] : ["*"]));
      return;
    }
    setSelectedScopes((prev) =>
      prev.includes(scope)
        ? prev.filter((s) => s !== scope && s !== "*")
        : [...prev.filter((s) => s !== "*"), scope],
    );
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/api-keys", {
        name: name.trim() || "API key",
        scopes: selectedScopes,
      });
      return res.json() as Promise<{ plainKey: string }>;
    },
    onSuccess: (data) => {
      setCreatedKey(data.plainKey);
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create key", description: err.message, variant: "destructive" });
    },
  });

  const handleClose = () => {
    setOpen(false);
    setName("");
    setSelectedScopes(["products:read"]);
    setCreatedKey(null);
    setShowKey(true);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true); }}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-2" />
          New API key
        </Button>
      </DialogTrigger>

      <DialogContent className="liquid-metal lm-card max-w-2xl max-h-[88vh] flex flex-col gap-0 p-0">
        {createdKey ? (
          <>
            <DialogHeader className="p-6 pb-4">
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-green-500" />
                Key created — save it now
              </DialogTitle>
              <DialogDescription>
                This is the only time the full key is shown. Copy it before closing.
              </DialogDescription>
            </DialogHeader>

            <div className="px-6 pb-4 space-y-3">
              <div className="rounded-lg border bg-muted p-3 font-mono text-sm break-all flex items-start gap-2">
                <span className="flex-1 select-all">
                  {showKey ? createdKey : createdKey.replace(/./g, "•")}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <CopyButton text={createdKey} />
              </div>

              <p className="text-xs text-muted-foreground">
                Use as: <code className="bg-muted px-1 rounded">Authorization: Bearer {createdKey.slice(0, 20)}…</code>
              </p>
            </div>

            <DialogFooter className="border-t p-4">
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className="p-6 pb-4 border-b">
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                Choose a name and the scopes this key may access.
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
              <div className="grid gap-1.5">
                <Label htmlFor="key-name">Key name</Label>
                <Input
                  id="key-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Claude Agent, Zapier, My App"
                />
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>Permissions</Label>
                  <span className="text-xs text-muted-foreground">
                    {selectedScopes.includes("*")
                      ? "Full access"
                      : `${selectedScopes.length} selected`}
                  </span>
                </div>

                {SCOPE_GROUPS.map((group) => (
                  <div key={group} className="space-y-2">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                      {group}
                    </p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {ALL_SCOPES.filter((s) => s.group === group).map((scope) => {
                        const checked =
                          selectedScopes.includes(scope.id) ||
                          (scope.id !== "*" && selectedScopes.includes("*"));
                        return (
                          <label
                            key={scope.id}
                            className={`flex items-start gap-2.5 cursor-pointer rounded-lg border p-2.5 transition-colors ${
                              checked
                                ? "border-primary/50 bg-primary/5"
                                : "border-border hover:bg-accent/40"
                            }`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleScope(scope.id)}
                              className="mt-0.5"
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-medium leading-tight">{scope.label}</p>
                              <p className="text-xs text-muted-foreground leading-tight mt-0.5">
                                {scope.description}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter className="border-t p-4 gap-2 sm:gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || selectedScopes.length === 0}
              >
                {createMutation.isPending ? "Creating…" : "Create key"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevokeButton({ id }: { id: string }) {
  const { toast } = useToast();
  const revoke = useMutation({
    mutationFn: () => apiRequest("POST", `/api/api-keys/${id}/revoke`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({ title: "Key revoked" });
    },
    onError: () => toast({ title: "Failed to revoke key", variant: "destructive" }),
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="liquid-metal lm-card">
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke this API key?</AlertDialogTitle>
          <AlertDialogDescription>
            Any app using this key will immediately lose access. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground"
            onClick={() => revoke.mutate()}
          >
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function DeveloperSettingsPage() {
  const { user } = useAuth();
  const canAccess = user?.role === "SUPER_ADMIN" || user?.role === "ADMIN";
  const canSeeLogs = user?.role === "SUPER_ADMIN";
  const [activeTab, setActiveTab] = useState("api-keys");

  const { data: keys = [], isLoading } = useQuery<ApiKey[]>({
    queryKey: ["/api/api-keys"],
    enabled: canAccess,
  });

  const activeKeys = keys.filter((k) => !k.revokedAt);
  const revokedKeys = keys.filter((k) => k.revokedAt);

  const baseUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/arcarna/v1`
      : "https://viger.cloud/arcarna/v1";

  if (!canAccess) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Only Super Admins and Admins can manage API keys.
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-4xl">
      <PageHeader
        title="Developer"
        description="API keys, audit trail, background jobs and automation rules"
        icon={Code2}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 min-h-[48px]">
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          {canSeeLogs && <TabsTrigger value="audit-log">Audit Log</TabsTrigger>}
          {canSeeLogs && <TabsTrigger value="worker-logs">Worker Logs</TabsTrigger>}
          <TabsTrigger value="rules">Automation Rules</TabsTrigger>
        </TabsList>

        <TabsContent value="api-keys" className="space-y-6">
      {/* Base URL info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Webhook className="h-4 w-4" />
            API base URL
          </CardTitle>
          <CardDescription>
            Send <code className="text-xs bg-muted px-1 rounded">Authorization: Bearer &lt;key&gt;</code> on every request.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 font-mono text-sm bg-muted rounded-lg px-3 py-2">
            <span className="flex-1 select-all">{baseUrl}</span>
            <CopyButton text={baseUrl} />
          </div>

          <div className="mt-4 grid gap-1 text-sm">
            <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide mb-1">Available endpoints</p>
            {[
              ["GET", "/orgs/{orgId}/products",    "products:read"],
              ["GET", "/orgs/{orgId}/orders",       "orders:read"],
              ["POST","/orgs/{orgId}/orders",       "orders:write"],
              ["GET", "/orgs/{orgId}/customers",    "customers:read"],
              ["GET", "/orgs/{orgId}/inventory",    "inventory:read"],
              ["GET", "/orgs/{orgId}/shifts",       "shifts:read"],
              ["GET", "/orgs/{orgId}/expenses",     "expenses:read"],
              ["GET", "/orgs/{orgId}/locations",    "locations:read"],
              ["GET", "/orgs/{orgId}/reports/sales","reports:read"],
            ].map(([method, path, scope]) => (
              <div key={path} className="flex items-center gap-2 font-mono text-xs py-0.5">
                <Badge variant={method === "GET" ? "secondary" : "default"} className="w-12 justify-center text-[10px]">
                  {method}
                </Badge>
                <span className="text-foreground/80">{path}</span>
                <Badge variant="outline" className="text-[10px] ml-auto">{scope}</Badge>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg bg-muted/60 p-3 text-xs font-mono space-y-1">
            <p className="text-muted-foreground font-sans font-medium text-[11px] uppercase tracking-wide mb-1">
              Example — Claude / ChatGPT tool config
            </p>
            <p><span className="text-blue-500">URL:</span> {baseUrl}/orgs/7f8c5189.../products</p>
            <p><span className="text-blue-500">Method:</span> GET</p>
            <p><span className="text-blue-500">Header:</span> Authorization: Bearer mk_live_…</p>
          </div>
        </CardContent>
      </Card>

      {/* API keys */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="h-4 w-4" />
              API keys
            </CardTitle>
            <CardDescription>
              {activeKeys.length} active key{activeKeys.length !== 1 ? "s" : ""}
            </CardDescription>
          </div>
          <NewKeyDialog />
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
          ) : activeKeys.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Key className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No active API keys yet.</p>
              <p className="text-xs">Create one to connect external tools.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key prefix</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeKeys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      mk_live_{key.keyLookup}…
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(key.scopes ?? []).map((s) => (
                          <Badge key={s} variant="secondary" className="text-[10px]">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {key.createdAt ? new Date(key.createdAt).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell>
                      <RevokeButton id={key.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {revokedKeys.length > 0 && (
            <details className="mt-4">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                {revokedKeys.length} revoked key{revokedKeys.length !== 1 ? "s" : ""}
              </summary>
              <Table className="mt-2 opacity-50">
                <TableBody>
                  {revokedKeys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell className="font-medium line-through text-muted-foreground">
                        {key.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        mk_live_{key.keyLookup}…
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        Revoked {key.revokedAt ? new Date(key.revokedAt).toLocaleDateString() : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </details>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        {canSeeLogs && (
          <TabsContent value="audit-log" className="space-y-6">
            <AuditLogsPage />
          </TabsContent>
        )}

        {canSeeLogs && (
          <TabsContent value="worker-logs" className="space-y-6">
            <WorkerLogsPage />
          </TabsContent>
        )}

        <TabsContent value="rules" className="space-y-6">
          <RulesPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
