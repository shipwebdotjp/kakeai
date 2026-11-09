import { describe, expect, it } from "vitest";
import { ApiError } from "../../api/client";
import { makeProgramDocument } from "./test-helpers";
import {
  buildFinalizeVersionRequest,
  buildRestoreVersionDraftRequest,
  buildSaveDraftRequest,
  parseLiveProgramRevisionConflict,
  parseLiveProgramServerIssues,
} from "./version-actions";

describe("version action requests", () => {
  it("trims a note and omits an empty one", () => {
    expect(buildFinalizeVersionRequest(3, " 初回収録 ")).toEqual({
      expectedRevision: 3,
      note: "初回収録",
    });
    expect(buildFinalizeVersionRequest(4, "   ")).toEqual({ expectedRevision: 4 });
  });

  it("shapes save and restore requests with the expected revision", () => {
    const document = makeProgramDocument();
    expect(buildSaveDraftRequest(7, document)).toEqual({
      expectedRevision: 7,
      document,
    });
    expect(buildRestoreVersionDraftRequest(8)).toEqual({ expectedRevision: 8 });
  });

  it("parses a reloadable 409 conflict and ignores other errors", () => {
    const currentDocument = makeProgramDocument();
    const error = new ApiError(409, {
      code: "LIVE_PROGRAM_REVISION_CONFLICT",
      message: "競合しました",
      requestId: "req-1",
      details: {
        programId: "prg-1",
        currentRevision: 5,
        currentDocument,
      },
    });

    expect(parseLiveProgramRevisionConflict(error)).toEqual({
      programId: "prg-1",
      currentRevision: 5,
      currentDocument,
    });
    expect(parseLiveProgramRevisionConflict(new Error("no"))).toBeNull();
    expect(
      parseLiveProgramRevisionConflict(
        new ApiError(409, {
          code: "LIVE_PROGRAM_REVISION_CONFLICT",
          message: "再試行",
          requestId: "req-2",
          details: { programId: "prg-1" },
        }),
      ),
    ).toBeNull();
  });

  it("parses 422 validation issue details", () => {
    const error = new ApiError(422, {
      code: "VALIDATION_ERROR",
      message: "検証エラー",
      requestId: "req-3",
      details: {
        issues: [{ path: ["segments", 0, "cues"], code: "custom", message: "キューがありません" }],
      },
    });
    expect(parseLiveProgramServerIssues(error)).toEqual([
      { path: ["segments", 0, "cues"], code: "custom", message: "キューがありません" },
    ]);
    expect(parseLiveProgramServerIssues(new ApiError(422, {
      code: "ASSET_NOT_FOUND",
      message: "missing",
      requestId: "req-4",
      details: { assetIds: ["a"] },
    }))).toEqual([]);
  });
});
