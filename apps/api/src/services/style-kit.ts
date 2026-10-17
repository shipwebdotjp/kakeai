import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, posix, relative, resolve, sep } from "node:path";
import {
  AUTHORING_STYLE_DIRECTORY,
  HANDMADE_PAPER_SKIN_ID,
  NEUTRAL_VISUAL_SKIN_ID,
  getVisualSkinDefinition,
  type CompositionAuthoringBrief,
  type CompositionAuthoredStyleProvenance,
  type FontCatalog,
  type FontFace,
  type FontFaceSpec,
  type ThemeFontCategory,
  type VisualSkinRef,
  type VisualThemeDefinition,
  type VisualThemeTextRole,
} from "@kakeai/contracts";
import { mixHex, overlayToRgba } from "@kakeai/video";
import { ApiError } from "../http/errors.ts";

export const STYLE_KIT_VERSION = 1 as const;

const PROTECTED_KIT_FILES = ["STYLE.md", "tokens.css", "fonts.css", "components.css"] as const;

const TEXT_ROLES: readonly VisualThemeTextRole[] = [
  "title",
  "subtitle",
  "heading",
  "body",
  "closing",
  "caption",
  "label",
  "code",
];

const GENERIC_FONT_STACKS: Record<ThemeFontCategory, string> = {
  sans: "sans-serif",
  serif: "serif",
  mono: "monospace",
};

const NEUTRAL_BRIEF: CompositionAuthoringBrief = {
  intent: "Visual Themeの配色・書体・余白に沿ったTemplate標準のモーション。",
  must: [
    "kakeai-style/ 配下のファイルを変更しない",
    "tokens.css のCSS変数を使い、色・角丸・影を直書きしない",
    "文字は var(--kakeai-font-*) のaliasだけを使い、生のフォント名を書かない",
    "document.fonts.ready の後に文字計測と timeline 登録を行う",
  ],
  avoid: ["外部URLと絶対パス", "font-familyの直接指定", "audio要素"],
};

const HANDMADE_PAPER_BRIEF: CompositionAuthoringBrief = {
  intent: "温かい紙の編集ノート。情報は手で留めた紙片として整理する。",
  must: [
    "kakeai-style/ 配下のファイルを変更しない",
    "tokens.css のCSS変数と components.css の .kk-paper / .kk-tape 部品を使う",
    "文字は var(--kakeai-font-*) のaliasだけを使い、生のフォント名を書かない",
    "document.fonts.ready の後に文字計測と timeline 登録を行う",
    "紙・テープ・控えめな影・短い貼り付け動作で統一する",
  ],
  avoid: [
    "跳ね・発光・glitch・強い3D変形",
    "スクラップブックの過剰なコラージュ",
    "黒板・ネオン・サイバー表現",
    "外部URLと絶対パス",
  ],
};

export function compositionAuthoringBriefOf(skin: VisualSkinRef): CompositionAuthoringBrief {
  switch (skin.id) {
    case HANDMADE_PAPER_SKIN_ID:
      return HANDMADE_PAPER_BRIEF;
    case NEUTRAL_VISUAL_SKIN_ID:
    default:
      return NEUTRAL_BRIEF;
  }
}

