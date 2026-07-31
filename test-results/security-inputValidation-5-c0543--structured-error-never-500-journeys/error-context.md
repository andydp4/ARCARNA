# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/journeys/security/inputValidation.spec.ts >> 5.7 input validation >> zod-validated routes answer 400 with a structured error, never 500
- Location: tests/journeys/security/inputValidation.spec.ts:487:3

# Error details

```
Error: malformed input must never reach a 500

expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 19

- Array []
+ Array [
+   "POST /api/suppliers [name=100k chars] (server/routes/suppliers.ts:66) → 500 {\"code\":\"INTERNAL_ERROR\",\"message\":\"Failed query: insert into \\\"suppliers\\\" (\\\"id\\\", \\\"org_id\\\", \\\"name\\\", \\\"contact_name\\\", \\\"email\\\", \\\"phone\\\", \\\"lead_time_days\\\", \\\"min_order_value\\\", \\\"min_order_quantity\\\", \\\"is_active\\\", \\\"created_at\\\", \\\"updated_at\\\") values (default, $1, $2, default, default, default, $3, $4, $5, $6, default, default) returning \\\"id\\\", \\\"org_id\\\", \\\"name\\\", \\\"contact_name\\",
+   "POST /api/suppliers [name=unicode + emoji + NUL] (server/routes/suppliers.ts:66) → 500 {\"code\":\"INTERNAL_ERROR\",\"message\":\"Failed query: insert into \\\"suppliers\\\" (\\\"id\\\", \\\"org_id\\\", \\\"name\\\", \\\"contact_name\\\", \\\"email\\\", \\\"phone\\\", \\\"lead_time_days\\\", \\\"min_order_value\\\", \\\"min_order_quantity\\\", \\\"is_active\\\", \\\"created_at\\\", \\\"updated_at\\\") values (default, $1, $2, default, default, default, $3, $4, $5, $6, default, default) returning \\\"id\\\", \\\"org_id\\\", \\\"name\\\", \\\"contact_name\\",
+   "POST /api/suppliers [leadTimeDays=MAX_SAFE_INTEGER] (server/routes/suppliers.ts:66) → 500 {\"code\":\"INTERNAL_ERROR\",\"message\":\"Failed query: insert into \\\"suppliers\\\" (\\\"id\\\", \\\"org_id\\\", \\\"name\\\", \\\"contact_name\\\", \\\"email\\\", \\\"phone\\\", \\\"lead_time_days\\\", \\\"min_order_value\\\", \\\"min_order_quantity\\\", \\\"is_active\\\", \\\"created_at\\\", \\\"updated_at\\\") values (default, $1, $2, default, default, default, $3, $4, $5, $6, default, default) returning \\\"id\\\", \\\"org_id\\\", \\\"name\\\", \\\"contact_name\\",
+   "POST /api/suppliers [leadTimeDays=beyond MAX_SAFE_INTEGER] (server/routes/suppliers.ts:66) → 500 {\"code\":\"INTERNAL_ERROR\",\"message\":\"Failed query: insert into \\\"suppliers\\\" (\\\"id\\\", \\\"org_id\\\", \\\"name\\\", \\\"contact_name\\\", \\\"email\\\", \\\"phone\\\", \\\"lead_time_days\\\", \\\"min_order_value\\\", \\\"min_order_quantity\\\", \\\"is_active\\\", \\\"created_at\\\", \\\"updated_at\\\") values (default, $1, $2, default, default, default, $3, $4, $5, $6, default, default) returning \\\"id\\\", \\\"org_id\\\", \\\"name\\\", \\\"contact_name\\",
+   "POST /api/suppliers [leadTimeDays=1e308] (server/routes/suppliers.ts:66) → 500 {\"code\":\"INTERNAL_ERROR\",\"message\":\"Failed query: insert into \\\"suppliers\\\" (\\\"id\\\", \\\"org_id\\\", \\\"name\\\", \\\"contact_name\\\", \\\"email\\\", \\\"phone\\\", \\\"lead_time_days\\\", \\\"min_order_value\\\", \\\"min_order_quantity\\\", \\\"is_active\\\", \\\"created_at\\\", \\\"updated_at\\\") values (default, $1, $2, default, default, default, $3, $4, $5, $6, default, default) returning \\\"id\\\", \\\"org_id\\\", \\\"name\\\", \\\"contact_name\\",
+   "POST /api/suppliers [minOrderValue=MAX_SAFE_INTEGER] (server/routes/suppliers.ts:66) → 500 {\"code\":\"INTERNAL_ERROR\",\"message\":\"Failed query: insert into \\\"suppliers\\\" (\\\"id\\\", \\\"org_id\\\", \\\"name\\\", \\\"contact_name\\\", \\\"email\\\", \\\"phone\\\", \\\"lead_time_days\\\", \\\"min_order_value\\\", \\\"min_order_quantity\\\", \\\"is_active\\\", \\\"created_at\\\", \\\"updated_at\\\") values (default, $1, $2, default, default, default, $3, $4, $5, $6, default, default) returning \\\"id\\\", \\\"org_id\\\", \\\"name\\\", \\\"contact_name\\",
+   "POST /api/suppliers [minOrderValue=beyond MAX_SAFE_INTEGER] (server/routes/suppliers.ts:66) → 500 {\"code\":\"INTERNAL_ERROR\",\"message\":\"Failed query: insert into \\\"suppliers\\\" (\\\"id\\\", \\\"org_id\\\", \\\"name\\\", \\\"contact_name\\\", \\\"email\\\", \\\"phone\\\", \\\"lead_time_days\\\", \\\"min_order_value\\\", \\\"min_order_quantity\\\", \\\"is_active\\\", \\\"created_at\\\", \\\"updated_at\\\") values (default, $1, $2, default, default, default, $3, $4, $5, $6, default, default) returning \\\"id\\\", \\\"org_id\\\", \\\"name\\\", \\\"contact_name\\",
+   "POST /api/suppliers [minOrderValue=1e308] (server/routes/suppliers.ts:66) → 500 {\"code\":\"INTERNAL_ERROR\",\"message\":\"Failed query: insert into \\\"suppliers\\\" (\\\"id\\\", \\\"org_id\\\", \\\"name\\\", \\\"contact_name\\\", \\\"email\\\", \\\"phone\\\", \\\"lead_time_days\\\", \\\"min_order_value\\\", \\\"min_order_quantity\\\", \\\"is_active\\\", \\\"created_at\\\", \\\"updated_at\\\") values (default, $1, $2, default, default, default, $3, $4, $5, $6, default, default) returning \\\"id\\\", \\\"org_id\\\", \\\"name\\\", \\\"contact_name\\",
+   "POST /api/product-suppliers [packSize=MAX_SAFE_INTEGER] (server/routes/suppliers.ts:112) → 500 {\"code\":\"INTERNAL_ERROR\",\"message\":\"Failed query: insert into \\\"product_suppliers\\\" (\\\"id\\\", \\\"org_id\\\", \\\"product_id\\\", \\\"supplier_id\\\", \\\"supplier_sku\\\", \\\"cost_price\\\", \\\"pack_size\\\", \\\"min_order_qty\\\", \\\"lead_time_override_days\\\", \\\"is_preferred\\\", \\\"created_at\\\", \\\"updated_at\\\") values (default, $1, $2, $3, default, $4, $5, $6, $7, $8, default, default) returning \\\"id\\\", \\\"org_id\\\", \\\"product",
+   "POST /api/product-suppliers [packSize=beyond MAX_SAFE_INTEGER] (server/routes/suppliers.ts:112) → 500 {\"code\":\"INTERNAL_ERROR\",\"message\":\"Failed query: insert into \\\"product_suppliers\\\" (\\\"id\\\", \\\"org_id\\\", \\\"product_id\\\", \\\"supplier_id\\\", \\\"supplier_sku\\\", \\\"cost_price\\\", \\\"pack_size\\\", \\\"min_order_qty\\\", \\\"lead_time_override_days\\\", \\\"is_preferred\\\", \\\"created_at\\\", \\\"updated_at\\\") values (default, $1, $2, $3, default, $4, $5, $6, $7, $8, default, default) returning \\\"id\\\", \\\"org_id\\\", \\\"product",
+   "POST /api/product-suppliers [packSize=1e308] (server/routes/suppliers.ts:112) → 500 {\"code\":\"INTERNAL_ERROR\",\"message\":\"Failed query: insert into \\\"product_suppliers\\\" (\\\"id\\\", \\\"org_id\\\", \\\"product_id\\\", \\\"supplier_id\\\", \\\"supplier_sku\\\", \\\"cost_price\\\", \\\"pack_size\\\", \\\"min_order_qty\\\", \\\"lead_time_override_days\\\", \\\"is_preferred\\\", \\\"created_at\\\", \\\"updated_at\\\") values (default, $1, $2, $3, default, $4, $5, $6, $7, $8, default, default) returning \\\"id\\\", \\\"org_id\\\", \\\"product",
+   "POST /api/product-suppliers [costPrice=zero] (server/routes/suppliers.ts:112) → 500 {\"code\":\"INTERNAL_ERROR\",\"message\":\"Failed query: insert into \\\"product_suppliers\\\" (\\\"id\\\", \\\"org_id\\\", \\\"product_id\\\", \\\"supplier_id\\\", \\\"supplier_sku\\\", \\\"cost_price\\\", \\\"pack_size\\\", \\\"min_order_qty\\\", \\\"lead_time_override_days\\\", \\\"is_preferred\\\", \\\"created_at\\\", \\\"updated_at\\\") values (default, $1, $2, $3, default, $4, $5, $6, $7, $8, default, default) returning \\\"id\\\", \\\"org_id\\\", \\\"product",
+   "POST /api/product-suppliers [costPrice=fractional] (server/routes/suppliers.ts:112) → 500 {\"code\":\"INTERNAL_ERROR\",\"message\":\"Failed query: insert into \\\"product_suppliers\\\" (\\\"id\\\", \\\"org_id\\\", \\\"product_id\\\", \\\"supplier_id\\\", \\\"supplier_sku\\\", \\\"cost_price\\\", \\\"pack_size\\\", \\\"min_order_qty\\\", \\\"lead_time_override_days\\\", \\\"is_preferred\\\", \\\"created_at\\\", \\\"updated_at\\\") values (default, $1, $2, $3, default, $4, $5, $6, $7, $8, default, default) returning \\\"id\\\", \\\"org_id\\\", \\\"product",
+   "POST /api/product-suppliers [costPrice=MAX_SAFE_INTEGER] (server/routes/suppliers.ts:112) → 500 {\"code\":\"INTERNAL_ERROR\",\"message\":\"Failed query: insert into \\\"product_suppliers\\\" (\\\"id\\\", \\\"org_id\\\", \\\"product_id\\\", \\\"supplier_id\\\", \\\"supplier_sku\\\", \\\"cost_price\\\", \\\"pack_size\\\", \\\"min_order_qty\\\", \\\"lead_time_override_days\\\", \\\"is_preferred\\\", \\\"created_at\\\", \\\"updated_at\\\") values (default, $1, $2, $3, default, $4, $5, $6, $7, $8, default, default) returning \\\"id\\\", \\\"org_id\\\", \\\"product",
+   "POST /api/product-suppliers [costPrice=beyond MAX_SAFE_INTEGER] (server/routes/suppliers.ts:112) → 500 {\"code\":\"INTERNAL_ERROR\",\"message\":\"Failed query: insert into \\\"product_suppliers\\\" (\\\"id\\\", \\\"org_id\\\", \\\"product_id\\\", \\\"supplier_id\\\", \\\"supplier_sku\\\", \\\"cost_price\\\", \\\"pack_size\\\", \\\"min_order_qty\\\", \\\"lead_time_override_days\\\", \\\"is_preferred\\\", \\\"created_at\\\", \\\"updated_at\\\") values (default, $1, $2, $3, default, $4, $5, $6, $7, $8, default, default) returning \\\"id\\\", \\\"org_id\\\", \\\"product",
+   "POST /api/product-suppliers [costPrice=1e308] (server/routes/suppliers.ts:112) → 500 {\"code\":\"INTERNAL_ERROR\",\"message\":\"Failed query: insert into \\\"product_suppliers\\\" (\\\"id\\\", \\\"org_id\\\", \\\"product_id\\\", \\\"supplier_id\\\", \\\"supplier_sku\\\", \\\"cost_price\\\", \\\"pack_size\\\", \\\"min_order_qty\\\", \\\"lead_time_override_days\\\", \\\"is_preferred\\\", \\\"created_at\\\", \\\"updated_at\\\") values (default, $1, $2, $3, default, $4, $5, $6, $7, $8, default, default) returning \\\"id\\\", \\\"org_id\\\", \\\"product",
+   "POST /api/inventory/transfers [huge quantity] (server/routes/inventoryTransfers.ts:70) → 500 {\"code\":\"INTERNAL_ERROR\",\"message\":\"Failed query: insert into \\\"inventory_transfer_items\\\" (\\\"id\\\", \\\"transfer_id\\\", \\\"product_id\\\", \\\"quantity\\\", \\\"created_at\\\") values (default, $1, $2, $3, default)\\nparams: beeb6d4b-d954-45a3-929e-e2b04a88452e,6ca770d5-74b1-4444-988e-44c147b74058,9007199254740991\"}",
+ ]
```

