#!/usr/bin/env node
/**
 * Detects the class of defect where backend capability exists but the UI seam
 * that reaches it does not — the failure mode behind the replenishment →
 * purchase draft → receiving flow, where every stage worked and none of the
 * links between them did.
 *
 * Three checks:
 *   1. DEAD LINKS      — a client link/navigation to a path with no <Route>.
 *   2. RESPONSE-AS-JSON — reading properties off apiRequest()'s return value,
 *                         which is a Response, not parsed JSON.
 *   3. ORPHAN ENDPOINTS — a server API route no client code references
 *                         (reported as advisory; many are legitimately
 *                         server-to-server).
 *
 * Exit code 1 on checks 1 and 2 (always bugs). Check 3 prints for review.
 * Run: node scripts/audit-ui-wiring.mjs [--strict]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const STRICT = process.argv.includes("--strict");

function walk(dir, exts, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "__tests__" || name === "dist") continue;
      walk(p, exts, acc);
    } else if (exts.some((e) => p.endsWith(e))) {
      acc.push(p);
    }
  }
  return acc;
}

const clientFiles = walk("client/src", [".ts", ".tsx"]);
const serverFiles = walk("server", [".ts"]);

// ---------------------------------------------------------------- routes
const appSrc = readFileSync("client/src/App.tsx", "utf8");
const routePaths = new Set(
  [...appSrc.matchAll(/path="([^"]+)"/g)].map((m) => m[1]),
);
// Redirect targets are valid destinations too.
for (const m of appSrc.matchAll(/<Redirect\s+to="([^"]+)"/g)) routePaths.add(m[1]);

/** A concrete path matches a route pattern if segment counts align and static parts agree. */
function matchesRoute(path) {
  const clean = path.split("?")[0].split("#")[0].replace(/\/$/, "") || "/";
  if (routePaths.has(clean)) return true;
  const parts = clean.split("/").filter(Boolean);
  for (const pattern of routePaths) {
    const pp = pattern.split("/").filter(Boolean);
    if (pp.length !== parts.length) continue;
    let ok = true;
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].startsWith(":")) continue;
      if (pp[i] !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

const deadLinks = [];
const LINK_PATTERNS = [
  /href="(\/[^"{}]*)"/g,
  /href=\{`(\/[^`$]*)`\}/g,
  /setLocation\(\s*"(\/[^"]*)"\s*\)/g,
  /navigate\(\s*"(\/[^"]*)"\s*\)/g,
];

for (const file of clientFiles) {
  if (file.endsWith("App.tsx")) continue;
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  for (const pattern of LINK_PATTERNS) {
    for (const m of src.matchAll(pattern)) {
      const target = m[1];
      // External, anchors, and API paths are not client routes.
      if (target.startsWith("//") || target.startsWith("/api/")) continue;
      if (matchesRoute(target)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      deadLinks.push(`${file}:${line}  →  ${target}  (no matching <Route>)`);
    }
  }
  void lines;
}

// ------------------------------------------------- apiRequest misuse
/**
 * apiRequest returns a Response. Reading `.id`/`.data` etc. off it (rather than
 * awaiting .json()) silently yields undefined — the bug that made two "created"
 * toasts render no identifier.
 */
const responseMisuse = [];
const SAFE_RESPONSE_PROPS = new Set([
  "json",
  "text",
  "blob",
  "ok",
  "status",
  "statusText",
  "headers",
  "arrayBuffer",
  "clone",
  "body",
  "url",
  "redirected",
  "type",
  "formData",
  "bytes",
]);

/** Extracts the balanced-brace body starting at the `{` index `open`. */
function balancedBody(src, open) {
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return { body: src.slice(open + 1, i), end: i };
    }
  }
  return { body: src.slice(open + 1), end: src.length };
}

for (const file of clientFiles) {
  const src = readFileSync(file, "utf8");

  for (const um of src.matchAll(/useMutation(?:<[^>]*>)?\(\s*\{/g)) {
    const open = src.indexOf("{", um.index + um[0].length - 1);
    const { body: block } = balancedBody(src, open);

    // Does mutationFn hand back a Response, or a parsed body?
    const fnMatch = block.match(/mutationFn:\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>\s*/);
    if (!fnMatch) continue;
    const afterArrow = block.slice(fnMatch.index + fnMatch[0].length);

    let returnsResponse;
    if (afterArrow.trimStart().startsWith("{")) {
      const fnBody = balancedBody(afterArrow, afterArrow.indexOf("{")).body;
      // Any .json() in the function body means the parsed value is what flows on.
      if (/\.json\s*\(/.test(fnBody)) returnsResponse = false;
      else returnsResponse = /return\s+(?:await\s+)?apiRequest\s*\(/.test(fnBody);
    } else {
      // Expression-bodied: `mutationFn: (x) => apiRequest(...)` yields a Response.
      returnsResponse = /^\s*(?:await\s+)?apiRequest\s*\(/.test(afterArrow);
    }

    if (!returnsResponse) continue;

    const osMatch = block.match(
      /onSuccess:\s*(?:async\s*)?\(\s*(\w+)(?:\s*:\s*[^),]+)?\s*(?:,[^)]*)?\)\s*=>\s*\{/,
    );
    if (!osMatch) continue;
    const param = osMatch[1];
    const osBody = balancedBody(block, block.indexOf("{", osMatch.index + osMatch[0].length - 1))
      .body;
    if (new RegExp(`\\b${param}\\s*(?:\\?\\.|\\.)\\s*json\\s*\\(`).test(osBody)) continue;

    const propRe = new RegExp(`\\b${param}\\s*(?:\\?\\.|\\.)\\s*(\\w+)`, "g");
    const seen = new Set();
    for (const pm of osBody.matchAll(propRe)) {
      const prop = pm[1];
      if (SAFE_RESPONSE_PROPS.has(prop) || seen.has(prop)) continue;
      seen.add(prop);
      const line = src.slice(0, open).split("\n").length;
      responseMisuse.push(
        `${file}:~${line}  →  onSuccess reads ${param}.${prop}, but mutationFn returns a Response (needs await res.json())`,
      );
    }
  }
}

// ------------------------------------------- silent mutation failures
/**
 * A useMutation with no onError: when the request fails the user sees nothing
 * at all — no toast, no inline message, and the optimistic UI may still look
 * like it worked. Checkpoint 7.1.
 *
 * Advisory: a few mutations are genuinely fire-and-forget (analytics pings,
 * best-effort telemetry).
 */
const silentFailures = [];
for (const file of clientFiles) {
  const src = readFileSync(file, "utf8");
  for (const um of src.matchAll(/useMutation(?:<[^>]*>)?\(\s*\{/g)) {
    const open = src.indexOf("{", um.index + um[0].length - 1);
    const { body: block } = balancedBody(src, open);
    if (/\bonError\b/.test(block)) continue;
    const line = src.slice(0, open).split("\n").length;
    silentFailures.push(`${file}:${line}  →  useMutation with no onError (failure is invisible)`);
  }
}

// ---------------------------------------------------- orphan pages
/**
 * A <Route> no link or programmatic navigation reaches. The mirror of an
 * orphan endpoint, and the same defect class: a page can be fully built and
 * simply unreachable, which is how a finished flow ships unusable.
 *
 * Advisory: some routes are legitimately entered only by redirect, by deep
 * link from outside the app, or as a route parameter built at runtime.
 */
const navTargets = new Set();
for (const file of clientFiles) {
  const src = readFileSync(file, "utf8");
  for (const pattern of LINK_PATTERNS) {
    for (const m of src.matchAll(pattern)) navTargets.add(m[1].split("?")[0]);
  }
  // Template-literal navigation: capture the static prefix before the first ${.
  for (const m of src.matchAll(/(?:href|to)=\{`(\/[^`]*?)\$\{/g)) navTargets.add(m[1]);
  for (const m of src.matchAll(/(?:setLocation|navigate)\(\s*`(\/[^`]*?)\$\{/g)) navTargets.add(m[1]);
  // Sidebar/menu config entries — nav-items.ts uses single quotes, so both
  // quote styles must be matched or every sidebar destination looks orphaned.
  for (const m of src.matchAll(/(?:path|href|to|url|route):\s*["'`](\/[^"'`]*)["'`]/g)) {
    navTargets.add(m[1]);
  }
}

for (const m of appSrc.matchAll(/<Redirect\s+to="([^"]+)"/g)) navTargets.add(m[1]);

function isReached(routePath) {
  if (routePath === "/") return true;
  const staticPrefix = routePath.split("/:")[0];
  for (const target of navTargets) {
    if (target === routePath || target === staticPrefix) return true;
    // A template-literal prefix like "/open-orders/" reaches "/open-orders/:id".
    if (staticPrefix && target.startsWith(staticPrefix + "/")) return true;
    if (target.startsWith(staticPrefix) && staticPrefix.length > 1) return true;
  }
  return false;
}

// Routes that only redirect (kept so old URLs keep working) are unreachable by
// link on purpose and are not orphans.
//
// Two forms exist, and matching only the first is why /orders/:id/refund was
// reported as an orphan indefinitely:
//
//   <Route path="/orders"><Redirect to="/open-orders" /></Route>
//   <Route path="/orders/:id/refund">
//     {(params) => <Redirect to={`/open-orders/${params.id}/refund`} />}
//
// A redirect that has to carry a route parameter through *must* use the
// render-prop form to read `params`, so the ones this used to miss were
// precisely the parameterised ones.
const redirectOnlyRoutes = new Set(
  [
    ...appSrc.matchAll(
      /<Route\s+path="([^"]+)"\s*>\s*(?:\{\s*\([^)]*\)\s*=>\s*)?<Redirect/g,
    ),
  ].map((m) => m[1]),
);

const orphanPages = [];
for (const routePath of routePaths) {
  // Auth/onboarding routes are entered by redirect from the server or guards.
  if (/^\/(sign-in|sign-out|no-access|pending-approval|setup-blocked|callback)/.test(routePath)) {
    continue;
  }
  if (redirectOnlyRoutes.has(routePath)) continue;
  if (!isReached(routePath)) orphanPages.push(routePath);
}

// ------------------------------------------------- orphan endpoints
const serverRoutes = new Set();
for (const file of serverFiles) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(
    /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*["'`](\/api\/[^"'`]+)["'`]/g,
  )) {
    serverRoutes.add(`${m[1].toUpperCase()} ${m[2]}`);
  }
}

const clientBlob = clientFiles.map((f) => readFileSync(f, "utf8")).join("\n");
const orphans = [];
for (const route of serverRoutes) {
  const path = route.split(" ")[1];
  // Compare on the static prefix before the first parameter.
  const prefix = path.split("/:")[0];
  if (prefix.length < 6) continue;
  if (clientBlob.includes(prefix)) continue;
  orphans.push(route);
}

// -------------------------------------------- icon buttons with no name
/**
 * `size="icon"` renders a square button whose only child is an icon, so it has
 * no text for a screen reader to announce — axe reports `button-name`, which is
 * a *critical* violation. The a11y suite found 155 of these across the five
 * critical paths, and did not report them in CI because that job runs against
 * an empty database: no rows, so no per-row action buttons exist to fail.
 *
 * The rule is narrow on purpose. `size="icon"` means icon-only by definition,
 * so requiring a name on it has no judgement call in it and cannot cry wolf
 * the way a general "does this button render text?" heuristic would.
 */
const unnamedIconButtons = [];
const NAME_ATTRS = /\b(aria-label|aria-labelledby|title)\s*=/;

for (const file of clientFiles) {
  if (!file.endsWith(".tsx")) continue;
  const src = readFileSync(file, "utf8");
  let idx = 0;
  while ((idx = src.indexOf('size="icon"', idx)) !== -1) {
    // Walk back to the opening `<`, then forward to the end of the tag, so the
    // attribute list is read as a whole rather than by proximity.
    const open = src.lastIndexOf("<", idx);
    let end = idx;
    let depth = 0;
    for (; end < src.length; end++) {
      const c = src[end];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    const tag = src.slice(open, end + 1);
    // An sr-only span inside the button also gives it a name, but that lives
    // after the opening tag — check a little of the body too.
    const body = src.slice(end + 1, end + 400);
    if (!NAME_ATTRS.test(tag) && !/sr-only/.test(body)) {
      unnamedIconButtons.push(
        `${file}:${src.slice(0, open).split("\n").length}  →  size="icon" with no aria-label/title/sr-only`,
      );
    }
    idx = end;
  }
}

// ------------------------------------------- fields the form never submits
/**
 * A controlled input bound to form state whose key is destructured away before
 * the payload is built. The operator types a value, the save reports success,
 * and the edit was dropped on the floor — indistinguishable from a backend that
 * ignored it, which is why this class costs a support round-trip every time.
 *
 * This is the product Edit dialog's Stock field: `const { stock: _stock, ...rest }
 * = formData` sat 900 lines above `value={formData.stock}`, so editing stock did
 * nothing while the toast still said "Product updated successfully".
 *
 * The discriminator is whether the key is ever READ for anything other than
 * painting the input. A key that is stripped from the body but read elsewhere is
 * the deliberate "persists through its own endpoint" pattern (aliases, and stock
 * once it routes through /api/inventory). A key whose only appearance is
 * `value={state.key}` has no path to the server at all.
 */
const droppedFields = [];
for (const file of clientFiles) {
  if (!file.endsWith(".tsx")) continue;
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/const\s*\{([^}]*?)\.\.\.\w+\s*\}\s*=\s*(\w+)/g)) {
    const [, discarded, stateVar] = m;
    for (const part of discarded.split(",")) {
      const key = part.split(":")[0].trim();
      if (!key || !/^[A-Za-z_$][\w$]*$/.test(key)) continue;
      const reads = [...src.matchAll(new RegExp(`\\b${stateVar}\\.${key}\\b`, "g"))].length;
      if (!reads) continue;
      const painted = [...src.matchAll(new RegExp(`value=\\{${stateVar}\\.${key}\\}`, "g"))]
        .length;
      if (!painted || reads > painted) continue;
      droppedFields.push(
        `${file}:${src.slice(0, m.index).split("\n").length}  →  ${stateVar}.${key} is rendered as an input but never submitted`,
      );
    }
  }
}

// ----------------------------------------------- controls with no behaviour
/**
 * A button with no onClick, no submit role, and no trigger/link wrapper to
 * supply one. It renders, it hovers, it depresses, and nothing happens — the
 * mock-UI failure behind the four dead Quick Actions and the dead "View All".
 *
 * Advisory: a `<button>` inside a <form> defaults to type="submit", and static
 * analysis cannot always see the form boundary, so this reports for triage
 * rather than failing the build.
 */
const inertButtons = [];
const HAS_BEHAVIOUR = /\bonClick\b|\bonSubmit\b|\btype\s*=\s*["']submit["']|\basChild\b|\bhref\b|\bdisabled\b/;
for (const file of clientFiles) {
  if (!file.endsWith(".tsx")) continue;
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/<(?:Button|button)[\s>]/g)) {
    const open = m.index;
    let end = open;
    let depth = 0;
    for (; end < src.length; end++) {
      const c = src[end];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    const tag = src.slice(open, end + 1);
    if (HAS_BEHAVIOUR.test(tag)) continue;
    // shadcn's <XTrigger asChild><Button/></XTrigger> supplies the handler from
    // the wrapper, as does a <Link> around the control.
    const before = src.slice(Math.max(0, open - 240), open);
    if (/(Trigger|<Link|<a)\b[^<>]*>\s*$/.test(before)) continue;
    inertButtons.push(
      `${file}:${src.slice(0, open).split("\n").length}  →  button with no onClick, submit role, or trigger/link wrapper`,
    );
  }
}

// ------------------------------------------------------------- report
let failed = false;

function section(title, rows, fatal) {
  if (!rows.length) {
    console.log(`✓ ${title}: none`);
    return;
  }
  const label = fatal ? "✗" : "!";
  console.log(`${label} ${title}: ${rows.length}`);
  for (const r of rows.sort()) console.log(`    ${r}`);
  if (fatal) failed = true;
}

console.log("audit-ui-wiring\n");
console.log(`  client routes: ${routePaths.size}   server API routes: ${serverRoutes.size}\n`);

section("Dead client links (navigation to a path with no route)", deadLinks, true);
section("Mutation result read as JSON without .json()", responseMisuse, true);
section('Icon-only buttons with no accessible name (axe button-name, critical)', unnamedIconButtons, true);
section("Form fields rendered but never submitted", droppedFields, true);
section(
  "Buttons with no behaviour (advisory — form-submit buttons can read as inert)",
  inertButtons,
  STRICT,
);
section(
  "Mutations with no onError (advisory — the user never sees the failure)",
  silentFailures,
  STRICT,
);
section(
  "Client routes nothing navigates to (advisory — some are redirect-only)",
  orphanPages,
  STRICT,
);
section(
  "Server API routes with no client reference (advisory — many are server-to-server)",
  orphans,
  STRICT,
);

if (failed) {
  console.error("\naudit-ui-wiring: FAILED");
  process.exit(1);
}
console.log("\naudit-ui-wiring: ok");
