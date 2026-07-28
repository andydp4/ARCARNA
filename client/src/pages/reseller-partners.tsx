/**
 * Reseller partners & ledger — the capture screen behind ARC-T2-004
 * (Reseller Credit & Payment Report). Record stock supplied and payments
 * received; the report derives balances, ageing and supply holds from these.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/appPaths";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Handshake, Plus, FileBarChart } from "lucide-react";
import { money } from "@/lib/reportBrand";

interface Partner {
  id: string;
  name: string;
  partnerCode: string;
}

async function postJson(url: string, body: unknown) {
  const res = await apiFetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || "Request failed");
  }
  return res.json();
}

export default function ResellerPartnersPage() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [type, setType] = useState<"SUPPLY" | "PAYMENT">("SUPPLY");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const { data: partners = [], isLoading } = useQuery<Partner[]>({
    queryKey: ["/api/reseller-partners"],
    queryFn: async () => {
      const res = await apiFetch("/api/reseller-partners", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load partners");
      return res.json();
    },
  });

  const addPartner = useMutation({
    mutationFn: () => postJson("/api/reseller-partners", { name: name.trim(), partnerCode: code.trim() }),
    onSuccess: () => {
      toast({ title: "Partner added", description: `${name.trim()} is now on the reseller list.` });
      setName("");
      setCode("");
      queryClient.invalidateQueries({ queryKey: ["/api/reseller-partners"] });
    },
    onError: (e: any) =>
      toast({ title: "Could not add partner", description: e.message, variant: "destructive" }),
  });

  const addTxn = useMutation({
    mutationFn: () =>
      postJson("/api/reseller-transactions", {
        partnerId,
        type,
        amount: parseFloat(amount),
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      const verb = type === "SUPPLY" ? "Stock supplied" : "Payment received";
      toast({ title: `${verb} recorded`, description: `${money(parseFloat(amount))} logged to the ledger.` });
      setAmount("");
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/reports", "ARC-T2-004"] });
    },
    onError: (e: any) =>
      toast({ title: "Could not record entry", description: e.message, variant: "destructive" }),
  });

  const amountValid = amount !== "" && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PageHeader
        title="Reseller Partners"
        question="What has each partner been supplied, and what have they paid?"
        explanation="Record supplies and payments here. The Reseller Credit & Payment report turns them into balances, ageing and supply holds."
        icon={Handshake}
        action={
          <Button variant="outline" asChild>
            <Link href="/reports/reseller-credit">
              <FileBarChart className="mr-2 h-4 w-4" />
              View report
            </Link>
          </Button>
        }
      />

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {/* Add partner */}
        <Card className="lm-card border-0 shadow-none">
          <CardHeader>
            <CardTitle className="text-lg">Add a partner</CardTitle>
            <CardDescription>Partner codes follow the PPP-01 … PPP-11 pattern.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="partner-name">Trading name</Label>
              <Input
                id="partner-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Peak Nutrition"
                data-testid="input-partner-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="partner-code">Partner code</Label>
              <Input
                id="partner-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="PPP-01"
                data-testid="input-partner-code"
              />
            </div>
            <Button
              className="w-full"
              disabled={!name.trim() || !code.trim() || addPartner.isPending}
              onClick={() => addPartner.mutate()}
              data-testid="button-add-partner"
            >
              <Plus className="mr-2 h-4 w-4" />
              {addPartner.isPending ? "Adding…" : "Add partner"}
            </Button>
          </CardContent>
        </Card>

        {/* Ledger entry */}
        <Card className="lm-card border-0 shadow-none">
          <CardHeader>
            <CardTitle className="text-lg">Record supply or payment</CardTitle>
            <CardDescription>A payment clears the oldest unpaid supplies first.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Partner</Label>
              <Select value={partnerId} onValueChange={setPartnerId}>
                <SelectTrigger data-testid="select-partner">
                  <SelectValue placeholder={isLoading ? "Loading…" : "Choose a partner"} />
                </SelectTrigger>
                <SelectContent>
                  {partners.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.partnerCode} · {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Entry type</Label>
              <Select value={type} onValueChange={(v: "SUPPLY" | "PAYMENT") => setType(v)}>
                <SelectTrigger data-testid="select-entry-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SUPPLY">Stock supplied (they owe us)</SelectItem>
                  <SelectItem value="PAYMENT">Payment received</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="txn-amount">Amount (£)</Label>
              <Input
                id="txn-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                data-testid="input-amount"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="txn-notes">Notes (optional)</Label>
              <Textarea
                id="txn-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Invoice ref, delivery note…"
                data-testid="input-notes"
              />
            </div>
            <Button
              className="w-full"
              disabled={!partnerId || !amountValid || addTxn.isPending}
              onClick={() => addTxn.mutate()}
              data-testid="button-record-txn"
            >
              {addTxn.isPending ? "Recording…" : "Record entry"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Current partners */}
      <Card className="lm-card mt-6 border-0 shadow-none">
        <CardHeader>
          <CardTitle className="text-lg">Partners</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : partners.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No partners yet. Add one above to start tracking supplies and payments.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {partners.map((p) => (
                <Badge key={p.id} variant="outline" className="px-2 py-1">
                  <span className="font-mono text-[10px]">{p.partnerCode}</span>
                  <span className="ml-2">{p.name}</span>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
