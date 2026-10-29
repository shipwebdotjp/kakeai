# 縦型ショート出力 TODO

[spec.md](./spec.md) の実装フェーズ。上から順に進める。

## P1. 契約とキャンバスの基盤

- [ ] `packages/video/src/meta.ts` の `OUTPUT_WIDTH` / `OUTPUT_HEIGHT` を横型の既定値に格下げし、描画コードから直接参照を外す
- [ ] `CanvasMetrics`（幅・高さ・コンテンツ幅・余白・セーフエリア・タイプスケール・字幕位置）を定義し、`workOutputProfileSchema` から導出する関数を追加する
- [ ] `compileDocument` がキャンバス（または Output Profile）を受け取るように変更する（省略時は `landscape`）
- [ ] `captionLayoutStyle` / `captionSafeAreaPx` をキャンバス引数対応にし、横型の戻り値が現行と一致することをテストで固定する
- [ ] `outputSettingsSchema`（`packages/contracts/src/job.ts`）の `z.literal(1920)` / `z.literal(1080)` を外し、Output Profile と整合する値域にする
- [ ] 既存スナップショット（1920×1080）がそのまま parse できることをテストする
- [ ] 契約テスト: `portrait` のキャンバスメトリクスと、不正な寸法の拒否

## P2. レンダー経路

- [ ] `createRenderJob` で Work の `outputProfile` を取得し、`snapshot.output` に 1080×1920 を記録する
- [ ] worker の `executeRenderJob` まで寸法が伝わることを確認する（producer は root の `data-width` / `data-height` を使う。worker 側の追加指定は不要）
- [ ] レンダー開始時の不整合検出（Work の出力形式とコンパイル結果の寸法が違う場合は `RENDER_INPUT_INVALID`）
- [ ] 横型レンダーのスナップショットが現行と同一であることをテストで固定する
- [ ] 縦型レンダーの結合テスト（小さい尺の固定コンテンツで mp4 の寸法を ffprobe で確認）

## P3. 縦型レイアウトのコア

- [ ] タイプスケール（テーマ `fontSize` × 0.75）の適用を文字ロール単位で行う
- [ ] コンテンツ幅・左右余白・上下セーフエリアをテンプレートへ渡す
- [ ] 字幕レイヤーを縦型の下端 340px・最大 3 行に調整する
- [ ] シーン共通のルートスタイル（背景・セーフエリア・字幕）をキャンバス対応にする
- [ ] はみ出し検出のテストヘルパー（要素の bbox がキャンバスを超えたら失敗）を追加する

## P4. テンプレートの縦型対応

各テンプレートで、固定 px をキャンバスメトリクスへ置き換え、縦型の組み方を定義する。

- [ ] `text-block`
- [ ] `list-callout`
- [ ] `media-card` / `media-full-bleed`（cover・contain の方針を spec 第3節どおりに）
- [ ] `chart-bar`（プロット幅の再計算と収まらない場合の警告）
- [ ] `flow-diagram`（縦型は top-to-bottom 既定）
- [ ] `table-simple` / `table-format`（列幅の再配分と列数警告）
- [ ] `quote` / `stat`
- [ ] `chat-thread` / `site-mockup`
- [ ] `character-standing`（幅をコンテンツ幅基準に）
- [ ] `device-frame` / `device-chrome`（現行の 9:16 画面を維持）
- [ ] `composition-full-bleed` の判定を「常に landscape」から「Work の Output Profile と一致」に変更
- [ ] `scene.card` / シーン全体の余白・配置の縦型調整

## P5. プレビュー UI と API

- [ ] 保存済みプレビュー・ドラフトプレビュー・テーマプレビューで同じキャンバスを使う
- [ ] `preview-frame-raster.ts` をキャンバス寸法でラスタライズする
- [ ] `apps/web/src/components/PreviewSection.tsx` の `aspect-video` 固定を、プレビューの `data-width` / `data-height` 追従にする
- [ ] 縦型作品のプレビュー枠（`aspect-[9/16]`）のレイアウト確認と、モバイル幅での表示確認
- [ ] テーマ編集プレビューは横型のままであることを明記（変更しない）

## P6. 検証と品質

- [ ] 横型・縦型それぞれのゴールデンフレーム比較（テーマ代表シーンと代表テンプレート）
- [ ] 字幕セーフエリア・タイプスケールの数値テスト
- [ ] 字幕の行数警告が出力形式で切り替わることのテスト（横型2行・縦型3行）
- [ ] 縦型での検証警告（字幕行数・チャート項目数・表の列数）のテスト
- [ ] 既存の横型スナップショットが変わらないことの回帰確認
- [ ] 実機での可読性確認（スマートフォン幅でのプレビュー）

## P7. 文書とユーザーガイド

- [ ] `docs/mvp/api-contract.md` の `outputSettings` とプレビュー寸法の記述を更新
- [ ] `docs/mvp/spec.md` の Job・レンダー記述を更新
- [ ] `docs/mvp/content-schema.md` の字幕の制約（1行の目安・警告行数）を出力形式別に更新
- [ ] `docs/composition-library/spec.md` の全画面利用の条件（Output Profile と一致）を更新
- [ ] `user-guide/docs/works/works.md` の「縦型の実際のレンダーは Composition に従う」という暫定記述を、縦型レンダー・プレビューが可能になった記述へ更新
- [x] `CONTEXT.md` の用語（Output Profile / Canvas Profile）を確定
