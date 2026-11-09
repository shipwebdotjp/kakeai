import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  liveProgramDocumentSchema,
  type LiveFormatDocumentV1,
  type LiveProgramDetail,
} from "@kakeai/contracts";
import { canonicalJson } from "../live/canonical-json.ts";
import { sha256Hex } from "../live/hash.ts";
import {
  createLiveCharacter,
  createLiveAsset,
  createLiveTestContext,
  createLiveVoiceProfile,
  liveFormatFixture,
  type LiveTestContext,
} from "./live-program-test-helpers.ts";
import {
  createLiveFormat,
  duplicateLiveFormat,
  getLiveFormat,
  listLiveFormats,
  updateLiveFormat,
} from "./live-formats.ts";
import {
  createLiveProgram,
  finalizeLiveProgramVersion,
  getLiveProgram,
  getLiveProgramVersion,
  listLiveProgramVersions,
  saveLiveProgramDraft,
} from "./live-programs.ts";
import { addScriptCue } from "./live-program-test-helpers.ts";

let context: LiveTestContext;
let formatDocument: LiveFormatDocumentV1;

beforeAll(async () => {
  context = await createLiveTestContext("kakeai-live-programs-");
  await createLiveAsset(context.prisma, {
    id: "asset-char",
    kind: "image",
    mediaType: "image/png",
  });
  await createLiveCharacter(context.prisma, {
    id: "char-left",
    name: "左キャラ",
    appearanceAssetId: "asset-char",
  });
  await createLiveVoiceProfile(context.prisma, { id: "voice-left" });
  formatDocument = liveFormatFixture({
    characterId: "char-left",
    voiceProfileId: "voice-left",
  });
}, 60_000);

afterAll(async () => {
  await context.close();
});

async function createProgramFromNewFormat(): Promise<{
  formatId: string;
  program: LiveProgramDetail;
}> {
  const format = await createLiveFormat(context.prisma, formatDocument);
  const program = await createLiveProgram(context.prisma, { formatId: format.id });
  return { formatId: format.id, program };
}

