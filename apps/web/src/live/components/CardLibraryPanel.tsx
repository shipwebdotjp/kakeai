import { useEffect, useMemo, useState } from "react";
import type { Asset, LiveCard } from "@kakeai/contracts";
import {
  addCardState,
  createLiveCard,
  createStarterState,
  duplicateCardState,
  updateCardState,
} from "../model/cards";
import { createLiveLocalId } from "../model/ids";
import { cardTypeLabel } from "../model/visual";
import { CardStateEditor } from "./CardStateEditor";
import {
  badgeNeutralClass,
  buttonNeutralClass,
  errorTextClass,
  iconButtonClass,
  metaTextClass,
  sectionTitleClass,
  textFieldClass,
} from "../../ui";

interface CardLibraryPanelProps {
  cards: readonly LiveCard[];
  imageAssets: readonly Asset[];
  focusVisual?: { cardId: string; stateId: string } | null;
  onAddCard: (card: LiveCard) => void;
  onUpdateCard: (card: LiveCard) => void;
  onRemoveCard: (cardId: string) => void;
  onRemoveState: (cardId: string, stateId: string) => void;
}

const CARD_TYPES: LiveCard["type"][] = ["headline", "image", "list", "chart", "quote"];

export function CardLibraryPanel({
  cards,
  imageAssets,
  focusVisual,
  onAddCard,
  onUpdateCard,
  onRemoveCard,
  onRemoveState,
}: CardLibraryPanelProps) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(
    cards[0]?.id ?? null,
  );
  const [selectedStateId, setSelectedStateId] = useState<string | null>(
    cards[0]?.states[0]?.id ?? null,
  );
  const [newType, setNewType] = useState<LiveCard["type"]>("headline");
  const [newImageAssetId, setNewImageAssetId] = useState(imageAssets[0]?.id ?? "");
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);

  useEffect(() => {
    if (newImageAssetId === "" && imageAssets[0] !== undefined) {
      setNewImageAssetId(imageAssets[0].id);
    }
  }, [imageAssets, newImageAssetId]);

  const selectedCard = useMemo(
    () => cards.find((card) => card.id === selectedCardId) ?? cards[0] ?? null,
    [cards, selectedCardId],
  );
  const selectedState = useMemo(
    () =>
      selectedCard?.states.find((state) => state.id === selectedStateId) ??
      selectedCard?.states[0] ??
      null,
    [selectedCard, selectedStateId],
  );

  useEffect(() => {
    if (focusVisual !== null && focusVisual !== undefined) {
      setSelectedCardId(focusVisual.cardId);
      setSelectedStateId(focusVisual.stateId);
    }
  }, [focusVisual?.cardId, focusVisual?.stateId]);

  useEffect(() => {
    if (selectedCard === null) {
      setSelectedCardId(cards[0]?.id ?? null);
      setSelectedStateId(cards[0]?.states[0]?.id ?? null);
      return;
    }
    if (selectedCard.id !== selectedCardId) {
      setSelectedCardId(selectedCard.id);
    }
    if (
      selectedState === null ||
      selectedCard.states.every((state) => state.id !== selectedState?.id)
    ) {
      setSelectedStateId(selectedCard.states[0]?.id ?? null);
    }
  }, [cards, selectedCard, selectedCardId, selectedState]);

  const addCard = () => {
    try {
      const card = createLiveCard({
        id: createLiveLocalId("card"),
        stateId: createLiveLocalId("state"),
        type: newType,
        ...(newType === "image" ? { imageAssetId: newImageAssetId } : {}),
        ...(newName.trim() === "" ? {} : { name: newName.trim() }),
      });
      onAddCard(card);
      setSelectedCardId(card.id);
      setSelectedStateId(card.states[0]?.id ?? null);
      setNewName("");
      setStateError(null);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "カードを作成できませんでした。",
      );
    }
  };

  return (
    <section className="space-y-3">
      <div className="rounded-lg border border-border bg-surface p-3">
        <h2 className={sectionTitleClass}>カード一覧</h2>
        {cards.length === 0 ? (
          <p className={metaTextClass}>カードがありません。下のフォームから追加できます。</p>
        ) : (
          <ul className="m-0 mt-2 list-none space-y-1 p-0">
            {cards.map((card) => (
              <li
                key={card.id}
                className={`flex items-center gap-1 rounded border px-2 py-1 ${
                  selectedCard?.id === card.id
                    ? "border-brand-500 bg-brand-50 dark:bg-brand-950/30"
                    : "border-border"
                }`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left text-sm"
                  onClick={() => {
                    setSelectedCardId(card.id);
                    setSelectedStateId(card.states[0]?.id ?? null);
                    setStateError(null);
                  }}
                >
                  <span className="min-w-0 flex-1 break-words">
                    {card.name ?? card.id}
                  </span>
                  <span className={badgeNeutralClass}>{cardTypeLabel(card.type)}</span>
                  <span className="text-xs text-muted-foreground">
                    状態 {card.states.length}
                  </span>
                </button>
                <button
                  type="button"
                  className={iconButtonClass}
                  aria-label={`${card.name ?? card.id} を削除`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `カード「${card.name ?? card.id}」を削除しますか？参照しているCue/セグメントのビジュアルは継承に戻ります。`,
                      )
                    ) {
                      onRemoveCard(card.id);
                    }
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <label className="text-sm">
            種類
            <select
              className={`mt-1 ${textFieldClass}`}
              value={newType}
              onChange={(event) => setNewType(event.target.value as LiveCard["type"])}
            >
              {CARD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {cardTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
          {newType === "image" && (
            <label className="text-sm">
              画像
              <select
                className={`mt-1 ${textFieldClass}`}
                value={newImageAssetId}
                onChange={(event) => setNewImageAssetId(event.target.value)}
              >
                {imageAssets.length === 0 && <option value="">画像がありません</option>}
                {imageAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.originalFilename}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-sm">
            名前（任意）
            <input
              className={`mt-1 ${textFieldClass}`}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="カード名"
            />
          </label>
          <button
            type="button"
            className={buttonNeutralClass}
            onClick={() => {
              setCreateError(null);
              addCard();
            }}
            disabled={
              (newType === "image" && newImageAssetId === "") ||
              (newType === "image" && imageAssets.length === 0)
            }
          >
            カードを追加
          </button>
        </div>
        {createError !== null && (
          <p className="mt-1 text-sm text-red-600">{createError}</p>
        )}
      </div>

      {selectedCard !== null && (
        <div className="rounded-lg border border-border bg-surface p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-40 flex-1 text-sm">
              カード名
              <input
                className={`mt-1 w-full ${textFieldClass}`}
                value={selectedCard.name ?? ""}
                placeholder={selectedCard.id}
                onChange={(event) => {
                  if (event.target.value === "") {
                    const { name: _removed, ...rest } = selectedCard;
                    onUpdateCard(rest);
                    return;
                  }
                  onUpdateCard({ ...selectedCard, name: event.target.value });
                }}
              />
            </label>
            <span className={badgeNeutralClass}>{cardTypeLabel(selectedCard.type)}</span>
          </div>

          {selectedCard.type === "chart" && (
            <div className="mt-2 flex flex-wrap gap-2">
              <label className="text-sm">
                表示
                <select
                  className={`mt-1 ${textFieldClass}`}
                  value={selectedCard.variant}
                  onChange={(event) =>
                    onUpdateCard({
                      ...selectedCard,
                      variant: event.target.value === "line" ? "line" : "bar",
                    })
                  }
                >
                  <option value="bar">棒グラフ</option>
                  <option value="line">折れ線</option>
                </select>
              </label>
              <label className="text-sm">
                グラフアニメーション
                <select
                  className={`mt-1 ${textFieldClass}`}
                  value={selectedCard.chartAnimation ?? ""}
                  onChange={(event) =>
                    onUpdateCard({
                      ...selectedCard,
                      chartAnimation:
                        event.target.value === ""
                          ? undefined
                          : event.target.value === "none"
                            ? "none"
                            : event.target.value === "draw"
                              ? "draw"
                              : "grow",
                    })
                  }
                >
                  <option value="">既定</option>
                  <option value="none">なし</option>
                  <option value="grow">伸ばす</option>
                  <option value="draw">描く</option>
                </select>
              </label>
            </div>
          )}

          <div className="mt-3 border-t border-border pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-sm font-semibold">状態（完全なスナップショット）</h3>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => {
                    try {
                      const stateId = createLiveLocalId("state");
                      const starter = createStarterState(
                        selectedCard,
                        stateId,
                        imageAssets[0]?.id,
                      );
                      if (starter === null) {
                        setStateError(
                          "画像カードには画像アセットが必要です。先に画像をアップロードしてください。",
                        );
                        return;
                      }
                      onUpdateCard(addCardState(selectedCard, starter));
                      setSelectedStateId(stateId);
                      setStateError(null);
                    } catch (error) {
                      setStateError(
                        error instanceof Error
                          ? error.message
                          : "状態を追加できませんでした。",
                      );
                    }
                  }}
                >
                  状態を追加
                </button>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  disabled={selectedState === null}
                  onClick={() => {
                    if (selectedState === null) {
                      return;
                    }
                    const stateId = createLiveLocalId("state");
                    onUpdateCard(duplicateCardState(selectedCard, selectedState.id, stateId));
                    setSelectedStateId(stateId);
                  }}
                >
                  状態を複製
                </button>
              </div>
            </div>
            {stateError !== null && (
              <p className={`mt-2 ${errorTextClass}`}>{stateError}</p>
            )}

            <div className="mt-2 flex flex-wrap gap-1">
              {selectedCard.states.map((state) => (
                <button
                  key={state.id}
                  type="button"
                  className={`rounded border px-2 py-1 text-xs ${
                    selectedState?.id === state.id
                      ? "border-brand-500 bg-brand-50 dark:bg-brand-950/30"
                      : "border-border"
                  }`}
                  onClick={() => {
                    setSelectedStateId(state.id);
                    setStateError(null);
                  }}
                >
                  {state.id}
                </button>
              ))}
            </div>

            {selectedState !== null && (
              <div className="mt-3">
                <CardStateEditor
                  card={selectedCard}
                  state={selectedState}
                  imageAssets={imageAssets}
                  onChangeState={(nextState) =>
                    onUpdateCard(
                      updateCardState(selectedCard, selectedState.id, () => nextState),
                    )
                  }
                />
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    className={iconButtonClass}
                    disabled={selectedCard.states.length <= 1}
                    onClick={() => onRemoveState(selectedCard.id, selectedState.id)}
                  >
                    この状態を削除
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
