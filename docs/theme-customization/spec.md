# Visual Theme カスタマイズ仕様

## 目的と境界

この文書は、利用者がVisual Themeを作成・編集・公開し、作品へ明示的に適用できるようにする仕様である。既存のVisual Theme基盤に対するこの機能の判断は本書を正とし、設計判断は[ADR 0049](../adr/0049-custom-visual-theme-revisions.md)を参照する。用語は[CONTEXT.md](../../CONTEXT.md)を正とする。

Visual Themeは出力映像の既定の見た目であり、Web UIのライト／ダークテーマではない。Visual Themeが選ぶVisual Skinと、そのSkinをAI Compositionへ渡す後続機能は[../visual-skins/spec.md](../visual-skins/spec.md)を正とする。Theme Definition Schema v2とTheme編集画面のSkin選択は同仕様で実装済みである。任意のCSS、HTML、JavaScript、フォントファイルの持ち込みは含めない。V1では実作品をTheme Draftで一時プレビューする機能を含めず、テーマ編集画面に固定の代表サンプルプレビューを置く。

## 成果と非ゴール

V1は次を提供する。

- 組み込みテーマと利用者テーマを並べて扱うテーマ一覧。
- 組み込みテーマの複製、新規利用者テーマ、Theme Draftの明示保存・破棄・公開・アーカイブ。
- 背景、surface、アクセント、字幕、テキストroleごとのフォント・色・装飾・囲み背景を調整するテーマ編集画面とライブプレビュー。
- macOSで現在利用可能なFont Faceの検索・選択、欠落フォントの警告とfallback描画。
- 公開Theme RevisionをWork編集画面で選択し、通常の明示台本保存によって新しいScript Versionへ固定する操作。
- `text.block@1` の映像用 `label` role。これは各Sceneに利用者が任意の文言で手動配置する小チャプターラベル用である。

V1で扱わないものは、Theme Draftによる実Workのプレビュー、テーマ／作品の共有・インポート・エクスポート、フォントファイルの取込み・埋込み、任意CSS、Sceneごとのテーマ切替、テーマの自動追従、複数label variant、カード・表・グラフなどテンプレート固有の編集項目である。

WindowsとLinuxは将来の対象にできるが、V1が実装するFont CatalogはmacOSだけとする。プラットフォーム差はFont Catalogの実装境界に閉じ込め、保存契約とWeb UIは共通にする。

## ライフサイクルと不変性

Themeはアプリ全体で再利用する論理的なテーマであり、名前、作成日時、アーカイブ状態を持つ。組み込みThemeはアプリ管理で不変、利用者ThemeはアプリDBで管理する。

Theme RevisionはTheme内で連番を持つ公開済みの不変定義である。ContentDocumentの既存参照 `{ id, version }` はTheme Revisionを指す。組み込みテーマは既存の静的レジストリで、利用者ThemeはDBから解決する。両者のidは衝突しない。利用者Themeのidは意味を持たない不透明なIDを使う。

Theme Draftは1 Themeにつき最大1つの可変な編集中定義である。Theme Draftは公開revisionでも正本でもなく、ContentDocument、Render Job、Artifactから参照してはならない。Theme Draftの保存はrevision番号を消費しない。公開時だけ、トランザクション内で次のrevision番号を割り当て、Draftの検証済み定義をコピーしたTheme Revisionを作る。公開成功後もDraftを残すか破棄するかはV1では破棄とする。

組み込みThemeは直接編集できない。「複製して編集」は新しい利用者Themeと、そのTheme Draftを作る。利用者Themeの公開revisionは、Script Versionまたはqueued/running Render Jobから参照される限り物理削除しない。V1の削除操作はThemeをアーカイブし、新規選択肢から隠すだけとする。アーカイブ済みrevisionの解決は維持する。

## 作品への適用と更新

Theme Revisionは自動追従しない。あるScript Versionが`theme-a@1`を参照しているとき、`theme-a@2`を公開してもその参照は変化しない。

Work編集画面は、現在のTheme Revisionと、同じThemeの利用可能な公開revisionを区別して表示する。利用者がrevisionを明示選択すると、編集用ContentDocumentの`visualTheme`だけを置き換えて未保存状態にする。通常の台本保存が、その選択を含む新しいScript Versionを作る。Cue入力、音声、素材、Scene構造をテーマ値へ展開保存してはならない。これにより過去のScript VersionとRender Jobは元のrevisionを参照し続ける。

