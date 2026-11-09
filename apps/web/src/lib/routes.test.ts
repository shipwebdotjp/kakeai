import { describe, expect, it } from "vitest";
import { liveRunNewRoute } from "./routes";

describe("live run routes", () => {
  it("keeps the export-only and run-creation destinations distinct", () => {
    const exportUrl = liveRunNewRoute({
      programId: "program-1",
      programVersionId: "version-1",
      mode: "export",
    });
    const runUrl = liveRunNewRoute({
      programId: "program-1",
      programVersionId: "version-1",
    });

    expect(exportUrl).toContain("mode=export");
    expect(runUrl).not.toContain("mode=");
    expect(exportUrl).not.toBe(runUrl);
  });
});
