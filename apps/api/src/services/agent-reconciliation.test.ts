import { describe, expect, it } from "vitest";
import { compareReconciliationRows } from "./agent-reconciliation";

describe("reconciliation difference counts", () => {
  it("counts a changed record once, missing and unexpected records separately, regardless of ordering", () => {
    const expected = [
      { id: "a", value: 1 },
      { id: "b", value: 2 },
      { id: "c", value: 3 },
    ];
    const stored = [
      { id: "d", value: 4 },
      { id: "b", value: 9 },
      { id: "a", value: 1 },
    ];
    expect(
      compareReconciliationRows(
        expected,
        stored,
        (row) => row.id,
        (a, b) => a.value === b.value,
      ),
    ).toEqual({
      expectedCount: 3,
      storedCount: 3,
      missingCount: 1,
      unexpectedCount: 1,
      mismatchCount: 1,
    });
  });
});
