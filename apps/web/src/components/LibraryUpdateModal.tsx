import type { VoiceProfile } from "@kakeai/contracts";
import type { LibraryUpdateAppearance, LibraryUpdatePlan } from "@kakeai/script-edits";
import {
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
} from "../ui";
import { Modal } from "./Modal";

interface LibraryUpdateModalProps {
  plan: LibraryUpdatePlan;
  voiceProfiles: readonly VoiceProfile[];
  onCancel: () => void;
  onApply: () => void;
}

export function LibraryUpdateDialog({
  state,
  voiceProfiles,
  onCancel,
  onApply,
}: {
  state: { plan: LibraryUpdatePlan } | null;
  voiceProfiles: readonly VoiceProfile[];
  onCancel: () => void;
  onApply: () => void;
}) {
  if (state === null) {
    return null;
  }
  return (
    <LibraryUpdateModal
      plan={state.plan}
      voiceProfiles={voiceProfiles}
      onCancel={onCancel}
      onApply={onApply}
    />
  );
}

function appearanceLabel(appearance: LibraryUpdateAppearance): string {
  const tags = `${appearance.expression || "-"} / ${appearance.pose || "-"}`;
  return appearance.label === undefined || appearance.label.length === 0
    ? tags
    : `${appearance.label}（${tags}）`;
}

function profileName(
  profileId: string | null,
  profiles: readonly VoiceProfile[],
): string {
  if (profileId === null) {
    return "未設定";
  }
  return profiles.find((profile) => profile.id === profileId)?.name ?? profileId;
}

function hasChanges(plan: LibraryUpdatePlan): boolean {
  return (
    plan.name !== null ||
    plan.names.some((entry) => entry.before !== entry.after) ||
    plan.voices.some((entry) => entry.before !== entry.after) ||
    plan.appearances.added.length > 0 ||
    plan.appearances.updated.length > 0 ||
    plan.appearances.removed.length > 0
  );
}

export function LibraryUpdateModal({
  plan,
  voiceProfiles,
  onCancel,
  onApply,
}: LibraryUpdateModalProps) {
  const nameChanges = plan.names.filter((entry) => entry.before !== entry.after);
  const voiceChanges = plan.voices.filter((entry) => entry.before !== entry.after);
  const changes = hasChanges(plan);

  return (
    <Modal
      open
      onClose={onCancel}
      title="ライブラリから更新"
      className="max-w-2xl"
    >
        <p className={`mb-3 ${metaTextClass}`}>
          作品内のキャラクターID・話者ID・立ち絵の配置は維持したまま、ライブラリの内容と最新の表情セット版を取り込みます。
        </p>

        {!changes && <p className={metaTextClass}>変更はありません。</p>}

        {plan.name !== null && (
          <section className="mb-3">
            <h3 className="text-sm font-semibold">名前</h3>
            <p className="text-sm">
              {plan.name.before} → {plan.name.after}
            </p>
          </section>
        )}

        {nameChanges.length > 0 && (
          <section className="mb-3">
            <h3 className="text-sm font-semibold">言語別の名前</h3>
            <ul className="text-sm">
              {nameChanges.map((entry) => (
                <li key={entry.locale}>
                  {entry.locale}: {entry.before ?? "（なし）"} → {entry.after ?? "（なし）"}
                </li>
              ))}
            </ul>
          </section>
        )}

        {voiceChanges.length > 0 && (
          <section className="mb-3">
            <h3 className="text-sm font-semibold">声</h3>
            <ul className="text-sm">
              {voiceChanges.map((entry) => (
                <li key={entry.locale}>
                  {entry.locale}: {profileName(entry.before, voiceProfiles)} →{" "}
                  {profileName(entry.after, voiceProfiles)}
                </li>
              ))}
            </ul>
            <p className={metaTextClass}>
              声の変更は今後のTTSにだけ適用されます。生成済みの音声は変わりません。
            </p>
          </section>
        )}

        {(plan.appearances.added.length > 0 ||
          plan.appearances.updated.length > 0 ||
          plan.appearances.removed.length > 0) && (
          <section className="mb-3">
            <h3 className="text-sm font-semibold">外観</h3>
            {plan.appearances.added.length > 0 && (
              <div className="mt-1">
                <p className="text-sm">追加</p>
                <ul className="text-sm">
                  {plan.appearances.added.map((entry) => (
                    <li key={entry.libraryAppearanceId}>
                      {appearanceLabel(entry.appearance)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {plan.appearances.updated.length > 0 && (
              <div className="mt-1">
                <p className="text-sm">更新</p>
                <ul className="text-sm">
                  {plan.appearances.updated.map((entry) => (
                    <li key={entry.appearanceId}>
                      {appearanceLabel(entry.before)} → {appearanceLabel(entry.after)}
                      {entry.before.faceSetVersion !== entry.after.faceSetVersion && (
                        <span className={metaTextClass}>
                          {" "}
                          （表情セット v{entry.before.faceSetVersion ?? 1} → v
                          {entry.after.faceSetVersion ?? 1}）
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {plan.appearances.removed.length > 0 && (
              <div className="mt-1">
                <p className="text-sm">ライブラリで削除済み（作品内に残します）</p>
                <ul className="text-sm">
                  {plan.appearances.removed.map((entry) => (
                    <li key={entry.appearanceId}>
                      {entry.label.length === 0 ? entry.appearanceId : entry.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {plan.expressionResets.length > 0 && (
          <section className="mb-3">
            <h3 className="text-sm font-semibold">
              表情が使えなくなる台詞（normal に戻します）
            </h3>
            <ul className="text-sm">
              {plan.expressionResets.map((reset) => (
                <li key={reset.lineId}>
                  {reset.sceneLabel}: {reset.captionText || reset.lineId}
                  <span className={metaTextClass}>
                    {" "}
                    （{reset.expressionId}）
                  </span>
                </li>
              ))}
            </ul>
            <p className={errorTextClass}>
              適用する前に、この置換で問題ないことを確認してください。
            </p>
          </section>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonPrimaryClass}
            disabled={!changes}
            onClick={onApply}
          >
            適用
          </button>
          <button
            type="button"
            className={buttonNeutralClass}
            onClick={onCancel}
          >
            キャンセル
          </button>
        </div>
    </Modal>
  );
}
