/**
 * Ask arcarna's tools (v1.2): mostly read-only functions over the Evidence and
 * Truths services the app already has. The one exception is draft_order,
 * which never writes an order either — it resolves a customer and products
 * (read-only lookups, the same ones arcarna Voice already used) and hands
 * back a draft for the app to open in the till, where a person prices it,
 * checks stock and takes payment.
 *
 * Each tool checks the asker's role on the server with the SAME rules as the
 * route that serves the page (shared/accessPolicy.ts, the Evidence refs above
 * the manager line, the Phase 7 staff visibility rules, Needs a look's
 * "people you outrank"), and calls the same service with the same viewer, so
 * a question can never reach more than the asker's own screens show. The
 * role comes from the session, never from the model or the request body.
 *
 * On top of that, every result is cleaned before the model sees it: no
 * customer phone, email or address for anyone, and no cost field below the
 * cost line (productForRole's rule), in case a service ever grows a field.
 */
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import {
  COST_FIELDS,
  EVIDENCE_MIN_ROLE,
  WOULD_HAVE_FLAGGED_MIN_ROLE,
  canSeeCost,
  evidenceRefMinRole,
  isAtLeast,
} from "@shared/accessPolicy";
import { REPORT_CATALOG, reportByRef } from "@shared/evidenceCatalog";
import { NEEDS_A_LOOK_MIN_ROLE } from "@shared/review/exceptions";
import type { AskEvidenceLink, AskTillDraft } from "@shared/ask";
import type { Role } from "@shared/rbac";

export interface AskToolContext {
  orgId: string;
  userId: string;
  role: string;
  locationId: string | null;
}

export interface AskToolResult {
  /** JSON text handed to the model. */
  content: string;
  isError?: boolean;
  /** The page the figures came from, linked under the answer. */
  evidence?: AskEvidenceLink;
  /** What the audit row records: the tool, and the Evidence ref when there is one. */
  audit: string;
  /** A short "Reading …" line for the app while the tool runs. */
  status: string;
  /** Set by draft_order once a request resolves cleanly: the app opens this in the till. */
  tillDraft?: AskTillDraft;
}

const ROLE_WORDS: Record<string, string> = {
  CASHIER: "cashiers",
  MANAGER: "managers",
  ADMIN: "admins",
  SUPER_ADMIN: "the owner",
};

function outsideRole(minRole: Role, what: string): string {
  const who = minRole === "SUPER_ADMIN" ? "the owner" : `${ROLE_WORDS[minRole] ?? minRole} and above`;
  return JSON.stringify({
    outside_role: true,
    message: `${what} is outside this person's role: only ${who} can see it. Tell them so plainly; do not work it out another way.`,
  });
}

// ---------------------------------------------------------------------------
// Cleaning. Keys first (a whole field goes), then the text inside strings.
// ---------------------------------------------------------------------------

/** Customer contact details never reach the model, for any role. */
const CONTACT_KEY = /phone|e164|email|address|postcode|whatsapp|wa_?id/i;
/** Below the cost line, anything that is or reveals what stock cost. */
const COST_KEY = /cost|margin|profit/i;
const COST_FIELD_SET = new Set<string>(COST_FIELDS);

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const UK_PHONE_RE = /(?:\+44\s?|\b0)(?:\d[\s-]?){9,10}\b/g;

function cleanString(s: string): string {
  return s.replace(EMAIL_RE, "[removed]").replace(UK_PHONE_RE, "[removed]");
}

/** Arrays longer than this are cut, with a note, so one answer stays cheap. */
const MAX_ROWS = 25;
const MAX_JSON_CHARS = 24_000;

