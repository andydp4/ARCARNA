import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { apiFetch } from "@/lib/appPaths";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Search, Plus, Ban } from "lucide-react";

export default function GiftCardsPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [lookupCode, setLookupCode] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueAmount, setIssueAmount] = useState("");
  const [issueCustomerId, setIssueCustomerId] = useState("");
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

  const { data: listData, isLoading } = useQuery({
    queryKey: ["/api/gift-cards", search],
    queryFn: async () => {
      const params = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : "";
      const res = await apiFetch(`/api/gift-cards${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load gift cards");
      return res.json();
    },
  });

  const { data: customers = [] } = useQuery<Array<{ id: string; name: string }>>({ queryKey: ["/api/customers"] });

  const { data: detailData, refetch: refetchDetail } = useQuery({
    queryKey: ["/api/gift-cards/detail", lookupCode],
    enabled: lookupCode.length === 16,
    queryFn: async () => {
      const res = await apiFetch(`/api/gift-cards/${encodeURIComponent(lookupCode)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load gift card");
      return res.json();
    },
  });

  const issueMutation = useMutation({
    mutationFn: (body: { amount: number; customerId?: string }) => apiRequest("POST", "/api/gift-cards", body),
    onSuccess: async (res) => {
      const data = await res.json();
      setIssuedCode(data.code);
      queryClient.invalidateQueries({ queryKey: ["/api/gift-cards"] });
      toast({ title: "Gift card issued", description: `Code ending ${data.code.slice(-4)}` });
    },
    onError: () => toast({ title: "Failed to issue gift card", variant: "destructive" }),
  });

  const voidMutation = useMutation({
    mutationFn: (code: string) => apiRequest("POST", `/api/gift-cards/${encodeURIComponent(code)}/void`, {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/gift-cards"] }); refetchDetail(); toast({ title: "Gift card voided" }); },
    onError: () => toast({ title: "Void failed", variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Gift cards" question="What stored value is outstanding?" explanation="Issue, search, void, and review gift card movements"
        action={<Button onClick={() => { setIssueOpen(true); setIssuedCode(null); }} className="min-h-[44px] lm-btn-metal"><Plus className="mr-2 h-4 w-4" />Issue gift card</Button>} />
      <Card><CardHeader><CardTitle className="text-base">Search</CardTitle></CardHeader>
        <CardContent><div className="flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-10 min-h-[44px] font-mono uppercase" placeholder="Full code or last 4 digits" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <Button variant="outline" className="min-h-[44px]" onClick={() => {
            const code = search.trim().toUpperCase().replace(/[\s-]/g, "");
            if (code.length !== 16) return toast({ title: "Enter full 16-character code", variant: "destructive" });
            setLookupCode(code);
          }}>Details</Button></div></CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Gift cards</CardTitle></CardHeader>
        <CardContent>{isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
          (listData?.giftCards ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No gift cards found.</p> :
          <Table><TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Balance</TableHead><TableHead>Original</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>{(listData?.giftCards ?? []).map((card: any) => (
              <TableRow key={card.id}><TableCell className="font-mono">{card.maskedCode}</TableCell>
                <TableCell>${card.balance.toFixed(2)}</TableCell><TableCell>${card.originalAmount.toFixed(2)}</TableCell>
                <TableCell><Badge variant={card.status === "active" ? "default" : "secondary"}>{card.status}</Badge></TableCell></TableRow>
            ))}</TableBody></Table>}</CardContent></Card>
      {detailData && lookupCode && (
        <Card><CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Card ****{detailData.codeLast4}</CardTitle>
          {detailData.status === "active" && <Button variant="destructive" size="sm" onClick={() => voidMutation.mutate(lookupCode)}><Ban className="mr-2 h-4 w-4" />Void</Button>}
        </CardHeader><CardContent>
          <p className="mb-4 text-sm">Balance: <strong>${detailData.balance.toFixed(2)}</strong> · {detailData.status}</p>
          {detailData.movements?.length > 0 && <Table><TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Amount</TableHead><TableHead>Balance after</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
            <TableBody>{detailData.movements.map((m: any) => (
              <TableRow key={m.id}><TableCell>{m.type}</TableCell><TableCell>${m.amount.toFixed(2)}</TableCell>
                <TableCell>${m.balanceAfter.toFixed(2)}</TableCell><TableCell>{new Date(m.createdAt).toLocaleString()}</TableCell></TableRow>
            ))}</TableBody></Table>}
        </CardContent></Card>
      )}
      <Dialog open={issueOpen} onOpenChange={setIssueOpen}><DialogContent><DialogHeader><DialogTitle>Issue gift card</DialogTitle></DialogHeader>
        {issuedCode ? <p className="rounded-md border bg-muted p-3 font-mono text-lg tracking-wider">{issuedCode}</p> :
          <div className="grid gap-4 py-4"><div className="grid gap-2"><Label>Amount</Label><Input type="number" min="0.01" step="0.01" value={issueAmount} onChange={(e) => setIssueAmount(e.target.value)} className="min-h-[44px]" /></div>
            <div className="grid gap-2"><Label>Customer (optional)</Label><Select value={issueCustomerId || "none"} onValueChange={(v) => setIssueCustomerId(v === "none" ? "" : v)}>
              <SelectTrigger className="min-h-[44px]"><SelectValue placeholder="Walk-in" /></SelectTrigger>
              <SelectContent><SelectItem value="none">Walk-in</SelectItem>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div></div>}
        <DialogFooter>{issuedCode ? <Button onClick={() => { setIssueOpen(false); setIssuedCode(null); }}>Done</Button> :
          <><Button variant="outline" onClick={() => setIssueOpen(false)}>Cancel</Button>
          <Button onClick={() => { const amount = parseFloat(issueAmount); if (!amount) return toast({ title: "Enter amount", variant: "destructive" });
            issueMutation.mutate({ amount, customerId: issueCustomerId || undefined }); }} disabled={issueMutation.isPending}>Issue</Button></>}</DialogFooter>
      </DialogContent></Dialog>
    </div>
  );
}
