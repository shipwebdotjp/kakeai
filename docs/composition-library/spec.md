# Composition Library 仕様

## 目的と境界

この文書は、AI が作成・更新する HyperFrames project を Kakeai 内で再利用する Composition Library の正とする。Composition は `Asset` ではない。画像・動画・音声の原本を表す Asset と異なり、Composition は編集可能な HyperFrames project の論理単位であり、`CompositionVersion` はその不変の公開版である。

ScriptVersion の正本は引き続き ContentDocument であり、HyperFrames HTML を台本 JSON へ保存しない。台本は `composition.full-bleed@1` の入力として CompositionVersion の ID だけを参照する。詳細な ContentDocument 契約は [../mvp/content-schema.md](../mvp/content-schema.md)、HTTP 契約は [../mvp/api-contract.md](../mvp/api-contract.md) を正とする。

v1 の対象は、Kakeai の Composition Library に保存され、HyperFrames skill を使う AI が作成・変更した project だけである。任意の外部 project の import、利用者による HTML/CSS/JavaScript の直接編集、任意 HTML の ScriptVersion への保存は対象外とする。Visual Skinを使うComposition Authoring Context、Style Kit、Style Provenanceの拡張は[../visual-skins/spec.md](../visual-skins/spec.md)を正とする。

## ライフサイクル

- `Composition` は再利用するモーションの論理単位で、安定した runtime composition ID を持つ。
- `CompositionDraft` は AI が次の変更を作るための可変な作業コピーであり、ScriptVersion や Render Job から参照しない。
- `CompositionVersion` は draft を明示 publish して作る不変版である。entry HTML、子 composition、固定メディア、フォント、manifest を一体の bundle として保持する。
- AI への修正指示は、使用中の CompositionVersion を変更せず draft を更新する。publish は新しい CompositionVersion を作り、利用したい VisualCue を含む新しい ScriptVersion がその版を参照する。

bundle と draft はアプリデータ領域の `compositions/` 配下に置く。保存するキーはアプリデータルート相対とし、正本に絶対パスを埋め込まない。published bundle は内容ハッシュで識別し、version の作成後に書き換えない。

## v1 の Composition 契約

CompositionVersion は次の manifest を持つ。

- bundle 内の相対 entrypoint、内容ハッシュ、安定した runtime composition ID、Canvas Profile とその寸法、有限の既定尺。
- すべての子 composition、固定画像、動画、フォントなどの bundle 内依存。
- 音声トラックを含まないこと。

v1 は `landscape`（1920×1080）と `portrait`（1080×1920）の全画面モーションを受け入れる。Canvas Profile は version ごとの不変プロパティであり、1つの Composition が両プロファイルの版を公開できる。外部 URL、絶対パス、ネットワーク取得に依存する素材は許可しない。AI は通常の HyperFrames composition QA と preview を通してから publish するが、外部 project 用の sandbox や手動承認フローは持たない。publish 時はサーバが entry HTML に HyperFrames lint を実行し、error がある bundle は拒否する（warning は許容する）。

### manifest と entry の契約

`manifest.json` は `compositionManifestSchema`（`packages/contracts`）の strict object である。

```json
{
  "entrypoint": "index.html",
  "contentHash": "draft",
  "runtimeCompositionId": "cmp.motion.example",
  "canvasProfile": "landscape",
  "width": 1920,
  "height": 1080,
  "durationMs": 10000,
  "dependencies": ["vendor/gsap.min.js"]
}
```

- `canvasProfile` は任意で、`landscape` または `portrait`。欠落時は `landscape` として解決する（既存 bundle の互換）。`width` / `height` はプロファイルの固定寸法（`landscape` = 1920×1080、`portrait` = 1080×1920）と一致しなければならない。任意の寸法や profile/寸法不一致は拒否する。`durationMs` は正の整数（ms）。
- `contentHash` は任意。サーバが publish 時に bundle 内容から `bundleHash` を計算し、保存・返却する manifest の `contentHash` にはその実ハッシュを設定する（bundle 内の `manifest.json` は書き換えない）。
- `dependencies` の各要素は bundle 内に実在する相対パスでなければならない。バイナリ（画像など）も依存に含められる。
- entry HTML は standalone 形式（`<body>` 直下に root、`<style>` は `<head>`）で書き、root の `data-composition-id` は `runtimeCompositionId` と、root の `data-width` / `data-height` はプロファイル寸法とそれぞれ一致させる。`<template>` 形式はコンパイル時に `<head>` の style/script が破棄されるため使わない。
- entry に `http(s)://` の外部 URL を含めてはならない。ライブラリは bundle へ同梱し `dependencies` に登録する。