新規Workはアプリ既定の組み込みTheme Revisionを参照して開始する。既定Themeの変更は将来の新規Workにだけ影響し、既存Workを変更しない。

## テーマ定義

Theme RevisionとTheme Draftの定義JSONは`themeDefinitionSchemaVersion`を持ち、ContentDocumentの`schemaVersion`から独立して進化する。各定義はZodで厳密に検証する。`ContentDocument.visualTheme`の形状は既存の`{ id, version }`を維持するため、この機能だけではContentDocumentのschemaVersionを上げない。

テーマの共通トークンは既存のcanvas、accents、surface、semantic colors、radius、shadow、motion、categoryColors、artDirectionを維持する。Theme Definition Schema v2は版付きVisual Skin Ref（必須）を持ち、v1のskin欠落は`neutral@1`へ解決する（[../visual-skins/spec.md](../visual-skins/spec.md)を正とする）。利用者が編集できる文字既定値は次のroleを持つ。

- `title`
- `subtitle`
- `heading`
- `body`
- `closing`
- `caption`
- `label`
- `code`

文字の見た目は次の二つを別の型として定義する。

- **Text Style**: Font Face参照、サイズ、色、行間、太字、イタリック、縁取り、影。
- **Text Surface**: 背景なしまたは単色背景、背景色と不透明度、水平・垂直余白、角丸、枠線。

すべてのtext roleはText Styleを持つ。Text Surfaceはroleごとの既定値として持て、V1では少なくともcaptionとlabelの設定を編集画面で公開する。他roleのText Surfaceは定義上サポートし、UI公開は将来追加できる。字幕は固定層だが`caption`のText StyleとText Surfaceを使う。`label`は`text.block@1`のCueが使い、Scene Labelとは一切連動しない。

字幕レイアウトと話者名タブは Theme v2 の加算として `caption: { layout, speaker }` に持つ（`themeDefinitionSchemaVersion` は 2 のまま）。`layout` は `frame`（既存の2行枠・中央・最大1600px）か `band`（下端全幅の3行帯・セーフエリア半透明塗りつぶし）で、省略時は `frame` と解釈する。`speaker` は話者名タブ専用の小さめスタイル（Text Style + Text Surface、既定 20px・太字・白・`#1B2740` 85%・上下4左右16・角丸8）で、省略時は既定を使う。タブは枠・帯いずれの上端にも左寄せで重ね、表示ON/OFFで行数予算とセーフエリアを変えない。既存テーマは見た目を変えない。詳細は [ADR 0094](../adr/0094-caption-speaker-label-responsibility.md) を参照する。

`text.block@1`は`label` roleを追加し、個別Cueの文字上書きが必要なときにFont Face参照とText Styleの上書きを受け取れるようにする（[ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md) で `@2` から `@1` へ再基準化）。旧`font: sans | serif | mono`指定は描画互換のため残し、選択ThemeのFont Face既定より優先する。

Text Styleは、locale別のFont Face上書き `fontFaceByLocale`（`Partial<Record<SupportedLocale, FontFaceSpec>>`、optional）を持てる（[ADR 0097](../adr/0097-locale-specific-theme-fonts.md)）。`themeDefinitionSchemaVersion` は 2 のまま加算し、既存定義はそのまま解釈する。未知localeキーはZodで拒否し、最後のlocaleエントリを消した場合は `{}` を保存せず `fontFaceByLocale` 自体を省略する（空辞書と未指定を同義にする）。Font CatalogはUIの選択肢の根拠であり、未検出faceを保存・公開の拒否理由にはしない。`FontFaceSpec.fallbacks` はCSS出力に使わない。

Font Faceの解決順は、Cueの明示上書き → `fontFaceByLocale[document.locale]` → Text Styleの共通 `fontFace` → locale依存のカテゴリスタックとする。サムネイルは候補Appearance → Edition共通Appearance → Themeのlocale別 → Themeの共通 → locale別スタックの順で、`resolveThumbnailAppearanceDefaults` がlocale別指定を `fontFace` へ具現化してからAppearanceを重ねる。カテゴリスタックは `THEME_FONT_STACKS` をja-JP・en-USの既定とし、zh-Hansは `PingFang SC`/`Noto Sans SC`、zh-Hantは `PingFang TC`/`Noto Sans TC` を先頭にする。`mono` はLatin等幅の後・generic `monospace` の前にCJKフォールバックを置く。HTMLの `lang` は動画がContentDocument locale、サムネイルがLanguage Edition localeを出力する。

