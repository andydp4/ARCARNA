# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/journeys/security/crossTenant.spec.ts >> 5.3 cross-tenant writes >> a create must not be allowed to reference another tenant's supplier, location or product
- Location: tests/journeys/security/crossTenant.spec.ts:318:8

# Error details

```
Error: single create must refuse another tenant's ids

expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 400
Received:    201
```

# Test source

```ts
  238 |     expect(await orgFingerprint(orgBId), "org B's data changed during the sweep").toEqual(before);
  239 |   });
  240 | 
  241 |   test("cross-tenant ids smuggled inside a create are rejected on the routes that check", async () => {
  242 |     // The dangerous shape is not "GET someone else's id" but "reference someone
  243 |     // else's id from a create that is otherwise legitimate in my own org".
  244 |     // Runs as org C — a throwaway attacker tenant — so nothing is written into
  245 |     // the seeded org and this file stays parallel-safe.
  246 |     const beforeB = await orgFingerprint(orgBId);
  247 | 
  248 |     const attempts = [
  249 |       {
  250 |         what: "transfer between B's locations",
  251 |         res: await cApi.post("/api/inventory/transfers", {
  252 |           data: {
  253 |             fromLocationId: b.locationId,
  254 |             toLocationId: b.secondLocationId,
  255 |             items: [{ productId: b.productId, quantity: 1 }],
  256 |           },
  257 |         }),
  258 |       },
  259 |       {
  260 |         what: "transfer draft from replenishment into B's location",
  261 |         res: await cApi.post("/api/replenishment/create-transfer-draft", {
  262 |           data: {
  263 |             toLocationId: b.locationId,
  264 |             items: [{ productId: b.productId, fromLocationId: b.secondLocationId, quantity: 1 }],
  265 |           },
  266 |         }),
  267 |       },
  268 |       {
  269 |         what: "goods receipt against B's purchase draft",
  270 |         res: await cApi.post("/api/goods-receipts", {
  271 |           data: {
  272 |             purchaseDraftId: b.purchaseDraftId,
  273 |             items: [
  274 |               {
  275 |                 purchaseDraftItemId: b.purchaseDraftItemId,
  276 |                 productId: b.productId,
  277 |                 quantityReceived: 1,
  278 |               },
  279 |             ],
  280 |           },
  281 |         }),
  282 |       },
  283 |       {
  284 |         what: "product-supplier link joining B's product to B's supplier",
  285 |         res: await cApi.post("/api/product-suppliers", {
  286 |           data: { productId: b.productId, supplierId: b.supplierId, costPrice: 1 },
  287 |         }),
  288 |       },
  289 |     ];
  290 | 
  291 |     const accepted: string[] = [];
  292 |     for (const a of attempts) {
  293 |       if (a.res.status() >= 200 && a.res.status() < 300) {
  294 |         accepted.push(`${a.what} → ${a.res.status()} ${(await a.res.text()).slice(0, 240)}`);
  295 |       }
  296 |     }
  297 | 
  298 |     expect(accepted, "a create referencing another tenant's ids was accepted").toEqual([]);
  299 |     expect(await orgFingerprint(orgBId), "org B's data changed").toEqual(beforeB);
  300 |   });
  301 | 
  302 |   /**
  303 |    * OPEN FINDING — cross-tenant reference injection and data disclosure.
  304 |    *
  305 |    * `POST /api/replenishment/create-purchase-draft` (and the batch variant)
  306 |    * accept `supplierId`, `locationId` and `productId` belonging to another
  307 |    * organisation and create the draft anyway:
  308 |    * `insertDraftWithItems` (server/services/purchaseDrafts.ts:229-261) inserts
  309 |    * `orgId` from the caller's context but never checks that the referenced rows
  310 |    * belong to it.
  311 |    *
  312 |    * `test.fail()` rather than a characterisation assertion, because unlike the
  313 |    * missing role guards there is no reading of the requirements under which
  314 |    * this is correct. Playwright reports it as an expected failure today, and
  315 |    * turns RED the moment it starts passing — which is the signal to delete the
  316 |    * annotation, not to "fix a regression".
  317 |    */
  318 |   test.fail("a create must not be allowed to reference another tenant's supplier, location or product", async () => {
  319 |     const single = await cApi.post("/api/replenishment/create-purchase-draft", {
  320 |       data: {
  321 |         supplierId: b.supplierId,
  322 |         locationId: b.locationId,
  323 |         items: [{ productId: b.productId, quantity: 4, estimatedCost: 1 }],
  324 |       },
  325 |     });
  326 |     const batch = await cApi.post("/api/replenishment/create-purchase-drafts", {
  327 |       data: {
  328 |         lines: [
  329 |           { supplierId: b.supplierId, locationId: b.locationId, productId: b.productId, quantity: 4 },
  330 |         ],
  331 |       },
  332 |     });
  333 |     console.log(
  334 |       `[5.3 FINDING] create-purchase-draft with org B's ids → ${single.status()}; ` +
  335 |         `create-purchase-drafts → ${batch.status()} ` +
  336 |         `(no ownership check in insertDraftWithItems, server/services/purchaseDrafts.ts:229)`,
  337 |     );
