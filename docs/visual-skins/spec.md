# Visual Skin と Composition Authoring Context 仕様

## 目的と正本

この文書は、動画全体の世界観を **Visual Skin** としてアプリ管理し、Visual Theme・VisualTemplate・AI が作る Composition の間で共有する契約を定める。最初のSkinは `neutral@1` と `handmade-paper@1` とする。実装判断は本書を正とする。

既存のVisual Themeは配色・書体・余白・影などの既定トークンを提供し、VisualTemplateは情報の意味と入力契約を提供する。本機能はその間に「紙、テープ、ネオン、黒板のような描写の文法」を置く。Themeがカードや図表の任意CSSを持つ機能でも、利用者が任意のHTML/JavaScriptをSkinへ持ち込む機能でもない。

- Theme customizationのライフサイクルとFont Catalogは[../theme-customization/spec.md](../theme-customization/spec.md)を正とする。
- Scene・Cue・VisualTemplateの契約は[../mvp/content-schema.md](../mvp/content-schema.md)と[../composite-visuals/spec.md](../composite-visuals/spec.md)を正とする。
- AI管理Compositionのdraft／publish／bundle境界は[../composition-library/spec.md](../composition-library/spec.md)を正とする。本書はそのauthoring入力を拡張する。
- 決定理由は[ADR 0069](../adr/0069-visual-skin-and-composition-authoring-context.md)を参照する。

## 用語と責務の境界

| 層 | 責務 | 例 | 持たないもの |
| --- | --- | --- | --- |
| Visual Theme | 作品全体の既定トークンと選択Skin | 色、Font Face、余白、影、`handmade-paper@1`の選択 | Template別の任意CSS、素材そのもの |
| Visual Skin | 複数Templateに共通する世界観の描写規則とtrusted実装 | 紙のsurface、マスキングテープ、破れ縁、静かな貼り付け動作 | 利用者任意コード、Scene固有の内容 |
| Visual Template | 情報の意味、構造、入力契約、Skinが未対応時のneutral描画 | 表、引用、画像カード、3点の要点リスト | 作品全体のブランド選択 |
| Visual Cue | そのSceneでの内容、表示範囲、レイヤー、明示上書き | 表示する画像、引用文、表示区間 | 世界観全体の再定義 |
| Asset | 単発または内容固有のメディア | 写真、スクリーンショット、特定の手描きイラスト | 再利用されるカード枠やテープのUI表現 |
| Composition Authoring Context | AIがCompositionを作るときの、解決済みThemeとSkinの非永続入力 | `STYLE.md`、生成済みCSS、Style Kitの版と診断 | ScriptVersionやCompositionVersionへの直接参照 |

繰り返し使われ、内容や大きさに応じて伸縮し、構造を表すものはSkinに置く。たとえばマスキングテープ、破れ紙、黒板面、ネオン枠はSkinの部品である。特定動画だけの落書き、写真、紙の実写画像はAssetである。

Skinは同じ意味を異なる世界観へ寄せる。情報構造自体が変わる場合は、Skinではなく専用VisualTemplateを追加する。たとえば汎用の引用を紙片らしく描くのはSkinだが、黒板にチョークで段階的に図解する専用Sceneは将来の `scene.chalkboard@1` の候補である。

## Skinの版管理とThemeとの関係

Visual Skinはアプリに同梱するtrustedな版付きレジストリである。利用者Themeと異なり、v1で利用者はSkinを作成、編集、import、archiveできない。Skinの描画コード、Style Kit、AI向け記述を変えるときは同じ`id@version`を上書きせず、新しいversionを追加する。

新しいTheme Definition Schemaは必須の`skin`を持つ。

```jsonc
{
  "themeDefinitionSchemaVersion": 2,
  "id": "theme_opaque_id",
  "version": 3,
  "skin": { "id": "handmade-paper", "version": 1 },
  "canvas": { "base": "#FAF6EE", "ink": "#1F2A44" }
  // 既存のTheme token群
}
```

`ContentDocument.visualTheme` の `{ id, version }` 形状は変えない。SkinはTheme Revisionから解決され、CueやSceneへ複製保存しない。Theme Revisionの変更は既存ScriptVersionを変更せず、利用者が選び通常の台本保存をした新しいScriptVersionにだけ固定される。

