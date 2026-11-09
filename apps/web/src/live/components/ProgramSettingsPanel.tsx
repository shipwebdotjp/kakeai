import type { LiveProgramDocument } from "@kakeai/contracts";
import {
  useCharacters,
  useThemes,
  useVoiceProfiles,
} from "../../api/hooks";
import { errorMessage } from "../../lib/errorMessage";
import { errorTextClass, metaTextClass, sectionTitleClass, textFieldClass } from "../../ui";
import { DurationField } from "./DurationField";
import { CastFields, ThemeFields, type ThemeOption } from "./CastFields";
import { ProgramPolicyFields } from "./ProgramPolicyFields";

interface ProgramSettingsPanelProps {
  document: LiveProgramDocument;
  onChangeDocument: (updater: (document: LiveProgramDocument) => LiveProgramDocument) => void;
}

export function ProgramSettingsPanel({
  document,
  onChangeDocument,
}: ProgramSettingsPanelProps) {
  const themesQuery = useThemes();
  const charactersQuery = useCharacters();
  const voicesQuery = useVoiceProfiles();

  const themes: ThemeOption[] =
    themesQuery.data
      ?.filter((theme) => theme.latestRevision !== null && theme.archivedAt === null)
      .map((theme) => ({
        id: theme.id,
        name: theme.name,
        version: theme.latestRevision?.version ?? 1,
      })) ?? [];

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-surface p-3">
        <h2 className={sectionTitleClass}>プログラム基本設定</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            タイトル
            <input
              className={`mt-1 w-full ${textFieldClass}`}
              value={document.title}
              onChange={(event) =>
                onChangeDocument((doc) => ({ ...doc, title: event.target.value }))
              }
            />
          </label>
          <DurationField
            label="全体目標尺"
            valueMs={document.targetDurationMs}
            onCommit={(valueMs) =>
              onChangeDocument((doc) => ({ ...doc, targetDurationMs: valueMs }))
            }
          />
          <div className="block text-sm">
            ステージ
            <p className={`m-0 mt-1 ${metaTextClass}`}>
              {document.stageTemplate}（v1では固定）
            </p>
          </div>
        </div>
        <p className={`mt-2 ${metaTextClass}`}>テーマ</p>
        {themesQuery.isLoading && <p className={metaTextClass}>テーマを読み込み中…</p>}
        {themesQuery.isError && (
          <p className={errorTextClass}>{errorMessage(themesQuery.error)}</p>
        )}
        <ThemeFields
          theme={document.theme}
          themes={themes}
          onChange={(theme) =>
            onChangeDocument((doc) => ({ ...doc, theme }))
          }
        />
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <h2 className={sectionTitleClass}>キャスト</h2>
        {charactersQuery.isLoading && <p className={metaTextClass}>キャラクターを読み込み中…</p>}
        {charactersQuery.isError && (
          <p className={errorTextClass}>{errorMessage(charactersQuery.error)}</p>
        )}
        {voicesQuery.isLoading && <p className={metaTextClass}>ボイスを読み込み中…</p>}
        {voicesQuery.isError && (
          <p className={errorTextClass}>{errorMessage(voicesQuery.error)}</p>
        )}
        <CastFields
          cast={document.cast}
          characters={charactersQuery.data ?? []}
          voices={voicesQuery.data ?? []}
          onChange={(cast) => onChangeDocument((doc) => ({ ...doc, cast }))}
        />
      </section>

      <ProgramPolicyFields document={document} onChangeDocument={onChangeDocument} />
    </div>
  );
}
