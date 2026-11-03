# 縦型ショート出力仕様

## 目的

作品ごとに出力形式（横型 16:9 / 縦型 9:16）を持ち、縦型作品では**プレビューとレンダーの両方**を 1080×1920 で生成する。縦型は 16:9 の縮小やクロップではなく、縦型キャンバス用にレイアウトを再構成して作る。

決定の背景は [ADR 0113](../adr/0113-work-scoped-immutable-output-profile.md)（出力形式は Work が唯一の正・不変）と [ADR 0114](../adr/0114-portrait-output-by-relayout.md)（縦型は再レイアウト）を正とする。

## 用語

- **Output Profile（出力形式）**: Work が持つ出力キャンバスの種類。`landscape`（1920×1080）または `portrait`（1080×1920）。`Work.outputProfile` に保存し、作成後は変更しない。
- **Canvas Profile（キャンバスプロファイル）**: Composition Version が持つ内部キャンバス。Output Profile とは独立で、Composition はシーン内の挿入要素として使う。
- **キャンバスメトリクス**: 出力形式から導出するレイアウト値（コンテンツ幅、余白、タイプスケール、セーフエリア、字幕位置）。コンパイラが計算し、テンプレートへ渡す。

## 1. 出力形式

| Output Profile | 幅 | 高さ | fps | 既定 |
| --- | --- | --- | --- | --- |
| `landscape` | 1920 | 1080 | 30 | 既存 Work・新規 Work |
| `portrait` | 1080 | 1920 | 30 | ショート版として複製した Work |

- `Work.outputProfile` が唯一の正。全 Language Edition・全 Script Version・全レンダー・全プレビューが同じ値を使う。
- 作成後は変更できない。変更は `POST /works/:workId/clone` の `outputProfile` を指定した複製で行う。省略時は複製元 Work の出力形式を継承する（既存の横型 Work からの複製は従来どおり `landscape`）。
- DB は `Work.outputProfile TEXT NOT NULL DEFAULT 'landscape'`。既存 Work は移行で `landscape` になる。
- `LanguageEdition`・`ScriptVersion` は出力形式を保持しない。レンダー開始時に Work から導出した寸法を `RenderJobSnapshot.output` に記録する（スナップショットは実行時の不変記録であり、`portrait` / `landscape` の区別ではなく寸法を持つ）。

## 2. キャンバスメトリクス

コンパイラは `compileDocument({ canvas })` のようにキャンバスを受け取り、次の値を導出する。`packages/video/src/meta.ts` の `OUTPUT_WIDTH` / `OUTPUT_HEIGHT` は横型の既定値として残し、描画コードは定数を直接参照しない。

| メトリクス | landscape | portrait | 根拠 |
| --- | --- | --- | --- |
| コンテンツ幅 | 1600px | 936px | 横型は現行値を維持。縦型は左右余白 72px |
| 左右余白 | 160px | 72px | 縦型は画面幅が狭いため比率を小さくする |
| 上セーフエリア | 0px | 120px | Shorts の上部 UI を避ける |
| 下セーフエリア | 字幕セーフ（テーマ由来） | 320px | Shorts の下部 UI（説明・音源・CTA）を避ける |
| 右セーフエリア | 0px | 120px | 縦型のアクションボタン列を避ける |
| タイプスケール | 1.0 | 0.75（字幕のみ 1.0） | テーマの `fontSize` に掛ける。字幕は可読性を優先して縮小しない |
| 字幕の下端オフセット | 72px | 340px | 下セーフエリア（320px）より外側に置く |
| 字幕の最大行数 | 2行（`band` は3行） | 3行 | 画面幅が狭く1行あたりの文字数が減るため、行数の上限を増やす |
| サイトモックアップの画面高 | 600px | 440px | 16:9 でも 782px 幅に収まり、クロップされない |

- タイプスケールはテーマの文字ロール（`title` / `heading` / `body` / `caption` など）の `fontSize` にのみ適用する。色・フォント・行間はテーマの値をそのまま使う。ロールごとに係数を持て、既定は第2節の表のとおり（字幕だけ縮小しない）。
- 上記は初期値とし、ゴールデンフレームでの確認後に調整してよい。数値を変えるときは本表を更新する。
- 横型の数値は現行出力を変えないことを優先し、既存値を動かさない。

## 3. 縦型レイアウトの規則

テンプレートは同じ入力から、キャンバスに応じて組み方を変える。

- **カード／全画面背景**: 背景は cover（`focalPoint` を中心）。カードは「媒体 → テキスト」の縦積みにし、テキストはコンテンツ幅で折り返す。
- **テキストブロック**: コンテンツ幅いっぱい。`align` は維持し、`max-width` をコンテンツ幅にする。
- **リスト／コールアウト**: 縦積み。項目間の余白は縦型で詰める。
- **チャート**: プロット幅をコンテンツ幅に合わせて再計算する。収まらない項目数・ラベル長は検証警告にする。
- **フローダイアグラム**: 縦型では top-to-bottom を既定にする。
- **表**: 列幅をコンテンツ幅で再配分する。列数が多く収まらない場合は検証警告にする。
- **引用・統計**: タイプスケールを適用し、余白を縦型用にする。
- **立ち絵**: 幅をコンテンツ幅基準にし、下端基準で配置する。
- **デバイスフレーム**: 既存の 9:16 画面をそのまま使える。縦型 Work でも挿入要素として使う。
- **チャット／サイトモックアップ**: フレームはコンテナ相対（`cqw` / `cqh`）なので、そのまま縦型に収まる。サイトモックアップの画面は高さ駆動なので、縦型では画面高を 440px（横型 600px）にして 16:9・1:1・9:16 のいずれも切り取られないようにする。
- **Composition 全画面（`composition.full-bleed@1`）**: Work の出力形式と Composition の `canvasProfile` が一致するときだけ使える。不一致は既存どおり `invalid_composition_profile`。縦型 Work で縦型 Composition を全画面に置けるよう、判定を「常に landscape」から「Work の Output Profile と一致」に変更する。
- **挿入素材（16:9 の画像・動画）**: 全画面背景は cover、カード内は contain。プレビューで確認できることを前提にし、既定の変換を勝手に切り替えない。

