# 縦型ショート出力 TODO

[spec.md](./spec.md) の実装フェーズ。上から順に進める。

## P1. 契約とキャンバスの基盤

- [x] `packages/video/src/meta.ts` の `OUTPUT_WIDTH` / `OUTPUT_HEIGHT` を横型の既定値に格下げし、描画コードから直接参照を外す（`packages/video/src/canvas.ts`）
- [x] `CanvasMetrics`（幅・高さ・コンテンツ幅・余白・セーフエリア・タイプスケール・字幕位置）を定義し、`workOutputProfileSchema` から導出する
- [x] `compileDocument` が `outputProfile` を受け取るように変更する（省略時は `landscape`）
- [x] `captionLayoutStyle` / `captionSafeAreaPx` をキャンバス引数対応にし、横型の戻り値が現行と一致することをテストで固定する
- [x] `outputSettingsSchema`（`packages/contracts/src/job.ts`）の `z.literal(1920)` / `z.literal(1080)` を外し、2つの出力形式だけを受け付ける
- [x] 既存スナップショット（1920×1080）がそのまま parse できることをテストする
- [x] 契約テスト: `portrait` のキャンバスメトリクスと、不正な寸法の拒否

## P2. レンダー経路

- [x] `createRenderJob` で Work の `outputProfile` を取得し、`snapshot.output` に 1080×1920 を記録する
- [x] worker の `executeRenderJob` まで寸法が伝わることを確認する（producer は root の `data-width` / `data-height` を使う。worker 側の追加指定は不要）
- [ ] レンダー開始時の不整合検出（Work の出力形式とコンパイル結果の寸法が違う場合は `RENDER_INPUT_INVALID`）
- [x] 横型レンダーのスナップショットが現行と同一であることをテストで固定する
- [x] 縦型レンダーの結合テスト（固定コンテンツで mp4 の寸法を ffprobe で確認）

## P3. 縦型レイアウトのコア

- [x] タイプスケール（テーマ `fontSize` × 0.75、字幕は 1.0）の適用を文字ロール単位で行う
- [x] コンテンツ幅・左右余白・セーフエリアを CSS 変数と `RenderContext.canvas` でテンプレートへ渡す
- [x] 字幕レイヤーを縦型の下端 340px・最大 3 行に調整する
- [x] シーン共通のルートスタイル（背景・セーフエリア・字幕）をキャンバス対応にする
- [ ] はみ出し検出のテストヘルパー（要素の bbox がキャンバスを超えたら失敗）を追加する

## P4. テンプレートの縦型対応

各テンプレートで、固定 px をキャンバスメトリクスへ置き換え、縦型の組み方を定義する。

- [x] `text-block`
- [x] `list-callout`
- [x] `media-card` / `media-full-bleed`（cover・contain の方針を spec 第3節どおりに）
- [x] `chart-bar`（プロット幅をコンテンツ幅へ）
- [x] `flow-diagram`（プロット寸法をキャンバスへ、縦型は top-to-bottom 既定）
- [x] `table-simple` / `table-format`（幅をコンテンツ幅へ。列数の警告は P6）
- [x] `quote` / `stat`
- [ ] `chat-thread` / `site-mockup`（幅・高さはコンテナ相対のため現状のまま。縦型での見え方を確認する）
- [x] `device-frame` / `device-chrome`（現行の 9:16 画面を維持）
- [x] `composition-full-bleed` の判定を「常に landscape」から「Work の Output Profile と一致」に変更
- [x] `scene.card` / シーン全体の余白・配置の縦型調整
- [ ] 縦型での見え方をテンプレートごとに目視確認し、初期値を調整する

## P5. プレビュー UI と API

- [x] 保存済みプレビュー・ドラフトプレビューで同じキャンバスを使う
- [x] `preview-frame-raster.ts` をコンパイル結果の `data-width` / `data-height` でラスタライズする
- [x] `apps/web/src/components/PreviewSection.tsx` の `aspect-video` 固定を、作品の出力形式に追従させる
- [ ] 縦型作品のプレビュー枠（`aspect-[9/16]`）のレイアウト確認と、モバイル幅での表示確認
- [x] テーマ編集プレビューは横型のままであることを明記（変更しない）

## P6. 検証と品質

- [ ] 横型・縦型それぞれのゴールデンフレーム比較（テーマ代表シーンと代表テンプレート）
- [x] 字幕セーフエリア・タイプスケールの数値テスト
- [x] 縦型のチャート・フローダイアグラムのレイアウト単体テスト
- [ ] 字幕の行数警告が出力形式で切り替わることのテスト（横型2行・縦型3行）
- [ ] 縦型での検証警告（チャート項目数・表の列数）を追加する
- [x] 既存の横型スナップショットが変わらないことの回帰確認
- [ ] 実機での可読性確認（スマートフォン幅でのプレビュー）

## P7. 文書とユーザーガイド

- [x] `docs/mvp/api-contract.md` の複製の `outputProfile` と WorkSummary の記述を更新
- [x] `docs/mvp/spec.md` の映像・出力寸法の記述を更新
- [ ] `docs/mvp/content-schema.md` の字幕の制約（1行の目安・警告行数）を出力形式別に更新
- [x] `docs/composition-library/spec.md` の全画面利用の条件（Output Profile と一致）を更新
- [x] `user-guide/docs/works/works.md` の縦型記述を、縦型レンダー・プレビューが可能になった内容へ更新
- [x] `CONTEXT.md` の用語（Output Profile / Canvas Profile）を確定
