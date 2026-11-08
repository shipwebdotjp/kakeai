import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  liveCharacterSheetSchema,
  livePackageManifestSchema,
  livePackageShowSchema,
  type LiveCharacterSheet,
  type LiveFixtureComment,
  type LiveManifestFont,
  type LivePackageFile,
  type LivePackageManifest,
  type LivePackageShow,
  type LiveMediaType,
  type LiveFileKind,
} from "@kakeai/contracts";

const NOW = "2026-11-07T12:00:00.000Z";

/** A valid 1x1 transparent PNG, enough for loader/serving tests. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2ZQAAAABJRU5ErkJggg==",
  "base64",
);

function wavBytes(): Buffer {
  const sampleRate = 8000;
  const dataSize = 1600;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

const THEME_CSS = [
  ":root{",
  "--kakeai-canvas:#FAF6EE;",
  "--kakeai-ink:#26211C;",
  "--kakeai-surface:#FFFDF8;",
  "--kakeai-text:#2B2620;",
  "--kakeai-muted:#6F665B;",
  "--kakeai-border:#D9D0C2;",
  "--kakeai-accent-primary:#C4552D;",
  "--kakeai-accent-secondary:#2F6F6A;",
  "--kakeai-font-sans:\"Hiragino Sans\",sans-serif;",
  "--kakeai-font-caption:\"Hiragino Sans\",sans-serif;",
  "}",
  "",
].join("\n");

export interface TestPackageOptions {
  includeMaterial?: boolean;
  /** Adds a comment segment, `test.fixture` and `fixtures/comments.json`. */
  includeCommentCorner?: boolean;
  /** Adds one `cut_in` segment before closing and its `cutIns[]` entry. */
  includeCutIn?: boolean;
  /**
   * Number of script/comment pairs when a comment corner is included. Defaults
   * to 1; values below 1 are treated as 1.
   */
  commentCorners?: number;
  /** Implies `includeCommentCorner` and becomes the fixture file content. */
  fixtureComments?: LiveFixtureComment[];
  /** Show target duration. Defaults to 600000 (10 minutes). */
  targetDurationMs?: number;
  fonts?: LiveManifestFont[];
  startAt?: string | null;
}

export const DEFAULT_TEST_FIXTURE_COMMENTS: LiveFixtureComment[] = [
  { atMs: 500, author: "みかん", text: "今日の話、分かりやすかったです", kind: "normal" },
  { atMs: 1_000, author: "ゆず", text: "次の話題は何ですか？", kind: "normal" },
  { atMs: 1_500, author: "かき", text: "http://example.com を見てください", kind: "normal" },
];

function includeComments(options: TestPackageOptions): boolean {
  return (
    options.includeCommentCorner === true ||
    options.commentCorners !== undefined ||
    options.fixtureComments !== undefined
  );
}

function commentCornerCount(options: TestPackageOptions): number {
  if (!includeComments(options)) {
    return 0;
  }
  const requested = options.commentCorners ?? 1;
  if (!Number.isFinite(requested)) {
    return 1;
  }
  return Math.max(1, Math.min(20, Math.floor(requested)));
}

export interface TestPackage {
  rootDir: string;
  manifest: LivePackageManifest;
  show: LivePackageShow;
  characters: LiveCharacterSheet;
  cleanup(): Promise<void>;
}

interface PendingFile {
  path: string;
  data: Buffer;
  mediaType: LiveMediaType;
  kind: LiveFileKind;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  hasAudio?: boolean;
}

function fileRecord(file: PendingFile): LivePackageFile {
  return {
    path: file.path,
    sha256: createHash("sha256").update(file.data).digest("hex"),
    byteSize: file.data.byteLength,
    mediaType: file.mediaType,
    kind: file.kind,
    durationMs: file.durationMs ?? null,
    width: file.width ?? null,
    height: file.height ?? null,
    hasAudio: file.hasAudio ?? false,
  };
}

