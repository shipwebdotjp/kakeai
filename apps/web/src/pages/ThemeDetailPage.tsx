import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import {
  SOFT_EDITORIAL_THEME_ID,
  SOFT_EDITORIAL_THEME_VERSION,
  getVisualTheme,
  visualThemeTextRoleSchema,
  type FontFace,
  type FontFaceSpec,
  type TextSurface,
  type TextStyle,
  type VisualThemeDefinition,
  type VisualThemeTextRole,
} from "@kakeai/contracts";
import {
  useArchiveTheme,
  useCreateTheme,
  useDiscardThemeDraft,
  useFontCatalog,
  usePreviewThemeDraft,
  usePublishThemeDraft,
  useRefreshFontCatalog,
  useTheme,
  useUpdateThemeDraft,
} from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
import { THEMES_ROUTE_PATH, themeDetailRoute } from "../lib/routes";
import {
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";

const ALL_ROLES = visualThemeTextRoleSchema.options;

const ROLE_LABELS: Record<VisualThemeTextRole, string> = {
  title: "タイトル",
  subtitle: "サブタイトル",
  heading: "見出し",
  body: "本文",
  closing: "結び",
  caption: "字幕",
  label: "チャプターラベル",
  code: "コード",
};

export function ThemeDetailPage() {
  const { themeId } = useParams<{ themeId: string }>();
  const navigate = useNavigate();

  const themeQuery = useTheme(themeId);
  const fontCatalogQuery = useFontCatalog();
  const refreshFontCatalog = useRefreshFontCatalog();

  const updateDraft = useUpdateThemeDraft(themeId);
  const discardDraft = useDiscardThemeDraft(themeId);
  const publishDraft = usePublishThemeDraft(themeId);
  const archiveTheme = useArchiveTheme();
  const createTheme = useCreateTheme();
  const previewDraft = usePreviewThemeDraft();

  const [formDef, setFormDef] = useState<VisualThemeDefinition | null>(null);
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<"colors" | "typography" | "surfaces">("colors");
  const [fontSearch, setFontSearch] = useState("");

  const theme = themeQuery.data;
  const isBuiltIn = theme?.isBuiltIn ?? false;

  // Initialize form when theme data changes
  useEffect(() => {
    if (!theme) return;
    const base = theme.draft?.definition ?? theme.latestRevision?.definition;
    if (base) {
      setFormDef(base);
      setDirty(false);
    }
  }, [theme]);

  // Live preview effect
  useEffect(() => {
    if (!formDef) return;
    const timer = setTimeout(() => {
      previewDraft.mutate(formDef);
    }, 300);
    return () => clearTimeout(timer);
  }, [formDef]);

  const fontFaces = fontCatalogQuery.data?.faces ?? [];
  const fontCatalogSupported = fontCatalogQuery.data?.supported ?? true;

  const filteredFontFaces = useMemo(() => {
    if (!fontSearch.trim()) return fontFaces.slice(0, 50);
    const query = fontSearch.toLowerCase();
    return fontFaces.filter(
      (f) =>
        f.family.toLowerCase().includes(query) ||
        f.displayName.toLowerCase().includes(query) ||
        f.postScriptName.toLowerCase().includes(query),
    ).slice(0, 50);
  }, [fontFaces, fontSearch]);

  const updateColor = (key: keyof VisualThemeDefinition["canvas"] | "surface" | "surfaceMuted" | "text" | "muted" | "border" | "onMedia", value: string) => {
    if (!formDef || isBuiltIn) return;
    const upper = value.toUpperCase();
    if (["base", "ink"].includes(key)) {
      setFormDef({
        ...formDef,
        canvas: { ...formDef.canvas, [key]: upper },
      });
    } else {
      setFormDef({
        ...formDef,
        [key]: upper,
      });
    }
    setDirty(true);
  };

  const updateAccent = (token: "primary" | "secondary" | "tertiary", value: string) => {
    if (!formDef || isBuiltIn) return;
    setFormDef({
      ...formDef,
      accents: { ...formDef.accents, [token]: value.toUpperCase() },
    });
    setDirty(true);
  };

  const updateTextStyle = (role: VisualThemeTextRole, updater: (style: TextStyle) => TextStyle) => {
    if (!formDef || isBuiltIn) return;
    const current = formDef.textRoles[role];
    const updated = updater(current);
    setFormDef({
      ...formDef,
      textRoles: { ...formDef.textRoles, [role]: updated },
    });
    setDirty(true);
  };

  const updateSurface = (role: "caption" | "label", updater: (surf: TextSurface) => TextSurface) => {
    if (!formDef || isBuiltIn) return;
    const defaultSurf: TextSurface = {
      enabled: true,
      backgroundColor: "#1B2740",
      backgroundOpacity: 0.55,
      paddingHorizontal: 36,
      paddingVertical: 12,
      borderRadius: 12,
    };
    const current = formDef.surfaces?.[role] ?? defaultSurf;
    const updated = updater(current);
    setFormDef({
      ...formDef,
      surfaces: { ...formDef.surfaces, [role]: updated },
    });
    setDirty(true);
  };

  const handleSaveDraft = () => {
    if (!formDef || !themeId) return;
    updateDraft.mutate(formDef, {
      onSuccess: () => setDirty(false),
    });
  };

  const handleDiscardDraft = () => {
    if (!themeId) return;
    if (!window.confirm("Draftの変更を破棄しますか？")) return;
    discardDraft.mutate(undefined, {
      onSuccess: () => setDirty(false),
    });
  };

  const handlePublish = () => {
    if (!themeId) return;
    if (!window.confirm("新しいリビジョンとして公開しますか？")) return;
    publishDraft.mutate(undefined, {
      onSuccess: () => setDirty(false),
    });
  };

  const handleDuplicate = () => {
    if (!theme) return;
    const ver = theme.latestRevision?.version ?? 1;
    createTheme.mutate(
      { name: `${theme.name} (コピー)`, sourceThemeRef: { id: theme.id, version: ver } },
      { onSuccess: (newTheme) => navigate(themeDetailRoute(newTheme.id)) },
    );
  };

  if (themeQuery.isLoading) return <p>読み込み中…</p>;
  if (themeQuery.isError) return <p className={errorTextClass}>{errorMessage(themeQuery.error)}</p>;
  if (!theme || !formDef) return <p className={errorTextClass}>テーマが見つかりません。</p>;

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-3">
          <Link to={THEMES_ROUTE_PATH} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">{theme.name}</h1>
              {isBuiltIn && (
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-900/60 dark:text-blue-200">
                  組み込み
                </span>
              )}
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
            </div>
            <p className={metaTextClass}>ID: {theme.id}</p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {isBuiltIn ? (
            <button
              type="button"
              className={buttonPrimaryClass}
              onClick={handleDuplicate}
              disabled={createTheme.isPending}
            >
              <Copy className="h-4 w-4 inline mr-1" />
              複製して編集
            </button>
          ) : (
            <>
              <button
                type="button"
                className={buttonNeutralClass}
                onClick={handleDiscardDraft}
                disabled={!theme.hasDraft || discardDraft.isPending}
              >
                <Trash2 className="h-4 w-4 inline mr-1" />
                Draft破棄
              </button>
              <button
                type="button"
                className={buttonNeutralClass}
                onClick={handleSaveDraft}
                disabled={updateDraft.isPending}
              >
                <Save className="h-4 w-4 inline mr-1" />
                Draft保存
              </button>
              <button
                type="button"
                className={buttonPrimaryClass}
                onClick={handlePublish}
                disabled={publishDraft.isPending}
              >
                <Upload className="h-4 w-4 inline mr-1" />
                公開 (Publish)
              </button>
            </>
          )}
        </div>
      </div>

      {/* Font Catalog Environment Notice */}
      {!fontCatalogSupported && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 inline mr-1 text-amber-600" />
          現在の動作環境は macOS ではないため、システムフォントの検出・追加は無効化されています。指定済みフォントは標準フォールバック描画されます。
        </div>
      )}

      {fontCatalogSupported && (
        <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/40 px-3 py-1.5 rounded border border-border">
          <span>
            検出可能フォント数: {fontFaces.length} 個
          </span>
          <button
            type="button"
            className="hover:underline text-brand-700 dark:text-brand-400 flex items-center gap-1"
            onClick={() => refreshFontCatalog.mutate()}
            disabled={refreshFontCatalog.isPending}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshFontCatalog.isPending ? "animate-spin" : ""}`} />
            フォント一覧再検出
          </button>
        </div>
      )}

      {/* Main Grid: Left Form / Right Live Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Form (7 cols) */}
        <div className="lg:col-span-6 space-y-4">
          {/* Tabs */}
          <div className="flex border-b border-border text-sm">
            <button
              type="button"
              className={`px-4 py-2 font-medium border-b-2 ${
                activeTab === "colors"
                  ? "border-brand-600 text-brand-600"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("colors")}
            >
              配色・トークン
            </button>
            <button
              type="button"
              className={`px-4 py-2 font-medium border-b-2 ${
                activeTab === "typography"
                  ? "border-brand-600 text-brand-600"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("typography")}
            >
              文字スタイル
            </button>
            <button
              type="button"
              className={`px-4 py-2 font-medium border-b-2 ${
                activeTab === "surfaces"
                  ? "border-brand-600 text-brand-600"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("surfaces")}
            >
              テキスト囲み・背景
            </button>
          </div>

          {/* Tab 1: Colors */}
          {activeTab === "colors" && (
            <div className="space-y-4 text-sm">
              <fieldset disabled={isBuiltIn} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">キャンバス背景 (canvas.base)</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        value={formDef.canvas.base}
                        onChange={(e) => updateColor("base", e.target.value)}
                        className="h-8 w-12 rounded cursor-pointer border border-border"
                      />
                      <input
                        type="text"
                        value={formDef.canvas.base}
                        onChange={(e) => updateColor("base", e.target.value)}
                        className={`font-mono ${textFieldClass}`}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">キャンバス文字 (canvas.ink)</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        value={formDef.canvas.ink}
                        onChange={(e) => updateColor("ink", e.target.value)}
                        className="h-8 w-12 rounded cursor-pointer border border-border"
                      />
                      <input
                        type="text"
                        value={formDef.canvas.ink}
                        onChange={(e) => updateColor("ink", e.target.value)}
                        className={`font-mono ${textFieldClass}`}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">プライマリ (accents.primary)</label>
                    <div className="flex gap-1.5 items-center">
                      <input
                        type="color"
                        value={formDef.accents.primary}
                        onChange={(e) => updateAccent("primary", e.target.value)}
                        className="h-8 w-10 rounded cursor-pointer border border-border"
                      />
                      <input
                        type="text"
                        value={formDef.accents.primary}
                        onChange={(e) => updateAccent("primary", e.target.value)}
                        className={`font-mono text-xs ${textFieldClass}`}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">セカンダリ (accents.secondary)</label>
                    <div className="flex gap-1.5 items-center">
                      <input
                        type="color"
                        value={formDef.accents.secondary}
                        onChange={(e) => updateAccent("secondary", e.target.value)}
                        className="h-8 w-10 rounded cursor-pointer border border-border"
                      />
                      <input
                        type="text"
                        value={formDef.accents.secondary}
                        onChange={(e) => updateAccent("secondary", e.target.value)}
                        className={`font-mono text-xs ${textFieldClass}`}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">ターシャリ (accents.tertiary)</label>
                    <div className="flex gap-1.5 items-center">
                      <input
                        type="color"
                        value={formDef.accents.tertiary}
                        onChange={(e) => updateAccent("tertiary", e.target.value)}
                        className="h-8 w-10 rounded cursor-pointer border border-border"
                      />
                      <input
                        type="text"
                        value={formDef.accents.tertiary}
                        onChange={(e) => updateAccent("tertiary", e.target.value)}
                        className={`font-mono text-xs ${textFieldClass}`}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1">カード等背景 (surface)</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        value={formDef.surface}
                        onChange={(e) => updateColor("surface", e.target.value)}
                        className="h-8 w-12 rounded cursor-pointer border border-border"
                      />
                      <input
                        type="text"
                        value={formDef.surface}
                        onChange={(e) => updateColor("surface", e.target.value)}
                        className={`font-mono ${textFieldClass}`}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1">基本文字色 (text)</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        value={formDef.text}
                        onChange={(e) => updateColor("text", e.target.value)}
                        className="h-8 w-12 rounded cursor-pointer border border-border"
                      />
                      <input
                        type="text"
                        value={formDef.text}
                        onChange={(e) => updateColor("text", e.target.value)}
                        className={`font-mono ${textFieldClass}`}
                      />
                    </div>
                  </div>
                </div>
              </fieldset>
            </div>
          )}

          {/* Tab 2: Typography */}
          {activeTab === "typography" && (
            <div className="space-y-4 text-sm">
              {fontCatalogSupported && (
                <div>
                  <label className="block text-xs font-semibold mb-1">端末フォント検索</label>
                  <input
                    type="text"
                    className={`w-full ${textFieldClass}`}
                    placeholder="フォントファミリー名で検索…"
                    value={fontSearch}
                    onChange={(e) => setFontSearch(e.target.value)}
                  />
                </div>
              )}

              <fieldset disabled={isBuiltIn} className="space-y-6">
                {ALL_ROLES.map((role) => {
                  const style = formDef.textRoles[role];

                  return (
                    <div key={role} className="rounded border border-border p-3 space-y-2">
                      <h4 className="font-bold text-sm text-brand-700 dark:text-brand-300">
                        {ROLE_LABELS[role]} ({role})
                      </h4>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                        <div>
                          <label className="block mb-1">カテゴリ</label>
                          <select
                            className={`w-full ${textFieldClass}`}
                            value={style.font}
                            onChange={(e) =>
                              updateTextStyle(role, (s) => ({
                                ...s,
                                font: e.target.value as any,
                              }))
                            }
                          >
                            <option value="sans">ゴシック (sans)</option>
                            <option value="serif">明朝 (serif)</option>
                            <option value="mono">等幅 (mono)</option>
                          </select>
                        </div>

                        <div>
                          <label className="block mb-1">サイズ (px)</label>
                          <input
                            type="number"
                            min={8}
                            max={240}
                            className={`w-full ${textFieldClass}`}
                            value={style.fontSize}
                            onChange={(e) =>
                              updateTextStyle(role, (s) => ({
                                ...s,
                                fontSize: Number(e.target.value),
                              }))
                            }
                          />
                        </div>

                        <div>
                          <label className="block mb-1">文字色</label>
                          <div className="flex items-center gap-1">
                            <input
                              type="color"
                              className="h-7 w-8 rounded border border-border"
                              value={style.color}
                              onChange={(e) =>
                                updateTextStyle(role, (s) => ({
                                  ...s,
                                  color: e.target.value.toUpperCase(),
                                }))
                              }
                            />
                            <input
                              type="text"
                              className={`font-mono text-xs w-full ${textFieldClass}`}
                              value={style.color}
                              onChange={(e) =>
                                updateTextStyle(role, (s) => ({
                                  ...s,
                                  color: e.target.value.toUpperCase(),
                                }))
                              }
                            />
                          </div>
                        </div>
                      </div>

                      {/* Font Face Spec Selector */}
                      {fontCatalogSupported && (
                        <div>
                          <label className="block text-xs mb-1">指定 Font Face</label>
                          <select
                            className={`w-full text-xs ${textFieldClass}`}
                            value={style.fontFace?.family ?? ""}
                            onChange={(e) => {
                              const selectedFamily = e.target.value;
                              if (!selectedFamily) {
                                updateTextStyle(role, (s) => ({ ...s, fontFace: undefined }));
                              } else {
                                const found = fontFaces.find((f) => f.family === selectedFamily);
                                updateTextStyle(role, (s) => ({
                                  ...s,
                                  fontFace: {
                                    family: selectedFamily,
                                    platformId: found?.postScriptName,
                                    weight: found?.weight ?? 400,
                                    style: found?.style ?? "normal",
                                    fallbacks: [],
                                  },
                                }));
                              }
                            }}
                          >
                            <option value="">（カテゴリ既定の標準フォント）</option>
                            {filteredFontFaces.map((face) => (
                              <option key={face.postScriptName} value={face.family}>
                                {face.displayName} ({face.family})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Decorations */}
                      <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                        <label className="inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={style.decoration.bold}
                            onChange={(e) =>
                              updateTextStyle(role, (s) => ({
                                ...s,
                                decoration: { ...s.decoration, bold: e.target.checked },
                              }))
                            }
                          />
                          太字
                        </label>
                        <label className="inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={style.decoration.italic}
                            onChange={(e) =>
                              updateTextStyle(role, (s) => ({
                                ...s,
                                decoration: { ...s.decoration, italic: e.target.checked },
                              }))
                            }
                          />
                          斜体
                        </label>
                        <label className="inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={style.decoration.shadow}
                            onChange={(e) =>
                              updateTextStyle(role, (s) => ({
                                ...s,
                                decoration: { ...s.decoration, shadow: e.target.checked },
                              }))
                            }
                          />
                          ドロップシャドウ
                        </label>
                        <label className="inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={style.decoration.outline}
                            onChange={(e) =>
                              updateTextStyle(role, (s) => ({
                                ...s,
                                decoration: { ...s.decoration, outline: e.target.checked },
                              }))
                            }
                          />
                          縁取り
                        </label>
                      </div>
                    </div>
                  );
                })}
              </fieldset>
            </div>
          )}

          {/* Tab 3: Surfaces (Caption & Label) */}
          {activeTab === "surfaces" && (
            <div className="space-y-4 text-sm">
              <p className={metaTextClass}>
                V1では「字幕 (caption)」と「チャプターラベル (label)」の背景囲み・余白・角丸設定を公開しています。
              </p>

              <fieldset disabled={isBuiltIn} className="space-y-4">
                {(["caption", "label"] as const).map((role) => {
                  const surf = formDef.surfaces?.[role] ?? {
                    enabled: true,
                    backgroundColor: "#1B2740",
                    backgroundOpacity: 0.55,
                    paddingHorizontal: 36,
                    paddingVertical: 12,
                    borderRadius: 12,
                  };

                  return (
                    <div key={role} className="rounded border border-border p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold text-sm text-brand-700 dark:text-brand-300">
                          {ROLE_LABELS[role]} 囲み設定
                        </h4>
                        <label className="inline-flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={surf.enabled}
                            onChange={(e) =>
                              updateSurface(role, (s) => ({ ...s, enabled: e.target.checked }))
                            }
                          />
                          有効
                        </label>
                      </div>

                      {surf.enabled && (
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <label className="block mb-1">背景色</label>
                            <div className="flex items-center gap-1">
                              <input
                                type="color"
                                className="h-7 w-8 rounded border border-border"
                                value={surf.backgroundColor}
                                onChange={(e) =>
                                  updateSurface(role, (s) => ({
                                    ...s,
                                    backgroundColor: e.target.value.toUpperCase(),
                                  }))
                                }
                              />
                              <input
                                type="text"
                                className={`font-mono text-xs w-full ${textFieldClass}`}
                                value={surf.backgroundColor}
                                onChange={(e) =>
                                  updateSurface(role, (s) => ({
                                    ...s,
                                    backgroundColor: e.target.value.toUpperCase(),
                                  }))
                                }
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block mb-1">不透明度 ({Math.round(surf.backgroundOpacity * 100)}%)</label>
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.05}
                              className="w-full"
                              value={surf.backgroundOpacity}
                              onChange={(e) =>
                                updateSurface(role, (s) => ({
                                  ...s,
                                  backgroundOpacity: Number(e.target.value),
                                }))
                              }
                            />
                          </div>

                          <div>
                            <label className="block mb-1">水平余白 (px)</label>
                            <input
                              type="number"
                              min={0}
                              className={`w-full ${textFieldClass}`}
                              value={surf.paddingHorizontal}
                              onChange={(e) =>
                                updateSurface(role, (s) => ({
                                  ...s,
                                  paddingHorizontal: Number(e.target.value),
                                }))
                              }
                            />
                          </div>

                          <div>
                            <label className="block mb-1">垂直余白 (px)</label>
                            <input
                              type="number"
                              min={0}
                              className={`w-full ${textFieldClass}`}
                              value={surf.paddingVertical}
                              onChange={(e) =>
                                updateSurface(role, (s) => ({
                                  ...s,
                                  paddingVertical: Number(e.target.value),
                                }))
                              }
                            />
                          </div>

                          <div>
                            <label className="block mb-1">角丸 (px)</label>
                            <input
                              type="number"
                              min={0}
                              className={`w-full ${textFieldClass}`}
                              value={surf.borderRadius}
                              onChange={(e) =>
                                updateSurface(role, (s) => ({
                                  ...s,
                                  borderRadius: Number(e.target.value),
                                }))
                              }
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </fieldset>
            </div>
          )}
        </div>

        {/* Right Live Preview (6 cols) */}
        <div className="lg:col-span-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">代表サンプル リアルタイムプレビュー</h3>
            {previewDraft.isPending && (
              <span className="text-xs text-muted-foreground animate-pulse">更新中…</span>
            )}
          </div>

          <div className="relative aspect-video w-full rounded border border-border bg-black overflow-hidden shadow">
            {previewDraft.data?.compositionHtml ? (
              <iframe
                className="h-full w-full border-0"
                srcDoc={previewDraft.data.compositionHtml}
                title="Theme Preview"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-neutral-400">
                プレビュー生成中…
              </div>
            )}
          </div>

          {theme.missingFonts && theme.missingFonts.length > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 inline mr-1 text-amber-600" />
              以下の指定フォントが見つからないため、標準フォールバックフォントで描画されています:
              <ul className="list-disc pl-5 mt-1">
                {theme.missingFonts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