既存の`themeDefinitionSchemaVersion: 1`で`skin`を持たないTheme Definitionは、保存値を書き換えず`neutral@1`として解決する。現在の`soft-editorial@1`と既存の利用者Themeはこの規則で互換を維持する。新しいTheme Draftと新規公開revisionはschema version 2を使い、明示的なSkin Refを必須とする。

Theme tokenとSkinの解決順は次のとおりとする。

1. Cueのプロパティ単位の明示値
2. Skinが提供するTemplate固有の描写規則
3. Theme Revisionのtoken
4. VisualTemplateの版固定neutral fallback

SkinはTheme tokenを置き換える固定の配色セットではない。たとえば`handmade-paper@1`は「温かい紙、控えめな不均一さ、テープで留めた情報片」という文法を決め、実際の紙色・アクセント・選択する手書きFont FaceはTheme Revisionが決める。これにより同じSkinを色違いの利用者Themeで再利用できる。

## Templateへの適用とfallback

各VisualTemplateは`neutral@1`のrendererを必ず持つ。Skin registryはTemplate id/versionごとに対応rendererを登録できる。選択中Skinが対象Templateを登録していればそれを使い、未登録ならTheme tokenを渡したneutral rendererを使う。未対応を保存・プレビュー・レンダーのエラーにはしない。

このfallbackは、Skinの対応範囲より先に新しいTemplateを追加できるようにする。新しいTemplateの受け入れ条件は`neutral@1`対応であり、既存Skinすべてへの同時対応ではない。UIは選択中Skinで強い描写を提供できるTemplateを識別できるが、Cueの選択肢から未対応Templateを隠さない。

Skin固有rendererもTemplateの入力Zodスキーマ、Cue range、layer、transition、AnimationPlanの所有境界を変更してはならない。Skinは任意CSS文字列・任意easing・任意JavaScriptをThemeやCueから受け取らない。

## 初期Skin

### `neutral@1`

`neutral@1`はすべてのVisualTemplateに対する標準描写であり、既存のTheme-aware rendererと同じ意味を持つ。既存Theme Definitionの暗黙のSkinである。VisualTemplateを追加するときは、最初にneutral rendererを設計する。

### `handmade-paper@1`

`handmade-paper@1`は、温白色の紙を基調に、情報を手で整理してテープで留めた編集ノートのように見せるSkinである。スクラップブックの過剰なコラージュ、黒板、サイバー表現はこのSkinに含めない。

共通の描写規則は次とする。

- 背景は温かい紙の地を基本とし、紙目は本文の可読性を損なわない弱さに留める。
- 重要な情報は紙片、付箋、控えめなマスキングテープ、必要な箇所だけの破れ縁で構造化する。
- 傾き・影・縁の不均一さは手仕事を感じる最小限に留め、本文、数値、図表の読み取りを優先する。
- 動きはCueの入場・退場とセリフ同期の効果だけに任せ、Skin側で自動の登場モーションを付けない。跳ねすぎ、発光、glitch、強い3D変形を使わない。
- Themeで選択された手書き系Font Faceを使えるが、Skinは特定のFont Faceを強制しない。読みやすいfallbackを常に持つ。

最初にSkin rendererを持つ対象は次に限定する。

| 表現 | 対象 | `handmade-paper@1`での役割 |
| --- | --- | --- |
| Scene背景 | compilerのScene surface | 紙の地、弱い繊維感、Theme accentに調和する面 |
| タイトル・見出し・label | `text.block@1` | 紙片または控えめな見出し帯。タイトル画面もこの表現で成立させる |
| 画像カード | `media.card@1` | 写真／動画を留めた紙片として扱い、テープまたは紙の縁を提供する |
| 要点リスト | `list.callout@1` | 3点程度の要点を、それぞれ留めた紙片として段階表示する |
| 引用 | `quote@1` | 引用文と出典を紙片の余白と控えめな引用記号で分ける |

表、グラフ、フローダイアグラム、stat、端末枠、立ち絵などは初回のSkin対応対象に含めない。これらは`neutral@1` fallbackで描画し、実際の動画で不調和が問題になった対象だけを後続versionで対応する。

