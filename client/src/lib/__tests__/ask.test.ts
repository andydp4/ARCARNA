import { describe, expect, it } from "vitest";
import { parseAskEvents } from "../ask";

describe("Ask arcarna stream parsing", () => {
  it("reads whole events and keeps a half-received one for the next chunk", () => {
    const first = parseAskEvents('data: {"type":"text","text":"Hel"}\n\ndata: {"type":"te');
    expect(first.events).toEqual([{ type: "text", text: "Hel" }]);
    const second = parseAskEvents(`${first.rest}xt","text":"lo"}\n\ndata: {"type":"done","outcome":"answered","evidence":[]}\n\n`);
    expect(second.events).toEqual([
      { type: "text", text: "lo" },
      { type: "done", outcome: "answered", evidence: [] },
    ]);
    expect(second.rest).toBe("");
  });

  it("skips anything that is not a JSON data line", () => {
    expect(parseAskEvents(": ping\n\ndata: not json\n\n").events).toEqual([]);
  });
});
