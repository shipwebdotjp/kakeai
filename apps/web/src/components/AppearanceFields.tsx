import {
  DEFAULT_APPEARANCE_EXPRESSION,
  DEFAULT_APPEARANCE_POSE,
  type AppearanceFormValue,
} from "../content/form";
import { buttonDangerClass, buttonNeutralClass, textFieldClass } from "../ui";
import { MediaPicker } from "./MediaPicker";

interface AppearanceFieldsProps {
  appearances: AppearanceFormValue[];
  onAdd: () => void;
  onPatch: (id: string, patch: Partial<AppearanceFormValue>) => void;
  onRemove: (id: string) => void;
}

export function AppearanceFields({
  appearances,
  onAdd,
  onPatch,
  onRemove,
}: AppearanceFieldsProps) {
  return (
    <div className="mt-3 border-t border-dashed border-border pt-2">
      <p className="mb-1 text-sm font-medium">外観</p>
      {appearances.map((appearance, index) => (
        <div key={appearance.id} className="my-2 rounded border border-border p-2">
          <MediaPicker
            label={`外観 ${index + 1} の画像`}
            kinds={["image"]}
            selectedAssetId={appearance.assetId}
            onSelect={(assetId) => onPatch(appearance.id, { assetId })}
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5">
              名前
              <input
                value={appearance.label}
                placeholder="例: 夏服"
                className={textFieldClass}
                onChange={(event) => onPatch(appearance.id, { label: event.target.value })}
              />
            </label>
            <label className="inline-flex items-center gap-1.5">
              表情
              <input
                value={appearance.expression}
                placeholder={DEFAULT_APPEARANCE_EXPRESSION}
                className={textFieldClass}
                onChange={(event) => onPatch(appearance.id, { expression: event.target.value })}
              />
            </label>
            <label className="inline-flex items-center gap-1.5">
              ポーズ
              <input
                value={appearance.pose}
                placeholder={DEFAULT_APPEARANCE_POSE}
                className={textFieldClass}
                onChange={(event) => onPatch(appearance.id, { pose: event.target.value })}
              />
            </label>
            <button
              type="button"
              className={buttonDangerClass}
              onClick={() => onRemove(appearance.id)}
            >
              外観を削除
            </button>
          </div>
        </div>
      ))}
      <button type="button" className={buttonNeutralClass} onClick={onAdd}>
        外観を追加
      </button>
    </div>
  );
}
