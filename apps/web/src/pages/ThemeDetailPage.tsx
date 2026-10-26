import { useEffect, useMemo, useRef, useState } from "react";
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
import "@hyperframes/player";
import {
  NEUTRAL_VISUAL_SKIN_REF,
  SOFT_EDITORIAL_THEME_ID,
  SOFT_EDITORIAL_THEME_VERSION,
  getVisualTheme,
  listVisualSkinDefinitions,
  DEFAULT_CAPTION_SPEAKER_SURFACE,
  DEFAULT_CAPTION_SPEAKER_TEXT,
  resolveCaptionSpeakerStyle,
  resolveVisualThemeSkin,
  toVisualThemeDefinitionV2,
  visualThemeTextRoleSchema,
  type FontFace,
  type FontFaceSpec,
  type TextSurface,
  type TextStyle,
  type VisualSkinRef,
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
import { ColorField } from "../components/ColorField";
import { errorMessage } from "../lib/errorMessage";
import { includeFontFace, selectableFontFaces } from "../lib/fontFaceOptions";
import { asSeekablePlayer, safePlay } from "../lib/player";
import { capturePlayback, isPlayerReady, playbackRestoreSeconds, type PlaybackSnapshot } from "../lib/previewPlayback";
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
  const [activeTab, setActiveTab] = useState<"colors" | "typography" | "surfaces" | "skin" | "caption">("colors");
  const [fontSearch, setFontSearch] = useState("");

  const [playerElement, setPlayerElement] = useState<HTMLElement | null>(null);
  const playbackRef = useRef<PlaybackSnapshot | null>(null);
  const startedRef = useRef(false);

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
    }, 400);
    return () => clearTimeout(timer);
  }, [formDef]);

  const latestPreviewHtml = previewDraft.data?.compositionHtml;
  const lastPreviewHtmlRef = useRef<string | undefined>(undefined);
  if (latestPreviewHtml !== undefined && latestPreviewHtml.length > 0) {
    lastPreviewHtmlRef.current = latestPreviewHtml;
  }
  // Keep the last preview on screen while the next one compiles, so the player is
  // not torn down (and does not restart) between updates.
  const previewHtml = latestPreviewHtml ?? lastPreviewHtmlRef.current;
  const hasPreview = previewHtml !== undefined && previewHtml.length > 0;

  // Another theme's preview is a fresh start: play it from the beginning.
  useEffect(() => {
    startedRef.current = false;
    playbackRef.current = null;
  }, [themeId]);

  // A rebuilt preview replaces the composition document, which restarts playback.
  // Track the playhead while it plays so the new document can be put back where
  // the user left it, including a seek or pause made while a request is in flight.
  useEffect(() => {
    if (!hasPreview || playerElement === null) return;

    const syncPlayback = () => {
      const captured = capturePlayback(asSeekablePlayer(playerElement), performance.now());
      if (captured !== null) {
        playbackRef.current = captured;
      }
    };

    const applyReady = () => {
      const player = asSeekablePlayer(playerElement);
      if (player === null) return;
      if (!startedRef.current) {
        startedRef.current = true;
        safePlay(player);
        return;
      }
      const snapshot = playbackRef.current;
      if (snapshot === null) return;
      const now = performance.now();
      const target = playbackRestoreSeconds(snapshot, now, player.duration);
      if (player.seek === undefined) return;
      player.seek(target);
      if (snapshot.paused) {
        player.pause?.();
      } else {
        safePlay(player);
      }
      // Overlapping preview requests each reload a document. Carry the restored
      // position forward instead of replaying the whole gap on the next `ready`.
      playbackRef.current = { ...snapshot, timeSeconds: target, capturedAtMs: now };
    };

    playerElement.addEventListener("ready", applyReady);
    playerElement.addEventListener("timeupdate", syncPlayback);
    playerElement.addEventListener("play", syncPlayback);
    playerElement.addEventListener("pause", syncPlayback);
    if (isPlayerReady(asSeekablePlayer(playerElement))) {
      applyReady();
    }
    return () => {
      playerElement.removeEventListener("ready", applyReady);
      playerElement.removeEventListener("timeupdate", syncPlayback);
      playerElement.removeEventListener("play", syncPlayback);
      playerElement.removeEventListener("pause", syncPlayback);
    };
  }, [hasPreview, playerElement]);

  const fontFaces = fontCatalogQuery.data?.faces ?? [];
  const fontCatalogSupported = fontCatalogQuery.data?.supported ?? true;

  const skinDefinitions = useMemo(() => listVisualSkinDefinitions(), []);
  const currentSkin = formDef ? resolveVisualThemeSkin(formDef) : NEUTRAL_VISUAL_SKIN_REF;
  const matchedFontFaces = useMemo(
    () => selectableFontFaces(fontFaces, fontSearch, undefined),
    [fontFaces, fontSearch],
  );

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

  const updateSkin = (skin: VisualSkinRef) => {
    if (!formDef || isBuiltIn) return;
    setFormDef(toVisualThemeDefinitionV2(formDef, skin));
    setDirty(true);
  };

  const updateCaptionLayout = (layout: 'frame' | 'band') => {
    if (!formDef || isBuiltIn) return;
    const current = formDef.caption ?? { layout: 'frame' as const };
    setFormDef({ ...formDef, caption: { ...current, layout } });
    setDirty(true);
  };

  const updateCaptionSpeakerText = (updater: (style: TextStyle) => TextStyle) => {
    if (!formDef || isBuiltIn) return;
    const resolved = resolveCaptionSpeakerStyle(formDef);
    const current = formDef.caption?.speaker?.text ?? resolved.text;
    const updated = updater(current);
    const speakerSurface = formDef.caption?.speaker?.surface ?? resolved.surface;
    const layout = formDef.caption?.layout ?? 'frame';
    setFormDef({ ...formDef, caption: { layout, speaker: { text: updated, surface: speakerSurface } } });
    setDirty(true);
  };

  const updateCaptionSpeakerSurface = (updater: (surf: TextSurface) => TextSurface) => {
    if (!formDef || isBuiltIn) return;
    const resolved = resolveCaptionSpeakerStyle(formDef);
    const currentText = formDef.caption?.speaker?.text ?? resolved.text;
    const current = formDef.caption?.speaker?.surface ?? resolved.surface;
    const updated = updater(current);
    const layout = formDef.caption?.layout ?? 'frame';
    setFormDef({ ...formDef, caption: { layout, speaker: { text: currentText, surface: updated } } });
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

  const handlePublish = async () => {
    if (!themeId) return;
    if (!window.confirm("新しいリビジョンとして公開しますか？")) return;
    try {
      if (dirty && formDef) {
        await updateDraft.mutateAsync(formDef);
      }
      publishDraft.mutate(undefined, {
        onSuccess: () => setDirty(false),
      });
    } catch {
      // updateDraft mutation error handled by hook
    }
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
    <div className="mx-auto w-full max-w-[1400px] space-y-4">
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
              disabled={createTheme.isPending || theme.latestRevision === null}
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
                disabled={publishDraft.isPending || (!theme.hasDraft && !dirty)}
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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Form (6 cols) */}
        <div className="space-y-4 lg:col-span-6">
          {/* Tabs */}
          <div className="flex flex-wrap border-b border-border text-sm">
            <button
              type="button"
              className={`whitespace-nowrap px-4 py-2 font-medium border-b-2 ${
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
              className={`whitespace-nowrap px-4 py-2 font-medium border-b-2 ${
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
              className={`whitespace-nowrap px-4 py-2 font-medium border-b-2 ${
                activeTab === "surfaces"
                  ? "border-brand-600 text-brand-600"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("surfaces")}
            >
              テキスト囲み・背景
            </button>
            <button
              type="button"
              className={`whitespace-nowrap px-4 py-2 font-medium border-b-2 ${
                activeTab === "skin"
                  ? "border-brand-600 text-brand-600"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("skin")}
            >
              世界観（スキン）
            </button>
            <button
              type="button"
              className={`whitespace-nowrap px-4 py-2 font-medium border-b-2 ${
                activeTab === "caption"
                  ? "border-brand-600 text-brand-600"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("caption")}
            >
              字幕
            </button>
          </div>

          {/* Tab: Skin */}
          {activeTab === "skin" && (
            <div className="space-y-4 text-sm">
              <fieldset disabled={isBuiltIn} className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  動画全体の世界観を選びます。スキン未対応のテンプレートは標準描画で表示されます。
                </p>
                {skinDefinitions.map((skin) => {
                  const selected =
                    currentSkin.id === skin.id && currentSkin.version === skin.version;
                  return (
                    <label
                      key={`${skin.id}@${skin.version}`}
                      className={`flex cursor-pointer items-start gap-3 rounded border p-3 ${
                        selected ? "border-brand-600 bg-brand-50" : "border-border"
                      } ${isBuiltIn ? "cursor-default" : ""}`}
                    >
                      <input
                        type="radio"
                        name="visual-skin"
                        className="mt-1"
                        checked={selected}
                        disabled={isBuiltIn}
                        onChange={() => updateSkin({ id: skin.id, version: skin.version })}
                      />
                      <span>
                        <span className="block font-semibold">{skin.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {skin.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            </div>
          )}

          {/* Tab 1: Colors */}
          {activeTab === "colors" && (
            <div className="space-y-4 text-sm">
              <fieldset disabled={isBuiltIn} className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ColorField
                    label="キャンバス背景 (canvas.base)"
                    value={formDef.canvas.base}
                    onChange={(value) => updateColor("base", value)}
                  />
                  <ColorField
                    label="キャンバス文字 (canvas.ink)"
                    value={formDef.canvas.ink}
                    onChange={(value) => updateColor("ink", value)}
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <ColorField
                    label="プライマリ (accents.primary)"
                    value={formDef.accents.primary}
                    onChange={(value) => updateAccent("primary", value)}
                  />
                  <ColorField
                    label="セカンダリ (accents.secondary)"
                    value={formDef.accents.secondary}
                    onChange={(value) => updateAccent("secondary", value)}
                  />
                  <ColorField
                    label="ターシャリ (accents.tertiary)"
                    value={formDef.accents.tertiary}
                    onChange={(value) => updateAccent("tertiary", value)}
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ColorField
                    label="カード等背景 (surface)"
                    value={formDef.surface}
                    onChange={(value) => updateColor("surface", value)}
                  />
                  <ColorField
                    label="基本文字色 (text)"
                    value={formDef.text}
                    onChange={(value) => updateColor("text", value)}
                  />
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
                  const faceOptions = includeFontFace(
                    matchedFontFaces,
                    fontFaces,
                    style.fontFace?.platformId,
                  );
                  const selectedFaceUnknown =
                    style.fontFace?.platformId !== undefined &&
                    style.fontFace.platformId.length > 0 &&
                    !faceOptions.some((face) => face.postScriptName === style.fontFace?.platformId);

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
                          <span className="mb-1 block">文字色</span>
                          <ColorField
                            ariaLabel={`${ROLE_LABELS[role]} 文字色`}
                            value={style.color}
                            onChange={(color) => updateTextStyle(role, (s) => ({ ...s, color }))}
                          />
                        </div>
                      </div>

                      {/* Font Face Spec Selector */}
                      {fontCatalogSupported && (
                        <div>
                          <label className="block text-xs mb-1">指定 Font Face</label>
                          <select
                            className={`w-full text-xs ${textFieldClass}`}
                            value={style.fontFace?.platformId ?? ""}
                            onChange={(e) => {
                              const selectedPostScriptName = e.target.value;
                              if (!selectedPostScriptName) {
                                updateTextStyle(role, (s) => ({ ...s, fontFace: undefined }));
                                return;
                              }
                              const found = fontFaces.find(
                                (f) => f.postScriptName === selectedPostScriptName,
                              );
                              if (found === undefined) {
                                return;
                              }
                              updateTextStyle(role, (s) => ({
                                ...s,
                                fontFace: {
                                  family: found.family,
                                  platformId: found.postScriptName,
                                  weight: found.weight,
                                  style: found.style,
                                  fallbacks: [],
                                },
                              }));
                            }}
                          >
                            <option value="">（カテゴリ既定の標準フォント）</option>
                            {selectedFaceUnknown && (
                              <option value={style.fontFace?.platformId ?? ""}>
                                （この端末にないフォント: {style.fontFace?.family}）
                              </option>
                            )}
                            {faceOptions.map((face) => (
                              <option key={face.postScriptName} value={face.postScriptName}>
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
                            <span className="mb-1 block">背景色</span>
                            <ColorField
                              ariaLabel={`${ROLE_LABELS[role]} 囲みの背景色`}
                              value={surf.backgroundColor}
                              onChange={(backgroundColor) =>
                                updateSurface(role, (s) => ({ ...s, backgroundColor }))
                              }
                            />
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

          {/* Tab 4: Caption layout and speaker label */}
          {activeTab === 'caption' && (
            <div className="space-y-4 text-sm">
              <p className="text-xs text-muted-foreground">
                字幕レイアウト（枠／帯）と話者名タブの見た目を決めます。話者名の表示可否は作品側の設定です。
              </p>
              <fieldset disabled={isBuiltIn} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold mb-1">レイアウト</label>
                  <select
                    className={textFieldClass}
                    value={formDef.caption?.layout ?? 'frame'}
                    onChange={(e) => updateCaptionLayout(e.target.value as 'frame' | 'band')}
                  >
                    <option value="frame">枠（2行・中央・1600px幅）</option>
                    <option value="band">帯（3行・下端全幅）</option>
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    帯は下端を半透明で塗りつぶし、3行分の高さを確保します。タブは上端の左に重ねます。
                  </p>
                </div>
                <div className="rounded border border-border p-3 space-y-3">
                  <h4 className="font-bold text-sm text-brand-700">話者名タブ（18〜20px推奨）</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block mb-1">サイズ (px)</label>
                      <input
                        type="number"
                        min={8}
                        max={40}
                        className={textFieldClass}
                        value={formDef.caption?.speaker?.text.fontSize ?? DEFAULT_CAPTION_SPEAKER_TEXT.fontSize}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === '') return;
                          const parsed = Number(raw);
                          if (!Number.isFinite(parsed)) return;
                          const fontSize = Math.min(40, Math.max(8, Math.round(parsed)));
                          updateCaptionSpeakerText((s) => ({ ...s, fontSize }));
                        }}
                      />
                    </div>
                    <div>
                      <span className="mb-1 block">文字色</span>
                      <ColorField
                        ariaLabel="話者名タブ 文字色"
                        value={formDef.caption?.speaker?.text.color ?? DEFAULT_CAPTION_SPEAKER_TEXT.color}
                        onChange={(color) => updateCaptionSpeakerText((s) => ({ ...s, color }))}
                      />
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={formDef.caption?.speaker?.text.decoration.bold ?? DEFAULT_CAPTION_SPEAKER_TEXT.decoration.bold}
                      onChange={(e) =>
                        updateCaptionSpeakerText((s) => ({
                          ...s,
                          decoration: { ...s.decoration, bold: e.target.checked },
                        }))
                      }
                    />
                    太字
                  </label>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="mb-1 block">背景色</span>
                      <ColorField
                        ariaLabel="話者名タブ 背景色"
                        value={formDef.caption?.speaker?.surface.backgroundColor ?? DEFAULT_CAPTION_SPEAKER_SURFACE.backgroundColor}
                        onChange={(backgroundColor) =>
                          updateCaptionSpeakerSurface((s) => ({ ...s, backgroundColor }))
                        }
                      />
                    </div>
                    <div>
                      <label className="block mb-1">
                        不透明度 ({Math.round(((formDef.caption?.speaker?.surface.backgroundOpacity ?? DEFAULT_CAPTION_SPEAKER_SURFACE.backgroundOpacity) * 100))}%)
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        className="w-full"
                        value={formDef.caption?.speaker?.surface.backgroundOpacity ?? DEFAULT_CAPTION_SPEAKER_SURFACE.backgroundOpacity}
                        onChange={(e) =>
                          updateCaptionSpeakerSurface((s) => ({
                            ...s,
                            backgroundOpacity: Number(e.target.value),
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>
              </fieldset>
            </div>
          )}
        </div>

        {/* Right Live Preview (6 cols) */}
        <div className="space-y-3 lg:col-span-6">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">代表サンプル リアルタイムプレビュー</h3>
            {previewDraft.isPending && (
              <span className="text-xs text-muted-foreground animate-pulse">更新中…</span>
            )}
          </div>

          <div className="relative aspect-video w-full overflow-hidden rounded border border-border bg-black shadow">
            {previewHtml ? (
              <hyperframes-player
                ref={setPlayerElement}
                srcdoc={previewHtml}
                controls
                loop
                className="h-full w-full"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-neutral-400">
                プレビュー生成中…
              </div>
            )}
          </div>

          {previewDraft.isError && (
            <p className={errorTextClass}>{errorMessage(previewDraft.error)}</p>
          )}

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
