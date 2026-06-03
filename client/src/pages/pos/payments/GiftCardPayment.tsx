import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/appPaths";
import { useToast } from "@/hooks/use-toast";

export interface GiftCardPaymentState {
  code: string;
  balance: number;
  amountToApply: number;
  remainderPaymentMethod?: string;
}

interface GiftCardPaymentProps {
  orderTotal: number;
  value: GiftCardPaymentState | null;
  onChange: (value: GiftCardPaymentState | null) => void;
}

export function GiftCardPayment({ orderTotal, value, onChange }: GiftCardPaymentProps) {
  const { toast } = useToast();
  const [codeInput, setCodeInput] = useState(value?.code ?? "");
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState<number | null>(value?.balance ?? null);
  const [amountInput, setAmountInput] = useState(value?.amountToApply != null ? String(value.amountToApply) : "");
  const [remainderMethod, setRemainderMethod] = useState(value?.remainderPaymentMethod ?? "cash");

  const lookupBalance = async () => {
    const code = codeInput.trim();
    if (!code) return toast({ title: "Enter a gift card code", variant: "destructive" });
    setLoading(true);
    try {
      const res = await apiFetch(`/api/gift-cards/${encodeURIComponent(code)}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Gift card not found");
      const data = await res.json();
      if (data.status === "void") throw new Error("Gift card has been voided");
      if (data.status === "expired") throw new Error("Gift card has expired");
      const cardBalance = Number(data.balance);
      setBalance(cardBalance);
      const defaultApply = Math.min(cardBalance, orderTotal);
      setAmountInput(defaultApply.toFixed(2));
      onChange({ code, balance: cardBalance, amountToApply: defaultApply,
        remainderPaymentMethod: defaultApply < orderTotal - 0.001 ? remainderMethod : undefined });
    } catch (error) {
      setBalance(null); onChange(null);
      toast({ title: "Gift card lookup failed", description: error instanceof Error ? error.message : "Unknown error", variant: "destructive" });
    } finally { setLoading(false); }
  };

  const applyAmount = parseFloat(amountInput) || 0;
  const remainder = Math.max(0, Math.round((orderTotal - applyAmount) * 100) / 100);
  const needsRemainder = remainder > 0.01;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <Label className="text-sm font-medium">Gift card</Label>
      <div className="flex gap-2">
        <Input placeholder="Enter 16-character code" value={codeInput}
          onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
          className="min-h-[44px] font-mono uppercase" data-testid="input-gift-card-code" />
        <Button type="button" variant="outline" onClick={lookupBalance} disabled={loading}
          className="min-h-[44px]" data-testid="button-gift-card-lookup">{loading ? "…" : "Check"}</Button>
      </div>
      {balance != null && (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">Balance: <span className="font-medium text-foreground">${balance.toFixed(2)}</span> · ****{codeInput.slice(-4)}</p>
          <div className="grid gap-2">
            <Label htmlFor="gift-card-amount">Amount to apply</Label>
            <Input id="gift-card-amount" type="number" min={0.01} step="0.01" max={Math.min(balance, orderTotal)}
              value={amountInput} onChange={(e) => {
                setAmountInput(e.target.value);
                const amount = parseFloat(e.target.value) || 0;
                onChange({ code: codeInput.trim(), balance, amountToApply: amount,
                  remainderPaymentMethod: amount < orderTotal - 0.001 ? remainderMethod : undefined });
              }} className="min-h-[44px]" data-testid="input-gift-card-amount" />
          </div>
          {needsRemainder && (
            <>
              <p className="text-muted-foreground">Remaining due: <span className="font-medium">${remainder.toFixed(2)}</span></p>
              <Select value={remainderMethod} onValueChange={(method) => {
                setRemainderMethod(method);
                onChange({ code: codeInput.trim(), balance, amountToApply: applyAmount, remainderPaymentMethod: method });
              }}>
                <SelectTrigger className="min-h-[44px]" data-testid="select-gift-card-remainder"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
        </div>
      )}
    </div>
  );
}