## Style Kit

Style Kitは、一つのVisual Skin versionに対応するAI authoring用の不変trusted bundleである。アプリのTemplate rendererと同じ世界観を、Kakeai外で動くCLIコーディングエージェントにも再利用させるために存在する。

Style Kitは少なくとも次を持つ。

- `STYLE.md`: 世界観、必須規則、禁止規則、可読性・余白・動きの原則。
- `tokens.css`: 解決済みTheme tokenをCSS custom propertyへ出力したもの。
- `fonts.css`: 現在のmacOSとHyperFrames Chromiumで検証済みの`@font-face { src: local(...) }` aliasとfallback。
- `components.css`と必要なSVG／画像: 紙、テープ、破れ縁など再利用するtrusted部品。
- `kit-lock.json`: Skin Ref、kit hash、各保護ファイルのhash、生成元Theme Revision、Font診断を記録するlock。

`kakeai-style/`以下のStyle KitファイルはComposition Draftのseed時にKakeaiが作る保護ファイルである。AIはそれらを読んで参照できるが、更新してはならない。publish時はサーバが`kit-lock.json`と保護ファイルのhashを検証し、変更されていれば`STYLE_KIT_MODIFIED`として拒否する。AIが生成する内容固有の画像・SVG・CSSは`assets/`またはagent自身の名前空間へ置き、Kitのファイルと混ぜない。

Kitは外部URLや絶対パスを含まない。Composition publish後も単体で動くよう、必要な部品はComposition bundleにコピーされる。CLI agentがKakeaiの共有ディレクトリを直接参照する設計にはしない。

## Composition Authoring Context

Composition Authoring Contextは、指定された公開Theme RevisionからSkin、token、Style Kit、Font診断を解決した非永続のauthoring入力である。AIに「Skinを探して読ませる」ことを要求せず、Composition作成前に必ずContextを渡す。

Contextは次を含む。

```jsonc
{
  "contextSchemaVersion": 1,
  "theme": {
    "ref": { "id": "theme_opaque_id", "version": 3 },
    "definitionHash": "sha256:..."
  },
  "skin": { "id": "handmade-paper", "version": 1 },
  "kit": { "version": 1, "hash": "sha256:..." },
  "canvasProfile": "landscape",
  "brief": {
    "intent": "温かい紙の編集ノート。情報は手で留めた紙片として整理する。",
    "must": ["..."],
    "avoid": ["..."]
  },
  "fontDiagnostics": ["..."],
  "seed": { "styleDirectory": "kakeai-style/" }
}
```

ContextはCompositionVersionを動的にThemeへ追従させない。AIはContextを基にHTML/CSSと内容固有のAssetを作り、publish済みCompositionVersionはそのbundleで見た目を固定する。後でThemeの色やFont Faceを変えても既存CompositionVersionのHTML/CSSは書き換えない。

publish時は次の**Composition Style Provenance**をCompositionVersionの不変メタデータとして保存する。

- authoring時のTheme Refと解決済みTheme Definition hash
- Skin RefとStyle Kit hash
- Context schema version、Canvas Profile、Font診断

Script Versionの選択ThemeとCompositionVersionのSkin Refが異なるとき、UIは不調和の可能性を警告する。v1では保存・レンダーを拒否せず、既存CompositionVersionを自動変換もしない。Skin一致は「Compositionが同じ世界観で作られた」ことを示す来歴であり、ランタイムでSkinを差し替える変数ではない。

### ローカルフォント

KakeaiのローカルmacOSレンダーでは、HyperFramesが使うChromiumで解決できるFont Faceをbundle同梱せずに使える。Style Kitは利用者が入力したfamily文字列をそのままCSSへ出さず、Font Resolverが検証した正確なlocal face nameだけから`fonts.css`を生成する。

```css
@font-face {
  font-family: "KakeaiSkinBody";
  src: local("Exact Local Face Name");
  font-style: normal;
  font-weight: 500;
}

:root { --kakeai-skin-font-body: "KakeaiSkinBody", sans-serif; }
```

