# プレビュー操作とドラフト・プレビュー 実装TODO

仕様は [spec.md](./spec.md) を正とする。上から順に進め、各フェーズで `npm run typecheck`・`npm test`・OCRレビューを実行し、妥当な指摘を修正してコミットする。保存は引き続き明示操作のみ。

## P1 プレビュー操作の信頼性とキーボード操作

- [x] 移動を純関数へ集約する（`apps/web/src/lib/player.ts` の再開セマンティクス、意味的ジャンプの1フレーム補正＋総尺丸め、相対移動の無補正）
- [x] ナビゲーション・キー操作の純関数を新設する（`apps/web/src/lib/previewNavigation.ts`。前後セリフ／Scene、キー→操作、入力要素の除外）
- [x] `PreviewController` を新設し `WorkEditPage` で提供する（playerRef・表示中timeline・再生状態・全移動メソッドの共有）
- [x] `PreviewSection` をcontroller化する（意味的ジャンプ補正、フォーカス可能領域のキーハンドラ、ショートカット案内、既存ボタン維持）
- [x] 左ペインのジャンプをcontroller経由にし、`onJumpToLine` を `SceneEditor` へ伝播する
- [x] セリフカード見出しにプレビュー専用のジャンプ操作を追加する（`LinesEditor`）
- [x] 契約へCue開始時刻を追加する（`packages/contracts` の `previewSceneTimingSchema`、`apps/api` の `buildPreviewTimeline`。[../mvp/api-contract.md](../mvp/api-contract.md) と同期）
- [x] テスト: 意味的ジャンプの1フレーム補正・総尺丸め・相対移動無補正、停止維持／再生再開、前後セリフの境界、キー操作の領域限定と入力除外
- [x] ドキュメント同期: [./spec.md](./spec.md)、[../editor/spec.md](../editor/spec.md)、[../mvp/api-contract.md](../mvp/api-contract.md)、ユーザーガイド
- 完了条件: 共有移動関数で全ジャンプが動き、停止中は停止を維持し、再生中は再開する。キーボードはプレビュー領域でのみ反応し、入力編集を妨げない。

## P2 未保存内容のドラフト・プレビュー

- [x] `packages/contracts` に `DraftPreviewRequest` と `DraftPreview` を追加する（`source: { kind: "draft" }`＋保存済みと同形のcomposition/assets/renderer/timeline）
- [x] APIにドラフト合成を追加する（`compilePreview` の共用、`POST /language-editions/:editionId/draft-preview`、書込みゼロ、同じエラー契約）
- [x] Webにドラフト送信を追加する（`SceneEditor` の500msデバウンス検証送信、AbortController＋連番で最新応答のみ採用、不正時は直前の有効プレビュー維持）
- [x] `PreviewSection` を更新する（時刻の維持・尺短縮時の末尾丸め・再生中のみ再開、通常の「更新」廃止・失敗時のみ再試行、未反映状態の表示）
- [x] 保存成功で保存済み版プレビューへ戻し、レンダーとTTSに保存済み版IDだけを渡す
- [x] テスト: ドラフトAPIの版・Job・永続ファイル非増加と保存済みpreviewとの同等解決、エラー契約、最新有効応答の選択、時刻維持と丸め、背景Cueの未保存確認フロー
- [x] ドキュメント同期: [./spec.md](./spec.md)、[../mvp/api-contract.md](../mvp/api-contract.md)、保存対象とプレビュー対象の区別をユーザーガイドに明記
- 完了条件: 有効な未保存編集がデバウンス後にプレビューへ反映され、保存・レンダーは常に保存済み版だけを対象にする。