### Canvas Profile

Canvas Profile は CompositionVersion が描画する内部キャンバスの固定セットである。

- `landscape` = 1920×1080（既定）、`portrait` = 1080×1920。
- version ごとの不変プロパティで、1つの Composition が landscape と portrait の版を別々に公開できる。ScriptVersion は使いたい版の ID を参照するだけで、既存参照は変わらない。
- 最終レンダー出力は常に 1920×1080。Canvas Profile は親 Composition へ入れ子配置される child 自身のキャンバスだけを定義する。
- `composition.full-bleed@1` は landscape の version だけを background に置ける。portrait は `scene.device-frame@1` の画面（9:16）に配置する。portrait を full-bleed へ保存・preview・render すると拒否する。

### authoring API

- `POST /compositions/:id/draft` は `{ entrypoint?, files?, filesBase64?, manifest? }` を受け取る。`files` はテキストファイル、`filesBase64` は base64 文字列で表したバイナリファイル（画像など）で、指定したファイルだけを上書きする部分更新（削除はしない）。同じ正規化パスを両方に含めることはできない。`manifest` を渡すとサーバが `manifest.json` を生成する（`entrypoint`・`runtimeCompositionId`・`width`・`height`・`contentHash` はサーバが設定し、`canvasProfile`・`durationMs`・`dependencies` を上書きする）。`canvasProfile` 省略時は現在の draft のプロファイル、無ければ `landscape` を使う。`files["manifest.json"]` の直書きも引き続き可能。
- `GET /compositions/:id/draft/files` は `{ entrypoint, files, binaryFiles? }` を返し、seed を含む draft の内容を読み戻せる。`files` は UTF-8 テキスト、`binaryFiles` は base64 文字列で表したバイナリ（存在する場合のみ）。
- `POST /compositions/:id/publish?dryRun=true` は version を作らずに publish と同じ検証だけを行い、成功時 `{ manifest }` を返す。失敗は常に 422 `VALIDATION_ERROR` と `details.issues`（`path`・`code`・`message`）で返し、manifest・依存・entry・外部 URL・entry id・lint の各問題を列挙する。
- Visual Skinを使うComposition authoring（`POST /compositions`の任意`authoringStyle`、`POST /composition-authoring-contexts`、Style Kit付きseed、`kakeai-style/`の保護とhash検証、`CompositionStyleProvenance`）は[../visual-skins/spec.md](../visual-skins/spec.md)を正とし、この文書のauthoring APIを拡張する。Style Kit付きのpublishでは、manifest・依存・entry・外部URL・lintの検証に加えて保護ファイルのhash照合を行い、改変を422 `STYLE_KIT_MODIFIED`で拒否する。

### 保存レイアウト

bundle と draft はアプリデータ領域の `compositions/` 配下に置く。`Composition` 作成時に `drafts/<compositionId>/`（seed の entry と `manifest.json`）が即時作成され、draft 更新のたびに指定ファイルが上書きされる。publish 時に `bundles/<contentHash>/<versionId>/` が作られ、以後書き換えない。`drafts/` と `bundles/` はサーバ管理であり、利用者や AI が直接編集しない。

同一 CompositionVersion は一つの ScriptVersion 内で複数回参照できる。HyperFrames の native nested composition が、重複した sub-composition ホストへ instance ごとの runtime composition ID を割り当て、CSS・DOM 参照・timeline 登録・SVG id を instance ごとにスコープする。この仕組みにより、AI が生成した project を書き換えずに複数配置の ID 衝突を防ぐ。異なる Composition には異なる runtime composition ID を割り当てる。

## ContentDocument と表示

`composition.full-bleed@1` は CompositionVersion を Composition 背景として置く信頼済み VisualTemplate である。

```json
{
  "template": { "id": "composition.full-bleed", "version": 1 },
  "range": { "kind": "scene" },
  "layer": "background",
  "input": { "compositionVersionId": "cmpver_001" }
}
```

