import type {
  CharacterLibraryEntry,
  LiveFormatDocumentV1,
  VoiceProfile,
} from "@kakeai/contracts";
import { metaTextClass, sectionTitleClass, textFieldClass } from "../../../ui";
import { CastFields, ThemeFields, type ThemeOption } from "../CastFields";
import { DurationField } from "../DurationField";

interface FormatBasicsFieldsProps {
  document: LiveFormatDocumentV1;
  themes: readonly ThemeOption[];
  characters: readonly CharacterLibraryEntry[];
  voices: readonly VoiceProfile[];
  onChangeDocument: (updater: (document: LiveFormatDocumentV1) => LiveFormatDocumentV1) => void;
}

export function FormatBasicsFields({
  document,
  themes,
  characters,
  voices,
  onChangeDocument,
}: FormatBasicsFieldsProps) {
  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <h2 className={sectionTitleClass}>基本設定</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          フォーマット名
          <input
            className={`mt-1 w-full ${textFieldClass}`}
            value={document.name}
            onChange={(event) =>
              onChangeDocument((current) => ({ ...current, name: event.target.value }))
            }
          />
        </label>
        <label className="block text-sm">
          既定タイトル
          <input
            className={`mt-1 w-full ${textFieldClass}`}
            value={document.title}
            onChange={(event) =>
              onChangeDocument((current) => ({ ...current, title: event.target.value }))
            }
          />
        </label>
        <DurationField
          label="全体目標尺"
          valueMs={document.targetDurationMs}
          onCommit={(valueMs) =>
            onChangeDocument((current) => ({ ...current, targetDurationMs: valueMs }))
          }
        />
        <div className="block text-sm">
          ステージ
          <p className={`m-0 mt-1 text-sm ${metaTextClass}`}>
            {document.stageTemplate}（v1では固定）
          </p>
        </div>
      </div>
      <p className={`mt-2 ${metaTextClass}`}>テーマ</p>
      <ThemeFields
        theme={document.theme}
        themes={themes}
        onChange={(theme) => onChangeDocument((current) => ({ ...current, theme }))}
      />
      <p className={`mt-3 ${metaTextClass}`}>既定キャスト</p>
      <CastFields
        cast={document.cast}
        characters={characters}
        voices={voices}
        onChange={(cast) => onChangeDocument((current) => ({ ...current, cast }))}
      />
    </section>
  );
}
