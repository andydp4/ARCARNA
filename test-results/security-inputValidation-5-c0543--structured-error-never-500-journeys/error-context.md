# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/journeys/security/inputValidation.spec.ts >> 5.7 input validation >> zod-validated routes answer 400 with a structured error, never 500
- Location: tests/journeys/security/inputValidation.spec.ts:487:3

# Error details

```
Error: a zod-guarded route answered something other than 400

expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 19

- Array []
+ Array [
+   "POST /api/suppliers [name=unicode + emoji + NUL] (server/routes/suppliers.ts:66) → 201 {\"id\":\"ea8886d8-3e5a-47ba-847a-46be9641aac1\",\"orgId\":\"4e66317f-7b64-4ed1-aa15-86e6df2af827\",\"name\":\"🧨💥 ünïcødé ㊙️ 𝔞𝔠𝔠𝔬𝔲𝔫𝔱 trailing\",\"contactName\":null,\"email\":null,\"phone\":null,\"leadTimeDays\":0,\"minOrderValue\":\"0.00\",\"minOrderQuantity\":0,\"isActive\":1,\"createdAt\":\"2026-07-31T09:27:22.711Z\",\"updatedAt\":\"2026-07-31T09:27:22.711Z\"}",
+   "POST /api/suppliers [name=sql-injection #1] (server/routes/suppliers.ts:66) → 201 {\"id\":\"6c4ce660-2cc9-48cf-8455-a52af8cd6ab1\",\"orgId\":\"4e66317f-7b64-4ed1-aa15-86e6df2af827\",\"name\":\"'; DROP TABLE products; --\",\"contactName\":null,\"email\":null,\"phone\":null,\"leadTimeDays\":0,\"minOrderValue\":\"0.00\",\"minOrderQuantity\":0,\"isActive\":1,\"createdAt\":\"2026-07-31T09:27:22.746Z\",\"updatedAt\":\"2026-07-31T09:27:22.746Z\"}",
+   "POST /api/suppliers [name=sql-injection #2] (server/routes/suppliers.ts:66) → 201 {\"id\":\"e7acba19-fab0-4bff-99f4-ee6504759965\",\"orgId\":\"4e66317f-7b64-4ed1-aa15-86e6df2af827\",\"name\":\"1' OR '1'='1\",\"contactName\":null,\"email\":null,\"phone\":null,\"leadTimeDays\":0,\"minOrderValue\":\"0.00\",\"minOrderQuantity\":0,\"isActive\":1,\"createdAt\":\"2026-07-31T09:27:22.755Z\",\"updatedAt\":\"2026-07-31T09:27:22.755Z\"}",
+   "POST /api/suppliers [name=sql-injection #3] (server/routes/suppliers.ts:66) → 201 {\"id\":\"5e3ee0ad-b32c-46cd-bf7d-aa20a14bcfad\",\"orgId\":\"4e66317f-7b64-4ed1-aa15-86e6df2af827\",\"name\":\"') OR 1=1 --\",\"contactName\":null,\"email\":null,\"phone\":null,\"leadTimeDays\":0,\"minOrderValue\":\"0.00\",\"minOrderQuantity\":0,\"isActive\":1,\"createdAt\":\"2026-07-31T09:27:22.765Z\",\"updatedAt\":\"2026-07-31T09:27:22.765Z\"}",
+   "POST /api/suppliers [name=sql-injection #4] (server/routes/suppliers.ts:66) → 201 {\"id\":\"1d24be34-f765-420d-ad16-e2eb7b82a744\",\"orgId\":\"4e66317f-7b64-4ed1-aa15-86e6df2af827\",\"name\":\"\\\\'; SELECT pg_sleep(5); --\",\"contactName\":null,\"email\":null,\"phone\":null,\"leadTimeDays\":0,\"minOrderValue\":\"0.00\",\"minOrderQuantity\":0,\"isActive\":1,\"createdAt\":\"2026-07-31T09:27:22.774Z\",\"updatedAt\":\"2026-07-31T09:27:22.774Z\"}",
+   "POST /api/suppliers [name=sql-injection #5] (server/routes/suppliers.ts:66) → 201 {\"id\":\"502ea4e4-822e-4e86-b130-fc65077f202e\",\"orgId\":\"4e66317f-7b64-4ed1-aa15-86e6df2af827\",\"name\":\"${jndi:ldap://x/y}\",\"contactName\":null,\"email\":null,\"phone\":null,\"leadTimeDays\":0,\"minOrderValue\":\"0.00\",\"minOrderQuantity\":0,\"isActive\":1,\"createdAt\":\"2026-07-31T09:27:22.786Z\",\"updatedAt\":\"2026-07-31T09:27:22.786Z\"}",
+   "POST /api/suppliers [name=sql-injection #6] (server/routes/suppliers.ts:66) → 201 {\"id\":\"74ad5ceb-e152-4d13-934c-eef2b4cce64d\",\"orgId\":\"4e66317f-7b64-4ed1-aa15-86e6df2af827\",\"name\":\"../../../../etc/passwd\",\"contactName\":null,\"email\":null,\"phone\":null,\"leadTimeDays\":0,\"minOrderValue\":\"0.00\",\"minOrderQuantity\":0,\"isActive\":1,\"createdAt\":\"2026-07-31T09:27:22.800Z\",\"updatedAt\":\"2026-07-31T09:27:22.800Z\"}",
+   "POST /api/suppliers [leadTimeDays=zero] (server/routes/suppliers.ts:66) → 201 {\"id\":\"b13f8bd8-81a4-487f-afba-22fb7213c938\",\"orgId\":\"4e66317f-7b64-4ed1-aa15-86e6df2af827\",\"name\":\"probe\",\"contactName\":null,\"email\":null,\"phone\":null,\"leadTimeDays\":0,\"minOrderValue\":\"0.00\",\"minOrderQuantity\":0,\"isActive\":1,\"createdAt\":\"2026-07-31T09:27:22.819Z\",\"updatedAt\":\"2026-07-31T09:27:22.819Z\"}",
+   "POST /api/suppliers [minOrderValue=zero] (server/routes/suppliers.ts:66) → 201 {\"id\":\"8409225b-dc86-475d-ad0b-ecde2d5ba65b\",\"orgId\":\"4e66317f-7b64-4ed1-aa15-86e6df2af827\",\"name\":\"probe\",\"contactName\":null,\"email\":null,\"phone\":null,\"leadTimeDays\":0,\"minOrderValue\":\"0.00\",\"minOrderQuantity\":0,\"isActive\":1,\"createdAt\":\"2026-07-31T09:27:22.906Z\",\"updatedAt\":\"2026-07-31T09:27:22.906Z\"}",
+   "POST /api/suppliers [minOrderValue=fractional] (server/routes/suppliers.ts:66) → 201 {\"id\":\"ffc6fe2f-61e9-4f66-83e2-31da30bab778\",\"orgId\":\"4e66317f-7b64-4ed1-aa15-86e6df2af827\",\"name\":\"probe\",\"contactName\":null,\"email\":null,\"phone\":null,\"leadTimeDays\":0,\"minOrderValue\":\"1.50\",\"minOrderQuantity\":0,\"isActive\":1,\"createdAt\":\"2026-07-31T09:27:22.915Z\",\"updatedAt\":\"2026-07-31T09:27:22.915Z\"}",
+   "POST /api/suppliers [extra unexpected keys] (server/routes/suppliers.ts:66) → 201 {\"id\":\"9594257d-97f0-43a5-b35f-738731eee2ed\",\"orgId\":\"4e66317f-7b64-4ed1-aa15-86e6df2af827\",\"name\":\"probe\",\"contactName\":null,\"email\":null,\"phone\":null,\"leadTimeDays\":0,\"minOrderValue\":\"0.00\",\"minOrderQuantity\":0,\"isActive\":1,\"createdAt\":\"2026-07-31T09:27:22.976Z\",\"updatedAt\":\"2026-07-31T09:27:22.976Z\"}",
+   "POST /api/product-suppliers [costPrice=zero] (server/routes/suppliers.ts:112) → 409 {\"code\":\"ALREADY_EXISTS\",\"message\":\"That supplier is already mapped to this product\"}",
+   "POST /api/product-suppliers [costPrice=fractional] (server/routes/suppliers.ts:112) → 409 {\"code\":\"ALREADY_EXISTS\",\"message\":\"That supplier is already mapped to this product\"}",
+   "POST /api/goods-receipts [quantityReceived MAX_SAFE_INTEGER] (server/routes/goodsReceipts.ts:70) → 409 {\"code\":\"OVER_RECEIVE\",\"message\":\"Quantity exceeds remaining on purchase line\",\"details\":{\"purchaseDraftItemId\":\"450b1f48-782e-415b-aee7-49b08e1db82a\",\"ordered\":9,\"alreadyReceived\":0,\"pendingOnOtherReceipts\":2,\"requested\":9007199254740991,\"remaining\":7}}",
+   "POST /api/goods-receipts [600 line items (no max on the array)] (server/routes/goodsReceipts.ts:70) → 201 {\"id\":\"b043a032-0ecb-424e-be05-b2e6fe4d6bc2\",\"orgId\":\"4e66317f-7b64-4ed1-aa15-86e6df2af827\",\"purchaseDraftId\":\"2a3ee94b-c657-4c23-8acb-11066d59cc30\",\"locationId\":\"91cf9daa-b7a1-4b91-b017-db6e48c32a4f\",\"status\":\"pending\",\"supplierReference\":null,\"deliveryNote\":null,\"receivedBy\":null,\"receivedAt\":null,\"createdAt\":\"2026-07-31T09:27:24.255Z\",\"updatedAt\":\"2026-07-31T09:27:24.255Z\",\"supplierName\":\"ZZ-SE",
+   "PATCH /api/org/setup [businessName 100k chars] (server/routes/setupImports.ts:63) → 200 {\"id\":\"4e66317f-7b64-4ed1-aa15-86e6df2af827\",\"name\":\"ZZ-SEC-TENANT-B ms8qo5zb-z51fp\",\"setupComplete\":1,\"setupWizardState\":null,\"onboardingState\":{},\"tradingName\":null,\"email\":null,\"phone\":null,\"address\":null,\"vatNumber\":null,\"companyNumber\":null,\"currency\":\"GBP\",\"timezone\":\"Europe/London\",\"businessType\":null,\"logoUrl\":null,\"invoiceTemplate\":\"standard\",\"invoicePrefix\":\"INV\",\"invoiceStartNumber\":100",
+   "PATCH /api/org/setup [sql in businessName] (server/routes/setupImports.ts:63) → 200 {\"id\":\"4e66317f-7b64-4ed1-aa15-86e6df2af827\",\"name\":\"ZZ-SEC-TENANT-B ms8qo5zb-z51fp\",\"setupComplete\":1,\"setupWizardState\":null,\"onboardingState\":{},\"tradingName\":null,\"email\":null,\"phone\":null,\"address\":null,\"vatNumber\":null,\"companyNumber\":null,\"currency\":\"GBP\",\"timezone\":\"Europe/London\",\"businessType\":null,\"logoUrl\":null,\"invoiceTemplate\":\"standard\",\"invoicePrefix\":\"INV\",\"invoiceStartNumber\":100",
+ ]
```

# Test source

```ts
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
  515 |     expect(serverErrors, "malformed input must never reach a 500").toEqual([]);
> 516 |     expect(notFourHundred, "a zod-guarded route answered something other than 400").toEqual([]);
      |                                                                                     ^ Error: a zod-guarded route answered something other than 400
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
  561 |   // Was test.fail(): routes leaked 500s on malformed input. Fixed by adding
  562 |   // schemas and column-width bounds, so this is now a normal expectation.
  563 |   test("no route may answer 5xx to malformed client input", async () => {
  564 |     test.setTimeout(120_000);
  565 |     const results = [...(await sweep(validatedTargets())), ...(await sweep(unvalidatedTargets()))];
  566 |     const serverErrors = results.filter((x) => x.status >= 500);
  567 |     console.log(
  568 |       `[5.7 FINDING] ${serverErrors.length} of ${results.length} malformed payloads returned 5xx`,
  569 |     );
  570 |     expect(
  571 |       serverErrors.map((x) => `${x.label} → ${x.status}`),
  572 |       "malformed input must never produce a server error",
  573 |     ).toEqual([]);
  574 |   });
  575 | 
  576 |   test("injection strings are parameterised away — the schema survives", async () => {
  577 |     test.setTimeout(120_000);
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
```