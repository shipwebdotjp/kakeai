import { useState, type ReactNode } from "react";
import type {
  FontFace,
  ResolvedThumbnailAppearance,
  ResolvedThumbnailTextStyle,
  ThumbnailAppearance,
  ThumbnailTextAppearance,
} from "@kakeai/contracts";
import { selectableFontFaces } from "../lib/fontFaceOptions";
import {
  clearAccent,
  clearOutlineValue,
  clearScrimValue,
  clearTextDecoration,
  clearTextValue,
  setAccent,
  setDecorationValue,
  setOutlineValue,
  setScrimValue,
  setTextDecoration,
  setTextValue,
  type ThumbnailDecorationKey,
  type ThumbnailTextRole,
} from "../lib/thumbnailAppearance";
import {
  buttonNeutralClass,
  colorFieldClass,
  metaTextClass,
  textFieldClass,
} from "../ui";

const FONT_CATEGORIES = [
  "sans",
  "serif",
  "mono",
] as const satisfies readonly ResolvedThumbnailTextStyle["font"][];

const FONT_CATEGORY_LABELS: Record<ResolvedThumbnailTextStyle["font"], string> = {
  sans: "ゴシック",
  serif: "明朝",
  mono: "等幅",
};

const DECORATION_LABELS: Record<ThumbnailDecorationKey, string> = {
  bold: "太字",
  italic: "斜体",
  outline: "縁取り",
  shadow: "影",
};

function toFontFaceSpec(face: FontFace) {
  return {
    family: face.family,
    platformId: face.postScriptName,
    weight: face.weight,
    style: face.style,
    fallbacks: [],
  };
}

function PropertyRow({
  label,
  overridden,
  onToggle,
  inherited,
  children,
}: {
  label: string;
  overridden: boolean;
  onToggle: (overridden: boolean) => void;
  inherited: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label className="inline-flex w-28 shrink-0 items-center gap-1">
        <input
          type="checkbox"
          checked={overridden}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <span>{label}</span>
      </label>
      {overridden ? (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      ) : (
        <span className={metaTextClass}>{inherited}</span>
      )}
    </div>
  );
}

