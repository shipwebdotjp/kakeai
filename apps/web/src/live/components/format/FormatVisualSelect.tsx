import type { LiveCard, LiveFormatVisualRef } from "@kakeai/contracts";
import { cardTypeLabel } from "../../model/visual";
import { textFieldClass } from "../../../ui";

interface FormatVisualSelectProps {
  value: LiveFormatVisualRef | undefined;
  cards: readonly LiveCard[];
  onChange: (value: LiveFormatVisualRef | undefined) => void;
}

/** Formats can only reference template cards, never Live Materials. */
export function FormatVisualSelect({
  value,
  cards,
  onChange,
}: FormatVisualSelectProps) {
  const selectedCard = cards.find((card) => card.id === value?.cardId);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={textFieldClass}
        aria-label="セグメント既定ビジュアル"
        value={value === undefined ? "none" : "card"}
        onChange={(event) => {
          if (event.target.value === "none") {
            onChange(undefined);
            return;
          }
          const card = cards.find((entry) => entry.id === value?.cardId) ?? cards[0];
          const stateId = card?.states[0]?.id;
          if (card !== undefined && stateId !== undefined) {
            onChange({ kind: "card", cardId: card.id, stateId });
          }
        }}
      >
        <option value="none">既定なし</option>
        <option value="card" disabled={cards.length === 0}>
          カード
        </option>
      </select>
      {value !== undefined && (
        <>
          <select
            className={textFieldClass}
            aria-label="カード"
            value={selectedCard?.id ?? value.cardId}
            onChange={(event) => {
              const card = cards.find((entry) => entry.id === event.target.value);
              const stateId = card?.states[0]?.id;
              if (card !== undefined && stateId !== undefined) {
                onChange({ kind: "card", cardId: card.id, stateId });
              }
            }}
          >
            {cards.length === 0 && <option value="">カードがありません</option>}
            {selectedCard === undefined && (
              <option value={value.cardId}>{value.cardId}（見つかりません）</option>
            )}
            {cards.map((card) => (
              <option key={card.id} value={card.id}>
                {card.name ?? card.id}（{cardTypeLabel(card.type)}）
              </option>
            ))}
          </select>
          <select
            className={textFieldClass}
            aria-label="カード状態"
            value={value.stateId}
            onChange={(event) =>
              onChange({ ...value, stateId: event.target.value })
            }
          >
            {(selectedCard === undefined ||
              !selectedCard.states.some((state) => state.id === value.stateId)) && (
              <option value={value.stateId}>{value.stateId}（見つかりません）</option>
            )}
            {selectedCard?.states.map((state) => (
              <option key={state.id} value={state.id}>
                {state.id}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}
