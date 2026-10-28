import { useState } from "react";
import { SUPPORTED_LOCALES, normalizeFontFaceByLocale, type FontFace, type FontFaceSpec, type SupportedLocale, type TextStyle } from "@kakeai/contracts";
import { selectableFontFaces } from "../lib/fontFaceOptions";
import { LOCALE_LABELS } from "../lib/localeLabels";
import { metaTextClass, textFieldClass } from "../ui";

export { LOCALE_LABELS } from "../lib/localeLabels";

type FontFaceLocaleTab = "common" | SupportedLocale;


const TAB_LABELS: Record<FontFaceLocaleTab, string> = {
  common: "共通",
  ...LOCALE_LABELS,
};

const TABS: FontFaceLocaleTab[] = ["common", ...SUPPORTED_LOCALES];

/**
 * Locale-tabbed Font Face picker for one Text Style. Color, size, and
 * decoration stay shared; only the face is overridable per locale.
 */
export function ThemeFontFaceField({
  style,
  fontFaces,
  fontSearch,
  onChange,
}: {
  style: TextStyle;
  fontFaces: readonly FontFace[];
  fontSearch: string;
  onChange: (updater: (style: TextStyle) => TextStyle) => void;
}) {
  const [tab, setTab] = useState<FontFaceLocaleTab>("common");
  const face = tab === "common" ? style.fontFace : style.fontFaceByLocale?.[tab];
  const faceOptions = selectableFontFaces(fontFaces, fontSearch, face?.platformId);
  const selectedFaceUnknown =
    face?.platformId !== undefined &&
    face.platformId.length > 0 &&
    !faceOptions.some((candidate) => candidate.postScriptName === face.platformId);

  const update = (next: FontFaceSpec | undefined): void => {
    onChange((current) => {
      if (tab === "common") {
        return { ...current, fontFace: next };
      }
      const dictionary: NonNullable<TextStyle["fontFaceByLocale"]> = {
        ...current.fontFaceByLocale,
        [tab]: next,
      };
      if (next === undefined) {
        delete dictionary[tab];
      }
      const normalized = normalizeFontFaceByLocale(dictionary);
      if (normalized === undefined) {
        const { fontFaceByLocale: _dropped, ...rest } = current;
        return rest;
      }
      return { ...current, fontFaceByLocale: normalized };
    });
  };

  const fallbackLabel =
    tab === "common" ? "（カテゴリ既定の標準フォント）" : `（${TAB_LABELS[tab]} は共通指定を使用）`;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1" role="group" aria-label="フォントを指定する言語">
        {TABS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={candidate === tab}
            className={`rounded border px-2 py-0.5 text-xs ${
              candidate === tab
                ? "border-brand-600 bg-brand-50 text-brand-700"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab(candidate)}
          >
            {TAB_LABELS[candidate]}
          </button>
        ))}
      </div>
      <label className="block text-xs">指定 Font Face（{TAB_LABELS[tab]}）</label>
      <select
        className={`w-full text-xs ${textFieldClass}`}
        value={face?.platformId ?? ""}
        onChange={(event) => {
          const selectedPostScriptName = event.target.value;
          if (!selectedPostScriptName) {
            update(undefined);
            return;
          }
          const found = fontFaces.find(
            (candidate) => candidate.postScriptName === selectedPostScriptName,
          );
          if (found === undefined) {
            return;
          }
          update({
            family: found.family,
            platformId: found.postScriptName,
            weight: found.weight,
            style: found.style,
            fallbacks: [],
          });
        }}
      >
        <option value="">{fallbackLabel}</option>
        {selectedFaceUnknown && (
          <option value={face?.platformId ?? ""}>（この端末にないフォント: {face?.family}）</option>
        )}
        {faceOptions.map((candidate) => (
          <option key={candidate.postScriptName} value={candidate.postScriptName}>
            {candidate.displayName} ({candidate.family})
          </option>
        ))}
      </select>
      {tab !== "common" && style.fontFaceByLocale?.[tab] === undefined && (
        <p className={metaTextClass}>この言語では共通タブのフォントを使います。</p>
      )}
    </div>
  );
}
