import { describe, expect, it } from "vitest";
import { FontCatalogService, type FontCatalogAdapter } from "./font-catalog.ts";
import type { FontFace } from "@kakeai/contracts";

class CountingAdapter implements FontCatalogAdapter {
  calls = 0;
  constructor(private readonly faces: FontFace[] = []) {}
  async getCatalog() {
    this.calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { supported: true, faces: this.faces, reason: null };
  }
}

describe("FontCatalogService", () => {
  it("shares one in-flight fetch between concurrent callers", async () => {
    const adapter = new CountingAdapter();
    const service = new FontCatalogService(adapter);
    const [first, second] = await Promise.all([service.getCatalog(), service.getCatalog()]);
    expect(adapter.calls).toBe(1);
    expect(first).toBe(second);
  });

  it("serves the cached catalog sequentially and refetches on forceRefresh", async () => {
    const adapter = new CountingAdapter();
    const service = new FontCatalogService(adapter);
    const first = await service.getCatalog();
    const second = await service.getCatalog();
    expect(adapter.calls).toBe(1);
    expect(second).toBe(first);
    await service.getCatalog(true);
    expect(adapter.calls).toBe(2);
  });
});
