import { describe, expect, it } from "vitest";
import { applyViewState, captureViewState } from "@shared/savedViews/state";

describe("savedViews state", () => {
  it("captures filter + sort", () => {
    expect(captureViewState({ searchTerm: "alice" }, { column: "name", direction: "asc" })).toEqual({
      filters: { searchTerm: "alice" },
      sort: { column: "name", direction: "asc" },
    });
  });

  it("applies saved filters onto defaults", () => {
    const result = applyViewState(
      { filters: { searchTerm: "bob" }, sort: {} },
      { searchTerm: "", category: "Bronze" },
    );
    expect(result).toEqual({ searchTerm: "bob", category: "Bronze" });
  });
});
