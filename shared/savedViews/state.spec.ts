import { describe, expect, it } from "vitest";
import { captureViewState } from "@shared/savedViews/state";

describe("savedViews state", () => {
  it("captures filter + sort", () => {
    expect(captureViewState({ searchTerm: "alice" }, { column: "name", direction: "asc" })).toEqual({
      filters: { searchTerm: "alice" },
      sort: { column: "name", direction: "asc" },
    });
  });
});