## 4. レンダー経路

- `RenderJobSnapshot.output` は `{ width, height, fps, format }` を保持し、レンダー開始時に Work の出力形式から導出した値を書き込む。`packages/contracts/src/job.ts` の `z.literal(1920)` / `z.literal(1080)` を外し、`workOutputProfileSchema` と同じ値域に接続する。
- HyperFrames producer は root の `data-width` / `data-height` からビューポートを決めるため、コンパイラが正しい寸法を出力すれば縦型でレンダーできる。worker 側の寸法指定は追加しない。
- `Artifact` の `widthPx` / `heightPx` は既存どおり ffprobe 結果を使う。DTO の変更は不要。
- スナップショットのスキーマバージョンは据え置く（[ADR 0112](../adr/0112-pre-1.0-in-place-v1-api-updates.md)）。変更は許容値の拡張であり、既存の queued スナップショット（1920×1080）はそのまま読める。

## 5. プレビュー経路

- `compileDocument` に渡すキャンバスは Work の出力形式から決める。保存済みプレビューとドラフトプレビューで同じ値を使う。
- プレビュー静止画のラスタライズ（`preview-frame-raster.ts`）は、キャンバス寸法で行う。レスポンスの `width` / `height` は PNG から読んだ実寸を返す（現行どおり）。
- Web のプレビュー枠は `aspect-video` 固定をやめ、プレビュー HTML の `data-width` / `data-height`（または Work の出力形式）からアスペクトを決める。
- テーマ編集画面のプレビューは横型のままとする。テーマはキャンバス非依存で、縦型の見え方は作品のプレビューで確認する。縦型対応は [roadmap.md](./roadmap.md) に置く。

## 6. 検証とエラー

- レンダー開始時、Work の出力形式とコンパイル結果の `data-width` / `data-height` が一致しなければ `RENDER_INPUT_INVALID` とする（実装上の不整合検出）。
- 縦型で内容が収まらない場合の警告を、既存の検証警告と同じ形（`issues`）で返す。対象は少なくとも、字幕行数、チャートの項目数、表の列数。
- 字幕の行数警告は出力形式に依存させる。横型は従来どおり 2 行まで警告なし、縦型は 3 行まで警告なしとする（`docs/mvp/content-schema.md`）。
- テキスト・チャート・表の目安も出力形式ごとに持つ。しきい値は `packages/contracts/src/output-profile.ts` の `OUTPUT_PROFILE_LAYOUT` を唯一の正とし、コンパイラのキャンバスメトリクスと同じ値を使う。縦型では横型より早く警告する（テキストは約78%の行長、チャートは4カテゴリ、表は3列・8行・セル11文字）。
- 保存・編集・復元の警告は Work の出力形式を使う。Agent の `script.validate` で台本本体だけを送る呼び出しは Work を特定できないため、横型の基準で警告する。
- 出力形式は Work の作成後に変更できないため、「出力形式を変更する」操作は提供しない。UI は複製（ショート版を作成）へ誘導する。

## 7. 既存機能との関係

- **作品一覧**: 出力形式のバッジと親作品の表示は実装済み。縦型 Work は「縦型 1080×1920」と表示する。
- **サムネイル**: 1280×720 の現行仕様を維持する。縦型サムネイルは扱わない（[roadmap.md](./roadmap.md)）。
- **YouTube 投稿設定**: 出力形式による項目の出し分けはしない。Shorts 固有の長さ制限・`#Shorts`・公開仕様は扱わない（[roadmap.md](./roadmap.md)）。
- **Agent**: `work.clone` は `outputProfile` を受け付ける（実装済み）。レンダー・プレビュー系の操作は Work の出力形式に従うため、操作の追加は不要。`work.get` / `work.list` の `outputProfile` も実装済み。
- **Composition Library**: 縦型 Composition はこれまでどおり挿入要素として使う。縦型 Work での全画面利用を許可する（第3節）。

## 8. 非ゴール

- 既存の横型 Work をその場で縦型へ変換する機能
- 9:16 以外の出力形式（1:1、4:5 など）
- AI による自動リフレーム・自動再構成
- 縦型専用のビジュアルテーマ
- 縦型サムネイル、Shorts 固有の投稿メタデータ
- 同じ Work から横型と縦型を同時にレンダーする機能

## 関連文書

- [todo.md](./todo.md): 実装フェーズ
- [roadmap.md](./roadmap.md): 今回のスコープ外と拡張候補
- [../work-history/spec.md](../work-history/spec.md): 複製の規則
- [../mvp/api-contract.md](../mvp/api-contract.md): 現行 API 契約（実装時に更新する）
- [../../CONTEXT.md](../../CONTEXT.md): 用語
