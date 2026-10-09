import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let cachedSource: string | undefined;

export function getGsapBundleSource(): string {
  if (cachedSource === undefined) {
    try {
      cachedSource = readFileSync(require.resolve("gsap/dist/gsap.min.js"), "utf8").replace(
        /<\/script/gi,
        "<\\/script",
      );
    } catch (error) {
      throw new Error("GSAP bundleを解決できません。gsapのインストールを確認してください。", {
        cause: error,
      });
    }
  }
  return cachedSource;
}
