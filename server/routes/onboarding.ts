import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import {
  completedOnboardingCount,
  isOnboardingComplete,
  nextOnboardingStep,
  ONBOARDING_STEPS,
  parseOnboardingState,
  patchOnboardingStepSchema,
  type OnboardingState,
} from "@shared/onboarding";

function buildOnboardingResponse(org: { onboardingState?: unknown }) {
  const state = parseOnboardingState(org.onboardingState);
  return {
    state,
    steps: ONBOARDING_STEPS,
    nextStep: nextOnboardingStep(state),
    completedCount: completedOnboardingCount(state),
    totalSteps: ONBOARDING_STEPS.length,
    isComplete: isOnboardingComplete(state),
  };
}

function mergeStep(state: OnboardingState, step: string, completed: boolean, draft?: Record<string, unknown>): OnboardingState {
  const completedSteps = new Set(state.completedSteps);
  if (completed) completedSteps.add(step);
  else completedSteps.delete(step);
  return {
    ...state,
    completedSteps: [...completedSteps],
    currentStep: step,
    draft: draft ? { ...state.draft, ...draft } : state.draft,
  };
}

export function registerOnboardingRoutes(app: Express, scoped: RequestHandler[]): void {
  app.get("/api/onboarding", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const org = await storage.getOrganization(ctx.orgId);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      res.json(buildOnboardingResponse(org));
    } catch (error) {
      console.error("[onboarding] GET", error);
      res.status(500).json({ message: "Failed to load onboarding" });
    }
  });

  app.patch("/api/onboarding/step", ...scoped, async (req: any, res) => {
    try {
      const parsed = patchOnboardingStepSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid step payload", errors: parsed.error.errors });
      }
      const ctx = req.orgContext as { orgId: string };
      const org = await storage.getOrganization(ctx.orgId);
      if (!org) return res.status(404).json({ message: "Organization not found" });

      const prev = parseOnboardingState(org.onboardingState);
      const next = mergeStep(prev, parsed.data.step, parsed.data.completed, parsed.data.draft);
      const updated = await storage.updateOnboardingState(ctx.orgId, next as Record<string, unknown>);
      res.json(buildOnboardingResponse(updated));
    } catch (error) {
      console.error("[onboarding] PATCH step", error);
      res.status(500).json({ message: "Failed to update onboarding step" });
    }
  });

  /** Marks first-sale complete after client runs test checkout (or skip in dev). */
  app.post("/api/onboarding/complete-first-sale", ...scoped, async (req: any, res) => {
    try {
      const ctx = req.orgContext as { orgId: string };
      const org = await storage.getOrganization(ctx.orgId);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      const prev = parseOnboardingState(org.onboardingState);
      const next = mergeStep(prev, "first-sale", true);
      const updated = await storage.updateOnboardingState(ctx.orgId, next as Record<string, unknown>);
      res.json(buildOnboardingResponse(updated));
    } catch (error) {
      console.error("[onboarding] complete-first-sale", error);
      res.status(500).json({ message: "Failed to complete first-sale step" });
    }
  });
}
