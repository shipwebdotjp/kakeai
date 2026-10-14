import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Copy, Plus, Palette, Archive } from "lucide-react";
import {
  useArchiveTheme,
  useCreateTheme,
  useThemes,
} from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
import { themeDetailRoute } from "../lib/routes";
import {
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";

export function ThemesPage() {
  const navigate = useNavigate();
  const [includeArchived, setIncludeArchived] = useState(false);
  const themesQuery = useThemes(includeArchived);
  const createTheme = useCreateTheme();
  const archiveTheme = useArchiveTheme();

  const [createOpen, setCreateOpen] = useState(false);
  const [newThemeName, setNewThemeName] = useState("");
  const [duplicateSourceId, setDuplicateSourceId] = useState<string>("");

  const handleCreateSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!newThemeName.trim()) return;

    let sourceThemeRef;
    if (duplicateSourceId) {
      const selectedTheme = themesQuery.data?.find((t) => t.id === duplicateSourceId);
      const version = selectedTheme?.latestRevision?.version ?? 1;
      sourceThemeRef = { id: duplicateSourceId, version };
    }

    createTheme.mutate(
      { name: newThemeName.trim(), sourceThemeRef },
      {
        onSuccess: (newTheme) => {
          setCreateOpen(false);
          setNewThemeName("");
          setDuplicateSourceId("");
          navigate(themeDetailRoute(newTheme.id));
        },
      },
    );
  };

  const handleDuplicateBuiltIn = (id: string, version: number, name: string) => {
    createTheme.mutate(
      {
        name: `${name} (コピー)`,
        sourceThemeRef: { id, version },
      },
      {
        onSuccess: (newTheme) => {
          navigate(themeDetailRoute(newTheme.id));
        },
      },
    );
  };

  const handleArchive = (id: string, name: string) => {
    if (!window.confirm(`テーマ「${name}」をアーカイブしますか？新規作成・選択からは非表示になります。`)) {
      return;
    }
    archiveTheme.mutate(id);
  };

  const builtInThemes = themesQuery.data?.filter((t) => t.isBuiltIn) ?? [];
  const userThemes = themesQuery.data?.filter((t) => !t.isBuiltIn) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Visual Theme 管理</h1>
          <p className={metaTextClass}>
            映像出力のフォント・配色・装飾ルールを定義するテーマを管理・作成します。
          </p>
        </div>
        <button
          type="button"
          className={buttonPrimaryClass}
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="mr-1.5 h-4 w-4 inline" />
          新規テーマ作成
        </button>
      </div>

      {themesQuery.isLoading && <p>読み込み中…</p>}
      {themesQuery.isError && (
        <p className={errorTextClass}>{errorMessage(themesQuery.error)}</p>
      )}

      {createOpen && (
        <form
          onSubmit={handleCreateSubmit}
          className="rounded-lg border border-border bg-card p-4 space-y-3"
        >
          <h3 className="font-semibold text-base">新規テーマ作成</h3>
          <div>
            <label className="block text-sm mb-1">テーマ名</label>
            <input
              type="text"
              required
              className={`w-full ${textFieldClass}`}
              placeholder="例: モダン・ダーク"
              value={newThemeName}
              onChange={(e) => setNewThemeName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">複製元テーマ（任意）</label>
            <select
              className={`w-full ${textFieldClass}`}
              value={duplicateSourceId}
              onChange={(e) => setDuplicateSourceId(e.target.value)}
            >
              <option value="">（既定テーマから作成）</option>
              {themesQuery.data
                ?.filter((t) => t.latestRevision !== null)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (v{t.latestRevision!.version}) {t.isBuiltIn ? "（組み込み）" : ""}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className={buttonNeutralClass}
              onClick={() => setCreateOpen(false)}
            >
              キャンセル
            </button>
            <button
              type="submit"
              className={buttonPrimaryClass}
              disabled={createTheme.isPending}
            >
              作成して編集
            </button>
          </div>
          {createTheme.isError && (
            <p className={errorTextClass}>{errorMessage(createTheme.error)}</p>
          )}
        </form>
      )}

      {/* User Themes */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Palette className="h-5 w-5" />
            マイテーマ
          </h2>
          <label className="inline-flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            アーカイブ済みを表示
          </label>
        </div>

        {userThemes.length === 0 ? (
          <p className={metaTextClass}>
            カスタムテーマはまだ作成されていません。「新規テーマ作成」から作成できます。
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {userThemes.map((theme) => {
              const latestDef = theme.latestRevision?.definition;

              return (
                <div
                  key={theme.id}
                  className={`rounded-lg border border-border bg-card p-4 space-y-3 flex flex-col justify-between ${
                    theme.archivedAt ? "opacity-60" : ""
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-base">{theme.name}</h3>
                      <div className="flex items-center gap-1">
                        {theme.hasDraft && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                            Draft
                          </span>
                        )}
                        {theme.latestRevision && (
                          <span className="rounded bg-brand-100 px-1.5 py-0.5 text-xs font-semibold text-brand-800 dark:bg-brand-900/60 dark:text-brand-200">
                            v{theme.latestRevision.version}
                          </span>
                        )}
                        {theme.archivedAt && (
                          <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                            アーカイブ
                          </span>
                        )}
                      </div>
                    </div>

                    {theme.missingFonts && theme.missingFonts.length > 0 && (
                      <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 inline" />
                        欠落フォント: {theme.missingFonts.join(", ")}
                      </p>
                    )}

                    {latestDef && (
                      <div className="mt-3 flex items-center gap-1.5">
                        <div
                          className="h-5 w-5 rounded border border-border"
                          style={{ backgroundColor: latestDef.canvas.base }}
                          title="キャンバス背景"
                        />
                        <div
                          className="h-5 w-5 rounded border border-border"
                          style={{ backgroundColor: latestDef.canvas.ink }}
                          title="文字インク"
                        />
                        <div
                          className="h-5 w-5 rounded border border-border"
                          style={{ backgroundColor: latestDef.accents.primary }}
                          title="プライマリアクセント"
                        />
                        <div
                          className="h-5 w-5 rounded border border-border"
                          style={{ backgroundColor: latestDef.accents.secondary }}
                          title="セカンダリアクセント"
                        />
                        <div
                          className="h-5 w-5 rounded border border-border"
                          style={{ backgroundColor: latestDef.surface }}
                          title="サーフェス"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <Link
                      to={themeDetailRoute(theme.id)}
                      className={buttonPrimaryClass}
                    >
                      編集
                    </Link>
                    {!theme.archivedAt && (
                      <button
                        type="button"
                        className={buttonNeutralClass}
                        onClick={() => handleArchive(theme.id, theme.name)}
                      >
                        <Archive className="h-3.5 w-3.5 inline mr-1" />
                        アーカイブ
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Built-in Themes */}
      <section className="space-y-3 pt-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Palette className="h-5 w-5" />
          組み込みテーマ
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {builtInThemes.map((theme) => {
            const def = theme.latestRevision?.definition;

            return (
              <div
                key={theme.id}
                className="rounded-lg border border-border bg-card p-4 space-y-3 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-base">{theme.name}</h3>
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-900/60 dark:text-blue-200">
                      組み込み (v{theme.latestRevision?.version})
                    </span>
                  </div>

                  {def && (
                    <div className="mt-3 flex items-center gap-1.5">
                      <div
                        className="h-5 w-5 rounded border border-border"
                        style={{ backgroundColor: def.canvas.base }}
                        title="キャンバス背景"
                      />
                      <div
                        className="h-5 w-5 rounded border border-border"
                        style={{ backgroundColor: def.canvas.ink }}
                        title="文字インク"
                      />
                      <div
                        className="h-5 w-5 rounded border border-border"
                        style={{ backgroundColor: def.accents.primary }}
                        title="プライマリアクセント"
                      />
                      <div
                        className="h-5 w-5 rounded border border-border"
                        style={{ backgroundColor: def.accents.secondary }}
                        title="セカンダリアクセント"
                      />
                      <div
                        className="h-5 w-5 rounded border border-border"
                        style={{ backgroundColor: def.surface }}
                        title="サーフェス"
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <Link
                    to={themeDetailRoute(theme.id)}
                    className={buttonNeutralClass}
                  >
                    詳細表示
                  </Link>
                  <button
                    type="button"
                    className={buttonPrimaryClass}
                    onClick={() =>
                      handleDuplicateBuiltIn(
                        theme.id,
                        theme.latestRevision?.version ?? 1,
                        theme.name,
                      )
                    }
                  >
                    <Copy className="h-3.5 w-3.5 inline mr-1" />
                    複製して編集
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
