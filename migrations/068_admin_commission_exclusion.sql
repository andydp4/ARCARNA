-- An owner/admin stepping in to complete a big order during a rush had no
-- way to keep that sale out of their own commission and KPI figures — it
-- silently accrued to whichever user account completed it, admin included,
-- exactly like a cashier's sale. There was also no existing "house"/excluded
-- concept anywhere in the schema to hang this off; shared/reports/
-- orderCommission.ts's CommissionOrderInput.excluded flag is fully
-- implemented and unit-tested but nothing ever set it.
--
-- exclude_from_commission is set automatically by completeOrderTx
-- (server/services/orderCompletion.ts) from the completing actor's role —
-- never a manual toggle — and read back by cashierShiftEngine.ts's
-- commissionOrders builder to feed that same excluded flag. True zeroes the
-- WHOLE order's commission pool, including any colleague's inputter share:
-- an admin completing someone else's queued order still keeps none of it,
-- and the order is not split for the exception. The sale still counts in
-- every revenue/business total exactly as before — this only ever affects
-- the accrued-commission figure, never settled_total or gross sales.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS exclude_from_commission boolean NOT NULL DEFAULT false;