function TextRoleEditor({
  role,
  label,
  base,
  value,
  onChange,
  fontFaces,
  fontCatalogSupported,
  fontSearch,
  idPrefix,
}: {
  role: ThumbnailTextRole;
  label: string;
  base: ResolvedThumbnailTextStyle;
  value: ThumbnailAppearance | null;
  onChange: (value: ThumbnailAppearance | null) => void;
  fontFaces: readonly FontFace[];
  fontCatalogSupported: boolean;
  fontSearch: string;
  idPrefix: string;
}) {
  const text: ThumbnailTextAppearance = value?.[role] ?? {};
  const faceOptions = selectableFontFaces(fontFaces, fontSearch, text.fontFace?.platformId);
  const inheritedFace =
    base.fontFace === undefined ? "カテゴリ既定" : base.fontFace.family;

  return (
    <fieldset className="rounded border border-border p-2">
      <legend className="px-1 text-xs font-semibold">{label}</legend>
      <div className="grid gap-1">
        <label className="flex flex-wrap items-center gap-2 text-xs">
          <span className="w-28 shrink-0">カテゴリ</span>
          <select
            id={`${idPrefix}-${role}-font`}
            className={textFieldClass}
            value={text.font ?? ""}
            onChange={(event) => {
              const selected = event.target.value;
              const font = FONT_CATEGORIES.find((candidate) => candidate === selected);
              onChange(
                font === undefined
                  ? clearTextValue(value, role, "font")
                  : setTextValue(value, role, "font", font),
              );
            }}
          >
            <option value="">継承（{FONT_CATEGORY_LABELS[base.font]}）</option>
            {FONT_CATEGORIES.map((font) => (
              <option key={font} value={font}>
                {FONT_CATEGORY_LABELS[font]}
              </option>
            ))}
          </select>
        </label>

        {fontCatalogSupported ? (
          <label className="flex flex-wrap items-center gap-2 text-xs">
            <span className="w-28 shrink-0">Font Face</span>
            <select
              id={`${idPrefix}-${role}-face`}
              className={textFieldClass}
              value={text.fontFace?.platformId ?? ""}
              onChange={(event) => {
                const selected = event.target.value;
                if (selected.length === 0) {
                  onChange(clearTextValue(value, role, "fontFace"));
                  return;
                }
                const face = fontFaces.find((candidate) => candidate.postScriptName === selected);
                if (face !== undefined) {
                  onChange(setTextValue(value, role, "fontFace", toFontFaceSpec(face)));
                }
              }}
            >
              <option value="">継承（{inheritedFace}）</option>
              {text.fontFace?.platformId !== undefined &&
                !faceOptions.some(
                  (face) => face.postScriptName === text.fontFace?.platformId,
                ) && (
                  <option value={text.fontFace.platformId}>
                    （この端末にないフォント: {text.fontFace.family}）
                  </option>
                )}
              {faceOptions.map((face) => (
                <option key={face.postScriptName} value={face.postScriptName}>
                  {face.displayName}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="w-28 shrink-0">Font Face</span>
            <span className={metaTextClass}>{text.fontFace?.family ?? inheritedFace}</span>
            {text.fontFace !== undefined && (
              <button
                type="button"
                className={buttonNeutralClass}
                onClick={() => onChange(clearTextValue(value, role, "fontFace"))}
              >
                解除
              </button>
            )}
          </div>
        )}

        <PropertyRow
          label="サイズ"
          overridden={text.fontSize !== undefined}
          inherited={`${base.fontSize}（1080基準）`}
          onToggle={(overridden) =>
            onChange(
              overridden
                ? setTextValue(value, role, "fontSize", base.fontSize)
                : clearTextValue(value, role, "fontSize"),
            )
          }
        >
          <input
            type="number"
            min={8}
            max={240}
            step={1}
            className={`${textFieldClass} w-24`}
            value={text.fontSize ?? ""}
            onChange={(event) => {
              const raw = event.target.value;
              if (raw === "") {
                onChange(clearTextValue(value, role, "fontSize"));
                return;
              }
              const parsed = Number(raw);
              if (Number.isFinite(parsed)) {
                onChange(
                  setTextValue(value, role, "fontSize", Math.min(240, Math.max(8, Math.round(parsed)))),
                );
              }
            }}
          />
          <span className={metaTextClass}>1080基準px</span>
        </PropertyRow>

        <PropertyRow
          label="色"
          overridden={text.color !== undefined}
          inherited={base.color}
          onToggle={(overridden) =>
            onChange(
              overridden
                ? setTextValue(value, role, "color", base.color)
                : clearTextValue(value, role, "color"),
            )
          }
        >
          <input
            type="color"
            className={colorFieldClass}
            value={text.color ?? base.color}
            onChange={(event) =>
              onChange(setTextValue(value, role, "color", event.target.value.toUpperCase()))
            }
          />
          <span className={metaTextClass}>{text.color ?? base.color}</span>
        </PropertyRow>

        <PropertyRow
          label="行間"
          overridden={text.lineHeight !== undefined}
          inherited={String(base.lineHeight)}
          onToggle={(overridden) =>
            onChange(
              overridden
                ? setTextValue(value, role, "lineHeight", base.lineHeight)
                : clearTextValue(value, role, "lineHeight"),
            )
          }
        >
          <input
            type="number"
            min={1}
            max={3}
            step={0.1}
            className={`${textFieldClass} w-24`}
            value={text.lineHeight ?? ""}
            onChange={(event) => {
              const raw = event.target.value;
              if (raw === "") {
                onChange(clearTextValue(value, role, "lineHeight"));
                return;
              }
              const parsed = Number(raw);
              if (Number.isFinite(parsed)) {
                onChange(
                  setTextValue(value, role, "lineHeight", Math.min(3, Math.max(1, parsed))),
                );
              }
            }}
          />
        </PropertyRow>

        <div className="flex flex-wrap items-start gap-2 text-xs">
          <label className="inline-flex w-28 shrink-0 items-center gap-1">
            <input
              type="checkbox"
              checked={text.decoration !== undefined}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? setTextDecoration(value, role, { ...base.decoration })
                    : clearTextDecoration(value, role),
                )
              }
            />
            <span>装飾</span>
          </label>
          {text.decoration === undefined ? (
            <span className={metaTextClass}>
              {Object.entries(base.decoration)
                .filter(([, enabled]) => enabled)
                .map(([key]) => DECORATION_LABELS[key as ThumbnailDecorationKey])
                .join("・") || "なし"}
            </span>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(Object.keys(DECORATION_LABELS) as ThumbnailDecorationKey[]).map((key) => (
                <label key={key} className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={text.decoration?.[key] ?? base.decoration[key]}
                    onChange={(event) =>
                      onChange(setDecorationValue(value, role, key, event.target.checked))
                    }
                  />
                  <span>{DECORATION_LABELS[key]}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <PropertyRow
          label="縁取り色"
          overridden={text.outline?.color !== undefined}
          inherited={base.outline.color === null ? "自動（コントラスト優先）" : base.outline.color}
          onToggle={(overridden) =>
            onChange(
              overridden
                ? setOutlineValue(value, role, "color", base.outline.color ?? "#FFFFFF")
                : clearOutlineValue(value, role, "color"),
            )
          }
        >
          <input
            type="color"
            className={colorFieldClass}
            value={text.outline?.color ?? base.outline.color ?? "#FFFFFF"}
            onChange={(event) =>
              onChange(setOutlineValue(value, role, "color", event.target.value.toUpperCase()))
            }
          />
          <span className={metaTextClass}>
            {text.outline?.color ?? "自動（コントラスト優先）"}
          </span>
        </PropertyRow>

        <PropertyRow
          label="縁取りの太さ"
          overridden={text.outline?.width !== undefined}
          inherited={`${base.outline.width}（1080基準）`}
          onToggle={(overridden) =>
            onChange(
              overridden
                ? setOutlineValue(value, role, "width", base.outline.width)
                : clearOutlineValue(value, role, "width"),
            )
          }
        >
          <input
            type="number"
            min={0}
            max={12}
            step={1}
            className={`${textFieldClass} w-24`}
            value={text.outline?.width ?? ""}
            onChange={(event) => {
              const raw = event.target.value;
              if (raw === "") {
                onChange(clearOutlineValue(value, role, "width"));
                return;
              }
              const parsed = Number(raw);
              if (Number.isFinite(parsed)) {
                onChange(
                  setOutlineValue(value, role, "width", Math.min(12, Math.max(0, Math.round(parsed)))),
                );
              }
            }}
          />
          <span className={metaTextClass}>0でなし</span>
        </PropertyRow>

        <p className={metaTextClass}>
          「%%」の部分縁取りにも同じ色・太さが使われます。
        </p>
      </div>
    </fieldset>
  );
}

export interface ThumbnailAppearanceEditorProps {
  base: ResolvedThumbnailAppearance;
  value: ThumbnailAppearance | null;
  onChange: (value: ThumbnailAppearance | null) => void;
  fontFaces: readonly FontFace[];
  fontCatalogSupported: boolean;
  idPrefix: string;
  resetLabel?: string;
}

export function ThumbnailAppearanceEditor({
  base,
  value,
  onChange,
  fontFaces,
  fontCatalogSupported,
  idPrefix,
  resetLabel = "すべてThemeに戻す",
}: ThumbnailAppearanceEditorProps) {
  const [fontSearch, setFontSearch] = useState("");

  return (
    <div className="space-y-3">
      {fontCatalogSupported && fontFaces.length > 0 && (
        <label className="block text-xs">
          <span className="font-semibold">Font Face 検索</span>
          <input
            type="text"
            className={`${textFieldClass} mt-1 w-full`}
            placeholder="フォントファミリー名で検索…"
            value={fontSearch}
            onChange={(event) => setFontSearch(event.target.value)}
          />
        </label>
      )}
      <TextRoleEditor
        role="headline"
        label="見出し"
        base={base.headline}
        value={value}
        onChange={onChange}
        fontFaces={fontFaces}
        fontCatalogSupported={fontCatalogSupported}
        fontSearch={fontSearch}
        idPrefix={idPrefix}
      />
      <TextRoleEditor
        role="subline"
        label="補足文"
        base={base.subline}
        value={value}
        onChange={onChange}
        fontFaces={fontFaces}
        fontCatalogSupported={fontCatalogSupported}
        fontSearch={fontSearch}
        idPrefix={idPrefix}
      />

      <fieldset className="rounded border border-border p-2">
        <legend className="px-1 text-xs font-semibold">強調色</legend>
        <PropertyRow
          label="アクセント"
          overridden={value?.accent !== undefined}
          inherited={base.accent}
          onToggle={(overridden) =>
            onChange(overridden ? setAccent(value, base.accent) : clearAccent(value))
          }
        >
          <input
            type="color"
            className={colorFieldClass}
            value={value?.accent ?? base.accent}
            onChange={(event) => onChange(setAccent(value, event.target.value.toUpperCase()))}
          />
          <span className={metaTextClass}>{value?.accent ?? base.accent}</span>
        </PropertyRow>
        <p className={metaTextClass}>
          独自の色は自動補正しません。プレビューで読みやすさを確認してください。
        </p>
      </fieldset>

      <fieldset className="rounded border border-border p-2">
        <legend className="px-1 text-xs font-semibold">scrim（写真の暗幕）</legend>
        <PropertyRow
          label="色"
          overridden={value?.scrim?.color !== undefined}
          inherited={base.scrim.color}
          onToggle={(overridden) =>
            onChange(
              overridden
                ? setScrimValue(value, "color", base.scrim.color)
                : clearScrimValue(value, "color"),
            )
          }
        >
          <input
            type="color"
            className={colorFieldClass}
            value={value?.scrim?.color ?? base.scrim.color}
            onChange={(event) => onChange(setScrimValue(value, "color", event.target.value.toUpperCase()))}
          />
          <span className={metaTextClass}>{value?.scrim?.color ?? base.scrim.color}</span>
        </PropertyRow>
        <PropertyRow
          label="不透明度"
          overridden={value?.scrim?.opacity !== undefined}
          inherited={String(base.scrim.opacity)}
          onToggle={(overridden) =>
            onChange(
              overridden
                ? setScrimValue(value, "opacity", base.scrim.opacity)
                : clearScrimValue(value, "opacity"),
            )
          }
        >
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            className={`${textFieldClass} w-24`}
            value={value?.scrim?.opacity ?? ""}
            onChange={(event) => {
              const raw = event.target.value;
              if (raw === "") {
                onChange(clearScrimValue(value, "opacity"));
                return;
              }
              const parsed = Number(raw);
              if (Number.isFinite(parsed)) {
                onChange(setScrimValue(value, "opacity", Math.min(1, Math.max(0, parsed))));
              }
            }}
          />
        </PropertyRow>
      </fieldset>

      <div className="flex justify-end">
        <button
          type="button"
          className={buttonNeutralClass}
          disabled={value === null}
          onClick={() => onChange(null)}
        >
          {resetLabel}
        </button>
      </div>
    </div>
  );
}
