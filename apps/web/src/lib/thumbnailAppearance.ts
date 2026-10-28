import {
  normalizeFontFaceByLocale,
  normalizeThumbnailAppearance,
  type FontFaceSpec,
  type SupportedLocale,
  type ThumbnailAppearance,
  type ThumbnailTextAppearance,
} from "@kakeai/contracts";

export type ThumbnailTextRole = "headline" | "subline";
export type ThumbnailTextScalarKey = "font" | "fontSize" | "color" | "lineHeight";
export type ThumbnailDecorationKey = keyof NonNullable<
  ThumbnailTextAppearance["decoration"]
>;
export type ThumbnailOutlineKey = "color" | "width";
export type ThumbnailScrimKey = "color" | "opacity";

function updateRoot(
  current: ThumbnailAppearance | null,
  update: (next: ThumbnailAppearance) => void,
): ThumbnailAppearance | null {
  const next: ThumbnailAppearance = { ...(current ?? {}) };
  update(next);
  return normalizeThumbnailAppearance(next);
}

function updateText(
  current: ThumbnailAppearance | null,
  role: ThumbnailTextRole,
  update: (text: ThumbnailTextAppearance) => void,
): ThumbnailAppearance | null {
  const text: ThumbnailTextAppearance = { ...(current?.[role] ?? {}) };
  update(text);
  return updateRoot(current, (next) => {
    if (Object.keys(text).length === 0) {
      delete next[role];
    } else {
      next[role] = text;
    }
  });
}

export function setTextValue<K extends ThumbnailTextScalarKey>(
  current: ThumbnailAppearance | null,
  role: ThumbnailTextRole,
  key: K,
  value: NonNullable<ThumbnailTextAppearance[K]>,
): ThumbnailAppearance | null {
  return updateText(current, role, (text) => {
    text[key] = value;
  });
}

export function clearTextValue(
  current: ThumbnailAppearance | null,
  role: ThumbnailTextRole,
  key: ThumbnailTextScalarKey,
): ThumbnailAppearance | null {
  return updateText(current, role, (text) => {
    delete text[key];
  });
}

export function setTextDecoration(
  current: ThumbnailAppearance | null,
  role: ThumbnailTextRole,
  decoration: NonNullable<ThumbnailTextAppearance["decoration"]>,
): ThumbnailAppearance | null {
  return updateText(current, role, (text) => {
    text.decoration = decoration;
  });
}

export function setTextFontFaceForLocale(
  current: ThumbnailAppearance | null,
  role: ThumbnailTextRole,
  locale: SupportedLocale,
  face: FontFaceSpec,
): ThumbnailAppearance | null {
  return updateText(current, role, (text) => {
    const normalized = normalizeFontFaceByLocale({
      ...text.fontFaceByLocale,
      [locale]: face,
    });
    if (normalized === undefined) {
      delete text.fontFaceByLocale;
    } else {
      text.fontFaceByLocale = normalized;
    }
  });
}

export function clearTextFontFaceForLocale(
  current: ThumbnailAppearance | null,
  role: ThumbnailTextRole,
  locale: SupportedLocale,
): ThumbnailAppearance | null {
  return updateText(current, role, (text) => {
    if (text.fontFaceByLocale === undefined) {
      return;
    }
    const dictionary = { ...text.fontFaceByLocale };
    delete dictionary[locale];
    const normalized = normalizeFontFaceByLocale(dictionary);
    if (normalized === undefined) {
      delete text.fontFaceByLocale;
    } else {
      text.fontFaceByLocale = normalized;
    }
  });
}

export function clearTextDecoration(
  current: ThumbnailAppearance | null,
  role: ThumbnailTextRole,
): ThumbnailAppearance | null {
  return updateText(current, role, (text) => {
    delete text.decoration;
  });
}

export function setDecorationValue(
  current: ThumbnailAppearance | null,
  role: ThumbnailTextRole,
  key: ThumbnailDecorationKey,
  value: boolean,
): ThumbnailAppearance | null {
  return updateText(current, role, (text) => {
    text.decoration = { ...(text.decoration ?? {}), [key]: value };
  });
}

export function setOutlineValue(
  current: ThumbnailAppearance | null,
  role: ThumbnailTextRole,
  key: ThumbnailOutlineKey,
  value: string | number,
): ThumbnailAppearance | null {
  return updateText(current, role, (text) => {
    text.outline = { ...(text.outline ?? {}), [key]: value };
  });
}

export function clearOutlineValue(
  current: ThumbnailAppearance | null,
  role: ThumbnailTextRole,
  key: ThumbnailOutlineKey,
): ThumbnailAppearance | null {
  return updateText(current, role, (text) => {
    if (text.outline === undefined) {
      return;
    }
    text.outline = { ...text.outline };
    delete text.outline[key];
  });
}

export function setAccent(
  current: ThumbnailAppearance | null,
  color: string,
): ThumbnailAppearance | null {
  return updateRoot(current, (next) => {
    next.accent = color;
  });
}

export function clearAccent(current: ThumbnailAppearance | null): ThumbnailAppearance | null {
  return updateRoot(current, (next) => {
    delete next.accent;
  });
}

export function setScrimValue(
  current: ThumbnailAppearance | null,
  key: ThumbnailScrimKey,
  value: string | number,
): ThumbnailAppearance | null {
  return updateRoot(current, (next) => {
    next.scrim = { ...(next.scrim ?? {}), [key]: value };
  });
}

export function clearScrimValue(
  current: ThumbnailAppearance | null,
  key: ThumbnailScrimKey,
): ThumbnailAppearance | null {
  return updateRoot(current, (next) => {
    if (next.scrim === undefined) {
      return;
    }
    next.scrim = { ...next.scrim };
    delete next.scrim[key];
  });
}
