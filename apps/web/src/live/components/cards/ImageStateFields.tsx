import type { Asset, LiveImageState } from "@kakeai/contracts";
import { textFieldClass } from "../../../ui";
import { setOptionalText } from "./optional-field";

interface ImageStateFieldsProps {
  state: LiveImageState;
  imageAssets: readonly Asset[];
  onChange: (state: LiveImageState) => void;
}

export function ImageStateFields({ state, imageAssets, onChange }: ImageStateFieldsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm sm:col-span-2">
        画像 Asset
        <select
          className={`mt-1 w-full ${textFieldClass}`}
          value={state.assetId}
          onChange={(event) => {
            const assetId = event.target.value;
            // Never write an empty id; the contract requires an existing asset.
            if (assetId === "") {
              return;
            }
            onChange({ ...state, assetId });
          }}
        >
          {!imageAssets.some((asset) => asset.id === state.assetId) && (
            <option value={state.assetId} disabled>
              {state.assetId === ""
                ? "画像アセットがありません"
                : `${state.assetId}（未登録）`}
            </option>
          )}
          {imageAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.originalFilename}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        代替テキスト
        <input
          className={`mt-1 w-full ${textFieldClass}`}
          value={state.alt ?? ""}
          onChange={(event) =>
            onChange(setOptionalText(state, "alt", event.target.value))
          }
        />
      </label>
      <label className="block text-sm">
        フィット
        <select
          className={`mt-1 w-full ${textFieldClass}`}
          value={state.fit}
          onChange={(event) =>
            onChange({ ...state, fit: event.target.value === "contain" ? "contain" : "cover" })
          }
        >
          <option value="cover">全体を覆う</option>
          <option value="contain">全体を表示</option>
        </select>
      </label>
      <label className="block text-sm">
        キャプション
        <input
          className={`mt-1 w-full ${textFieldClass}`}
          value={state.caption ?? ""}
          onChange={(event) =>
            onChange(setOptionalText(state, "caption", event.target.value))
          }
        />
      </label>
      <label className="block text-sm">
        クレジット
        <input
          className={`mt-1 w-full ${textFieldClass}`}
          value={state.credit ?? ""}
          onChange={(event) =>
            onChange(setOptionalText(state, "credit", event.target.value))
          }
        />
      </label>
    </div>
  );
}
