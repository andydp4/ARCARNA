/**
 * Phone pickers vs the keyboard-closing fix (v1.2 Phase 3, CMP-11).
 *
 * On Android, raising the on-screen keyboard resizes the viewport and moves
 * focus, and a Radix Select / Popover / DropdownMenu treats both as "close".
 * So a search box placed inside one of those floating layers closes the
 * picker the moment it is tapped (#173: the till's customer picker). The fix
 * was to build searchable pickers as inline content in the page's own DOM
 * (CustomerPicker in pos-cart-panel.tsx, ProductSearch in pos-order-lines.tsx).
 *
 * This walks every page and component and fails if any text field sits inside
 * one of those floating layers again. Dialogs and sheets are fine: they do
 * not dismiss on resize or focus moving within them.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const FLOATING = ["SelectContent", "PopoverContent", "DropdownMenuContent", "MenubarContent", "HoverCardContent"];
const TEXT_FIELD = /<(Input|input|Textarea|textarea|CommandInput)\b/;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "ui" || name === "__tests__") continue; // primitives, not pickers
      out.push(...tsxFiles(full));
    } else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("phone pickers", () => {
  it("never put a text field inside a Select, Popover or menu", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(ROOT)) {
      const src = readFileSync(file, "utf8");
      for (const tag of FLOATING) {
        const open = new RegExp(`<${tag}\\b`, "g");
        let m: RegExpExecArray | null;
        while ((m = open.exec(src))) {
          const end = src.indexOf(`</${tag}>`, m.index);
          if (end === -1) continue;
          if (TEXT_FIELD.test(src.slice(m.index, end))) {
            const line = src.slice(0, m.index).split("\n").length;
            offenders.push(`${path.relative(ROOT, file)}:${line} (${tag})`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
