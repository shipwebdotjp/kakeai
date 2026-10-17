import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  FontCatalog,
  FontFace,
  FontFaceSpec,
  ThemeFontCategory,
  VisualThemeDefinition,
  VisualThemeTextRole,
} from "@kakeai/contracts";
import {
  ChromiumFontVerifier,
  NoopFontVerifier,
  type FontFaceVerifier,
  type LocalFaceVerification,
} from "./font-verifier.ts";

const execFileAsync = promisify(execFile);

export const THEME_TEXT_ROLES: readonly VisualThemeTextRole[] = [
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

export { GENERIC_FONT_STACKS };

export interface FontCatalogAdapter {
  getCatalog(): Promise<{ supported: boolean; faces: FontFace[]; reason: string | null }>;
}

const FONT_FILE_EXTENSION = /\.(ttf|otf|ttc|otc|dfont|woff2?)$/i;

function asText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

// Ordered most specific first: "extrabold" contains "bold", "ultralight"
// contains "light", so the compound words must win.
const WEIGHT_HINTS: readonly (readonly [readonly string[], number])[] = [
  [["black", "ブラック"], 900],
  [["hairline", "thin", "ヘアライン"], 100],
  [["extralight", "extra light", "ultralight", "ultra light", "エクストラライト", "ウルトラライト"], 200],
  [["light", "ライト"], 300],
  [["demibold", "demi bold", "semibold", "semi bold", "デミボールド", "セミボールド"], 600],
  [
    ["extrabold", "extra bold", "ultrabold", "ultra bold", "heavy", "エクストラボールド", "ウルトラボールド", "ヘビー"],
    800,
  ],
  [["medium", "ミディアム"], 500],
  [["bold", "ボールド", "太字"], 700],
];

function weightFromHint(hint: string): number {
  const normalized = hint.toLowerCase();
  for (const [keywords, weight] of WEIGHT_HINTS) {
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      return weight;
    }
  }
  return 400;
}

function styleFromHint(hint: string): "normal" | "italic" | "oblique" {
  const normalized = hint.toLowerCase();
  if (/italic|イタリック|斜体/.test(normalized)) {
    return "italic";
  }
  return /oblique/.test(normalized) ? "oblique" : "normal";
}

/**
 * Normalizes the `system_profiler SPFontsDataType -json` payload into Font
 * Faces. The item `_name` is the font *file* name ("YuMincho.ttc"), which is
 * not usable as a CSS family; the typeface `family` is.
 */
export function buildCatalogFaces(fontItems: unknown): FontFace[] {
  if (!Array.isArray(fontItems)) {
    return [];
  }
  const faces: FontFace[] = [];
  for (const item of fontItems) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const itemRecord = item as Record<string, unknown>;
    const fileFamily = asText(itemRecord._name)?.replace(FONT_FILE_EXTENSION, "");
    const typefaces = Array.isArray(itemRecord.typefaces) ? itemRecord.typefaces : [];
    for (const typeface of typefaces) {
      if (typeof typeface !== "object" || typeface === null) {
        continue;
      }
      const face = typeface as Record<string, unknown>;
      const displayName = asText(face._name) ?? asText(face.fullname) ?? fileFamily;
      if (displayName === undefined) {
        continue;
      }
      const family = asText(face.family) ?? fileFamily ?? displayName;
      const postScriptName = asText(face.postscript_name) ?? displayName;
      const hint = [asText(face.style), asText(face.fullname), displayName].filter(
        (entry): entry is string => entry !== undefined,
      ).join(" ");

      faces.push({
        platformId: postScriptName,
        family,
        displayName,
        postScriptName,
        weight: weightFromHint(hint),
        style: styleFromHint(hint),
        stretch: "normal",
        available: true,
      });
    }
  }
  return faces;
}

