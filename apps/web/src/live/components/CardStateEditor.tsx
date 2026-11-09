import { useMemo } from "react";
import type { Asset, LiveCard } from "@kakeai/contracts";
import { errorTextClass, warningTextClass } from "../../ui";
import { buildCardStateDraft } from "../model/card-state-draft";
import { ChartStateFields } from "./cards/ChartStateFields";
import { HeadlineStateFields } from "./cards/HeadlineStateFields";
import { ImageStateFields } from "./cards/ImageStateFields";
import { ListStateFields } from "./cards/ListStateFields";
import { QuoteStateFields } from "./cards/QuoteStateFields";

interface CardStateEditorProps {
  card: LiveCard;
  state: LiveCard["states"][number];
  imageAssets: readonly Asset[];
  onChangeState: (state: LiveCard["states"][number]) => void;
}

function InvalidState({ cardType }: { cardType: string }) {
  return (
    <p className={errorTextClass}>
      状態データに編集可能なIDがないため、カード種別（{cardType}）の項目を表示できません。カードを削除して作り直してください。
    </p>
  );
}

function StateIssues({ issues }: { issues: readonly string[] }) {
  return (
    <div
      className="rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950/40"
      role="status"
    >
      <p className={`m-0 font-semibold ${warningTextClass}`}>
        状態データに {issues.length} 件の問題があります
      </p>
      <ul className="m-0 mt-1 list-disc pl-5 text-xs text-amber-800 dark:text-amber-200">
        {issues.map((issue, index) => (
          <li key={`${index}-${issue}`}>{issue}</li>
        ))}
      </ul>
      <p className="m-0 mt-1 text-xs text-amber-800 dark:text-amber-200">
        下の項目を修正すると保存できます。
      </p>
    </div>
  );
}

export function CardStateEditor({
  card,
  state,
  imageAssets,
  onChangeState,
}: CardStateEditorProps) {
  const draft = useMemo(
    () => buildCardStateDraft(card.type, state),
    [card.type, state],
  );

  if (draft === null) {
    return <InvalidState cardType={card.type} />;
  }

  return (
    <div className="space-y-3">
      {draft.issues.length > 0 && <StateIssues issues={draft.issues} />}
      {draft.cardType === "headline" && (
        <HeadlineStateFields state={draft.state} onChange={onChangeState} />
      )}
      {draft.cardType === "image" && (
        <ImageStateFields
          state={draft.state}
          imageAssets={imageAssets}
          onChange={onChangeState}
        />
      )}
      {draft.cardType === "list" && (
        <ListStateFields state={draft.state} onChange={onChangeState} />
      )}
      {draft.cardType === "chart" && (
        <ChartStateFields state={draft.state} onChange={onChangeState} />
      )}
      {draft.cardType === "quote" && (
        <QuoteStateFields state={draft.state} onChange={onChangeState} />
      )}
    </div>
  );
}