export function cleanForAsk(value: unknown, role: string, depth = 0): unknown {
  if (depth > 12) return null;
  if (typeof value === "string") return cleanString(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const rows = value.slice(0, MAX_ROWS).map((v) => cleanForAsk(v, role, depth + 1));
    if (value.length > MAX_ROWS) rows.push({ note: `${value.length - MAX_ROWS} more rows not shown; the Evidence page has them all.` });
    return rows;
  }
  if (value && typeof value === "object") {
    const seesCost = canSeeCost(role);
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (CONTACT_KEY.test(key)) continue;
      if (!seesCost && (COST_FIELD_SET.has(key) || COST_KEY.test(key))) continue;
      out[key] = cleanForAsk(v, role, depth + 1);
    }
    return out;
  }
  return value;
}

function toContent(value: unknown, role: string): string {
  const json = JSON.stringify(cleanForAsk(value, role));
  if (json.length <= MAX_JSON_CHARS) return json;
  return JSON.stringify({
    truncated: true,
    note: "The result was too long to read in full; this is the start of it. Say the Evidence page has the rest.",
    start: json.slice(0, MAX_JSON_CHARS),
  });
}

// ---------------------------------------------------------------------------
// Inputs. The model's input is untrusted: every tool validates it here.
// ---------------------------------------------------------------------------

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD");
const range = z.object({ from: isoDay.optional(), to: isoDay.optional() }).strict();

const INPUTS = {
  list_evidence: z.object({}).strict(),
  run_evidence: z.object({ ref: z.string().regex(/^ARC-T\d-\d{3}$/i), from: isoDay.optional(), to: isoDay.optional() }).strict(),
  my_performance: range,
  staff_performance: range,
  needs_a_look: z
    .object({ state: z.enum(["open", "all"]).optional(), kind: z.enum(["price", "refund", "pattern"]).optional() })
    .strict(),
  price_overrides: range,
  would_have_flagged: range,
  stock_levels: z
    .object({ search: z.string().max(80).optional(), status: z.enum(["out", "low", "ok", "any"]).optional() })
    .strict(),
  staff_targets: z.object({}).strict(),
  draft_order: z.object({ text: z.string().min(1).max(240) }).strict(),
} as const;

export type AskToolName = keyof typeof INPUTS;

const RANGE_PROPS = {
  from: { type: "string", description: "First trading day, YYYY-MM-DD. Optional." },
  to: { type: "string", description: "Last trading day, YYYY-MM-DD. Optional." },
} as const;

/**
 * The tool list: fixed text, fixed order, the same for every role, so the
 * cached prefix is identical for every question. A tool the asker's role may
 * not use says so when called.
 */
