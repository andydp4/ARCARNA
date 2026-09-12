/**
 * The legality table from docs/briefs/PHASE_N_OPERATIONS_CENTRE.md
 * "Legality", plus the zod schema every transition body is validated
 * against.
 */
import { describe, expect, it } from "vitest";
import {
  OpsTransitionError,
  TRANSITION_ACTIONS,
  assertTransition,
  transitionOrderSchema,
  type TransitionableOrder,
} from "./opsTransitions";

function order(overrides: Partial<TransitionableOrder> = {}): TransitionableOrder {
  return { status: "pending", fulfilmentMethod: "collection", etaGiven: null, ...overrides };
}

describe("a completed order accepts only reopen", () => {
  for (const action of TRANSITION_ACTIONS.filter((a) => a !== "reopen")) {
    it(`refuses "${action}"`, () => {
      expect(() => assertTransition(order({ status: "completed" }), action)).toThrow(OpsTransitionError);
    });
  }

  it("accepts reopen", () => {
    expect(() => assertTransition(order({ status: "completed" }), "reopen")).not.toThrow();
  });
});

describe("reopen is only valid on a completed order", () => {
  for (const status of ["pending", "on-hold", "awaiting-customer", "urgent"]) {
    it(`refuses reopen when status is "${status}"`, () => {
      expect(() => assertTransition(order({ status }), "reopen")).toThrow(OpsTransitionError);
    });
  }
});

describe("arrived and out_for_delivery are fulfilment-specific", () => {
  it("arrived is legal on a collection order", () => {
    expect(() => assertTransition(order({ fulfilmentMethod: "collection" }), "arrived")).not.toThrow();
  });

  it("arrived is illegal on a delivery order", () => {
    expect(() => assertTransition(order({ fulfilmentMethod: "delivery" }), "arrived")).toThrow(OpsTransitionError);
  });

  it("out_for_delivery is legal on a delivery order", () => {
    expect(() => assertTransition(order({ fulfilmentMethod: "delivery" }), "out_for_delivery")).not.toThrow();
  });

  it("out_for_delivery is illegal on a collection order", () => {
    expect(() => assertTransition(order({ fulfilmentMethod: "collection" }), "out_for_delivery")).toThrow(
      OpsTransitionError,
    );
  });
});

describe("set_due is one-shot", () => {
  it("is legal while no promise exists yet", () => {
    expect(() => assertTransition(order({ etaGiven: null }), "set_due")).not.toThrow();
  });

  it("is illegal once a promise already exists — that is a delay, not a first due time", () => {
    expect(() => assertTransition(order({ etaGiven: "2026-01-12T14:00:00.000Z" }), "set_due")).toThrow(
      OpsTransitionError,
    );
  });
});

describe("every other action is legal on an open order regardless of fulfilment or promise", () => {
  const openActions = TRANSITION_ACTIONS.filter(
    (a) => !["reopen", "arrived", "out_for_delivery", "set_due"].includes(a),
  );
  for (const action of openActions) {
    for (const fulfilmentMethod of ["collection", "delivery"] as const) {
      it(`allows "${action}" on an open ${fulfilmentMethod} order`, () => {
        expect(() => assertTransition(order({ fulfilmentMethod }), action)).not.toThrow();
      });
    }
  }
});

describe("every illegal transition raises the one shared code", () => {
  it("uses ORDER_TRANSITION_INVALID", () => {
    try {
      assertTransition(order({ status: "completed" }), "hold");
      throw new Error("expected assertTransition to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(OpsTransitionError);
      expect((error as OpsTransitionError).code).toBe("ORDER_TRANSITION_INVALID");
    }
  });
});

describe("transitionOrderSchema", () => {
  it("accepts a bare claim", () => {
    expect(transitionOrderSchema.safeParse({ action: "claim" }).success).toBe(true);
  });

  it("accepts set_due with dueInMinutes", () => {
    expect(transitionOrderSchema.safeParse({ action: "set_due", dueInMinutes: 15 }).success).toBe(true);
  });

  it("accepts set_due with a 24-hour dueTime", () => {
    expect(transitionOrderSchema.safeParse({ action: "set_due", dueTime: "14:30" }).success).toBe(true);
  });

  it("rejects a dueTime that is not 24-hour HH:MM", () => {
    expect(transitionOrderSchema.safeParse({ action: "set_due", dueTime: "2:30 PM" }).success).toBe(false);
    expect(transitionOrderSchema.safeParse({ action: "set_due", dueTime: "24:00" }).success).toBe(false);
  });

  it("rejects an unknown action", () => {
    expect(transitionOrderSchema.safeParse({ action: "delete_everything" }).success).toBe(false);
  });

  it("rejects a missing action", () => {
    expect(transitionOrderSchema.safeParse({}).success).toBe(false);
  });

  it("accepts complete with a label and an actual time", () => {
    const result = transitionOrderSchema.safeParse({
      action: "complete",
      label: "delivered",
      actualAt: "2026-01-12T14:05:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a label that is not handed_over or delivered", () => {
    expect(transitionOrderSchema.safeParse({ action: "complete", label: "shipped" }).success).toBe(false);
  });
});
