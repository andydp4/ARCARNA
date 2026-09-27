import { describe, expect, it } from "vitest";
import { buildRotaPdf, rotaCellLines, rotaPdfFileName, shortDate, type RotaPdfGrid } from "../rotaPdf";

const A4_LANDSCAPE_WIDTH = 841.89;

function dates(from: string, n: number): string[] {
  const [y, m, d] = from.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
}

function grid(peopleCount: number): RotaPdfGrid {
  const ds = dates("2026-09-28", 14); // Mon 28/9 … Sun 11/10
  const people = Array.from({ length: peopleCount }, (_, p) => ({
    name: p === 0 ? "Worker A" : `Person ${p}`,
    days: ds.map((date, i) => {
      if (p === 0 && i === 4) {
        // Fri 2/10: the owner's split day — overnight plus evening.
        return {
          date,
          status: "working" as const,
          startTime: "00:00",
          endTime: "00:00",
          shifts: [
            { startTime: "00:00", endTime: "08:00" },
            { startTime: "16:00", endTime: "00:00" },
          ],
        };
      }
      if (i === 2) return { date, status: "off" as const, startTime: null, endTime: null, shifts: [] };
      if (i % 2 === 0) return { date, status: "working" as const, startTime: "12:00", endTime: "20:00", shifts: [{ startTime: "12:00", endTime: "20:00" }] };
      return { date, status: "unscheduled" as const, startTime: null, endTime: null, shifts: [] };
    }),
  }));
  return { dates: ds, people, headcountByDate: Object.fromEntries(ds.map((d) => [d, peopleCount])) };
}

/** Every text draw in the (uncompressed) PDF: its x position and string. */
function textDraws(raw: string): Array<{ x: number; text: string }> {
  return [...raw.matchAll(/([\d.]+) [\d.]+ Td\n\((.*?)\) Tj/g)].map((m) => ({ x: Number(m[1]), text: m[2] }));
}

describe("rotaCellLines", () => {
  it("lists every shift on a split day, not just the first", () => {
    expect(
      rotaCellLines({
        date: "d",
        status: "working",
        startTime: "00:00",
        endTime: "00:00",
        shifts: [
          { startTime: "00:00", endTime: "08:00" },
          { startTime: "16:00", endTime: "00:00" },
        ],
      }),
    ).toEqual(["00:00-08:00", "16:00-00:00"]);
  });

  it("falls back to start/end when shifts are absent", () => {
    expect(rotaCellLines({ date: "d", status: "working", startTime: "09:00", endTime: "17:00" })).toEqual(["09:00-17:00"]);
  });

  it("prints Off for a day off and nothing for an unscheduled day", () => {
    expect(rotaCellLines({ date: "d", status: "off", startTime: null, endTime: null })).toEqual(["Off"]);
    expect(rotaCellLines({ date: "d", status: "unscheduled", startTime: null, endTime: null })).toEqual([]);
  });
});

describe("buildRotaPdf", () => {
  const generatedAt = new Date(2026, 8, 27, 9, 30);

  it("fits all 14 days across one A4 landscape page for a normal team", () => {
    const pdf = buildRotaPdf(grid(6), { orgName: "Test Shop", generatedAt, compress: false });
    expect(pdf.getNumberOfPages()).toBe(1);

    const draws = textDraws(pdf.output());
    const texts = draws.map((d) => d.text);
    // Both ends of the fortnight are on the sheet — the first print lost Fri and Sat.
    expect(texts).toContain("28/9");
    expect(texts).toContain("11/10");
    expect(texts.filter((t) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].includes(t))).toHaveLength(14);
    // Nothing is drawn past the right-hand margin.
    for (const d of draws) expect(d.x).toBeLessThan(A4_LANDSCAPE_WIDTH - 20);
  });

  it("prints both halves of a split shift and marks days off", () => {
    const raw = buildRotaPdf(grid(2), { generatedAt, compress: false }).output();
    const texts = textDraws(raw).map((d) => d.text);
    expect(texts).toContain("00:00-08:00");
    expect(texts).toContain("16:00-00:00");
    expect(texts).toContain("Off");
  });

  it("runs a long roster onto further pages and repeats the day header on each", () => {
    const pdf = buildRotaPdf(grid(40), { generatedAt, compress: false });
    const pages = pdf.getNumberOfPages();
    expect(pages).toBeGreaterThan(1);
    const texts = textDraws(pdf.output()).map((d) => d.text);
    expect(texts.filter((t) => t === "Staff")).toHaveLength(pages);
    expect(texts).toContain(`arcarna  ·  page ${pages} of ${pages}`);
  });

  it("says so when nobody is on the roster rather than printing an empty table", () => {
    const texts = textDraws(buildRotaPdf({ dates: dates("2026-09-28", 14), people: [], headcountByDate: {} }, { generatedAt, compress: false }).output()).map((d) => d.text);
    expect(texts).toContain("Nobody on the roster yet.");
  });

  it("names the file after the first date on the sheet", () => {
    expect(rotaPdfFileName({ dates: ["2026-09-28"] })).toBe("rota-2026-09-28.pdf");
    expect(shortDate("2026-10-05")).toBe("5/10");
  });
});
