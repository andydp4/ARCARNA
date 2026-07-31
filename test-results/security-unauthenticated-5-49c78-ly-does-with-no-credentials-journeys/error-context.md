# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/journeys/security/unauthenticated.spec.ts >> 5.4 unauthenticated access >> CHARACTERISATION — what this server actually does with no credentials
- Location: tests/journeys/security/unauthenticated.spec.ts:169:3

# Error details

```
Error: no API route may return 200 to an anonymous caller

expect(received).toBeUndefined()

Received: 13
```

# Test source

```ts
  85  |   return [b.supplierId, b.productId, b.customerId, b.purchaseDraftId, b.giftCardId, orgBId];
  86  | }
  87  | 
  88  | test.describe("5.4 unauthenticated access", () => {
  89  |   test("the auth mode of the server under test is recorded, not assumed", async () => {
  90  |     console.log(
  91  |       `[5.4 CONFIG] devAuthBypass=${mode.devAuthBypass} clerkConfigured=${mode.clerkConfigured} ` +
  92  |         `nodeEnv=${mode.nodeEnv} phase2dTest=${mode.phase2dTest}`,
  93  |     );
  94  |     expect(typeof mode.devAuthBypass).toBe("boolean");
  95  |   });
  96  | 
  97  |   test("no anonymous request is ever served tenant data — true in every mode", async () => {
  98  |     // This is the property that holds regardless of configuration, so it is the
  99  |     // one asserted unconditionally.
  100 |     const api = await apiAnonymous();
  101 |     const leaks: string[] = [];
  102 |     for (const r of ROUTES) {
  103 |       const res = await api[r.method](r.path);
  104 |       const body = await res.text();
  105 |       const found = leakedValues(body, tenantValues());
  106 |       if (found.length) leaks.push(`${r.method.toUpperCase()} ${r.path} leaked ${found.join(", ")}`);
  107 |     }
  108 |     await api.dispose();
  109 |     expect(leaks, "an anonymous caller was served tenant data").toEqual([]);
  110 |   });
  111 | 
  112 |   test("401 with a bare message, when the server can produce one", async () => {
  113 |     test.skip(
  114 |       mode.devAuthBypass || !mode.clerkConfigured,
  115 |       "a 401 is only reachable with DEV_AUTH_BYPASS off and CLERK_PUBLISHABLE_KEY set; " +
  116 |         "this server is in a different mode and the behaviour it does have is asserted separately",
  117 |     );
  118 |     const api = await apiAnonymous();
  119 |     const wrong: string[] = [];
  120 |     const leaks: string[] = [];
  121 |     for (const r of ROUTES) {
  122 |       const res = await api[r.method](r.path);
  123 |       const body = await res.text();
  124 |       if (res.status() !== 401) wrong.push(`${r.method.toUpperCase()} ${r.path} → ${res.status()}`);
  125 |       const leak = internalLeak(body);
  126 |       if (leak) leaks.push(`${r.method.toUpperCase()} ${r.path} disclosed ${leak}`);
  127 |     }
  128 |     await api.dispose();
  129 |     expect(wrong, "every API route must answer 401 to an anonymous caller").toEqual([]);
  130 |     expect(leaks, "a 401 body must carry no internals").toEqual([]);
  131 |   });
  132 | 
  133 |   /**
  134 |    * OPEN FINDING — wrong status and an internal disclosure when Clerk is the
  135 |    * provider but no publishable key is configured.
  136 |    *
  137 |    * `test.fail()` because there is no configuration in which a 500 carrying the
  138 |    * Clerk library's setup instructions is the right answer to "who are you?".
  139 |    * Verified: the same build with `CLERK_PUBLISHABLE_KEY` set answers
  140 |    * `401 {"message":"Unauthorized"}`, so the fix is a guard, not a redesign.
  141 |    */
  142 |   test.fail("an anonymous request must not produce a 500 or echo library internals", async () => {
  143 |     test.skip(
  144 |       mode.devAuthBypass || mode.clerkConfigured,
  145 |       "only applies with the bypass off and no Clerk publishable key",
  146 |     );
  147 |     const api = await apiAnonymous();
  148 |     const fiveHundreds: string[] = [];
  149 |     const leaks: string[] = [];
  150 |     for (const r of ROUTES) {
  151 |       const res = await api[r.method](r.path);
  152 |       const body = await res.text();
  153 |       if (res.status() >= 500) fiveHundreds.push(`${r.method.toUpperCase()} ${r.path} → ${res.status()}`);
  154 |       if (/clerkMiddleware|clerk\.com/i.test(body)) {
  155 |         leaks.push(`${r.method.toUpperCase()} ${r.path} echoed Clerk setup instructions`);
  156 |       }
  157 |     }
  158 |     await api.dispose();
  159 |     console.log(
  160 |       `[5.4 FINDING] ${fiveHundreds.length}/${ROUTES.length} anonymous requests returned 5xx, ` +
  161 |         `${leaks.length} echoed the Clerk library error ` +
  162 |         `(server/auth/clerkAuth.ts:24-29 mounts a no-op when CLERK_PUBLISHABLE_KEY is unset, ` +
  163 |         `then :109 calls getAuth and throws)`,
  164 |     );
  165 |     expect(fiveHundreds, "an unauthenticated request must not 500").toEqual([]);
  166 |     expect(leaks, "an error body must not echo library setup instructions").toEqual([]);
  167 |   });
  168 | 
  169 |   test("CHARACTERISATION — what this server actually does with no credentials", async () => {
  170 |     // Whatever the mode, record the real status distribution so the report can
  171 |     // quote it rather than paraphrase it, and so a change is visible.
  172 |     const api = await apiAnonymous();
  173 |     const statuses: Record<string, number> = {};
  174 |     for (const r of ROUTES) {
  175 |       const res = await api[r.method](r.path);
  176 |       const key = `${res.status()}`;
  177 |       statuses[key] = (statuses[key] ?? 0) + 1;
  178 |     }
  179 |     await api.dispose();
  180 |     console.log(`[5.4 OBSERVED] anonymous status distribution: ${JSON.stringify(statuses)}`);
  181 |     expect(
  182 |       Object.keys(statuses).some((s) => Number(s) >= 400),
  183 |       "no anonymous request may succeed",
  184 |     ).toBeTruthy();
> 185 |     expect(statuses["200"], "no API route may return 200 to an anonymous caller").toBeUndefined();
      |                                                                                   ^ Error: no API route may return 200 to an anonymous caller
  186 |   });
  187 | 
  188 |   test("with DEV_AUTH_BYPASS=1, anonymous callers are promoted — recorded", async () => {
  189 |     test.skip(!mode.devAuthBypass, "only meaningful on a bypass-enabled server");
  190 |     // tryDevAuthBypass (server/auth/commonAuth.ts:49-82) builds a session user
  191 |     // for DEV_AUTH_USER_ID with no credential of any kind. If that id is absent
  192 |     // from allowed_users it defaults to SUPER_ADMIN, and requireOrgContext will
  193 |     // auto-select the org when exactly one exists — i.e. on a single-tenant dev
  194 |     // database an unauthenticated caller gets full super-admin scope.
  195 |     const api = await apiAnonymous();
  196 |     const who = await api.get("/api/auth/user");
  197 |     const body = await who.text();
  198 |     console.log(`[5.4 CONFIG] DEV_AUTH_BYPASS=1: GET /api/auth/user anonymously → ${who.status()} ${body.slice(0, 240)}`);
  199 |     await api.dispose();
  200 |     expect(who.status(), "bypass mode answers, it does not challenge").not.toBe(401);
  201 |   });
  202 | 
  203 |   test("the public routes stay public and leak nothing", async () => {
  204 |     const api = await apiAnonymous();
  205 |     for (const path of PUBLIC_ROUTES) {
  206 |       const res = await api.get(path);
  207 |       expect(res.status(), `${path} must remain reachable`).toBe(200);
  208 |       const body = await res.text();
  209 |       expect(leakedValues(body, tenantValues()), `${path} leaked tenant data`).toEqual([]);
  210 |       expect(internalLeak(body), `${path} leaked internals`).toBeNull();
  211 |       expect(body, "no secret material in a public probe").not.toMatch(/sk_(test|live)_|SESSION_SECRET|DATABASE_URL/);
  212 |     }
  213 |     await api.dispose();
  214 |   });
  215 | 
  216 |   /**
  217 |    * OPEN FINDING — unmatched `/api/*` paths fall through to the SPA shell.
  218 |    *
  219 |    * Both the dev fallback (server/vite.ts:36-54) and the production one
  220 |    * (server/static.ts:48-54) are pathless middleware that answer every
  221 |    * unmatched request with `200 text/html`. So an unknown API path — or a known
  222 |    * path with the wrong verb — returns the React index page with a 200, without
  223 |    * ever passing through `isAuthenticated`. No tenant data escapes, but a
  224 |    * client typo becomes an invisible success, which is precisely the defect
  225 |    * class this programme exists to catch: the caller's `res.json()` then fails
  226 |    * on HTML rather than on a 404 anyone can see.
  227 |    */
  228 |   test.fail("an unknown /api path must 404, not return the SPA shell with 200", async () => {
  229 |     const api = await apiAnonymous();
  230 |     const probes: { method: "get" | "post" | "patch" | "put" | "delete"; path: string }[] = [
  231 |       { method: "get", path: "/api/definitely-not-a-route" },
  232 |       { method: "post", path: "/api/definitely-not-a-route" },
  233 |       { method: "patch", path: "/api/rules/00000000-0000-4000-8000-000000000000" }, // registered as PUT
  234 |       { method: "patch", path: "/api/scheduled-reports/00000000-0000-4000-8000-000000000000" },
  235 |     ];
  236 |     const htmlTwoHundreds: string[] = [];
  237 |     for (const p of probes) {
  238 |       const res = await api[p.method](p.path);
  239 |       const type = res.headers()["content-type"] ?? "";
  240 |       if (res.status() === 200 && type.includes("text/html")) {
  241 |         htmlTwoHundreds.push(`${p.method.toUpperCase()} ${p.path} → 200 ${type}`);
  242 |       }
  243 |     }
  244 |     await api.dispose();
  245 |     console.log(
  246 |       `[5.4 FINDING] ${htmlTwoHundreds.length}/${probes.length} unmatched API requests returned the SPA ` +
  247 |         `shell with 200: ${htmlTwoHundreds.join("; ")} (server/vite.ts:36, server/static.ts:48)`,
  248 |     );
  249 |     expect(htmlTwoHundreds, "unmatched /api paths must 404 as JSON").toEqual([]);
  250 |   });
  251 | });
  252 | 
```