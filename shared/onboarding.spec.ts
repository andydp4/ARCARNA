import { describe, expect, it } from "vitest";
import {
  completedOnboardingCount,
  isOnboardingComplete,
  nextOnboardingStep,
  parseOnboardingState,
} from "./onboarding";

describe("onboarding state", () => {
  it("parses empty state", () => {
    expect(parseOnboardingState(null)).toEqual({ completedSteps: [] });
  });

  it("computes next step", () => {
    const state = parseOnboardingState({ completedSteps: ["org", "currency"] });
    expect(nextOnboardingStep(state)).toBe("location");
  });

  it("detects complete", () => {
    const state = parseOnboardingState({
      completedSteps: ["org", "currency", "location", "product", "first-sale"],
    });
    expect(isOnboardingComplete(state)).toBe(true);
    expect(nextOnboardingStep(state)).toBe("done");
    expect(completedOnboardingCount(state)).toBe(5);
  });
});