export const ASK_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "list_evidence",
    description:
      "Lists the Evidence reports (with their ARC refs, titles and purposes) this person may open. Call this first when you are not sure which Evidence answers the question.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "run_evidence",
    description:
      "Runs one Evidence report by ref for a date range and returns its summary and rows. Use for takings and sales by day or week (ARC-T1-001 daily, ARC-T1-004 weekly), stock (ARC-T1-002), margin and below-minimum sales (ARC-T2-001), order timing (ARC-T2-005), customers (T3/T4) and the rest. For a single day use from = to = that day. Managers and above; some refs are admins only.",
    input_schema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Evidence ref, e.g. ARC-T1-001." },
        ...RANGE_PROPS,
      },
      required: ["ref"],
      additionalProperties: false,
    },
  },
  {
    name: "my_performance",
    description:
      "The asker's OWN performance figures (orders, value brought in, speed, targets met, badges, their own commission) for a date range, with the team median when four or more people worked. Every role. Use for 'how am I doing' questions.",
    input_schema: { type: "object", properties: { ...RANGE_PROPS }, additionalProperties: false },
  },
  {
    name: "staff_performance",
    description:
      "Staff Performance for a date range: what each person the asker may see did. Managers see cashiers and themselves; admins and the owner see everyone. Use for questions comparing people.",
    input_schema: { type: "object", properties: { ...RANGE_PROPS }, additionalProperties: false },
  },
  {
    name: "needs_a_look",
    description:
      "The Needs a look inbox: flagged sales and refunds about people the asker outranks, with open counts per queue and per person. Use for 'unreviewed flags' questions. Managers and above.",
    input_schema: {
      type: "object",
      properties: {
        state: { type: "string", enum: ["open", "all"], description: "open (default) = not yet reviewed." },
        kind: { type: "string", enum: ["price", "refund", "pattern"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "price_overrides",
    description:
      "Price overrides Evidence: sale lines sold under list price, grouped by person, product and reason, for a date range (default the last 14 days). Managers and above; each sees only people they outrank.",
    input_schema: { type: "object", properties: { ...RANGE_PROPS }, additionalProperties: false },
  },
  {
    name: "would_have_flagged",
    description:
      "What the till's price guard would have flagged (sales below minimum or below cost) by product and person, for a date range. Admins and the owner only.",
    input_schema: { type: "object", properties: { ...RANGE_PROPS }, additionalProperties: false },
  },
  {
    name: "stock_levels",
    description:
      "Stock counts at the asker's location: name, SKU, count, and out/low/ok. Every role. Use for 'have we got' and 'what is running low' questions.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Part of a product name, SKU or barcode. Optional." },
        status: { type: "string", enum: ["out", "low", "ok", "any"], description: "Filter by status. Optional." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "staff_targets",
    description: "The staff targets in force (what the colours on My performance are measured against). Every role.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "draft_order",
    description:
      "Starts an order from a plain request ('create an order for Bunny, 50 Product 1, for tomorrow'). Resolves the customer and products against the shop's real records and opens a draft in the till — it never saves an order itself; the till still prices it, checks stock and takes payment. Every role. Rewrite the request into `text` in exactly this shape before calling: '<Customer name, or Walk-in> wants <quantity> <product name>[ and <quantity> <product name>...][, for today/tomorrow/<weekday>].' e.g. 'Bunny wants 50 Product 1 and 2 Coke, for tomorrow.' If the person did not name a customer, use 'Walk-in'. If a product or quantity is unclear, ask them rather than guessing one. Each call is independent — nothing from an earlier call is remembered — so if the result comes back not ready (something unclear or missing), ask the person for it, then call again with the WHOLE order restated, not just the missing part.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "The request, rewritten into the shape above." } },
      required: ["text"],
      additionalProperties: false,
    },
  },
].map((tool) => ({ ...tool, eager_input_streaming: true }) as Anthropic.Beta.BetaTool);

const PAGES = {
  myPerformance: { key: "my-performance", title: "My performance", route: "/my-performance" },
  staffPerformance: { key: "ARC-T2-002", title: "Staff Performance", route: "/reports/staff-performance" },
  needsALook: { key: "needs-a-look", title: "Needs a look", route: "/needs-a-look" },
  priceOverrides: { key: "price-overrides", title: "Price overrides", route: "/reports/price-overrides" },
  wouldHaveFlagged: { key: "would-have-flagged", title: "Would have flagged", route: "/reports/would-have-flagged" },
  stockLevels: { key: "stock-levels", title: "Stock levels", route: "/stock-levels" },
  staffTargets: { key: "staff-targets", title: "Staff targets", route: "/reports/staff-targets" },
} satisfies Record<string, AskEvidenceLink>;

function query(input: { from?: string; to?: string }): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  if (input.from) q.from = input.from;
  if (input.to) q.to = input.to;
  return q;
}

/** Service errors that carry a plain message for the person (bad dates, a range too long). */
function plainMessage(error: unknown): string | null {
  const status = (error as { status?: unknown; statusCode?: unknown })?.status ?? (error as { statusCode?: unknown })?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500 && error instanceof Error) return error.message;
  return null;
}