export class MacOsFontCatalogAdapter implements FontCatalogAdapter {
  async getCatalog(): Promise<{ supported: boolean; faces: FontFace[]; reason: string | null }> {
    if (process.platform !== "darwin") {
      return {
        supported: false,
        faces: [],
        reason: "unsupported_platform",
      };
    }

    try {
      // Execute system_profiler to get JSON list of fonts on macOS
      const { stdout } = await execFileAsync("/usr/sbin/system_profiler", ["SPFontsDataType", "-json"], {
        maxBuffer: 20 * 1024 * 1024,
      });
      const data = JSON.parse(stdout);
      const fontItems = data?.SPFontsDataType ?? [];

      return {
        supported: true,
        faces: buildCatalogFaces(fontItems),
        reason: null,
      };
    } catch {
      // Fallback if system_profiler fails or isn't accessible
      return {
        supported: true,
        faces: [
          {
            platformId: "HiraginoSans-W3",
            family: "Hiragino Sans",
            displayName: "Hiragino Sans W3",
            postScriptName: "HiraginoSans-W3",
            weight: 400,
            style: "normal",
            stretch: "normal",
            available: true,
          },
          {
            platformId: "HiraginoSans-W6",
            family: "Hiragino Sans",
            displayName: "Hiragino Sans W6",
            postScriptName: "HiraginoSans-W6",
            weight: 700,
            style: "normal",
            stretch: "normal",
            available: true,
          },
          {
            platformId: "HiraginoMinchoProN-W3",
            family: "Hiragino Mincho ProN",
            displayName: "Hiragino Mincho ProN W3",
            postScriptName: "HiraginoMinchoProN-W3",
            weight: 400,
            style: "normal",
            stretch: "normal",
            available: true,
          },
        ],
        reason: null,
      };
    }
  }
}

export class FakeFontCatalogAdapter implements FontCatalogAdapter {
  constructor(
    private supported = true,
    private faces: FontFace[] = [],
    private reason: string | null = null,
  ) {}

  async getCatalog(): Promise<{ supported: boolean; faces: FontFace[]; reason: string | null }> {
    return {
      supported: this.supported,
      faces: this.faces,
      reason: this.reason,
    };
  }
}

function normalizeFontWeight(weight: number | string): number {
  if (typeof weight === "number" && Number.isFinite(weight)) {
    return weight;
  }
  const numeric = Number(weight);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  switch (String(weight).toLowerCase()) {
    case "bold":
    case "bolder":
      return 700;
    case "light":
    case "lighter":
      return 300;
    case "medium":
      return 500;
    case "semibold":
    case "demibold":
      return 600;
    case "black":
    case "heavy":
      return 900;
    case "normal":
    case "regular":
    default:
      return 400;
  }
}

export function findLocalFace(fontFace: FontFaceSpec, catalog: FontCatalog): FontFace | undefined {
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
  const wantedWeight = normalizeFontWeight(fontFace.weight);
  const exact = familyMatches.find(
    (face) => face.weight === wantedWeight && face.style === fontFace.style,
  );
  const styled = familyMatches.find((face) => face.style === fontFace.style);
  return exact ?? styled;
}

function describeFaceName(name: string): string {
  return `"${name.replace(/[\\"\r\n\f]/g, " ").trim()}"`;
}

export interface ResolvedThemeFontRole {
  role: VisualThemeTextRole;
  category: ThemeFontCategory;
  localFaceName: string | undefined;
  localFaceWeight: number | undefined;
  localFaceStyle: "normal" | "italic" | "oblique" | undefined;
  usesFallback: boolean;
}

export interface ThemeFontResolution {
  catalogSupported: boolean;
  verificationSupported: boolean;
  verificationReason: string | null;
  roles: ResolvedThemeFontRole[];
  missingFonts: string[];
  diagnostics: string[];
}

export class FontCatalogService {
  private cachedCatalog: FontCatalog | null = null;
  private inFlightCatalog: Promise<FontCatalog> | null = null;
  private readonly verifiedFaceNames = new Map<string, boolean>();

  constructor(
    private adapter: FontCatalogAdapter = new MacOsFontCatalogAdapter(),
    private verifier: FontFaceVerifier = new NoopFontVerifier(),
  ) {}

  async getCatalog(forceRefresh = false): Promise<FontCatalog> {
    const catalog = await this.loadCatalog(forceRefresh);
    if (this.verifiedFaceNames.size === 0) {
      return catalog;
    }
    return {
      ...catalog,
      faces: catalog.faces.map((face) => {
        const verified = this.verifiedFaceNames.get(face.postScriptName.toLowerCase());
        return verified === undefined ? face : { ...face, verifiedLocalFace: verified };
      }),
    };
  }

  private async loadCatalog(forceRefresh: boolean): Promise<FontCatalog> {
    if (forceRefresh) {
      this.verifiedFaceNames.clear();
    }
    if (this.cachedCatalog && !forceRefresh) {
      return this.cachedCatalog;
    }
    if (this.inFlightCatalog === null) {
      const pending = this.fetchAndCache();
      this.inFlightCatalog = pending;
      const clear = () => {
        if (this.inFlightCatalog === pending) {
          this.inFlightCatalog = null;
        }
      };
      pending.then(clear, clear);
      return pending;
    }
    return this.inFlightCatalog;
  }

