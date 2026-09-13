/**
 * `POST /api/orders/:id/transition` — route-level behaviour (Phase N, N3b;
 * server/routes/orderTransitions.ts). The service layer
 * (`server/services/orderTransitions.ts`) is mocked here: this file proves
 * body validation and the error → status/code mapping the brief's API
 * section specifies, not the state machine itself (that is
 * `orderTransitionRoles.test.ts`, `completionSinglePath.test.ts` and
 * `reopenResettle.test.ts`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestHandler } from "express";

vi.mock("../db", () => ({ db: {} }));
vi.mock("../storage", () => ({ storage: {} }));

const { runOrderTransition } = vi.hoisted(() => ({ runOrderTransition: vi.fn() }));
vi.mock("../services/orderTransitions", async () => {
  const actual = await vi.importActual<typeof import("../services/orderTransitions")>(
    "../services/orderTransitions",
  );
  return { ...actual, runOrderTransition };
});
vi.mock("../middleware/requireActiveCashierShift", () => ({
  attachActiveCashierShift: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireActiveCashierShift: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import { registerOrderTransitionRoutes } from "../routes/orderTransitions";
import { CreditError } from "../services/creditLedger";
import { OrderReopenRefusedError } from "../services/orderCompletion";
import {
  OpsTransitionError,
  OrderAlreadyAssignedError,
  OrderNotFoundError,
  TransitionBadRequestError,
  TransitionForbiddenError,
} from "../services/orderTransitions";

function captureRoutes(register: (app: any, scoped: RequestHandler[]) => void) {
  const routes: Record<string, RequestHandler[]> = {};
  register(
    {
      post: (path: string, ...handlers: RequestHandler[]) => (routes[`POST ${path}`] = handlers),
    } as any,
    [],
  );
  return routes;
}

function fakeRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json } as any;
}

const routes = captureRoutes(registerOrderTransitionRoutes);
const handler = routes["POST /api/orders/:id/transition"][routes["POST /api/orders/:id/transition"].length - 1];

function baseReq(overrides: Record<string, unknown> = {}) {
  return {
    orgContext: { orgId: "org-1" },
    user: { id: "sam", role: "CASHIER" },
    params: { id: "order-1" },
    body: { action: "claim" },
    ...overrides,
  } as any;
}

beforeEach(() => {
  runOrderTransition.mockReset();
});

describe("body validation", () => {
  it("400s on an invalid action", async () => {
    const res = fakeRes();
    await handler(baseReq({ body: { action: "not-a-real-action" } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(runOrderTransition).not.toHaveBeenCalled();
  });

  it("400s with no org context", async () => {
    const res = fakeRes();
    await handler(baseReq({ orgContext: { orgId: null } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("401s with no signed-in actor", async () => {
    const res = fakeRes();
    await handler(baseReq({ user: undefined }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("passes the parsed body straight through as `input` on success", async () => {
    runOrderTransition.mockResolvedValue({ order: { id: "order-1" }, event: null, changed: false });
    const res = fakeRes();
    await handler(baseReq({ body: { action: "set_due", dueInMinutes: 15 } }), res, vi.fn());
    expect(runOrderTransition).toHaveBeenCalledWith({
      orgId: "org-1",
      orderId: "order-1",
      actor: { userId: "sam", role: "CASHIER", cashierShift: null },
      input: { action: "set_due", dueInMinutes: 15 },
    });
    expect(res.json).toHaveBeenCalledWith({ order: { id: "order-1" }, event: null, changed: false });
  });
});

describe("error → status/code mapping", () => {
  it("OrderNotFoundError → 404", async () => {
    runOrderTransition.mockRejectedValue(new OrderNotFoundError());
    const res = fakeRes();
    await handler(baseReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("TransitionForbiddenError → 403 with its code", async () => {
    runOrderTransition.mockRejectedValue(new TransitionForbiddenError("nope"));
    const res = fakeRes();
    await handler(baseReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "ORDER_TRANSITION_FORBIDDEN" }));
  });

  it("OrderAlreadyAssignedError → 409 ORDER_ALREADY_ASSIGNED, naming the winner", async () => {
    runOrderTransition.mockRejectedValue(new OrderAlreadyAssignedError("ana", "Ana"));
    const res = fakeRes();
    await handler(baseReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ORDER_ALREADY_ASSIGNED", assignedUserId: "ana", assignedUserName: "Ana" }),
    );
  });

  it("OpsTransitionError (illegal transition, N0) → 409 ORDER_TRANSITION_INVALID", async () => {
    runOrderTransition.mockRejectedValue(new OpsTransitionError("cannot do that"));
    const res = fakeRes();
    await handler(baseReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "ORDER_TRANSITION_INVALID" }));
  });

  it("OrderReopenRefusedError → 409 with its own code (e.g. ORDER_REOPEN_CLOSED_DAY)", async () => {
    runOrderTransition.mockRejectedValue(new OrderReopenRefusedError("closed", "ORDER_REOPEN_CLOSED_DAY"));
    const res = fakeRes();
    await handler(baseReq({ body: { action: "reopen" } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "ORDER_REOPEN_CLOSED_DAY" }));
  });

  it("TransitionBadRequestError → 400 with its code", async () => {
    runOrderTransition.mockRejectedValue(new TransitionBadRequestError("bad input", "SOME_CODE"));
    const res = fakeRes();
    await handler(baseReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "SOME_CODE" }));
  });

  it("CreditError → its own status and code (e.g. 400 CREDIT_CUSTOMER_REQUIRED)", async () => {
    runOrderTransition.mockRejectedValue(new CreditError("needs a customer", 400, "CREDIT_CUSTOMER_REQUIRED"));
    const res = fakeRes();
    await handler(baseReq({ body: { action: "complete" } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "CREDIT_CUSTOMER_REQUIRED" }));
  });

  it("an unrecognised error → 500", async () => {
    runOrderTransition.mockRejectedValue(new Error("boom"));
    const res = fakeRes();
    await handler(baseReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
