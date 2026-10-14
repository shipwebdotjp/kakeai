import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FontCatalog, FontFace, VisualThemeDefinition } from "@kakeai/contracts";

const execFileAsync = promisify(execFile);

export function escapeCssFontFamily(name: string): string {
  const sanitized = name.replace(/['"\\;{}()<>&]/g, "").trim();
  if (sanitized.length === 0) {
    return "sans-serif";
  }
  return `'${sanitized}'`;
}

export interface FontCatalogAdapter {
  getCatalog(): Promise<{ supported: boolean; faces: FontFace[]; reason: string | null }>;
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
      const faces: FontFace[] = [];

      for (const item of fontItems) {
        const family = typeof item._name === "string" ? item._name : "Unknown";
        const typefaces = Array.isArray(item.typefaces) ? item.typefaces : [];
        for (const face of typefaces) {
          const displayName = typeof face._name === "string" ? face._name : family;
          const postScriptName = typeof face.postscript_name === "string" ? face.postscript_name : displayName;
          const styleStr = typeof face.style === "string" ? face.style.toLowerCase() : "normal";
          const style = styleStr.includes("italic") ? "italic" : styleStr.includes("oblique") ? "oblique" : "normal";
          const weight = styleStr.includes("bold") ? 700 : 400;

          faces.push({
            platformId: postScriptName,
            family,
            displayName,
            postScriptName,
            weight,
            style,
            stretch: "normal",
            available: true,
          });
        }
      }

      return {
        supported: true,
        faces,
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

export class FontCatalogService {
  private cachedCatalog: FontCatalog | null = null;
  private inFlightCatalog: Promise<FontCatalog> | null = null;

  constructor(private adapter: FontCatalogAdapter = new MacOsFontCatalogAdapter()) {}

  async getCatalog(forceRefresh = false): Promise<FontCatalog> {
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

  async diagnoseTheme(definition: VisualThemeDefinition): Promise<{ missingFonts: string[] }> {
    const catalog = await this.getCatalog();
    if (!catalog.supported || catalog.faces.length === 0) {
      return { missingFonts: [] };
    }

    const availableFamilies = new Set(catalog.faces.map((f) => f.family.toLowerCase()));
    const availablePostScripts = new Set(catalog.faces.map((f) => f.postScriptName.toLowerCase()));

    const missingFonts = new Set<string>();

    for (const token of Object.values(definition.textRoles)) {
      if (token.fontFace) {
        const familyLower = token.fontFace.family.toLowerCase();
        const platformLower = token.fontFace.platformId?.toLowerCase();
        const found =
          availableFamilies.has(familyLower) ||
          (platformLower && availablePostScripts.has(platformLower));
        if (!found) {
          missingFonts.add(token.fontFace.family);
        }
      }
    }

    return { missingFonts: Array.from(missingFonts) };
  }
}

let sharedFontCatalogService: FontCatalogService | undefined;

export function getSharedFontCatalogService(): FontCatalogService {
  if (sharedFontCatalogService === undefined) {
    sharedFontCatalogService = new FontCatalogService();
  }
  return sharedFontCatalogService;
}
