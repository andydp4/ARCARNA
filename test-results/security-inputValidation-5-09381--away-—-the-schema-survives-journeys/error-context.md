# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/journeys/security/inputValidation.spec.ts >> 5.7 input validation >> injection strings are parameterised away — the schema survives
- Location: tests/journeys/security/inputValidation.spec.ts:574:3

# Error details

```
Error: a database error surfaced to the client

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 5

- Array []
+ Array [
+   "POST /api/suppliers [\\'; SELECT pg_sleep(5); --] (suppliers)",
+   "POST /api/customers [\\'; SELECT pg_sleep(5); --] (customers)",
+   "PATCH /api/suppliers/:id [\\'; SELECT pg_sleep(5); --] (suppliers patch)",
+ ]
```

# Test source

```ts
  493 |     const serverErrors: string[] = [];
  494 |     const unstructured: string[] = [];
  495 |     const leaks: string[] = [];
  496 | 
  497 |     for (const res of results) {
  498 |       if (res.status >= 500) serverErrors.push(`${res.label} → ${res.status} ${res.body}`);
  499 |       else if (res.status !== 400) notFourHundred.push(`${res.label} → ${res.status} ${res.body}`);
  500 |       const leak = internalLeak(res.body);
  501 |       if (leak) leaks.push(`${res.label} disclosed ${leak}`);
  502 |       if (res.status >= 400) {
  503 |         try {
  504 |           const parsed = JSON.parse(res.body) as Record<string, unknown>;
  505 |           if (typeof parsed !== "object" || parsed === null || (!("message" in parsed) && !("code" in parsed))) {
  506 |             unstructured.push(`${res.label} → body has neither message nor code: ${res.body}`);
  507 |           }
  508 |         } catch {
  509 |           unstructured.push(`${res.label} → body is not JSON: ${res.body}`);
  510 |         }
  511 |       }
  512 |     }
  513 | 
  514 |     console.log(`[5.7] swept ${results.length} malformed payloads across the safeParse routes`);
  515 |     expect(serverErrors, "malformed input must never reach a 500").toEqual([]);
  516 |     expect(notFourHundred, "a zod-guarded route answered something other than 400").toEqual([]);
  517 |     expect(unstructured, "an error body must be structured JSON").toEqual([]);
  518 |     expect(leaks, "an error body disclosed internals").toEqual([]);
  519 |     expect(await orgFingerprint(orgId), "a rejected payload wrote to the database").toEqual(before);
  520 |   });
  521 | 
  522 |   test("CHARACTERISATION — routes that validate by throwing, or not at all", async () => {
  523 |     test.setTimeout(120_000);
  524 |     const before = await orgFingerprint(orgId);
  525 |     const results = await sweep(unvalidatedTargets());
  526 | 
  527 |     const accepted = results.filter((x) => x.status >= 200 && x.status < 300);
  528 |     const serverErrors = results.filter((x) => x.status >= 500);
  529 |     const leaks = results.filter((x) => internalLeak(x.body));
  530 | 
  531 |     if (serverErrors.length) {
  532 |       console.log(
  533 |         `[5.7 FINDING] ${serverErrors.length}/${results.length} malformed payloads produced a 5xx:\n  ` +
  534 |           serverErrors.map((x) => `${x.label} → ${x.status} ${x.body.slice(0, 120)}`).join("\n  "),
  535 |       );
  536 |     }
  537 |     if (accepted.length) {
  538 |       console.log(
  539 |         `[5.7 FINDING] ${accepted.length} malformed payloads were ACCEPTED:\n  ` +
  540 |           accepted.map((x) => `${x.label} → ${x.status} ${x.body.slice(0, 120)}`).join("\n  "),
  541 |       );
  542 |     }
  543 | 
  544 |     // Asserted unconditionally: whatever the status, nothing may leak internals.
  545 |     expect(
  546 |       leaks.map((x) => x.label),
  547 |       "an error body disclosed a stack trace, source path, SQL or connection string",
  548 |     ).toEqual([]);
  549 |     // And a rejection must not have written on the way out.
  550 |     expect(await orgFingerprint(orgId), "a rejected payload wrote to the database").toEqual(before);
  551 |   });
  552 | 
  553 |   /**
  554 |    * OPEN FINDING — several routes answer 500 to malformed client input.
  555 |    *
  556 |    * A 500 on a bad request is a defect regardless of policy: it is
  557 |    * unactionable for the caller, it pollutes error budgets and alerting, and it
  558 |    * means an unhandled exception escaped the handler. The exact list is printed
  559 |    * by the characterisation test above.
  560 |    */
  561 |   test.fail("no route may answer 5xx to malformed client input", async () => {
  562 |     test.setTimeout(120_000);
  563 |     const results = [...(await sweep(validatedTargets())), ...(await sweep(unvalidatedTargets()))];
  564 |     const serverErrors = results.filter((x) => x.status >= 500);
  565 |     console.log(
  566 |       `[5.7 FINDING] ${serverErrors.length} of ${results.length} malformed payloads returned 5xx`,
  567 |     );
  568 |     expect(
  569 |       serverErrors.map((x) => `${x.label} → ${x.status}`),
  570 |       "malformed input must never produce a server error",
  571 |     ).toEqual([]);
  572 |   });
  573 | 
  574 |   test("injection strings are parameterised away — the schema survives", async () => {
  575 |     test.setTimeout(120_000);
  576 |     // The point is not the status code but that nothing executed: after firing
  577 |     // classic injection payloads at every string field reachable, the tables
  578 |     // this org depends on must still be there and its rows still intact.
  579 |     const before = await orgFingerprint(orgId);
  580 |     const results: Result[] = [];
  581 |     for (const payload of SQLI) {
  582 |       for (const t of [
  583 |         { method: "post" as const, path: () => "/api/suppliers", where: "suppliers", cases: () => [{ name: payload, body: { name: payload } }] },
  584 |         { method: "post" as const, path: () => "/api/customers", where: "customers", cases: () => [{ name: payload, body: { name: payload } }] },
  585 |         { method: "patch" as const, path: () => `/api/suppliers/${r.supplierId}`, where: "suppliers patch", cases: () => [{ name: payload, body: { name: payload } }] },
  586 |         { method: "patch" as const, path: () => `/api/purchase-drafts/${r.purchaseDraftId}/status`, where: "draft status", cases: () => [{ name: payload, body: { status: payload } }] },
  587 |       ]) {
  588 |         results.push(...(await sweep([t])));
  589 |       }
  590 |     }
  591 | 
  592 |     const sqlErrors = results.filter((x) => /syntax error|pg_|relation ".*" does not exist|SQLSTATE/i.test(x.body));
> 593 |     expect(sqlErrors.map((x) => x.label), "a database error surfaced to the client").toEqual([]);
      |                                                                                      ^ Error: a database error surfaced to the client
  594 | 
  595 |     // Some of these are legitimate names and will have been stored. Remove them
  596 |     // so the fingerprint comparison is about damage, not about creation.
  597 |     const after = await orgFingerprint(orgId);
  598 |     expect(after.org_name, "the organisation row survived").toBe(before.org_name);
  599 |     expect(Number(after.products), "no product table was dropped or emptied").toBeGreaterThanOrEqual(
  600 |       Number(before.products),
  601 |     );
  602 |     expect(after.draft_statuses, "draft status must not have been altered by an injected value").toBe(
  603 |       before.draft_statuses,
  604 |     );
  605 |   });
  606 | 
  607 |   /**
  608 |    * OPEN FINDING — an over-length string reaches the database and the driver's
  609 |    * error, including the full SQL statement and its bound parameters, is
  610 |    * returned to the client.
  611 |    *
  612 |    * `supplierBody.name` is `z.string().min(1)` with no `.max()`
  613 |    * (server/routes/suppliers.ts:21), the global JSON body limit is 25 MB for
  614 |    * every route (shared/importLimits.ts:5, applied at server/index.ts:53), and
  615 |    * `supplierErrorPayload` falls through to `err.message` for anything that is
  616 |    * not a `SupplierError` (server/services/suppliers.ts:19). The result is a
  617 |    * 500 whose body contains `insert into "suppliers" (...) values ($1, $2 ...)`
  618 |    * plus the parameter values — schema and tenant id handed to the caller.
  619 |    * The same fall-through exists in purchaseDrafts, goodsReceipts and
  620 |    * inventoryTransfers.
  621 |    */
  622 |   test.fail("an over-length field must be rejected without echoing the SQL statement", async () => {
  623 |     test.setTimeout(60_000);
  624 |     const giant = { name: "x".repeat(12 * 1024 * 1024) };
  625 |     const res = await api.post("/api/suppliers", { data: giant });
  626 |     const body = (await res.text()).slice(0, 800);
  627 |     const leak = internalLeak(body);
  628 |     console.log(`[5.7 FINDING] 12MB name → ${res.status()}; disclosure: ${leak ?? "none"}; body: ${body.slice(0, 200)}`);
  629 |     expect(res.status(), "an over-length string is a client error, not a server error").toBeLessThan(500);
  630 |     expect(leak, "the rejection must not disclose internals").toBeNull();
  631 |   });
  632 | 
  633 |   test("whatever the status, an over-length field does not corrupt the org", async () => {
  634 |     test.setTimeout(60_000);
  635 |     const before = await orgFingerprint(orgId);
  636 |     const res = await api.post("/api/suppliers", { data: { name: "x".repeat(1_000_000) } });
  637 |     expect(res.status(), "an over-length name must not be stored").toBeGreaterThanOrEqual(400);
  638 |     expect(await orgFingerprint(orgId), "nothing was written").toEqual(before);
  639 |   });
  640 | 
  641 |   /**
  642 |    * OPEN FINDING — `POST /api/goods-receipts` puts no upper bound on `items`,
  643 |    * and its per-line over-receive check does not sum repeated
  644 |    * `purchaseDraftItemId`s within one request.
  645 |    *
  646 |    * A draft line ordering 9 units accepts a single receipt carrying hundreds of
  647 |    * lines against it (201). `POST .../complete` then refuses with
  648 |    * `409 OVER_RECEIVE` forever, so the draft is left showing `remaining: 0`
  649 |    * with a pending receipt that can never be completed — receiving on that
  650 |    * draft is blocked until someone voids it by hand. The sibling schema
  651 |    * `purchaseDraftBatchSchema` caps its array at 500
  652 |    * (server/routes/replenishment.ts:61); this one does not.
  653 |    */
  654 |   test.fail("a goods receipt must not accept more units than the draft line ordered", async () => {
  655 |     test.setTimeout(120_000);
  656 |     const lines = 400;
  657 |     const res = await api.post("/api/goods-receipts", {
  658 |       data: {
  659 |         purchaseDraftId: r.purchaseDraftId,
  660 |         items: Array.from({ length: lines }, () => ({
  661 |           purchaseDraftItemId: r.purchaseDraftItemId,
  662 |           productId: r.productId,
  663 |           quantityReceived: 1,
  664 |         })),
  665 |       },
  666 |     });
  667 |     const body = (await res.text()).slice(0, 300);
  668 |     console.log(
  669 |       `[5.7 FINDING] goods receipt with ${lines} lines × 1 unit against a line ordering 9 → ${res.status()} ${body.slice(0, 160)}`,
  670 |     );
  671 |     expect(
  672 |       res.status(),
  673 |       "the sum across lines exceeds the ordered quantity and must be refused at create time",
  674 |     ).toBeGreaterThanOrEqual(400);
  675 |   });
  676 | 
  677 |   test("malformed JSON is refused with a 4xx, not a stack trace", async () => {
  678 |     const res = await api.post("/api/suppliers", {
  679 |       headers: { "content-type": "application/json" },
  680 |       data: "{ this is not json ",
  681 |     });
  682 |     const body = (await res.text()).slice(0, 400);
  683 |     console.log(`[5.7] malformed JSON → ${res.status()} ${body.slice(0, 160)}`);
  684 |     expect(res.status()).toBeGreaterThanOrEqual(400);
  685 |     expect(res.status(), "a syntactically broken body is the client's fault").toBeLessThan(500);
  686 |     expect(internalLeak(body)).toBeNull();
  687 |   });
  688 | 
  689 |   test("unicode and emoji round-trip through a name field without corruption", async () => {
  690 |     const name = `ZZ-SEC ünïcødé 🧨 ${Date.now()}`;
  691 |     const created = await api.post("/api/suppliers", { data: { name } });
  692 |     expect(created.status(), await created.text()).toBe(201);
  693 |     const supplier = (await created.json()) as { id: string; name: string };
```