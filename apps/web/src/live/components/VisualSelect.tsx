import type {
  LiveCard,
  LiveProgramMaterial,
  LiveVisualRef,
} from "@kakeai/contracts";
import { cardTypeLabel } from "../model/visual";
import { textFieldClass } from "../../ui";

interface VisualSelectProps {
  value: LiveVisualRef | null | undefined;
  mode: "cue" | "segment";
  cards: readonly LiveCard[];
  materials: readonly LiveProgramMaterial[];
  allowMaterial?: boolean;
  onChange: (value: LiveVisualRef | null | undefined) => void;
}

type VisualKind = "inherit" | "hidden" | "card" | "material" | "none";

function visualFieldKind(mode: "cue" | "segment", value: LiveVisualRef | null | undefined): VisualKind {
  if (value === undefined) {
    return mode === "cue" ? "inherit" : "none";
  }
  if (value === null) {
    return mode === "cue" ? "hidden" : "none";
  }
  return value.kind;
}

/**
 * Cue fields distinguish "inherit" (undefined) from "hide" (null). Segment
 * defaults have no hide state: clearing the select removes the field.
 */
export function VisualSelect({
  value,
  mode,
  cards,
  materials,
  allowMaterial = true,
  onChange,
}: VisualSelectProps) {
  const kind = visualFieldKind(mode, value);

  const setKind = (next: VisualKind) => {
    if (next === "inherit") {
      onChange(undefined);
      return;
    }
    if (next === "none") {
      onChange(undefined);
      return;
    }
    if (next === "hidden") {
      onChange(null);
      return;
    }
    if (next === "material") {
      const materialId = value?.kind === "material" ? value.materialId : materials[0]?.id;
      if (materialId !== undefined) {
        onChange({ kind: "material", materialId });
      }
      return;
    }
    const cardId = value?.kind === "card" ? value.cardId : cards[0]?.id;
    const card = cards.find((entry) => entry.id === cardId);
    if (card !== undefined) {
      const stateId =
        value?.kind === "card" && value.cardId === card.id
          ? value.stateId
          : card.states[0]?.id;
      if (stateId !== undefined) {
        onChange({ kind: "card", cardId: card.id, stateId });
      }
    }
  };

  const selectedCard =
    value !== null && value !== undefined && value.kind === "card"
      ? cards.find((card) => card.id === value.cardId)
      : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className={textFieldClass}
        aria-label={mode === "cue" ? "Cueの中央ビジュアル" : "セグメント既定ビジュアル"}
        value={kind}
        onChange={(event) => setKind(event.target.value as VisualKind)}
      >
        {mode === "cue" && <option value="inherit">セグメント既定を継承</option>}
        {mode === "cue" && <option value="hidden">中央ビジュアルを隠す</option>}
        {mode === "segment" && <option value="none">既定なし</option>}
        <option value="card" disabled={cards.length === 0}>
          カード
        </option>
        {allowMaterial && (
          <option value="material" disabled={materials.length === 0}>
            素材
          </option>
        )}
      </select>

      {kind === "card" && (
        <>
          <select
            className={textFieldClass}
            aria-label="カード"
            value={selectedCard?.id ?? (value?.kind === "card" ? value.cardId : "")}
            onChange={(event) => {
              const card = cards.find((entry) => entry.id === event.target.value);
              const stateId = card?.states[0]?.id;
              if (card !== undefined && stateId !== undefined) {
                onChange({ kind: "card", cardId: card.id, stateId });
              }
            }}
          >
            {cards.length === 0 && <option value="">カードがありません</option>}
            {selectedCard === undefined && value?.kind === "card" && (
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
            value={value?.kind === "card" ? value.stateId : ""}
            onChange={(event) => {
              if (selectedCard === undefined) {
                return;
              }
              onChange({
                kind: "card",
                cardId: selectedCard.id,
                stateId: event.target.value,
              });
            }}
          >
            {(selectedCard === undefined ||
              !selectedCard.states.some(
                (state) => state.id === (value?.kind === "card" ? value.stateId : ""),
              )) && (
              <option value={value?.kind === "card" ? value.stateId : ""}>
                {value?.kind === "card" ? value.stateId : ""}（見つかりません）
              </option>
            )}
            {selectedCard?.states.map((state) => (
              <option key={state.id} value={state.id}>
                {state.id}
              </option>
            ))}
          </select>
        </>
      )}

      {kind === "material" && (
        <select
          className={textFieldClass}
          aria-label="素材"
          value={value?.kind === "material" ? value.materialId : ""}
          onChange={(event) =>
            onChange({ kind: "material", materialId: event.target.value })
          }
        >
          {materials.length === 0 && <option value="">素材がありません</option>}
          {value?.kind === "material" &&
            !materials.some((material) => material.id === value.materialId) && (
              <option value={value.materialId}>{value.materialId}（見つかりません）</option>
            )}
          {materials.map((material) => (
            <option key={material.id} value={material.id}>
              {material.name ?? material.id}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