値の解決順はプロパティ単位で次のとおりとする。

1. Cueの明示上書き
2. 選択中Theme Revisionのrole既定値
3. VisualTemplateの版固定fallback

上書きを「テーマ既定に戻す」操作は、Cueから該当プロパティを削除することで表す。Theme値をCueへmaterializeしてはならない。

## Font Catalog と Font Face

Font Catalogは現在の端末で利用可能なFont Faceを列挙するアプリサービスである。WebブラウザはOSフォント全体を自力で列挙せず、APIから正規化済みカタログを取得する。

共通のFont Face DTOは、安定したplatform identifier、family名、表示名、face名、weight、style、stretch、可変font axis、利用可否を持つ。Theme定義には少なくとも選択faceのplatform identifier、family名、style/weight、定義済みfallback列を保存する。利用者入力のfont名を未エスケープのCSSとして出力してはならず、コンパイラはFont Resolverが解決・エスケープした値だけを出力する。

family名はCSSのfont familyとして解決できる名前でなければならない。macOSの`system_profiler SPFontsDataType`が返す項目名はフォントファイル名（例: `YuMincho.ttc`）でありfamily名ではないため、adapterはtypeface側の`family`を使い、存在しない場合だけファイル名から拡張子を除いて代用する。platform identifierはPostScript名とし、同じfamilyに複数のfaceがある場合でもfaceを一意に特定できるようにする。Web UIのface選択はplatform identifierで選択肢を識別し、familyだけで同一視してはならない。

コンパイラはText Roleごとに、選択faceのplatform identifier、family名、カテゴリのgeneric stackの順でfont-familyを出力する。platform identifierを先頭に置くことで、family内に複数のfaceがあるフォント（例: 游明朝体のMediumとDemibold）でも選択したfaceがそのまま描画される。

この解決はChromium（MP4レンダーとサムネイル）を前提とする。macOS 26では游明朝体、クレー、筑紫A丸ゴシック、凸版文久明朝などの多くが`FontServices.framework`配下のSubsetsとして保持されており、Safari（WebKit）のweb contentからは解決できない。`~/Library/Fonts`へ利用者が導入したフォントも同様に解決できない。この場合font-familyは次のfamily名、最終的にはカテゴリのgeneric stackへフォールバックするため、Font Faceを切り替えても描画は変わらない。V1はこのブラウザ差を吸収せず、テーマ編集にはChromium系ブラウザを使う運用とする。サーバー側でChromium描画した静止画をプレビューへ出す案は将来の選択肢とし、V1には含めない。

V1のmacOS Font CatalogはmacOSのフォント基盤から列挙し、起動時キャッシュと手動更新を持つ。将来のWindows DirectWrite、Linux Fontconfig実装も同一DTOを返す。レンダーに使うChromiumでfaceが解決できるかはカタログ列挙と別に確認する。

指定faceが選択・プレビュー・Render Job作成時に見つからない場合、保存や公開は拒否しない。Theme編集画面、Work編集画面、プレビュー、レンダー投入前に欠落Font Faceと使用するfallbackを警告し、コンパイルはfallbackで継続する。Theme Revision自体は同じFont Face参照を保持し、環境依存の解決結果を正本へ書き戻さない。レンダー投入時はdocument localeを診断入力に取り、zh-Hans／zh-Hantで言語別のフォント指定がなく共通 `fontFace` のみを使うロール（8ロールと `caption.speaker.text`）には、字形が中国語と一致しない可能性を警告する。これはFont Catalogが字形カバレッジや日中字形差を実測できないことによるリスク指摘であり、レンダーは継続する。

## 解決、プレビュー、レンダー

既存の`packages/contracts`内の組み込みThemeレジストリだけでは利用者Themeを検証できない。Theme Refはcontractsで形状のみを検証し、保存、プレビュー、レンダー投入ではTheme Resolverが組み込みレジストリとDBの公開Theme Revisionを解決して実在性を検証する。存在しない参照は従来どおり拒否する。

Render Jobを作るときは、ContentDocumentのTheme Refだけでなく、解決済みのTheme Revision定義とFont Resolverの診断をJob snapshotへ固定する。ワーカーはDB上の最新ThemeやTheme Draftを読み直さず、snapshotの定義でコンパイルする。Theme Revisionがアーカイブ済みでも、過去のJobは実行できる。