HyperFrames lintは、`@font-face`を伴わない任意のnamed `font-family`を拒否する。AIはThemeのFont Face名を直接書かず、Kitが渡すaliasだけを使う。`document.fonts.ready`後に文字計測とtimeline登録を行う。

Context生成時、draft preview時、publish前、render投入前に、Kakeaiは同じChromiumでFont Faceの解決可否を診断する。見つからない場合は、定義済みfallbackを含む`fonts.css`で継続し警告する。ローカルフォントだけを使うv1のCompositionは、別Mac、Docker、クラウドレンダーで同一見た目を保証しない。これらを対象にするときだけ、再配布可能なfont fileをStyle Kitへ同梱する別機能を設計する。

## APIと外部CLI agent

ここで示すAPIは本機能の実装時に[../mvp/api-contract.md](../mvp/api-contract.md)へ追加する予定の契約であり、現行APIではない。すべて既存のloopback API (`/api/v1`) に置き、インターネットへ公開しない。

1. `POST /composition-authoring-contexts` は `{ visualTheme: { id, version }, canvasProfile }` を受け、書込みなしで解決済みContextを返す。Themeは公開revisionだけを受け付ける。
2. `POST /compositions` は既存入力に`authoringStyle: { visualTheme: { id, version } }`を任意追加する。指定時、サーバは同じContextを再解決し、最小seedにStyle Kitを加えたDraftを作る。
3. agentは既存の`GET /compositions/:id/draft/files`でseedを読み、作業用source folderへ展開する。完成後は既存のDraft更新・dry-run publish・publish APIを使う。

CLI agent向けの`skills/kakeai-composition/SKILL.md`は、次を必須手順として追加する。

- Compositionを作る前にContextを取得し、`STYLE.md`、`tokens.css`、`fonts.css`、`kit-lock.json`を読む。
- `kakeai-style/`を編集せず、Style KitのCSS custom propertyと部品を参照する。
- Font名を直接CSSに書かず、Kitのfont aliasを使い、`document.fonts.ready`後に文字計測・timeline登録をする。
- HyperFramesの通常QAに加え、世界観、可読性、Style Kit改変なしを確認し、dry-run publishを通してからpublishする。

外部CLI agentはKakeai管理下のAI authoring sourceであり、任意の外部projectをimportする権限を得ない。既存のHost／Origin検証、相対bundle path、外部URL禁止、publish時lintというComposition Libraryの安全境界を維持する。

## 非ゴール

- 利用者が任意のCSS、HTML、JavaScript、Style Kit、Skin rendererを作成またはimportすること。
- Cueごと、SceneごとにSkinを切り替えること。
- 既存CompositionVersionを選択Themeへ自動追従・再着色・再レイアウトすること。
- Skin未対応Templateの使用を禁止すること。
- 初期段階で`handmade-paper@1`以外の強い世界観、黒板、スクラップブック、サイバーSkinを同時に実装すること。
- ローカルフォントだけで、別Mac、Docker、クラウドレンダーまで完全なフォント再現性を保証すること。

## 検証

- Theme Definition v1が暗黙に`neutral@1`へ解決し、既存ScriptVersionの見た目を変えない。
- Theme Definition v2が未知Skin、未知Skin versionを参照すると、保存・preview・render投入で拒否される。
- Skin対応済みTemplateがSkin rendererを使い、未対応TemplateがTheme token付きneutral fallbackを使う。
- `handmade-paper@1`の背景、`text.block`、`media.card`、`list.callout`、`quote`が、紙・テープ・可読性・有限motionの規則を満たす。
- Context APIが永続データを作らず、公開Theme Revisionだけを解決し、同じ入力から同じKit hashを返す。
- Style Kit付きComposition Draftをread-backしても、binary/text assetが失われない。Kit改変はpublishで拒否する。
- CompositionVersionのStyle Provenanceが不変で、後のTheme Draft変更、Theme archive、Skin追加で変化しない。
- macOS Font Catalogが返すlocal face nameを使う`@font-face local()`が、HyperFrames Chromiumでloadedになる。未解決Faceはfallbackと警告になる。
- 同一Skin以外のCompositionをSceneへ配置すると警告するが、既存Compositionの保存・preview・renderを壊さない。
