# TypeScript Local Verification Checklist

## Commands
```bash
npm install
npm run check
```
Or: `pnpm install && pnpm run check` / `yarn && yarn check`

## Expected Output
Exit code 0. No errors. If `npm run check` runs `tsc` with `noEmit`, you should see no output on success.

## Likely Failure Points (from recent changes)

1. **server/storage.ts**
   - `createOrderExpenses(orderId, expenses, orgId?)` – third param added; callers (if any) may need update
   - `createOrder` – `orgId` added to order/order_items/order_expenses inserts

2. **server/routes.ts**
   - Reverted to `engine.updateProduct` / `engine.updateCustomer`; engine returns domain types (may differ from storage row shape)

3. **apps/server/src/db/schema.ts vs shared/schema.ts**
   - apps/server may use snake_case columns; shared uses camelCase. Cross-imports can cause type mismatches.

4. **Import paths**
   - `@shared/schema` vs `../shared/schema` – ensure tsconfig paths resolve