テーマ編集画面のプレビューは固定の代表ContentDocumentを使う。代表サンプルにはbackground、surface、accent、title、subtitle、heading、body、closing、label、captionを含める。代表ドキュメントのlocaleはプレビューリクエストの`locale`（既定`ja-JP`）に従い、zh-Hans／zh-Hantでは簡体字・繁体字の判別用サンプル文を使う。編集フォームの未保存値を`themeDefinition` overrideとしてプレビューAPIへ送り、通常のコンパイラでHTMLと診断を返す。この呼び出しはDB、Script Version、Theme Revision、Job、Artifactを作成しない。実WorkをDraftでプレビューするAPIはV1に含めない。

返したHTMLは完成したCompositionそのものなので、Web UIはHyperFramesプレイヤー（`<hyperframes-player>`）で再生する。プレイヤーは枠に合わせてCompositionをスケールし、Sceneの`data-start`/`data-duration`に従って再生・シークする。通常の`<iframe>`へ直接描画してはならない（スケールされず、全Sceneが重なって表示される）。

代表サンプルプレビューはサーバーでHTML/CSSへコンパイルするだけで、ラスタライズはしない。描画は閲覧ブラウザが行うため、見た目はブラウザのフォント解決に依存する。MP4とサムネイルは管理下のChromiumで描画する。したがってFont Faceの描画はMP4を正とし、テーマ編集にはChromium系ブラウザを使う運用とする（Safariでの制約は「Font Catalog と Font Face」を参照）。

編集フォームの変更はプレビューのHTMLを作り直すため、プレイヤーはCompositionを再読み込みして先頭へ戻る。Web UIはプレビューの再生位置と再生／一時停止状態をプレイヤーのイベントから追跡し、新しいCompositionの`ready`で同じ位置へシークして状態を復元する。一時停止中は同じ位置で止めたまま、再生中は再読み込みに要した時間だけ進めて再生を継続する。再合成中は直前のプレビューを表示したままにする。これらは閲覧ブラウザ上でのプレイヤー操作であり、コンパイル結果やレンダーには影響しない。

## APIとUI

APIは少なくとも次の責務を持つ。

- 組み込み／利用者Themeの一覧、公開revision、Theme Draftの取得。
- 利用者Themeの作成、組み込みThemeからの複製、Theme Draftの明示保存・破棄、公開、アーカイブ。
- Font Catalogの取得と更新。
- 任意の検証済み`themeDefinition`による代表サンプルプレビュー。

公開済みTheme Revisionの内容を更新するAPIは置かない。ContentDocumentへのTheme適用は既存の明示台本保存フローで行い、Theme APIがWorkやScript Versionを直接書き換えない。

Web UIはグローバルナビゲーションに「テーマ」を追加し、Theme一覧とTheme編集画面を提供する。Theme編集画面は、編集フォームとライブプレビューを常に並べて表示する。公開・アーカイブ・破棄は確認操作を要求する。Work編集画面は公開済みTheme Revisionだけを選択でき、Draftを候補に表示しない。

## 移行

`soft-editorial@1`と既存Script Versionはそのまま有効である。組み込みThemeをDBへ移す必要はない。現行の`visualThemeRefSchema`が組み込みThemeだけを静的に拒否している検証を、形状検証とResolver検証へ分離する。ContentDocumentの既存JSON形状、既存Theme Ref、Cueの明示値、Render Jobの旧snapshotは保持する。

`text.block@1`のlabel・Font Face・surface拡張は再解釈を伴わないため同じ版で行い、既存Text Cueを自動変換しない。

## 検証

- Theme Revision／Draftの不変性、公開連番、複製、アーカイブ、参照保護。
- 組み込みとDB Themeの解決、未知Theme拒否、旧`soft-editorial@1`互換。
- Theme更新が既存Script Versionを変更せず、明示保存だけが新しいScript Versionを作ること。
- Text Style、Text Surface、caption、`text.block@1`のlabel、Cue上書き／既定復帰の解決順。
- Font Catalog DTO、未解決Font Faceの警告、CSS値の安全なエスケープ、fallback描画。
- Theme Draft代表プレビューが永続データもJobも作らず、Draft定義を反映すること。
- Render Job snapshotがTheme Revision定義を固定し、後のDraft変更・Theme archiveで変化しないこと。
- API入力の厳密なZod検証、一覧・編集・公開・テーマ選択UIの往復。
