import { describe, expect, it } from "vitest";
import {
  dataDirectories,
  databaseFilePath,
  resolveDataRoot,
  toSqliteUrl,
} from "./paths.ts";

describe("resolveDataRoot", () => {
  it("uses KAKEAI_DATA_DIR when set", () => {
    const root = resolveDataRoot({ KAKEAI_DATA_DIR: "/tmp/kakeai-dev" }, "darwin", "/Users/me");
    expect(root).toBe("/tmp/kakeai-dev");
  });

  it("resolves a relative KAKEAI_DATA_DIR against the working directory", () => {
    const root = resolveDataRoot({ KAKEAI_DATA_DIR: "data" }, "darwin", "/Users/me");
    expect(root).toBe(`${process.cwd()}/data`);
  });

  it("defaults to Application Support on macOS", () => {
    const root = resolveDataRoot({}, "darwin", "/Users/me");
    expect(root).toBe("/Users/me/Library/Application Support/Kakeai");
  });

  it("defaults to XDG data home on other platforms", () => {
    const root = resolveDataRoot({}, "linux", "/home/me");
    expect(root).toBe("/home/me/.local/share/kakeai");
    const xdg = resolveDataRoot({ XDG_DATA_HOME: "/home/me/.data" }, "linux", "/home/me");
    expect(xdg).toBe("/home/me/.data/kakeai");
  });

  it("defaults to APPDATA on Windows", () => {
    const root = resolveDataRoot({ APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, "win32", "C:\\Users\\me");
    expect(root.startsWith("C:\\Users\\me\\AppData\\Roaming")).toBe(true);
    expect(root.endsWith("Kakeai")).toBe(true);
  });
});

describe("dataDirectories", () => {
  it("splits db, assets, artifacts and tmp under the root", () => {
    const directories = dataDirectories("/root");
    expect(directories).toEqual({
      root: "/root",
      db: "/root/db",
      assets: "/root/assets",
      artifacts: "/root/artifacts",
      tmp: "/root/tmp",
    });
  });
});

describe("databaseFilePath and toSqliteUrl", () => {
  it("puts the database under db and exposes a file URL", () => {
    const directories = dataDirectories("/root");
    expect(databaseFilePath(directories)).toBe("/root/db/kakeai.db");
    expect(toSqliteUrl(databaseFilePath(directories))).toBe("file:/root/db/kakeai.db");
  });

  it("keeps spaces literal for the SQLite driver adapter", () => {
    const url = toSqliteUrl("/Users/me/Library/Application Support/Kakeai/db/kakeai.db");
    expect(url).toBe("file:/Users/me/Library/Application Support/Kakeai/db/kakeai.db");
  });
});