export function testShow(options: TestPackageOptions = {}): LivePackageShow {
  const includeMaterial = options.includeMaterial === true;
  const corners = commentCornerCount(options);
  const materialSegment = includeMaterial ? { material: "material-1" } : {};
  const segments: unknown[] = [
    {
      id: "seg-opening",
      kind: "opening",
      label: "オープニング",
      targetDurationMs: 60_000,
      cues: ["cue-opening"],
    },
  ];
  const cues: unknown[] = [
    {
      id: "cue-opening",
      origin: "live",
      speaker: "left",
      caption: "まもなく始まります。",
      speech: "まもなく はじまります。",
      expression: "normal",
      audio: "audio/prepared/cue-opening.wav",
      durationMs: 1000,
    },
  ];

  const scriptCount = Math.max(1, corners);
  for (let index = 1; index <= scriptCount; index += 1) {
    const suffix = index === 1 ? "" : `-${index}`;
    const scriptCueId = `cue-script${suffix}`;
    segments.push({
      id: `seg-script${suffix}`,
      kind: "script",
      label: index === 1 ? "本編" : `本編${index}`,
      targetDurationMs: 300_000,
      cues: [scriptCueId],
      ...(index === 1 ? materialSegment : {}),
    });
    cues.push({
      id: scriptCueId,
      origin: "script",
      sourceLineId: `line-${index}`,
      speaker: "right",
      caption: index === 1 ? "本編の話題です。" : `本編${index}の話題です。`,
      speech: index === 1 ? "ほんぺんの わだいです。" : `ほんぺん${index}の わだいです。`,
      expression: index === 1 ? "smile" : "normal",
      audio: `audio/prepared/${scriptCueId}.wav`,
      durationMs: 1000,
    });
    if (corners > 0) {
      segments.push({
        id: `seg-comments${suffix}`,
        kind: "comment",
        label: index === 1 ? "コメント" : `コメント${index}`,
        targetDurationMs: 120_000,
      });
    }
  }

  if (options.includeCutIn === true) {
    segments.push({
      id: "seg-cut-in",
      kind: "cut_in",
      label: "コメントコーナーへ",
      cutInId: "jingle-1",
    });
  }
  segments.push({
    id: "seg-closing",
    kind: "closing",
    label: "クロージング",
    targetDurationMs: 60_000,
    cues: ["cue-closing"],
  });
  cues.push({
    id: "cue-closing",
    origin: "live",
    speaker: "left",
    caption: "本日はここまでです。",
    speech: "ほんじつは ここまでです。",
    expression: "normal",
    audio: "audio/prepared/cue-closing.wav",
    durationMs: 1000,
  });

  return livePackageShowSchema.parse({
    schemaVersion: 1,
    show: {
      title: "テスト配信",
      locale: "ja-JP",
      targetDurationMs: options.targetDurationMs ?? 600_000,
      stageTemplate: "news-desk",
      theme: "theme.css",
      characters: { left: "char-left", right: "char-right" },
      startAt: options.startAt ?? null,
    },
    commentSource: { kind: corners > 0 ? "fixture" : "youtube" },
    segments,
    cutIns:
      options.includeCutIn === true
        ? [
            {
              id: "jingle-1",
              file: "media/assets/cutin.mp4",
              durationMs: 4000,
              hasAudio: true,
              width: 1920,
              height: 1080,
            },
          ]
        : [],
    ...(corners > 0 ? { test: { fixture: "fixtures/comments.json" } } : {}),
    cues,
    materials: includeMaterial
      ? [
          {
            id: "material-1",
            kind: "image",
            file: "materials/card-1.png",
            hasAudio: false,
            focus: true,
            width: 1,
            height: 1,
          },
        ]
      : [],
    speakers: [
      {
        id: "speaker-left",
        name: "左",
        side: "left",
        characterId: "char-left",
        voice: { adapterId: "voicevox", voiceId: "voice-1", speedScale: 1, settings: {} },
      },
      {
        id: "speaker-right",
        name: "右",
        side: "right",
        characterId: "char-right",
        voice: { adapterId: "voicevox", voiceId: "voice-2", speedScale: 1, settings: {} },
      },
    ],
    commentPolicy: {
      mode: "corner",
      freshnessMin: 10,
      maxCommentsPerCorner: 4,
      maxHumanPinsPerCorner: 4,
      maxExtraSlots: 2,
      allowImmediateInterrupt: false,
      skipWhenEmpty: true,
    },
    safety: {
      blockedTopics: [],
      persona: "親しみやすい解説役",
      maxResponseChars: 180,
      maxResponseCues: 2,
      fallbackCueId: "cue-opening",
    },
    playout: {
      minBufferMs: 10_000,
      maxThinkingMs: 2000,
      closingReserveMs: 120_000,
      noApprovalDelay: true,
    },
  });
}