async function run(name: AskToolName, input: any, ctx: AskToolContext): Promise<Omit<AskToolResult, "audit" | "status">> {
  const viewer = { userId: ctx.userId, role: ctx.role };
  const role = ctx.role;
  switch (name) {
    case "list_evidence": {
      if (!isAtLeast(role, EVIDENCE_MIN_ROLE)) {
        return {
          content: JSON.stringify({
            evidence: [],
            note: "Evidence is for managers and above. This person can ask about their own performance, their targets and stock levels.",
          }),
        };
      }
      const list = REPORT_CATALOG.filter((r) => r.status === "available" && isAtLeast(role, evidenceRefMinRole(r.ref))).map(
        (r) => ({ ref: r.ref, title: r.title, purpose: r.purpose }),
      );
      return { content: JSON.stringify({ evidence: list }) };
    }
    case "run_evidence": {
      const ref = String(input.ref).toUpperCase();
      const entry = reportByRef(ref);
      if (!entry || entry.status !== "available") {
        return { content: JSON.stringify({ error: `There is no Evidence ${ref}. Use list_evidence to see what there is.` }), isError: true };
      }
      if (!isAtLeast(role, EVIDENCE_MIN_ROLE)) return { content: outsideRole(EVIDENCE_MIN_ROLE, `Evidence (${entry.title})`) };
      const min = evidenceRefMinRole(ref);
      if (!isAtLeast(role, min)) return { content: outsideRole(min, entry.title) };
      const { runReport } = await import("../services/reportsEngine");
      const opts: { from?: Date; to?: Date } = {};
      // Read exactly as GET /api/reports/:ref reads ?from=&to=, so an answer
      // and the Evidence page it links to show the same figures.
      if (input.from) opts.from = new Date(input.from);
      if (input.to) opts.to = new Date(input.to);
      let payload = await runReport(ref, ctx.orgId, opts);
      // The page's rule (Q14): people the viewer may not see are masked.
      if (ref === "ARC-T2-005") {
        const { redactOrderTimingPeople } = await import("../services/orderTimingPage");
        payload = await redactOrderTimingPeople(ctx.orgId, payload, viewer);
      }
      return {
        content: toContent(
          { title: payload.title, period: payload.period, summary: payload.summary, redFlags: payload.redFlags, rowCount: payload.rows.length, rows: payload.rows },
          role,
        ),
        evidence: { key: ref, title: entry.title, route: entry.route },
      };
    }
    case "my_performance": {
      const { myPerformance, parseMyRange } = await import("../services/myPerformance");
      const { orgTimeZone } = await import("../services/tradingDayShift");
      const range = parseMyRange(query(input), await orgTimeZone(ctx.orgId));
      // No user id in the input: it is always the asker's own figures.
      const mine = await myPerformance(ctx.orgId, viewer, range);
      return { content: toContent(mine, role), evidence: PAGES.myPerformance };
    }
    case "staff_performance": {
      if (!isAtLeast(role, EVIDENCE_MIN_ROLE)) return { content: outsideRole(EVIDENCE_MIN_ROLE, "Staff Performance") };
      const { parsePerformanceQuery, staffPerformance } = await import("../services/staffPerformance");
      const { orgTimeZone } = await import("../services/tradingDayShift");
      const q = parsePerformanceQuery(query(input), await orgTimeZone(ctx.orgId));
      const perf = await staffPerformance(ctx.orgId, q, viewer);
      const compact = {
        period: perf.period,
        previousPeriod: perf.previousPeriod,
        provisional: perf.provisional,
        hiddenPeople: perf.hiddenPeople,
        people: perf.rows.map((r) => ({
          name: r.name,
          role: r.role,
          loaded: r.loaded,
          prepared: r.prepared,
          completed: r.completed,
          delivered: r.delivered,
          valueBroughtIn: r.valueBroughtIn,
          averageOrderValue: r.averageOrderValue,
          wrongItemRatePercent: r.wrongItemRatePercent,
          kpis: r.kpis,
          change: r.change,
        })),
        team: { total: perf.team.total, benefit: perf.team.benefit },
        grossSettledSales: perf.grossSettledSales,
      };
      return { content: toContent(compact, role), evidence: PAGES.staffPerformance };
    }
    case "needs_a_look": {
      if (!isAtLeast(role, NEEDS_A_LOOK_MIN_ROLE)) return { content: outsideRole(NEEDS_A_LOOK_MIN_ROLE, "Needs a look") };
      const { listNeedsALook } = await import("../services/exceptionReviews");
      const inbox = await listNeedsALook(ctx.orgId, viewer, { state: input.state ?? "open", kind: input.kind ?? null });
      const byPerson = new Map<string, { name: string; role: string; count: number; amount: number }>();
      for (const item of inbox.items) {
        const key = item.subjectUserId ?? `unknown:${item.subjectName}`;
        const row = byPerson.get(key) ?? { name: item.subjectName, role: item.subjectRole, count: 0, amount: 0 };
        row.count += 1;
        row.amount += item.amount ?? 0;
        byPerson.set(key, row);
      }
      const summary = {
        state: input.state ?? "open",
        queues: inbox.queues,
        staleLine: inbox.staleLine,
        itemsListed: inbox.items.length,
        byPerson: [...byPerson.values()].sort((a, b) => b.count - a.count),
        recent: inbox.items.map((i) => ({
          kind: i.kind,
          orderRef: i.orderRef,
          person: i.subjectName,
          severity: i.severity,
          summary: i.summary,
          amount: i.amount,
          state: i.state,
          createdAt: i.createdAt,
        })),
      };
      return { content: toContent(summary, role), evidence: PAGES.needsALook };
    }
    case "price_overrides": {
      if (!isAtLeast(role, NEEDS_A_LOOK_MIN_ROLE)) return { content: outsideRole(NEEDS_A_LOOK_MIN_ROLE, "Price overrides") };
      const { priceOverrides } = await import("../services/priceOverrides");
      const { wouldHaveFlaggedRange } = await import("../services/priceExceptions");
      const { orgTimeZone } = await import("../services/tradingDayShift");
      const r = wouldHaveFlaggedRange(query(input), await orgTimeZone(ctx.orgId));
      return { content: toContent(await priceOverrides(ctx.orgId, viewer, r), role), evidence: PAGES.priceOverrides };
    }
    case "would_have_flagged": {
      if (!isAtLeast(role, WOULD_HAVE_FLAGGED_MIN_ROLE)) return { content: outsideRole(WOULD_HAVE_FLAGGED_MIN_ROLE, "Would have flagged") };
      const { wouldHaveFlagged, wouldHaveFlaggedRange } = await import("../services/priceExceptions");
      const { orgTimeZone } = await import("../services/tradingDayShift");
      const r = wouldHaveFlaggedRange(query(input), await orgTimeZone(ctx.orgId));
      return { content: toContent(await wouldHaveFlagged(ctx.orgId, r), role), evidence: PAGES.wouldHaveFlagged };
    }
    case "stock_levels": {
      // The Stock levels route's own path: the caller's resolved location and
      // the allow-listed row (no cost field exists on it to strip).
      const { resolveEditableStockLocationId } = await import("../services/stockLocationContext");
      const { storage } = await import("../storage");
      const { toStockLevelRow } = await import("@shared/stockLevels");
      const locationId = await resolveEditableStockLocationId({ orgId: ctx.orgId, locationId: ctx.locationId, userId: ctx.userId });
      const all = (await storage.getProductsWithStock(ctx.orgId, locationId)).map(toStockLevelRow);
      const needle = (input.search ?? "").trim().toLowerCase();
      const status = input.status ?? "any";
      const rows = all.filter(
        (r) =>
          (status === "any" || r.status === status) &&
          (!needle || r.name.toLowerCase().includes(needle) || r.sku.toLowerCase().includes(needle) || (r.barcode ?? "").includes(needle)),
      );
      const counts = { out: 0, low: 0, ok: 0 };
      for (const r of all) counts[r.status] += 1;
      return {
        content: toContent({ products: all.length, counts, matching: rows.length, rows: rows.map(({ id: _id, ...r }) => r) }, role),
        evidence: PAGES.stockLevels,
      };
    }
    case "staff_targets": {
      const { currentTargets } = await import("../services/staffTargets");
      const t = await currentTargets(ctx.orgId);
      const page = isAtLeast(role, "MANAGER") ? PAGES.staffTargets : { ...PAGES.myPerformance };
      return {
        content: toContent(t.current ? { version: t.current.version, setAt: t.current.setAt, targets: t.current.targets } : { targets: null, note: "No targets have been set." }, role),
        evidence: page,
      };
    }
    case "draft_order": {
      // Same engine arcarna Voice uses (server/assistant/engine.ts): read-only
      // customer/product lookups, never a save. A single request either
      // resolves cleanly (a named or "Walk-in" customer, at least one matched
      // product) or comes back asking for whatever was unclear — never guessed.
      const { runAssistantTurn } = await import("../assistant/engine");
      const { tillDraftFrom } = await import("../assistant/quickEntry");
      const result = await runAssistantTurn(ctx.orgId, null, String(input.text));
      if (result.draft?.status === "confirming") {
        return {
          content: JSON.stringify({ ready: true, message: "Opened in the till for the cashier to price and take payment." }),
          tillDraft: tillDraftFrom(result.draft),
        };
      }
      return { content: JSON.stringify({ ready: false, message: result.message, missingFields: result.missingFields }) };
    }
  }
}

