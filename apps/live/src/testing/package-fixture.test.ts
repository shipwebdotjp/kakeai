import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createTestPackage, testRunConfig, type TestPackage } from "./package-fixture.ts";

const packages: TestPackage[] = [];

afterEach(async () => {
  await Promise.all(packages.splice(0).map((pkg) => pkg.cleanup()));
});

describe("testRunConfig", () => {
  it("builds a YouTube run without a fixture file", async () => {
    const pkg = await createTestPackage();
    packages.push(pkg);

    const run = await testRunConfig(pkg, { source: "youtube" });

    expect(run.source).toEqual({
      kind: "youtube",
      videoUrl: "https://www.youtube.com/watch?v=test",
      liveChatId: null,
    });
  });

  it("records the package fixture hash for a fixture run", async () => {
    const pkg = await createTestPackage({ includeCommentCorner: true });
    packages.push(pkg);

    const run = await testRunConfig(pkg);
    expect(run.source.kind).toBe("fixture");
    if (run.source.kind !== "fixture") {
      return;
    }

    const bytes = await readFile(run.source.fixturePath);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(run.source.fixtureSha256);
  });
});
