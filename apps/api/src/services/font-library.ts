import type { FontCatalog, FontFace } from "@kakeai/contracts";

export interface FontSearchInput {
  query?: string | undefined;
  style?: FontFace["style"] | undefined;
  minWeight?: number | undefined;
  maxWeight?: number | undefined;
  available?: boolean | undefined;
  limit: number;
  offset: number;
}

export interface FontSearchResult {
  fonts: FontFace[];
  total: number;
  nextOffset: number | null;
  catalog: {
    supported: boolean;
    reason: string | null;
    updatedAt: string;
  };
}

const STYLE_ORDER: Record<FontFace["style"], number> = {
  normal: 0,
  italic: 1,
  oblique: 2,
};

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * A stable page order. The catalog is a cached snapshot, so paging by offset is
 * safe as long as the order is deterministic; sorting on the face identity last
 * keeps equal (family, weight, style) faces from swapping between pages.
 */
function compareFaces(left: FontFace, right: FontFace): number {
  return (
    compareText(left.family, right.family) ||
    left.weight - right.weight ||
    STYLE_ORDER[left.style] - STYLE_ORDER[right.style] ||
    compareText(left.postScriptName, right.postScriptName)
  );
}

function matchesQuery(face: FontFace, query: string): boolean {
  return [face.family, face.displayName, face.postScriptName].some((value) =>
    value.toLowerCase().includes(query),
  );
}

/** Filters and pages the installed Font Catalog for `font.list`. */
export function searchFonts(
  catalog: FontCatalog,
  input: FontSearchInput,
): FontSearchResult {
  const query = input.query?.toLowerCase();
  const matches = catalog.faces.filter((face) => {
    if (query !== undefined && !matchesQuery(face, query)) {
      return false;
    }
    if (input.style !== undefined && face.style !== input.style) {
      return false;
    }
    if (input.minWeight !== undefined && face.weight < input.minWeight) {
      return false;
    }
    if (input.maxWeight !== undefined && face.weight > input.maxWeight) {
      return false;
    }
    if (input.available !== undefined && face.available !== input.available) {
      return false;
    }
    return true;
  });
  matches.sort(compareFaces);

  const fonts = matches.slice(input.offset, input.offset + input.limit);
  const next = input.offset + fonts.length;
  return {
    fonts,
    total: matches.length,
    nextOffset: next < matches.length ? next : null,
    catalog: {
      supported: catalog.supported,
      reason: catalog.reason,
      updatedAt: catalog.updatedAt,
    },
  };
}
