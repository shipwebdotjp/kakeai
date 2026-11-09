import type { LiveListState } from "@kakeai/contracts";
import {
  addListItem,
  LIVE_LIST_MAX_ITEMS,
  removeListItem,
  setActiveListItem,
  updateListItem,
} from "../../model/cards";
import { createLiveLocalId } from "../../model/ids";
import { iconButtonClass, metaTextClass, textFieldClass } from "../../../ui";
import { setOptionalText } from "./optional-field";
import {
  isBlankText,
  requiredFieldClass,
  requiredMessageClass,
} from "./required-field";

interface ListStateFieldsProps {
  state: LiveListState;
  onChange: (state: LiveListState) => void;
}

export function ListStateFields({ state, onChange }: ListStateFieldsProps) {
  const itemsFull = state.items.length >= LIVE_LIST_MAX_ITEMS;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="block text-sm">
          タイトル
          <input
            className={`mt-1 w-full ${textFieldClass}`}
            value={state.title ?? ""}
            onChange={(event) =>
              onChange(setOptionalText(state, "title", event.target.value))
            }
          />
        </label>
        <label className="flex items-end gap-1 text-sm">
          <input
            type="checkbox"
            checked={state.ordered}
            onChange={(event) => onChange({ ...state, ordered: event.target.checked })}
          />
          番号付き
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="m-0 text-sm font-medium">項目（この状態で表示する完全なスナップショット）</p>
          <button
            type="button"
            className="text-sm text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
            disabled={itemsFull}
            title={
              itemsFull ? `項目は最大${LIVE_LIST_MAX_ITEMS}件までです。` : undefined
            }
            onClick={() => {
              const id = createLiveLocalId("item");
              const next = addListItem(state, { id, text: "新しい項目" });
              if (next !== state) {
                onChange(next);
              }
            }}
          >
            項目を追加
          </button>
        </div>
        {itemsFull && (
          <p className={`m-0 mt-1 ${metaTextClass}`}>
            項目は最大{LIVE_LIST_MAX_ITEMS}件までです。追加するには既存の項目を削除してください。
          </p>
        )}
        {state.items.length === 0 && (
          <p className="mt-1 text-sm text-muted-foreground">
            項目がありません（まだ何も表示しない状態）。
          </p>
        )}
        <ul className="m-0 mt-1 list-none space-y-1 p-0">
          {state.items.map((item) => {
            const textMissing = isBlankText(item.text);
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-1">
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input
                    type="radio"
                    name={`active-${state.id}`}
                    checked={state.activeItemId === item.id}
                    onChange={() => onChange(setActiveListItem(state, item.id))}
                    aria-label={`${item.id} をアクティブにする`}
                  />
                  強調
                </label>
                <input
                  className={`min-w-40 flex-1 ${textFieldClass} ${textMissing ? requiredFieldClass : ""}`}
                  value={item.text}
                  aria-invalid={textMissing}
                  onChange={(event) =>
                    onChange(updateListItem(state, item.id, { text: event.target.value }))
                  }
                  aria-label="項目テキスト"
                />
                <input
                  className={`w-32 ${textFieldClass}`}
                  value={item.note ?? ""}
                  placeholder="補足"
                  onChange={(event) =>
                    onChange(
                      updateListItem(state, item.id, {
                        note: event.target.value === "" ? undefined : event.target.value,
                      }),
                    )
                  }
                  aria-label="項目の補足"
                />
                <span className="text-[10px] text-muted-foreground" title="状態をまたいで使う安定ID">
                  {item.id}
                </span>
                <button
                  type="button"
                  className={iconButtonClass}
                  aria-label={`${item.text} を削除`}
                  onClick={() => onChange(removeListItem(state, item.id))}
                >
                  ×
                </button>
                {textMissing && (
                  <span className={`w-full ${requiredMessageClass}`}>
                    項目テキストは必須です。
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-1 text-xs text-muted-foreground">
          項目IDは状態をまたいで同じものを使います。状態を複製して追加分だけ編集すると差分表示になります。
        </p>
      </div>
    </div>
  );
}
