import { describe, expect, it } from "vitest";
import { aggregateChannelAttribution, normalizeChannel } from "./channelAttribution";

describe("normalizeChannel", () => {
  it("defaults empty to pos", () => {
    expect(normalizeChannel("")).toBe("pos");
    expect(normalizeChannel(undefined)).toBe("pos");
  });
});

describe("aggregateChannelAttribution", () => {
  it("returns empty when no completed orders", () => {
    expect(aggregateChannelAttribution([])).toEqual([]);
  });

  it("groups revenue and computes share", () => {
    const rows = aggregateChannelAttribution([
      { channel: "pos", total: 100, status: "completed" },
      { channel: "web", total: 50, status: "completed" },
      { channel: "pos", total: 50, status: "completed" },
      { channel: "web", total: 10, status: "cancelled" },
    ]);
    expect(rows).toHaveLength(2);
    const pos = rows.find((r) => r.channel === "pos");
    expect(pos?.orderCount).toBe(2);
    expect(pos?.revenue).toBe(150);
    expect(pos?.sharePct).toBe(75);
  });
});