const STATUS: Record<AskToolName, string> = {
  list_evidence: "Checking which Evidence you can see",
  run_evidence: "Reading Evidence",
  my_performance: "Reading My performance",
  staff_performance: "Reading Staff Performance",
  needs_a_look: "Reading Needs a look",
  price_overrides: "Reading Price overrides",
  would_have_flagged: "Reading Would have flagged",
  stock_levels: "Reading Stock levels",
  staff_targets: "Reading Staff targets",
  draft_order: "Working out the order",
};

export function isAskToolName(name: string): name is AskToolName {
  return Object.prototype.hasOwnProperty.call(INPUTS, name);
}

/** The "Reading …" line for a tool call, before it runs. */
export function askToolStatus(name: string, input: unknown): string {
  if (!isAskToolName(name)) return "Looking";
  if (name === "run_evidence") {
    const ref = typeof (input as { ref?: unknown })?.ref === "string" ? String((input as { ref: string }).ref).toUpperCase() : "";
    const entry = reportByRef(ref);
    if (entry) return `Reading ${entry.title}`;
  }
  return STATUS[name];
}

/**
 * Runs one tool call for the asker. Never throws: a bad input or a failing
 * service becomes an error result the model can explain, with no stack trace
 * or database text in it.
 */
export async function executeAskTool(name: string, rawInput: unknown, ctx: AskToolContext): Promise<AskToolResult> {
  const status = askToolStatus(name, rawInput);
  if (!isAskToolName(name)) {
    return { content: JSON.stringify({ error: `There is no tool called ${name}.` }), isError: true, audit: "unknown", status };
  }
  const parsed = INPUTS[name].safeParse(rawInput ?? {});
  if (!parsed.success) {
    // Eager input streaming hands over whatever was parsed; never run on it.
    return {
      content: JSON.stringify({ INVALID_JSON: JSON.stringify(rawInput ?? null), error: "The input did not match the tool's schema." }),
      isError: true,
      audit: name,
      status,
    };
  }
  const audit = name === "run_evidence" ? `run_evidence:${String((parsed.data as { ref: string }).ref).toUpperCase()}` : name;
  try {
    return { ...(await run(name, parsed.data, ctx)), audit, status };
  } catch (error) {
    const message = plainMessage(error);
    if (!message) console.error(`[Ask] tool ${name} failed:`, (error as Error)?.name ?? "error");
    return {
      content: JSON.stringify({ error: message ?? "That Evidence could not be read just now. Say so; do not guess the figures." }),
      isError: true,
      audit,
      status,
    };
  }
}