export function testCharacters(): LiveCharacterSheet {
  const voice = { adapterId: "voicevox" as const, voiceId: "voice-1", speedScale: 1, settings: {} };
  return liveCharacterSheetSchema.parse({
    schemaVersion: 1,
    characters: [
      {
        id: "char-left",
        side: "left",
        name: "左",
        appearances: [
          {
            id: "left-normal",
            expression: "normal",
            image: "media/characters/left-normal.png",
            faceSetId: null,
            faceSetVersion: null,
          },
        ],
        voice,
      },
      {
        id: "char-right",
        side: "right",
        name: "右",
        appearances: [
          {
            id: "right-normal",
            expression: "normal",
            image: "media/characters/right-normal.png",
            faceSetId: null,
            faceSetVersion: null,
          },
        ],
        voice: { ...voice, voiceId: "voice-2" },
      },
    ],
    faceSets: [],
  });
}

export async function createTestPackage(
  options: TestPackageOptions = {},
): Promise<TestPackage> {
  const rootDir = await mkdtemp(join(tmpdir(), "kakeai-live-package-"));
  const show = testShow(options);
  const characters = testCharacters();
  const wav = wavBytes();

  const files: PendingFile[] = [
    {
      path: "theme.css",
      data: Buffer.from(THEME_CSS, "utf8"),
      mediaType: "text/css",
      kind: "theme",
    },
    {
      path: "show.json",
      data: Buffer.from(`${JSON.stringify(show, null, 2)}\n`, "utf8"),
      mediaType: "application/json",
      kind: "show",
    },
    {
      path: "characters.json",
      data: Buffer.from(`${JSON.stringify(characters, null, 2)}\n`, "utf8"),
      mediaType: "application/json",
      kind: "characters",
    },
    {
      path: "media/characters/left-normal.png",
      data: PNG_1X1,
      mediaType: "image/png",
      kind: "asset",
      width: 1,
      height: 1,
    },
    {
      path: "media/characters/right-normal.png",
      data: PNG_1X1,
      mediaType: "image/png",
      kind: "asset",
      width: 1,
      height: 1,
    },
    ...show.cues.map(
      (cue): PendingFile => ({
        path: cue.audio,
        data: wav,
        mediaType: "audio/wav",
        kind: "prepared-audio",
        durationMs: cue.durationMs,
        hasAudio: true,
      }),
    ),
  ];
  if (options.includeMaterial === true) {
    files.push({
      path: "materials/card-1.png",
      data: PNG_1X1,
      mediaType: "image/png",
      kind: "material",
      width: 1,
      height: 1,
      hasAudio: false,
    });
  }

  if (options.includeCutIn === true) {
    files.push({
      path: "media/assets/cutin.mp4",
      data: Buffer.from("cut-in fixture bytes"),
      mediaType: "video/mp4",
      kind: "cut-in",
      durationMs: 4000,
      width: 1920,
      height: 1080,
      hasAudio: true,
    });
  }

  if (includeComments(options)) {
    const comments = options.fixtureComments ?? DEFAULT_TEST_FIXTURE_COMMENTS;
    files.push({
      path: "fixtures/comments.json",
      data: Buffer.from(`${JSON.stringify(comments, null, 2)}\n`, "utf8"),
      mediaType: "application/json",
      kind: "fixture",
    });
  }

  let manifest: LivePackageManifest;
  try {
    for (const file of files) {
      const absolutePath = join(rootDir, file.path);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, file.data);
    }

    manifest = livePackageManifestSchema.parse({
      packageSchemaVersion: 1,
      exporterVersion: "0.1.0",
      packageId: "livepkg-test",
      createdAt: NOW,
      source: {
        workId: "work-1",
        languageEditionId: "edition-1",
        scriptVersionId: "script-1",
        theme: { id: "neutral", version: 1 },
        profileSha256: "a".repeat(64),
      },
      files: files.map(fileRecord),
      fonts:
        options.fonts ?? [
          {
            role: "caption",
            family: "Hiragino Sans",
            found: true,
            fallback: "sans-serif",
            required: false,
          },
        ],
      voices: [],
    });
    await writeFile(
      join(rootDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    await rm(rootDir, { recursive: true, force: true });
    throw error;
  }

  return {
    rootDir,
    manifest,
    show,
    characters,
    async cleanup() {
      await rm(rootDir, { recursive: true, force: true });
    },
  };
}

export async function readTestManifest(rootDir: string): Promise<LivePackageManifest> {
  return livePackageManifestSchema.parse(
    JSON.parse(await readFile(join(rootDir, "manifest.json"), "utf8")),
  );
}

export async function writeTestManifest(
  rootDir: string,
  manifest: LivePackageManifest,
): Promise<void> {
  await writeFile(join(rootDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}
