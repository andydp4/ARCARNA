# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/journeys/security/inputValidation.spec.ts >> 5.7 input validation >> a goods receipt must not accept more units than the draft line ordered
- Location: tests/journeys/security/inputValidation.spec.ts:658:8

# Error details

```
Error: the sum across lines exceeds the ordered quantity and must be refused at create time

expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 400
Received:    201
```

# Test source

```ts
  578 |     // The point is not the status code but that nothing executed: after firing
  579 |     // classic injection payloads at every string field reachable, the tables
  580 |     // this org depends on must still be there and its rows still intact.
  581 |     const before = await orgFingerprint(orgId);
  582 |     const results: Result[] = [];
  583 |     for (const payload of SQLI) {
  584 |       for (const t of [
  585 |         { method: "post" as const, path: () => "/api/suppliers", where: "suppliers", cases: () => [{ name: payload, body: { name: payload } }] },
  586 |         { method: "post" as const, path: () => "/api/customers", where: "customers", cases: () => [{ name: payload, body: { name: payload } }] },
  587 |         { method: "patch" as const, path: () => `/api/suppliers/${r.supplierId}`, where: "suppliers patch", cases: () => [{ name: payload, body: { name: payload } }] },
  588 |         { method: "patch" as const, path: () => `/api/purchase-drafts/${r.purchaseDraftId}/status`, where: "draft status", cases: () => [{ name: payload, body: { status: payload } }] },
  589 |       ]) {
  590 |         results.push(...(await sweep([t])));
  591 |       }
  592 |     }
  593 | 
  594 |     const sqlErrors = results.filter((x) => /syntax error|pg_|relation ".*" does not exist|SQLSTATE/i.test(x.body));
  595 |     expect(sqlErrors.map((x) => x.label), "a database error surfaced to the client").toEqual([]);
  596 | 
  597 |     // Some of these are legitimate names and will have been stored. Remove them
  598 |     // so the fingerprint comparison is about damage, not about creation.
  599 |     const after = await orgFingerprint(orgId);
  600 |     expect(after.org_name, "the organisation row survived").toBe(before.org_name);
  601 |     expect(Number(after.products), "no product table was dropped or emptied").toBeGreaterThanOrEqual(
  602 |       Number(before.products),
  603 |     );
  604 |     expect(after.draft_statuses, "draft status must not have been altered by an injected value").toBe(
  605 |       before.draft_statuses,
  606 |     );
  607 |   });
  608 | 
  609 |   /**
  610 |    * OPEN FINDING — an over-length string reaches the database and the driver's
  611 |    * error, including the full SQL statement and its bound parameters, is
  612 |    * returned to the client.
  613 |    *
  614 |    * `supplierBody.name` is `z.string().min(1)` with no `.max()`
  615 |    * (server/routes/suppliers.ts:21), the global JSON body limit is 25 MB for
  616 |    * every route (shared/importLimits.ts:5, applied at server/index.ts:53), and
  617 |    * `supplierErrorPayload` falls through to `err.message` for anything that is
  618 |    * not a `SupplierError` (server/services/suppliers.ts:19). The result is a
  619 |    * 500 whose body contains `insert into "suppliers" (...) values ($1, $2 ...)`
  620 |    * plus the parameter values — schema and tenant id handed to the caller.
  621 |    * The same fall-through exists in purchaseDrafts, goodsReceipts and
  622 |    * inventoryTransfers.
  623 |    */
  624 |   // Was test.fail(): the *ErrorPayload helpers echoed err.message, which for a
  625 |   // Drizzle error is the SQL statement. Now a fixed message.
  626 |   test("an over-length field must be rejected without echoing the SQL statement", async () => {
  627 |     test.setTimeout(60_000);
  628 |     const giant = { name: "x".repeat(12 * 1024 * 1024) };
  629 |     const res = await api.post("/api/suppliers", { data: giant });
  630 |     const body = (await res.text()).slice(0, 800);
  631 |     const leak = internalLeak(body);
  632 |     console.log(`[5.7 FINDING] 12MB name → ${res.status()}; disclosure: ${leak ?? "none"}; body: ${body.slice(0, 200)}`);
  633 |     expect(res.status(), "an over-length string is a client error, not a server error").toBeLessThan(500);
  634 |     expect(leak, "the rejection must not disclose internals").toBeNull();
  635 |   });
  636 | 
  637 |   test("whatever the status, an over-length field does not corrupt the org", async () => {
  638 |     test.setTimeout(60_000);
  639 |     const before = await orgFingerprint(orgId);
  640 |     const res = await api.post("/api/suppliers", { data: { name: "x".repeat(1_000_000) } });
  641 |     expect(res.status(), "an over-length name must not be stored").toBeGreaterThanOrEqual(400);
  642 |     expect(await orgFingerprint(orgId), "nothing was written").toEqual(before);
  643 |   });
  644 | 
  645 |   /**
  646 |    * OPEN FINDING — `POST /api/goods-receipts` puts no upper bound on `items`,
  647 |    * and its per-line over-receive check does not sum repeated
  648 |    * `purchaseDraftItemId`s within one request.
  649 |    *
  650 |    * A draft line ordering 9 units accepts a single receipt carrying hundreds of
  651 |    * lines against it (201). `POST .../complete` then refuses with
  652 |    * `409 OVER_RECEIVE` forever, so the draft is left showing `remaining: 0`
  653 |    * with a pending receipt that can never be completed — receiving on that
  654 |    * draft is blocked until someone voids it by hand. The sibling schema
  655 |    * `purchaseDraftBatchSchema` caps its array at 500
  656 |    * (server/routes/replenishment.ts:61); this one does not.
  657 |    */
  658 |   test.fail("a goods receipt must not accept more units than the draft line ordered", async () => {
  659 |     test.setTimeout(120_000);
  660 |     const lines = 400;
  661 |     const res = await api.post("/api/goods-receipts", {
  662 |       data: {
  663 |         purchaseDraftId: r.purchaseDraftId,
  664 |         items: Array.from({ length: lines }, () => ({
  665 |           purchaseDraftItemId: r.purchaseDraftItemId,
  666 |           productId: r.productId,
  667 |           quantityReceived: 1,
  668 |         })),
  669 |       },
  670 |     });
  671 |     const body = (await res.text()).slice(0, 300);
  672 |     console.log(
  673 |       `[5.7 FINDING] goods receipt with ${lines} lines × 1 unit against a line ordering 9 → ${res.status()} ${body.slice(0, 160)}`,
  674 |     );
  675 |     expect(
  676 |       res.status(),
  677 |       "the sum across lines exceeds the ordered quantity and must be refused at create time",
> 678 |     ).toBeGreaterThanOrEqual(400);
      |       ^ Error: the sum across lines exceeds the ordered quantity and must be refused at create time
  679 |   });
  680 | 
  681 |   test("malformed JSON is refused with a 4xx, not a stack trace", async () => {
  682 |     const res = await api.post("/api/suppliers", {
  683 |       headers: { "content-type": "application/json" },
  684 |       data: "{ this is not json ",
  685 |     });
  686 |     const body = (await res.text()).slice(0, 400);
  687 |     console.log(`[5.7] malformed JSON → ${res.status()} ${body.slice(0, 160)}`);
  688 |     expect(res.status()).toBeGreaterThanOrEqual(400);
  689 |     expect(res.status(), "a syntactically broken body is the client's fault").toBeLessThan(500);
  690 |     expect(internalLeak(body)).toBeNull();
  691 |   });
  692 | 
  693 |   test("unicode and emoji round-trip through a name field without corruption", async () => {
  694 |     const name = `ZZ-SEC ünïcødé 🧨 ${Date.now()}`;
  695 |     const created = await api.post("/api/suppliers", { data: { name } });
  696 |     expect(created.status(), await created.text()).toBe(201);
  697 |     const supplier = (await created.json()) as { id: string; name: string };
  698 |     expect(supplier.name, "the stored name must match what was sent").toBe(name);
  699 | 
  700 |     const list = await api.get("/api/suppliers");
  701 |     expect((await list.text()).includes(name), "the name must survive the round trip").toBeTruthy();
  702 | 
  703 |     await api.delete(`/api/suppliers/${supplier.id}`);
  704 |   });
  705 | });
  706 | 
```