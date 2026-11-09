import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { LiveFormatSummary } from "@kakeai/contracts";
import { useCreateLiveProgram, useLiveFormats } from "../../api/hooks";
import { errorMessage } from "../../lib/errorMessage";
import {
  liveFormatRoute,
  liveFormatsRoute,
  liveProgramRoute,
  liveProgramsRoute,
} from "../../lib/routes";
import { formatDateTime, formatDuration } from "../../live/duration";
import {
  badgeInfoClass,
  badgeNeutralClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  sectionTitleClass,
  textFieldClass,
} from "../../ui";

export function LiveProgramNewPage() {
  const navigate = useNavigate();
  const formatsQuery = useLiveFormats();
  const createProgram = useCreateLiveProgram();
  const [selectedFormat, setSelectedFormat] = useState<LiveFormatSummary | null>(null);
  const [title, setTitle] = useState("");

  const chooseFormat = (format: LiveFormatSummary) => {
    setSelectedFormat(format);
    setTitle(format.title);
  };

  const create = () => {
    if (selectedFormat === null || title.trim() === "") {
      return;
    }
    createProgram.mutate(
      { formatId: selectedFormat.id, title: title.trim() },
      {
        onSuccess: (program) => navigate(liveProgramRoute(program.id)),
      },
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link to={liveProgramsRoute()} className="text-sm text-brand-700 hover:underline">
          ← ライブプログラム一覧
        </Link>
        <h1 className="mt-1 text-2xl font-bold">新しいライブプログラム</h1>
        <p className={metaTextClass}>
          フォーマットのセグメント・キャスト・カード・ポリシーをコピーして台本を作成します。作成後のフォーマット変更は反映されません。
        </p>
      </div>

      <ol className="m-0 flex list-none gap-2 p-0 text-sm">
        <li className={selectedFormat === null ? badgeInfoClass : badgeNeutralClass}>
          1. フォーマットを選択
        </li>
        <li className={selectedFormat !== null ? badgeInfoClass : badgeNeutralClass}>
          2. タイトルを入力
        </li>
      </ol>

      {formatsQuery.isLoading && <p>フォーマットを読み込み中…</p>}
      {formatsQuery.isError && (
        <p className={errorTextClass}>{errorMessage(formatsQuery.error)}</p>
      )}
      {formatsQuery.isSuccess && (formatsQuery.data.items.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className={sectionTitleClass}>利用できるフォーマットがありません</h2>
          <p className={metaTextClass}>
            プログラムを作成するには、先にライブフォーマットを作成してください。
          </p>
          <Link to={liveFormatsRoute()} className={buttonPrimaryClass}>
            ライブフォーマットを作成
          </Link>
        </div>
      ) : selectedFormat === null ? (
        <ul className="m-0 list-none space-y-2 p-0">
          {formatsQuery.data.items.map((format) => (
            <li key={format.id}>
              <button
                type="button"
                className="w-full rounded-lg border border-border bg-surface p-3 text-left hover:border-brand-500"
                onClick={() => chooseFormat(format)}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold">{format.name}</span>
                  <span className={badgeNeutralClass}>{format.title}</span>
                  <span className={metaTextClass}>{formatDuration(format.targetDurationMs)}</span>
                </div>
                <p className="m-0 mt-1 text-sm text-muted-foreground">
                  セグメント {format.segmentCount}件 / 定型カード {format.cardCount}件 / 更新{" "}
                  {formatDateTime(format.updatedAt)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{selectedFormat.name}</span>
            <span className={badgeNeutralClass}>{selectedFormat.title}</span>
            <Link
              to={liveFormatRoute(selectedFormat.id)}
              className="text-sm text-brand-700 hover:underline"
            >
              フォーマットを確認
            </Link>
          </div>
          <label className="block text-sm">
            プログラムのタイトル
            <input
              className={`mt-1 w-full ${textFieldClass}`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
          </label>
          {createProgram.isError && (
            <p className={errorTextClass}>{errorMessage(createProgram.error)}</p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className={buttonNeutralClass}
              onClick={() => setSelectedFormat(null)}
              disabled={createProgram.isPending}
            >
              フォーマットを選び直す
            </button>
            <button
              type="button"
              className={buttonPrimaryClass}
              disabled={createProgram.isPending || title.trim() === ""}
              onClick={create}
            >
              {createProgram.isPending ? "作成中…" : "プログラムを作成"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