> 338 |     expect(single.status(), "single create must refuse another tenant's ids").toBeGreaterThanOrEqual(400);
      |                                                                               ^ Error: single create must refuse another tenant's ids
  339 |     expect(batch.status(), "batch create must refuse another tenant's ids").toBeGreaterThanOrEqual(400);
  340 |   });
  341 | 
  342 |   test("FINDING PROOF: the injected draft then discloses org B's names to org C", async () => {
  343 |     // The injection above is not merely untidy data — it is a working read
  344 |     // oracle. Anyone holding another tenant's UUIDs can plant them in a draft
  345 |     // of their own and read that tenant's supplier, location and product names
  346 |     // straight back out, because loadDraftWithItems joins suppliers, locations
  347 |     // and products with no org predicate
  348 |     // (server/services/purchaseDrafts.ts:156-157, 175).
  349 |     const create = await cApi.post("/api/replenishment/create-purchase-draft", {
  350 |       data: {
  351 |         supplierId: b.supplierId,
  352 |         locationId: b.locationId,
  353 |         items: [{ productId: b.productId, quantity: 2, estimatedCost: 1 }],
  354 |       },
  355 |     });
  356 |     if (create.status() >= 400) {
  357 |       // The injection has been fixed; there is nothing left to disclose.
  358 |       console.log("[5.3] injection now refused — disclosure path is closed");
  359 |       return;
  360 |     }
  361 |     const draft = (await create.json()) as { id: string };
  362 | 
  363 |     const readback = await cApi.get(`/api/purchase-drafts/${draft.id}`);
  364 |     const body = await readback.text();
  365 |     const disclosed = leakedValues(body, [
  366 |       b.supplierId,
  367 |       b.locationId,
  368 |       b.productId,
  369 |     ]);
  370 |     console.log(
  371 |       `[5.3 FINDING] GET /api/purchase-drafts/${draft.id} as org C returned org B's ` +
  372 |         `supplierName/locationName/productName. Disclosed ids: ${disclosed.join(", ")}`,
  373 |     );
  374 |     // Asserted as the *current* behaviour so the proof is recorded and the log
  375 |     // line is produced; the expectation of a fix lives in the test.fail() above.
  376 |     expect(readback.status()).toBe(200);
  377 |     expect(body, "org B's supplier name is served to org C").toContain("ZZ-SEC Supplier");
  378 |     expect(body, "org B's product name is served to org C").toContain("ZZ-SEC Widget");
  379 |   });
  380 | });
  381 | 
  382 | test.describe("5.5 IDOR sweep", () => {
  383 |   test("enumerating org B's ids as every org-A role leaks nothing", async () => {
  384 |     // 5.2 covers reads and 5.3 covers writes as ADMIN. This crosses the two:
  385 |     // every role × every id, so no combination is left unprobed.
  386 |     const roles: Role[] = bypassOn ? ["ADMIN"] : ["ADMIN", "MANAGER", "CASHIER"];
  387 |     const before = await orgFingerprint(orgBId);
  388 |     const failures: string[] = [];
  389 | 
  390 |     for (const role of roles) {
  391 |       const api = await apiAs(role, orgAId);
  392 |       for (const r of crossTenantReads()) {
  393 |         const res = await api.get(r.path);
  394 |         const body = await res.text();
  395 |         if (res.status() >= 200 && res.status() < 300) {
  396 |           failures.push(`${role} GET ${r.path} → ${res.status()}`);
  397 |         }
  398 |         const found = leakedValues(body, secrets());
  399 |         if (found.length) failures.push(`${role} GET ${r.path} leaked ${found.join(", ")}`);
  400 |       }
  401 |       for (const w of crossTenantWrites()) {
  402 |         const res = await send(api, w);
  403 |         if (res.status() >= 200 && res.status() < 300) {
  404 |           failures.push(`${role} ${w.method.toUpperCase()} ${w.path} → ${res.status()} (${w.what})`);
  405 |         }
  406 |       }
  407 |       await api.dispose();
  408 |     }
  409 | 
  410 |     expect(failures, "cross-tenant access succeeded for some role").toEqual([]);
  411 |     expect(await orgFingerprint(orgBId), "org B changed during the sweep").toEqual(before);
  412 |   });
  413 | 
  414 |   test("a CASHIER of org A gets no more than an ADMIN of org A on org B's ids", async () => {
  415 |     test.skip(bypassOn, ROLE_GATE_OFF_REASON);
  416 |     // Guards against a route that is role-gated for ADMIN but reachable by a
  417 |     // lower role through a different code path.
  418 |     const cashier = await apiAs("CASHIER", orgAId);
  419 |     const twoHundreds: string[] = [];
  420 |     for (const r of crossTenantReads()) {
  421 |       const res = await cashier.get(r.path);
  422 |       if (res.ok()) twoHundreds.push(`GET ${r.path} → ${res.status()}`);
  423 |     }
  424 |     await cashier.dispose();
  425 |     expect(twoHundreds).toEqual([]);
  426 |   });
  427 | 
  428 |   test("org B is intact after every sweep in this file", async () => {
  429 |     // The final ledger check. If a probe above wrote and a later probe wrote it
  430 |     // back, the per-test fingerprints could both pass; this compares against the
  431 |     // record set as provisioned.
  432 |     const api = await apiAs("SUPER_ADMIN", orgBId);
  433 |     const draft = await api.get(`/api/purchase-drafts/${b.purchaseDraftId}`);
  434 |     expect(draft.ok(), "org B's own admin must still see its draft").toBeTruthy();
  435 |     const draftBody = (await draft.json()) as { status: string; items?: { quantity: number }[] };
  436 |     expect(draftBody.status, "status must still be the one org B set").toBe("approved");
  437 |     expect(draftBody.items?.[0]?.quantity, "line quantity must be untouched").toBe(9);
  438 | 
```