  private async fetchAndCache(): Promise<FontCatalog> {
    const result = await this.adapter.getCatalog();
    this.cachedCatalog = {
      supported: result.supported,
      faces: result.faces,
      reason: result.reason,
      updatedAt: new Date().toISOString(),
    };
    return this.cachedCatalog;
  }

  async resolveThemeFonts(
    definition: VisualThemeDefinition,
    options: { verify: boolean },
  ): Promise<ThemeFontResolution> {
    const catalog = await this.loadCatalog(false);
    if (!catalog.supported) {
      return {
        catalogSupported: false,
        verificationSupported: false,
        verificationReason: catalog.reason,
        roles: THEME_TEXT_ROLES.map((role) => ({
          role,
          category: definition.textRoles[role].font,
          localFaceName: undefined,
          localFaceWeight: undefined,
          localFaceStyle: undefined,
          usesFallback: true,
        })),
        missingFonts: [],
        diagnostics: [
          "フォントカタログが利用できないため、すべての文字はgeneric stackで描画されます",
        ],
      };
    }

    const candidates = THEME_TEXT_ROLES.map((role) => {
      const token = definition.textRoles[role];
      return {
        role,
        category: token.font,
        fontFace: token.fontFace,
        localFace: token.fontFace === undefined ? undefined : findLocalFace(token.fontFace, catalog),
      };
    });

    let verification: LocalFaceVerification | undefined;
    if (options.verify) {
      const names = candidates.flatMap((candidate) =>
        candidate.localFace === undefined ? [] : [candidate.localFace.postScriptName],
      );
      if (names.length > 0) {
        try {
          verification = await this.verifier.verifyLocalFaces(names);
        } catch (error) {
          verification = {
            supported: false,
            reason: error instanceof Error ? error.message : String(error),
            verified: new Set(),
          };
        }
        if (verification.supported) {
          for (const name of names) {
            this.verifiedFaceNames.set(name.toLowerCase(), verification.verified.has(name));
          }
        }
      }
    }

    const diagnostics: string[] = [];
    const missing = new Set<string>();
    const roles = candidates.map((candidate) => {
      const generic = GENERIC_FONT_STACKS[candidate.category];
      const emptyRole: ResolvedThemeFontRole = {
        role: candidate.role,
        category: candidate.category,
        localFaceName: undefined,
        localFaceWeight: undefined,
        localFaceStyle: undefined,
        usesFallback: true,
      };
      if (candidate.fontFace === undefined) {
        return { ...emptyRole, usesFallback: false };
      }
      if (candidate.localFace === undefined) {
        missing.add(candidate.fontFace.family);
        diagnostics.push(
          `${candidate.role}: ${describeFaceName(candidate.fontFace.family)} に一致するlocal faceを解決できないため ${generic} を使用`,
        );
        return emptyRole;
      }
      const faceName = candidate.localFace.postScriptName;
      if (verification !== undefined && verification.supported && !verification.verified.has(faceName)) {
        missing.add(candidate.fontFace.family);
        diagnostics.push(
          `${candidate.role}: local face ${describeFaceName(faceName)} はChromiumで解決できないため ${generic} を使用`,
        );
        return emptyRole;
      }
      let suffix = "（Chromium未検証）";
      if (verification === undefined) {
        suffix = "（未検証）";
      } else if (verification.supported) {
        suffix = "";
      }
      diagnostics.push(
        `${candidate.role}: local face ${describeFaceName(faceName)} を使用${suffix}`,
      );
      return {
        role: candidate.role,
        category: candidate.category,
        localFaceName: faceName,
        localFaceWeight: candidate.localFace.weight,
        localFaceStyle: candidate.localFace.style,
        usesFallback: false,
      };
    });

    return {
      catalogSupported: true,
      verificationSupported: verification?.supported ?? false,
      verificationReason: verification?.supported === false ? verification.reason : null,
      roles,
      missingFonts: [...missing],
      diagnostics,
    };
  }

  async diagnoseTheme(
    definition: VisualThemeDefinition,
    options: { verify?: boolean } = {},
  ): Promise<{ missingFonts: string[]; diagnostics: string[] }> {
    const resolution = await this.resolveThemeFonts(definition, {
      verify: options.verify === true,
    });
    return {
      missingFonts: resolution.missingFonts,
      diagnostics: resolution.diagnostics,
    };
  }
}

let sharedFontCatalogService: FontCatalogService | undefined;

export function getSharedFontCatalogService(): FontCatalogService {
  if (sharedFontCatalogService === undefined) {
    sharedFontCatalogService = new FontCatalogService(
      new MacOsFontCatalogAdapter(),
      new ChromiumFontVerifier(),
    );
  }
  return sharedFontCatalogService;
}
