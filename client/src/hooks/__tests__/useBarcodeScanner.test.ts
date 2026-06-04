import { describe, expect, it } from "vitest";
import { consumeScannerBurst, isEditableTarget } from "../useBarcodeScanner";

describe("useBarcodeScanner helpers", () => {
  it("ignores editable targets", () => {
    expect(isEditableTarget({ tagName: "INPUT" } as HTMLElement)).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true } as HTMLElement)).toBe(true);
    expect(isEditableTarget({ tagName: "BUTTON" } as HTMLElement)).toBe(false);
  });

  it("detects fast scanner burst ending with Enter", () => {
    const events = [
      { key: "1", timeStamp: 100 },
      { key: "2", timeStamp: 110 },
      { key: "3", timeStamp: 120 },
      { key: "4", timeStamp: 125 },
      { key: "5", timeStamp: 130 },
      { key: "6", timeStamp: 135 },
      { key: "Enter", timeStamp: 140 },
    ];
    const { code } = consumeScannerBurst(events, 140);
    expect(code).toBe("123456");
  });

  it("rejects slow human typing", () => {
    const events = [
      { key: "1", timeStamp: 100 },
      { key: "2", timeStamp: 200 },
      { key: "3", timeStamp: 300 },
      { key: "Enter", timeStamp: 400 },
    ];
    const { code } = consumeScannerBurst(events, 400);
    expect(code).toBeNull();
  });
});