function sha256Hex(content: string | Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

export function hashVisualThemeDefinition(definition: VisualThemeDefinition): string {
  return sha256Hex(stableStringify(definition));
}

function cssStringLiteral(value: string): string {
  const sanitized = value.replace(/[\\"\r\n\f]/g, " ").trim();
  return `"${sanitized}"`;
}

function cssCommentSafe(value: string): string {
  return value.replace(/\*\/|\r|\n/g, "").slice(0, 128);
}

function fontAlias(role: VisualThemeTextRole): string {
  return `KakeaiSkin-${role}`;
}

interface ResolvedFontRole {
  role: VisualThemeTextRole;
  category: ThemeFontCategory;
  localFace: FontFace | undefined;
}

function resolveLocalFace(fontFace: FontFaceSpec, catalog: FontCatalog): FontFace | undefined {
  const faces = catalog.faces;
  const wantedPostScript = fontFace.platformId?.toLowerCase();
  if (wantedPostScript !== undefined && wantedPostScript.length > 0) {
    const byPostScript = faces.find(
      (face) => face.postScriptName.toLowerCase() === wantedPostScript,
    );
    if (byPostScript !== undefined) {
      return byPostScript;
    }
  }
  const wantedFamily = fontFace.family.toLowerCase();
  const familyMatches = faces.filter((face) => face.family.toLowerCase() === wantedFamily);
  if (familyMatches.length === 0) {
    return undefined;
  }
  const exact = familyMatches.find(
    (face) => face.weight === fontFace.weight && face.style === fontFace.style,
  );
  const styled = familyMatches.find((face) => face.style === fontFace.style);
  return exact ?? styled ?? familyMatches[0];
}

function resolveFontRoles(
  theme: VisualThemeDefinition,
  catalog: FontCatalog,
): { roles: ResolvedFontRole[]; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const roles = TEXT_ROLES.map((role) => {
    const token = theme.textRoles[role];
    const fontFace = token.fontFace;
    let localFace: FontFace | undefined;
    if (fontFace !== undefined) {
      const resolved = catalog.supported ? resolveLocalFace(fontFace, catalog) : undefined;
      if (resolved !== undefined) {
        localFace = resolved;
        diagnostics.push(
          `${role}: local face ${cssStringLiteral(resolved.postScriptName)} を使用`,
        );
      } else {
        diagnostics.push(
          `${role}: ${cssStringLiteral(fontFace.family)} を解決できないため ${GENERIC_FONT_STACKS[token.font]} を使用`,
        );
      }
    }
    return { role, category: token.font, localFace };
  });
  if (!catalog.supported) {
    diagnostics.unshift("フォントカタログが利用できないため、すべての文字はgeneric stackで描画されます");
  }
  return { roles, diagnostics };
}

function renderFontsCss(theme: VisualThemeDefinition, roles: ResolvedFontRole[]): string {
  const lines: string[] = [
    `/* Kakeai Style Kit fonts (kit v${STYLE_KIT_VERSION}) — source theme ${cssCommentSafe(theme.id)}@${theme.version} */`,
  ];
  for (const role of roles) {
    if (role.localFace === undefined) {
      continue;
    }
    lines.push(
      `@font-face {`,
      `  font-family: ${cssStringLiteral(fontAlias(role.role))};`,
      `  src: local(${cssStringLiteral(role.localFace.postScriptName)});`,
      `  font-style: ${role.localFace.style};`,
      `  font-weight: ${role.localFace.weight};`,
      `  font-display: block;`,
      `}`,
    );
  }
  lines.push(":root {");
  for (const role of roles) {
    const stack =
      role.localFace === undefined
        ? GENERIC_FONT_STACKS[role.category]
        : `${cssStringLiteral(fontAlias(role.role))}, ${GENERIC_FONT_STACKS[role.category]}`;
    lines.push(`  --kakeai-font-${role.role}: ${stack};`);
  }
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

function renderTokensCss(theme: VisualThemeDefinition): string {
  const lines: string[] = [
    `/* Kakeai Style Kit tokens (kit v${STYLE_KIT_VERSION}) — source theme ${cssCommentSafe(theme.id)}@${theme.version} */`,
    ":root {",
    `  --kakeai-canvas: ${theme.canvas.base};`,
    `  --kakeai-canvas-ink: ${theme.canvas.ink};`,
    `  --kakeai-accent-primary: ${theme.accents.primary};`,
    `  --kakeai-accent-secondary: ${theme.accents.secondary};`,
    `  --kakeai-accent-tertiary: ${theme.accents.tertiary};`,
    `  --kakeai-surface: ${theme.surface};`,
    `  --kakeai-surface-muted: ${theme.surfaceMuted};`,
    `  --kakeai-text: ${theme.text};`,
    `  --kakeai-muted: ${theme.muted};`,
    `  --kakeai-border: ${theme.border};`,
    `  --kakeai-on-media: ${theme.onMedia};`,
    `  --kakeai-scrim: ${overlayToRgba(theme.scrim)};`,
    `  --kakeai-shadow: ${overlayToRgba(theme.shadow)};`,
    `  --kakeai-radius-sm: ${theme.radius.sm}px;`,
    `  --kakeai-radius-md: ${theme.radius.md}px;`,
    `  --kakeai-radius-lg: ${theme.radius.lg}px;`,
    `  --kakeai-motion-enter-ms: ${theme.motion.enterMs};`,
    `  --kakeai-motion-exit-ms: ${theme.motion.exitMs};`,
    `  --kakeai-motion-max-ms: ${theme.motion.maxMs};`,
    `  --kakeai-tone-success: ${theme.semantic.success};`,
    `  --kakeai-tone-warning: ${theme.semantic.warning};`,
    `  --kakeai-tone-error: ${theme.semantic.error};`,
    `  --kakeai-tone-info: ${theme.semantic.info};`,
  ];
  for (const role of TEXT_ROLES) {
    const token = theme.textRoles[role];
    lines.push(
      `  --kakeai-text-${role}-size: ${token.fontSize}px;`,
      `  --kakeai-text-${role}-color: ${token.color};`,
      `  --kakeai-text-${role}-weight: ${token.decoration.bold ? 700 : 400};`,
      `  --kakeai-text-${role}-line-height: ${token.lineHeight};`,
    );
  }
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

const TORN_BOTTOM_POINTS =
  "polygon(0% 0%, 100% 0%, 100% calc(100% - 1.6px), 94% calc(100% - 2.4px), 88% calc(100% - 1.2px), 80% calc(100% - 2.6px), 72% calc(100% - 0.8px), 63% calc(100% - 2.2px), 55% calc(100% - 1.3px), 47% calc(100% - 2.9px), 39% calc(100% - 1.1px), 30% calc(100% - 2.4px), 22% calc(100% - 0.9px), 14% calc(100% - 2.8px), 7% calc(100% - 1.2px), 0% calc(100% - 3px))";

const TAPE_CLIP =
  "polygon(0 14%, 4% 0, 97% 5%, 100% 86%, 95% 100%, 2% 93%)";

function renderComponentsCss(skin: VisualSkinRef, theme: VisualThemeDefinition): string {
  const header = `/* Kakeai Style Kit components (kit v${STYLE_KIT_VERSION}) — skin ${cssCommentSafe(skin.id)}@${skin.version} */`;
  if (skin.id === HANDMADE_PAPER_SKIN_ID) {
    const paper = mixHex(theme.canvas.base, "#FFFFFF", 0.64);
    const edge = mixHex(theme.canvas.base, theme.canvas.ink, 0.16);
    const shadow = overlayToRgba({ color: theme.canvas.ink, opacity: 0.16 });
    const shadowSoft = overlayToRgba({ color: theme.canvas.ink, opacity: 0.1 });
    return [
      header,
      ":root {",
      `  --kakeai-paper-bg: ${paper};`,
      `  --kakeai-paper-edge: ${edge};`,
      `  --kakeai-paper-shadow: ${shadow};`,
      `  --kakeai-paper-shadow-soft: ${shadowSoft};`,
      "}",
      ".kk-paper {",
      "  position: relative;",
      "  background: var(--kakeai-paper-bg);",
      "  border-radius: 6px;",
      "  box-shadow: inset 0 0 0 1px var(--kakeai-paper-edge), 0 12px 26px var(--kakeai-paper-shadow);",
      "}",
      ".kk-paper-torn {",
      `  clip-path: ${TORN_BOTTOM_POINTS};`,
      "}",
      ".kk-tape {",
      "  position: absolute;",
      "  width: 120px;",
      "  height: 30px;",
      "  background: var(--kakeai-accent-soft, var(--kakeai-surface-muted));",
      "  opacity: 0.9;",
      `  clip-path: ${TAPE_CLIP};`,
      "  box-shadow: 0 1px 3px var(--kakeai-paper-shadow);",
      "}",
      ".kk-note {",
      "  background: var(--kakeai-paper-bg);",
      "  border-radius: 4px;",
      "  box-shadow: inset 0 0 0 1px var(--kakeai-paper-edge), 0 8px 20px var(--kakeai-paper-shadow-soft);",
      "  transform: rotate(0.4deg);",
      "}",
      "",
    ].join("\n");
  }
  return [
    header,
    ".kk-surface {",
    "  background: var(--kakeai-surface);",
    "  border-radius: var(--kakeai-radius-md);",
    "  box-shadow: 0 12px 48px var(--kakeai-shadow);",
    "}",
    ".kk-ink {",
    "  color: var(--kakeai-text);",
    "}",
    ".kk-muted {",
    "  color: var(--kakeai-muted);",
    "}",
    "",
  ].join("\n");
}

const SHARED_STYLE_RULES: readonly string[] = [
  "すべての色・角丸・影・余白は tokens.css のCSS変数から取る。",
  "文字は var(--kakeai-font-*) のaliasだけを使い、生の font-family やユーザー入力のフォント名を書かない。",
  "document.fonts.ready の後に文字計測と timeline 登録を行う。",
  "kakeai-style/ は読み取り専用の保護ファイルであり、変更すると publish が STYLE_KIT_MODIFIED で拒否される。",
  "内容固有の画像やSVGは assets/ へ置き、kakeai-style/ に混ぜない。",
  "外部URL、絶対パス、audio要素を使わない。",
];

function renderStyleMd(options: {
  skin: VisualSkinRef;
  definitionHash: string;
  theme: VisualThemeDefinition;
  fontDiagnostics: readonly string[];
}): string {
  const { skin, theme } = options;
  const skinDefinition = getVisualSkinDefinition(skin.id, skin.version);
  const brief = compositionAuthoringBriefOf(skin);
  const lines: string[] = [
    `# ${skinDefinition?.name ?? skin.id} Style Kit`,
    "",
    `- Skin: \`${skin.id}@${skin.version}\``,
    `- Kit version: ${STYLE_KIT_VERSION}`,
    `- Source theme: \`${theme.id}@${theme.version}\` (definition hash \`${options.definitionHash}\`)`,
    `- Style directory: \`${AUTHORING_STYLE_DIRECTORY}/\``,
    "",
    "## 世界観",
    "",
    brief.intent,
    "",
    "## 必須規則",
    "",
    ...brief.must.map((entry) => `- ${entry}`),
    ...SHARED_STYLE_RULES.map((entry) => `- ${entry}`),
    "",
    "## 禁止規則",
    "",
    ...brief.avoid.map((entry) => `- ${entry}`),
    "",
    "## 可読性・余白・動き",
    "",
  ];
  if (skin.id === HANDMADE_PAPER_SKIN_ID) {
    lines.push(
      "- 背景は温かい紙の地とし、本文の可読性を損なわない弱さの紙目に留める。",
      "- 紙片・テープ・影・傾きは最小限にし、本文・数値・図表の読み取りを優先する。",
      "- 動きは「紙を置く」「テープで留める」に相当する短い移動とフェードだけにする。",
      "- 破れ縁は必要な箇所だけに使う。",
    );
  } else {
    lines.push(
      "- Themeの余白・角丸・影をそのまま使う。",
      "- 動きは motion token の範囲に収める。",
    );
  }
  lines.push(
    "",
    "## Kitの使い方",
    "",
    "- `tokens.css`: 色・角丸・影・モーションのCSS変数。",
    "- `fonts.css`: 検証済みlocal faceのalias (`--kakeai-font-*`)。",
    "- `components.css`: 世界観の部品クラス（例: `.kk-paper`, `.kk-tape`）。",
    "- `kit-lock.json`: Skin Ref、kit hash、各保護ファイルのhash、生成元Theme、Font診断。",
    "",
    "## Font診断",
    "",
    ...(options.fontDiagnostics.length === 0
      ? ["- 解決対象のFont Faceはありません。"]
      : options.fontDiagnostics.map((entry) => `- ${entry}`)),
    "",
  );
  return `${lines.join("\n")}\n`;
}

export interface StyleKitContents {
  files: Record<string, string>;
  kitHash: string;
  definitionHash: string;
  fontDiagnostics: string[];
}

export function buildStyleKitContents(options: {
  skin: VisualSkinRef;
  theme: VisualThemeDefinition;
  fontCatalog: FontCatalog;
}): StyleKitContents {
  const { skin, theme, fontCatalog } = options;
  const { roles, diagnostics } = resolveFontRoles(theme, fontCatalog);
  const definitionHash = hashVisualThemeDefinition(theme);

  const files: Record<string, string> = {
    "STYLE.md": renderStyleMd({ skin, definitionHash, theme, fontDiagnostics: diagnostics }),
    "tokens.css": renderTokensCss(theme),
    "fonts.css": renderFontsCss(theme, roles),
    "components.css": renderComponentsCss(skin, theme),
  };

  const fileHashes: Record<string, string> = {};
  for (const name of PROTECTED_KIT_FILES) {
    const content = files[name];
    if (content === undefined) {
      throw new Error(`Missing style kit file: ${name}`);
    }
    fileHashes[name] = sha256Hex(content);
  }
  const kitHash = sha256Hex(stableStringify({ kitVersion: STYLE_KIT_VERSION, skin, files: fileHashes }));
  const lock = {
    lockSchemaVersion: 1,
    kitVersion: STYLE_KIT_VERSION,
    skin,
    theme: { ref: { id: theme.id, version: theme.version }, definitionHash },
    kitHash,
    files: fileHashes,
    fontDiagnostics: diagnostics,
  };
  files["kit-lock.json"] = `${JSON.stringify(lock, null, 2)}\n`;

  return { files, kitHash, definitionHash, fontDiagnostics: diagnostics };
}

export function styleKitProvenance(options: {
  skin: VisualSkinRef;
  theme: VisualThemeDefinition;
  canvasProfile: CompositionAuthoredStyleProvenance["canvasProfile"];
  contents: StyleKitContents;
}): CompositionAuthoredStyleProvenance {
  const files: Record<string, string> = {};
  for (const name of PROTECTED_KIT_FILES) {
    const content = options.contents.files[name];
    if (content === undefined) {
      throw new Error(`Missing style kit file: ${name}`);
    }
    files[name] = sha256Hex(content);
  }
  const lockContent = options.contents.files["kit-lock.json"];
  if (lockContent === undefined) {
    throw new Error("Missing style kit file: kit-lock.json");
  }
  files["kit-lock.json"] = sha256Hex(lockContent);
  return {
    kind: "authored",
    contextSchemaVersion: 1,
    theme: {
      ref: { id: options.theme.id, version: options.theme.version },
      definitionHash: options.contents.definitionHash,
    },
    skin: options.skin,
    kit: {
      version: STYLE_KIT_VERSION,
      hash: options.contents.kitHash,
      files,
    },
    canvasProfile: options.canvasProfile,
    fontDiagnostics: options.contents.fontDiagnostics,
  };
}

export interface StyleKitIssue {
  path: (string | number)[];
  code: string;
  message: string;
}

export function styleKitModifiedError(issues: StyleKitIssue[]): ApiError {
  return new ApiError(422, "STYLE_KIT_MODIFIED", "Style Kitが変更されています。", { issues });
}

export function assertNotProtectedStylePath(relPath: string): void {
  const normalized = posix.normalize(relPath.replace(/\\/g, "/")).replace(/^\.\//, "");
  if (normalized === AUTHORING_STYLE_DIRECTORY || normalized.startsWith(`${AUTHORING_STYLE_DIRECTORY}/`)) {
    throw styleKitModifiedError([
      {
        path: ["files", relPath],
        code: "style_kit_modified",
        message: `'${relPath}' はStyle Kitの保護ファイルです。kakeai-style/ 配下は変更できません。`,
      },
    ]);
  }
}

async function listKitEntries(
  dir: string,
  base: string = dir,
  collected: Map<string, "file" | "symlink" | "other"> = new Map(),
): Promise<Map<string, "file" | "symlink" | "other">> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return collected;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await listKitEntries(full, base, collected);
      continue;
    }
    const key = relative(base, full).split(sep).join("/");
    collected.set(key, entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "other");
  }
  return collected;
}

function kitFilePathWithin(kitDir: string, relPath: string): string | undefined {
  const base = resolve(kitDir);
  const target = resolve(kitDir, relPath);
  if (target !== base && !target.startsWith(base + sep)) {
    return undefined;
  }
  return target;
}

export async function verifyCompositionStyleKit(
  draftDir: string,
  provenance: CompositionAuthoredStyleProvenance,
): Promise<StyleKitIssue[]> {
  const kitDir = join(draftDir, AUTHORING_STYLE_DIRECTORY);
  const expected = provenance.kit.files;
  const issues: StyleKitIssue[] = [];
  const actual = await listKitEntries(kitDir);
  for (const [relPath, expectedHash] of Object.entries(expected)) {
    const kind = actual.get(relPath);
    if (kind === undefined) {
      issues.push({
        path: [AUTHORING_STYLE_DIRECTORY, relPath],
        code: "style_kit_missing",
        message: `Style Kitファイル '${relPath}' が見つかりません`,
      });
      continue;
    }
    const filePath = kind === "file" ? kitFilePathWithin(kitDir, relPath) : undefined;
    if (filePath === undefined) {
      issues.push({
        path: [AUTHORING_STYLE_DIRECTORY, relPath],
        code: "style_kit_modified",
        message: `Style Kitファイル '${relPath}' が変更されています`,
      });
      continue;
    }
    let content: Buffer;
    try {
      content = await readFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        issues.push({
          path: [AUTHORING_STYLE_DIRECTORY, relPath],
          code: "style_kit_missing",
          message: `Style Kitファイル '${relPath}' が見つかりません`,
        });
        continue;
      }
      throw error;
    }
    if (sha256Hex(content) !== expectedHash) {
      issues.push({
        path: [AUTHORING_STYLE_DIRECTORY, relPath],
        code: "style_kit_modified",
        message: `Style Kitファイル '${relPath}' が変更されています`,
      });
    }
  }
  for (const relPath of actual.keys()) {
    if (!Object.hasOwn(expected, relPath)) {
      issues.push({
        path: [AUTHORING_STYLE_DIRECTORY, relPath],
        code: "style_kit_extra",
        message: `保護ディレクトリに許可されていないファイルがあります: '${relPath}'`,
      });
    }
  }
  return issues;
}
