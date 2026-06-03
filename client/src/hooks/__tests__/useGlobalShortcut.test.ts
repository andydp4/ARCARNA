import { describe, expect, it } from "vitest";
import {
  getVisibleCommandPaletteActions,
  isCommandPaletteActionAllowed,
} from "@shared/commandPaletteActions";
import { isEditableTarget, shouldOpenCommandPalette } from "../useGlobalShortcut";

describe("useGlobalShortcut helpers", () => {
  it("opens on Cmd/Ctrl+K outside editable fields", () => {
    expect(
      shouldOpenCommandPalette({ key: "k", metaKey: true, ctrlKey: false }, { tagName: "BODY" }),
    ).toBe(true);
    expect(
      shouldOpenCommandPalette({ key: "k", metaKey: false, ctrlKey: true }, { tagName: "DIV" }),
    ).toBe(true);
  });

  it("ignores Cmd/Ctrl+K while typing in inputs", () => {
    expect(
      shouldOpenCommandPalette(
        { key: "k", metaKey: true, ctrlKey: false },
        { tagName: "INPUT", isContentEditable: false },
      ),
    ).toBe(false);
    expect(
      shouldOpenCommandPalette(
        { key: "k", metaKey: true, ctrlKey: false },
        { tagName: "TEXTAREA", isContentEditable: false },
      ),
    ).toBe(false);
    expect(
      shouldOpenCommandPalette(
        { key: "k", metaKey: true, ctrlKey: false },
        { tagName: "DIV", isContentEditable: true },
      ),
    ).toBe(false);
  });

  it("ignores unrelated keys", () => {
    expect(
      shouldOpenCommandPalette({ key: "j", metaKey: true, ctrlKey: false }, { tagName: "BODY" }),
    ).toBe(false);
    expect(
      shouldOpenCommandPalette({ key: "k", metaKey: false, ctrlKey: false }, { tagName: "BODY" }),
    ).toBe(false);
  });

  it("detects editable targets", () => {
    expect(isEditableTarget({ tagName: "input" })).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("commandPaletteActions role gating", () => {
  it("allows cashiers basic actions but not manager-only settings", () => {
    const cashierActions = getVisibleCommandPaletteActions("CASHIER");
    expect(cashierActions.some((a) => a.id === "action-create-order")).toBe(true);
    expect(cashierActions.some((a) => a.id === "action-settings")).toBe(false);
    expect(isCommandPaletteActionAllowed({ id: "x", label: "x", href: "/x", minRole: "MANAGER" }, "CASHIER")).toBe(
      false,
    );
  });
});
