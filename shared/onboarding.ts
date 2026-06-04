import { z } from "zod";

/** Five setup steps before the done screen (brief U6). */
export const ONBOARDING_STEPS = [
  "org",
  "currency",
  "location",
  "product",
  "first-sale",
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

export const onboardingStateSchema = z.object({
  completedSteps: z.array(z.string()).default([]),
  currentStep: z.string().optional(),
  draft: z.record(z.unknown()).optional(),
});

export type OnboardingState = z.infer<typeof onboardingStateSchema>;

export function parseOnboardingState(raw: unknown): OnboardingState {
  const parsed = onboardingStateSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { completedSteps: [] };
}

export function isOnboardingComplete(state: OnboardingState): boolean {
  return ONBOARDING_STEPS.every((s) => state.completedSteps.includes(s));
}

export function nextOnboardingStep(state: OnboardingState): OnboardingStepId | "done" {
  for (const step of ONBOARDING_STEPS) {
    if (!state.completedSteps.includes(step)) return step;
  }
  return "done";
}

export function completedOnboardingCount(state: OnboardingState): number {
  return ONBOARDING_STEPS.filter((s) => state.completedSteps.includes(s)).length;
}

export const patchOnboardingStepSchema = z.object({
  step: z.enum(ONBOARDING_STEPS),
  completed: z.boolean(),
  draft: z.record(z.unknown()).optional(),
});

export const CURRENCY_PRESETS = [
  { code: "GBP", symbol: "£", label: "British Pound" },
  { code: "EUR", symbol: "€", label: "Euro" },
  { code: "USD", symbol: "$", label: "US Dollar" },
] as const;
