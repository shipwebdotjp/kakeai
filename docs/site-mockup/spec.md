# サイトモックアップ（フレーム型）仕様

## 目的と境界

この文書は、ロードマップ Phase 1 の次段として、有名な投稿サイト・技術サイト・ブラウザの「ガワ（chrome）」の中に、利用者が用意した画像・動画（スクリーンショットや画面録画）を収める **フレーム型の複合ビジュアル** `scene.site-mockup@1` を定める。決定は [ADR 0033](../adr/0033-site-mockup-frame-variants.md) を参照する。台本契約は [../mvp/content-schema.md](../mvp/content-schema.md)、複合ビジュアルの基盤は [../composite-visuals/spec.md](../composite-visuals/spec.md) を正とする。

- **型A（フレーム型）に限定する。** 画面の中身は利用者の素材（画像・動画）とし、投稿本文・メタ情報を構造化データから組み立てる「フェイク投稿型」は本仕様の対象外とする。構造化入力は table/chart 系で扱う。
- ロゴ・ワードマークは同梱しない。**汎用スタイル**（配色・レイアウトで「らしさ」を出す）で描画し、必要なら利用者が持ち込んだロゴ素材を任意で重ねられる。商標の利用可否は利用者が確認する。
- 任意HTML/JavaScriptは正本に持ち込まない。信頼済みテンプレートの入力Zodスキーマに適合するパラメータJSONだけを受け入れる。

## テンプレート契約

```jsonc
{
  "template": { "id": "scene.site-mockup", "version": 1 },
  "input": {
    "variant": "x",                 // 必須。下記variant一覧
    "screen": { "kind": "media", "assetId": "...", "fit": "cover" }, // 必須。NestedVisual
    "theme": "light",               // 任意。light | dark（既定 light）
    "name": "表示名",               // 任意
    "handle": "@handle",            // 任意
    "url": "https://example.com",   // 任意
    "caption": "投稿本文",           // 任意
    "logo": { "kind": "media", "assetId": "...", "fit": "contain" }, // 任意。利用者持ち込みロゴ
    "animation": { "preset": "fade", "durationMs": 400 } // 任意（P1のAnimationPlan）
  }
}
```

- `layers`: `["card", "overlay"]`。背景には置かない。
- `screen` は `nestedMedia`（画像・動画）。任意の `NestedVisual`（入れ子テンプレート）は `@1` では受け付けない。将来の埋め込みは新版で検討する。
- `variant` は `enum`。`transitionPolicy`・`animationPolicy` は既定（[composite-visuals/spec.md](../composite-visuals/spec.md)）を使う。
- テキスト（`name`/`handle`/`url`/`caption`）はエスケープして描画し、テキスト量の目安超過は保存を拒否せず警告として返す。

## variant 一覧（初期セット）

日本語・技術系を主とし、知名度の高いサイトを初期から含める。ガワは汎用スタイルで描く。

| variant | 対象 | ガワの主な要素 |
| --- | --- | --- |
| `x` | X（旧Twitter） | ヘッダ、ハンドル、本文、メディア枠 |
| `instagram` | Instagram | プロフィール行、正方形/縦長メディア、キャプション |
| `tiktok` | TikTok | 縦長全画面、下部のキャプション/ハンドル |
| `youtube` | YouTube | 16:9プレイヤー、タイトル行、チャンネル行 |
| `github` | GitHub | リポジトリ/Issue風ヘッダ、コード枠 |
| `qiita` | Qiita | 記事ヘッダ、本文枠、タグ行 |
| `zenn` | Zenn | 記事ヘッダ、本文枠 |
| `note` | note | 記事ヘッダ、本文枠、著者行 |
| `stackoverflow` | Stack Overflow | 質問ヘッダ、回答枠 |
| `hackernews` | Hacker News | 一覧行風ヘッダ、本文枠 |
| `reddit` | Reddit | 投稿ヘッダ、投票/コメント行 |
| `pixiv` | pixiv | 作品ヘッダ、イラスト枠 |
| `niconico` | ニコニコ動画 | プレイヤー枠、コメント風行 |
| `browser` | 汎用ブラウザ | アドレスバー、タブ風ヘッダ |

### variant 追加の版管理

- `variant` への**値の追加は `@1` 内で許容する**（加算的enum）。既存 variant の描画・レイアウト規約を変えない限り、新版を切らない。
- 既存 variant のガワ構成やレイアウト規約を変更する場合は、[ADR-0009](../adr/0009-template-version-immutability.md) に従い新しい版（`@2`）を追加し、`@1` は変えない。
- この例外は [ADR 0033](../adr/0033-site-mockup-frame-variants.md) に記録する。

## 汎用スタイルと利用者ロゴ

- 各 variant は、配色・余白・ヘッダ構成などで「そのサイトらしさ」を表現するが、**同梱のロゴ・ワードマークは使わない**。
- `theme` は `light`/`dark` の2値。既定は `light`。
- `logo` が指定された場合だけ、利用者素材をヘッダ等の所定位置に `contain` で重ねる。未指定なら汎用のプレースホルダ（サイト名のテキスト）を出す。
- ブランドの利用条件は利用者が確認する。UIとユーザーガイドで案内する。

## レンダリングと分離

- [composite-visuals/spec.md](../composite-visuals/spec.md) の分離規約に従う。Cue IDを符号化したscope配下に、ガワの各要素（ヘッダ、ハンドル、メディア枠など）のDOM IDを割り当て、複数配置・入れ子でも衝突しない。
- rendererはHTML断片・素材参照・`AnimationPlan`（`screen` への登場アニメーション）だけを返し、GSAPタイムラインとComposition HTMLはトップレベルコンパイラだけが生成する。
- `collectAssetRefs` は `screen` と `logo` の素材参照を返す。
- 画面の描画は共通の `NestedVisual` レンダラ（`renderNested`）を再利用する。

## 編集UI

- テンプレートの `inputFields` により、エディタは次を生成する: `variant`（select）、`screen`（nestedMedia＋fit）、`theme`（select）、`name`/`handle`/`url`/`caption`（text/optionalText）、`logo`（nestedMedia＋fit）、`animation`（animation）。
- 「Cueを追加」に `scene.site-mockup` を追加する。背景・カードと同じCue一覧の流儀で、レイヤー・順序・表示区間・入退場を編集する。

## 受け入れ条件

- `scene.site-mockup@1` の画像と動画を、`card`・`overlay` の両レイヤーで保存し、プレビューでシークし、MP4をレンダーできる。
- 2つ以上のモックアップを同一Sceneに置いてもDOM ID・CSS・AnimationPlanが衝突しない。
- 未対応の `variant` 値、`screen` 欠落、`screen` が任意 `NestedVisual` の場合は拒否する。
- `variant` を追加しても既存 variant の描画が変わらない。

## 非ゴール

- 投稿本文やメタ情報を構造化データから組み立てる「フェイク投稿型」。
- 実サイトからの取得、埋め込み、スクレイピング。
- 同梱ロゴ・ワードマークの提供。
- `screen` への任意 `NestedVisual`（入れ子テンプレート）埋め込み。