describe("Live Format and Live Program persistence", () => {
  it("deep-copies a format with new ids and remaps every reference", async () => {
    const format = await createLiveFormat(context.prisma, formatDocument);
    const program = await createLiveProgram(context.prisma, { formatId: format.id });
    const draft = program.draftDocument;

    expect(draft.title).toBe(formatDocument.title);
    expect(draft.sourceFormat?.formatId).toBe(format.id);
    expect(draft.materials).toEqual([]);
    expect(draft.cutIns).toEqual([]);
    // The CutIn placeholder cannot be materialized without a CutIn asset.
    expect(draft.segments.some((segment) => segment.kind === "cut_in")).toBe(false);

    const formatSegmentIds = new Set(formatDocument.segments.map((segment) => segment.id));
    expect(draft.segments.every((segment) => !formatSegmentIds.has(segment.id))).toBe(true);
    const formatCueIds = new Set(formatDocument.cues.map((cue) => cue.id));
    expect(draft.cues.every((cue) => !formatCueIds.has(cue.id))).toBe(true);
    const formatCardIds = new Set(formatDocument.cards.map((card) => card.id));
    expect(draft.cards.every((card) => !formatCardIds.has(card.id))).toBe(true);

    const opening = draft.segments.find((segment) => segment.kind === "opening");
    const closing = draft.segments.find((segment) => segment.kind === "closing");
    expect(opening?.kind).toBe("opening");
    expect(closing?.kind).toBe("closing");
    if (opening?.kind !== "opening" || closing?.kind !== "closing") {
      throw new Error("spine missing");
    }
    expect(opening.cues).toHaveLength(1);
    expect(closing.cues).toHaveLength(1);
    expect(draft.safety?.fallbackCueId).not.toBe("format-cue-fallback");
    expect(draft.cues.some((cue) => cue.id === draft.safety?.fallbackCueId)).toBe(true);

    const script = draft.segments.find((segment) => segment.kind === "script");
    if (script === undefined || script.kind === "cut_in") {
      throw new Error("script segment missing");
    }
    const visual = script.visual;
    expect(visual?.kind).toBe("card");
    if (visual?.kind !== "card") {
      throw new Error("script visual missing");
    }
    expect(formatCardIds.has(visual.cardId)).toBe(false);
    const card = draft.cards.find((entry) => entry.id === visual.cardId);
    expect(card).toBeDefined();
    expect(card?.states.some((state) => state.id === visual.stateId)).toBe(true);

    const beforeUpdate = await getLiveProgram(context.prisma, program.id);
    const updated = await updateLiveFormat(context.prisma, format.id, {
      ...formatDocument,
      name: "ニュース30分 v2",
      title: "変更後のタイトル",
    });
    expect(updated.name).toBe("ニュース30分 v2");
    const reloaded = await getLiveProgram(context.prisma, program.id);
    expect(reloaded.draftDocument).toEqual(beforeUpdate.draftDocument);
    expect(reloaded.title).toBe(beforeUpdate.title);
    expect(reloaded.sourceFormat).toEqual(beforeUpdate.sourceFormat);
  });

  it("rejects a stale draft save with the current revision and document", async () => {
    const { program } = await createProgramFromNewFormat();
    const document = addScriptCue(program.draftDocument);
    const saved = await saveLiveProgramDraft(context.prisma, program.id, {
      expectedRevision: 0,
      document,
    });
    expect(saved.draftRevision).toBe(1);

    await expect(
      saveLiveProgramDraft(context.prisma, program.id, {
        expectedRevision: 0,
        document,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "LIVE_PROGRAM_REVISION_CONFLICT",
      details: {
        currentRevision: 1,
        currentDocument: saved.draftDocument,
      },
    });

    await expect(
      finalizeLiveProgramVersion(context.prisma, program.id, {
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "LIVE_PROGRAM_REVISION_CONFLICT",
    });
  });

  it("keeps versions immutable, canonical and independent from the draft", async () => {
    const { program } = await createProgramFromNewFormat();
    const document = addScriptCue(program.draftDocument);
    const saved = await saveLiveProgramDraft(context.prisma, program.id, {
      expectedRevision: 0,
      document,
    });
    expect(saved.draftRevision).toBe(1);

    const beforeFinalize = await getLiveProgram(context.prisma, program.id);
    const version1 = await finalizeLiveProgramVersion(context.prisma, program.id, {
      expectedRevision: 1,
      note: "初版",
    });
    expect(version1.versionNumber).toBe(1);
    expect(version1.note).toBe("初版");
    expect(version1.documentSha256).toBe(sha256Hex(canonicalJson(version1.document)));
    expect(version1.resolutionSnapshotSha256).toBe(
      sha256Hex(canonicalJson(version1.resolutionSnapshot)),
    );

    const afterFinalize = await getLiveProgram(context.prisma, program.id);
    expect(afterFinalize.draftRevision).toBe(beforeFinalize.draftRevision);
    expect(afterFinalize.draftDocument).toEqual(beforeFinalize.draftDocument);

    const changed: LiveProgramDetail["draftDocument"] = {
      ...saved.draftDocument,
      title: "変更後の下書き",
    };
    const savedAgain = await saveLiveProgramDraft(context.prisma, program.id, {
      expectedRevision: 1,
      document: changed,
    });
    expect(savedAgain.draftRevision).toBe(2);

    const reloadedVersion = await getLiveProgramVersion(
      context.prisma,
      program.id,
      version1.id,
    );
    expect(reloadedVersion.documentSha256).toBe(version1.documentSha256);
    expect(reloadedVersion.resolutionSnapshotSha256).toBe(
      version1.resolutionSnapshotSha256,
    );
    expect(reloadedVersion.document).toEqual(version1.document);
    expect(reloadedVersion.document.title).toBe("今週のニュース");

    const version2 = await finalizeLiveProgramVersion(context.prisma, program.id, {
      expectedRevision: 2,
    });
    expect(version2.versionNumber).toBe(2);
    expect(version2.documentSha256).not.toBe(version1.documentSha256);

    // Finalize does not mutate the draft, so an immediate re-freeze is stable.
    const version3 = await finalizeLiveProgramVersion(context.prisma, program.id, {
      expectedRevision: 2,
    });
    expect(version3.versionNumber).toBe(3);
    expect(version3.documentSha256).toBe(version2.documentSha256);
    expect(version3.resolutionSnapshotSha256).toBe(
      version2.resolutionSnapshotSha256,
    );

    const versions = await listLiveProgramVersions(context.prisma, program.id);
    expect(versions.map((version) => version.versionNumber)).toEqual([3, 2, 1]);
  });

  it("creates, lists and duplicates formats without the GUI", async () => {
    const format = await createLiveFormat(context.prisma, formatDocument);
    const list = await listLiveFormats(context.prisma);
    expect(list.items.some((entry) => entry.id === format.id)).toBe(true);
    const detail = await getLiveFormat(context.prisma, format.id);
    expect(detail.document.title).toBe(formatDocument.title);

    const duplicate = await duplicateLiveFormat(context.prisma, format.id, "複製フォーマット");
    expect(duplicate.id).not.toBe(format.id);
    expect(duplicate.name).toBe("複製フォーマット");
    expect(duplicate.document.name).toBe("複製フォーマット");

    const program = await createLiveProgram(context.prisma, { formatId: format.id });
    expect(program.draftRevision).toBe(0);
    const saved = await saveLiveProgramDraft(context.prisma, program.id, {
      expectedRevision: 0,
      document: addScriptCue(program.draftDocument),
    });
    const version = await finalizeLiveProgramVersion(context.prisma, program.id, {
      expectedRevision: saved.draftRevision,
    });
    const versions = await listLiveProgramVersions(context.prisma, program.id);
    expect(versions.map((entry) => entry.id)).toEqual([version.id]);
  });
});