- `layer` は `background` とし、`range` は `scene` / `lines` / `offset` の全てを許可する（共通 Cue range 解決を使う）。`background` 以外のレイヤーへの配置は ContentDocument 検証が拒否する。同一 version の複数配置は許可する（R2）。
- **尺**: Composition host の実効表示窓は `min(range 尺, manifest.durationMs)` とする。range 尺より child が短い Cue は child 終端で非表示にし、末フレーム保持・ループはしない。Cue transition は実効表示窓内に収まることを検証する。Scene crossfade により必要となる表示窓が child 尺を超える Composition 背景は、保存時とレンダー投入時に明示エラーにする。
- 音声、利用時の text/color/media slot は持たない。

### 端末画面への埋め込み（R3）

`scene.device-frame@1` の `screen` は `NestedVisual` であり、`kind: "composition"` の子として CompositionVersion を端末画面枠内に置ける。

```json
{
  "template": { "id": "scene.device-frame", "version": 1 },
  "range": { "kind": "scene" },
  "layer": "background",
  "input": {
    "frame": "laptop",
    "screen": {
      "kind": "composition",
      "compositionVersionId": "cmpver_001",
      "fit": "contain",
      "zoom": 1.5,
      "position": { "x": 0.5, "y": 0.5 }
    }
  }
}
```

- `fit` は必須で `contain` / `cover`。`zoom` は任意（`0.5..3`、省略時 `1`）、`position` は任意（`x`/`y` を `0..1`、省略時は中央）。
- 子は Cue 開始から 0 秒で再生し、child 尺で非表示にする。freeze と loop は持たない。Cue／Scene crossfade は親 device frame の可視性だけを変え、child の時計はリセットしない。
- 子の配置は slot の content box を基準に fit → zoom → position（object-position 相当の crop）で決める。親 screen は既存の角丸・枠・`overflow:hidden` で最終 clip を所有し、`contain` の余白は既存の黒背景を見せる。
- 配置は frame ごとの px 定数を持たず、**slot 要素を CSS `container-type: size` にする**ことで成立する。コンパイラは `cqw`/`cqh` と `tan(atan2())` から無単位の倍率を求め、固定 1920×1080 の子を `transform: scale()` で拡縮する。trusted template が Composition slot を設けるときは、その要素を `container-type: size` にする（独自ベゼル・将来の TV／site mockup も同じ契約）。
- 現行 canvas は `landscape`（1920×1080）と `portrait`（1080×1920）の2プロファイル。slot のスケーリングは解決済み manifest の寸法から導出し、`portrait` は phone screen（9:16）にそのまま収まる。`contain` の余白または `cover` の crop を選べる。

ScriptVersion の保存、プレビュー、Render Job の作成時に CompositionVersion の存在と bundle 完全性を確認する。draft、削除済み version、破損した bundle は参照できない。

## プレビューとレンダー

コンパイラは単一の HTML 文字列ではなく、親 `index.html` と参照 CompositionVersion の file tree からなる render project を組み立てる。親は `data-composition-src` で version 固有の entrypoint を参照し、HyperFrames が child timeline を独立して seek する。参照追跡は入れ子と複数 instance に対応し、preview の content URL 解決、render snapshot、bundle materialize も再帰的に参照を集める。

プレビューでは、published bundle の entrypoint と依存ファイルを同一 origin の読み取り専用 content URL で配信する。URL は media session cookie と厳密な path 検証で保護し、draft やアプリデータの絶対パスを公開しない。

レンダー開始時の Job snapshot には、参照した各 CompositionVersion の ID、bundle hash、manifest を固定する。ワーカーは snapshot と照合した bundle だけを一時 HyperFrames project に materialize し、親 index、Composition bundle、Asset Rendition を一回の `@hyperframes/producer` render で合成する。以後の draft 更新、新 version の publish、bundle 欠損は既存 Job の入力を変更しない。

## 非ゴール

- 任意の外部 HyperFrames / HTML project の import と実行。
- HTML/CSS/JavaScript の利用者向け編集 UI。
- 可変 slot、音声、任意 mask・透視変形。
- CompositionVersion を video Asset に自動変換して保存すること。透過 WebM へ bake する既存の通常 video Asset workflow は別物として維持する。
