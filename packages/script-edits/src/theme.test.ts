import { describe, expect, it } from "vitest";
import {
  createInitialContentDocument,
  SOFT_EDITORIAL_THEME_ID,
  SOFT_EDITORIAL_THEME_VERSION,
} from "@kakeai/contracts";
import { applyScriptOperation } from "./apply.ts";
import { ScriptEditError } from "./errors.ts";
import { createTestContext } from "./testing.ts";

function expectEditError(callback: () => unknown, code: ScriptEditError["code"]): void {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(ScriptEditError);
    expect((error as ScriptEditError).code).toBe(code);
    return;
  }
  throw new Error(`エラーが発生しませんでした: ${code}`);
}

describe("document.setVisualTheme", () => {
  it("selects a built-in theme without a theme lookup", () => {
    const document = createInitialContentDocument();
    const result = applyScriptOperation(
      document,
      {
        op: "document.setVisualTheme",
        id: SOFT_EDITORIAL_THEME_ID,
        version: SOFT_EDITORIAL_THEME_VERSION,
      },
      createTestContext(),
    );
    expect(result.document.visualTheme).toEqual({
      id: SOFT_EDITORIAL_THEME_ID,
      version: SOFT_EDITORIAL_THEME_VERSION,
    });
  });

  it("selects the latest revision of an unarchived user theme", () => {
    const document = createInitialContentDocument();
    const result = applyScriptOperation(
      document,
      { op: "document.setVisualTheme", id: "theme-user", version: 3 },
      createTestContext({}, { selectableThemes: { "theme-user": [3] } }),
    );
    expect(result.document.visualTheme).toEqual({ id: "theme-user", version: 3 });
  });

  it("rejects a non-latest or archived user theme revision", () => {
    const document = createInitialContentDocument();
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          { op: "document.setVisualTheme", id: "theme-user", version: 2 },
          createTestContext({}, { selectableThemes: { "theme-user": [3] } }),
        ),
      "EDIT_TARGET_NOT_FOUND",
    );
  });

  it("rejects a user theme when no theme lookup is provided", () => {
    const document = createInitialContentDocument();
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          { op: "document.setVisualTheme", id: "theme-user", version: 1 },
          createTestContext(),
        ),
      "EDIT_TARGET_NOT_FOUND",
    );
  });

  it("rejects an unknown theme", () => {
    const document = createInitialContentDocument();
    expectEditError(
      () =>
        applyScriptOperation(
          document,
          { op: "document.setVisualTheme", id: "missing", version: 1 },
          createTestContext(),
        ),
      "EDIT_TARGET_NOT_FOUND",
    );
  });
});

describe("document.setCaption", () => {
  it("toggles the speaker name display", () => {
    const document = createInitialContentDocument();
    const on = applyScriptOperation(
      document,
      { op: "document.setCaption", showSpeakerName: true },
      createTestContext(),
    );
    expect(on.document.caption).toEqual({ showSpeakerName: true });
    const off = applyScriptOperation(
      on.document,
      { op: "document.setCaption", showSpeakerName: false },
      createTestContext(),
    );
    expect(off.document.caption).toEqual({ showSpeakerName: false });
  });
});