# Test source

```ts
  415 |       path: () => `/api/loyalty-tiers/${r.loyaltyTierId}`,
  416 |       where: "server/routes/loyalty.ts:106",
  417 |       cases: () => [
  418 |         { name: "empty body", body: {} },
  419 |         { name: "pointsRequired as string", body: { pointsRequired: "many" } },
  420 |       ],
  421 |     },
  422 |     {
  423 |       method: "put",
  424 |       path: () => "/api/loyalty/settings",
  425 |       where: "server/routes/loyalty.ts:48 — settingsSchema.parse",
  426 |       cases: () => [
  427 |         { name: "empty body", body: {} },
  428 |         { name: "redemptionRate negative", body: { redemptionRate: -1, minRedeemPoints: 10 } },
  429 |         { name: "minRedeemPoints as string", body: { redemptionRate: 0.01, minRedeemPoints: "ten" } },
  430 |       ],
  431 |     },
  432 |     {
  433 |       method: "post",
  434 |       path: () => "/api/gift-cards",
  435 |       where: "server/routes/giftCards.ts:64 — issueSchema.parse",
  436 |       cases: () => [
  437 |         { name: "empty body", body: {} },
  438 |         { name: "amount negative", body: { amount: -50 } },
  439 |         { name: "amount zero", body: { amount: 0 } },
  440 |         { name: "amount MAX_SAFE_INTEGER", body: { amount: Number.MAX_SAFE_INTEGER } },
  441 |         { name: "amount as object", body: { amount: {} } },
  442 |         { name: "customerId not a uuid", body: { amount: 5, customerId: "nope" } },
  443 |       ],
  444 |     },
  445 |     {
  446 |       method: "post",
  447 |       path: () => "/api/saved-views",
  448 |       where: "server/routes/savedViews.ts:69 — viewBodySchema.parse (throws, no ZodError branch)",
  449 |       cases: () => [
  450 |         { name: "empty body", body: {} },
  451 |         { name: "wrong types", body: { page: 1, name: [], filters: "x" } },
  452 |       ],
  453 |     },
  454 |   ];
  455 | }
  456 | 
  457 | async function send(target: Target, body: unknown) {
  458 |   const options = { data: body as never };
  459 |   switch (target.method) {
  460 |     case "post":
  461 |       return api.post(target.path(), options);
  462 |     case "put":
  463 |       return api.put(target.path(), options);
  464 |     case "patch":
  465 |       return api.patch(target.path(), options);
  466 |   }
  467 | }
  468 | 
  469 | type Result = { label: string; status: number; body: string };
  470 | 
  471 | async function sweep(targets: Target[]): Promise<Result[]> {
  472 |   const out: Result[] = [];
  473 |   for (const t of targets) {
  474 |     for (const c of t.cases()) {
  475 |       const res = await send(t, c.body);
  476 |       out.push({
  477 |         label: `${t.method.toUpperCase()} ${t.path().replace(/[0-9a-f-]{36}/gi, ":id")} [${c.name}] (${t.where})`,
  478 |         status: res.status(),
  479 |         body: (await res.text()).slice(0, 400),
  480 |       });
  481 |     }
  482 |   }
  483 |   return out;
  484 | }
  485 | 
  486 | test.describe("5.7 input validation", () => {
  487 |   test("zod-validated routes answer 400 with a structured error, never 500", async () => {
  488 |     test.setTimeout(120_000);
  489 |     const before = await orgFingerprint(orgId);
  490 |     const results = await sweep(validatedTargets());
  491 | 
  492 |     const notFourHundred: string[] = [];
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
> 515 |     expect(serverErrors, "malformed input must never reach a 500").toEqual([]);
      |                                                                    ^ Error: malformed input must never reach a 500
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
  593 |     expect(sqlErrors.map((x) => x.label), "a database error surfaced to the client").toEqual([]);
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
```