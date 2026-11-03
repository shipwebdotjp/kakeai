import { Plus, Trash2 } from "lucide-react";
import { resolveStandingLayout, type FaceSet } from "@kakeai/contracts";
import {
  DEFAULT_APPEARANCE_EXPRESSION,
  DEFAULT_APPEARANCE_POSE,
  DEFAULT_STANDING_SCALE,
  MAX_STANDING_SCALE,
  MIN_STANDING_SCALE,
  STANDING_EDGE_OPTIONS,
  STANDING_SCALE_STEP,
  STANDING_VERTICAL_OPTIONS,
  type AppearanceFormValue,
} from "../content/form";
import {
  buttonDangerClass,
  buttonNeutralClass,
  editAreaClass,
  formLabelClass,
  itemCardClass,
  textFieldClass,
} from "../ui";
import { MediaPicker } from "./MediaPicker";

interface AppearanceFieldsProps {
  appearances: AppearanceFormValue[];
  onAdd: () => void;
  onPatch: (id: string, patch: Partial<AppearanceFormValue>) => void;
  onRemove: (id: string) => void;
  faceSets?: Pick<FaceSet, "id" | "name" | "version">[];
}

function normalizeStandingScale(value: string): number {
  if (value.trim().length === 0) {
    return DEFAULT_STANDING_SCALE;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_STANDING_SCALE;
  }
  return Math.min(MAX_STANDING_SCALE, Math.max(MIN_STANDING_SCALE, parsed));
}

export function AppearanceFields({
  appearances,
  onAdd,
  onPatch,
  onRemove,
  faceSets = [],
}: AppearanceFieldsProps) {
  return (
    <div className={editAreaClass}>
      <h4 className="mb-1 text-sm font-semibold text-foreground">外観</h4>
      {appearances.map((appearance, index) => {
        const layout = resolveStandingLayout(appearance);
        return (
        <div key={appearance.id} className={itemCardClass}>
          <MediaPicker
            label={`外観 ${index + 1} の画像`}
            kinds={["image"]}
            selectedAssetId={appearance.assetId}
            onSelect={(assetId) => onPatch(appearance.id, { assetId })}
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className={formLabelClass}>
              名前
              <input
                value={appearance.label}
                placeholder="例: 夏服"
                className={textFieldClass}
                onChange={(event) => onPatch(appearance.id, { label: event.target.value })}
              />
            </label>
            <label className={formLabelClass}>
              表情
              <input
                value={appearance.expression}
                placeholder={DEFAULT_APPEARANCE_EXPRESSION}
                className={textFieldClass}
                onChange={(event) => onPatch(appearance.id, { expression: event.target.value })}
              />
            </label>
            <label className={formLabelClass}>
              ポーズ
              <input
                value={appearance.pose}
                placeholder={DEFAULT_APPEARANCE_POSE}
                className={textFieldClass}
                onChange={(event) => onPatch(appearance.id, { pose: event.target.value })}
              />
            </label>
            <label className={formLabelClass}>
              表情セット
              <select
                className={textFieldClass}
                value={appearance.faceSetId ?? ""}
                onChange={(event) => {
                  const faceSetId =
                    event.target.value === "" ? null : event.target.value;
                  const selected = faceSets.find((entry) => entry.id === faceSetId);
                  onPatch(appearance.id, {
                    faceSetId,
                    faceSetVersion:
                      faceSetId === null ? null : (selected?.version ?? null),
                  });
                }}
              >
                <option value="">なし</option>
                {appearance.faceSetId !== null &&
                  !faceSets.some((entry) => entry.id === appearance.faceSetId) && (
                    <option value={appearance.faceSetId} disabled>
                      不明な表情セット ({appearance.faceSetId})
                    </option>
                  )}
                {faceSets.map((faceSet) => (
                  <option key={faceSet.id} value={faceSet.id}>
                    {faceSet.name || faceSet.id}
                  </option>
                ))}
              </select>
              {appearance.faceSetId !== null &&
                appearance.faceSetVersion !== null && (
                  <span className="text-xs text-muted-foreground">
                    v{appearance.faceSetVersion} に固定
                  </span>
                )}
            </label>
            <button
              type="button"
              className={buttonDangerClass}
              onClick={() => onRemove(appearance.id)}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              外観を削除
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className={formLabelClass}>立ち絵の標準配置</p>
            <label className={formLabelClass}>
              倍率
              <input
                type="number"
                min={MIN_STANDING_SCALE}
                max={MAX_STANDING_SCALE}
                step={STANDING_SCALE_STEP}
                className={`w-24 ${textFieldClass}`}
                value={layout.scale}
                onChange={(event) =>
                  onPatch(appearance.id, {
                    standing: {
                      ...layout,
                      scale: normalizeStandingScale(event.target.value),
                    },
                  })
                }
              />
            </label>
            <label className={formLabelClass}>
              端からの位置
              <select
                className={textFieldClass}
                value={layout.edge}
                onChange={(event) =>
                  onPatch(appearance.id, {
                    standing: {
                      ...layout,
                      edge: event.target.value as typeof layout.edge,
                    },
                  })
                }
              >
                {STANDING_EDGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={formLabelClass}>
              高さ
              <select
                className={textFieldClass}
                value={layout.vertical}
                onChange={(event) =>
                  onPatch(appearance.id, {
                    standing: {
                      ...layout,
                      vertical:
                        event.target.value as typeof layout.vertical,
                    },
                  })
                }
              >
                {STANDING_VERTICAL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        );
      })}
      <button type="button" className={`mt-2 ${buttonNeutralClass}`} onClick={onAdd}>
        <Plus aria-hidden="true" className="h-4 w-4" />
        外観を追加
      </button>
    </div>
  );
}
