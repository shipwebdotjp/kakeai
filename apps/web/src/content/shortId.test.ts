import { describe, expect, it } from "vitest";
import { createEmptyLine, newLineId, newSceneId } from "./form";

function allHexTokens(length: number): string[] {
  const total = 16 ** length;
  return Array.from({ length: total }, (_, value) =>
    value.toString(16).padStart(length, "0"),
  );
}

describe("短縮ID", () => {
  it("シーンIDは scene-point-<hex> 形式", () => {
    expect(newSceneId(new Set())).toMatch(/^scene-point-[0-9a-f]{3,}$/);
  });

  it("line IDは所属シーンの短縮トークンを含む", () => {
    expect(newLineId("scene-point-a3f", new Set())).toMatch(/^line-a3f-[0-9a-f]{3,}$/);
    expect(newLineId("scene-intro", new Set())).toMatch(/^line-intro-[0-9a-f]{3,}$/);
  });

  it("渡した既存IDとは重複しない", () => {
    const existing = new Set(["scene-point-abc"]);
    expect(newSceneId(existing)).not.toBe("scene-point-abc");
    const lineExisting = new Set(["line-a3f-1ff"]);
    expect(newLineId("scene-point-a3f", lineExisting)).not.toBe("line-a3f-1ff");
  });

  it("既存IDで埋まっている場合は桁を増やす", () => {
    const existing = new Set(allHexTokens(3).map((token) => `scene-point-${token}`));
    expect(newSceneId(existing)).toMatch(/^scene-point-[0-9a-f]{4,}$/);
  });

  it("衝突回避したline IDが1つの文書として重複しない", () => {
    const existing = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const line = createEmptyLine("scene-point-a3f", existing);
      existing.add(line.id);
    }
    expect(existing.size).toBe(200);
  });
});
