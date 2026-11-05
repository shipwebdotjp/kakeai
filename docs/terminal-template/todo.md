# ターミナルテンプレート 実装TODO

仕様は [spec.md](./spec.md) を正とする。

## Phase 1: v1（入力・出力・セリフ同期・ウインドウ）

- [x] `packages/contracts` に `terminal.session@1` の入力スキーマ、`turns` / `reveal` 効果、`inputFields`、`exampleInput`、`collectLineRefs` を追加
- [x] `packages/contracts` に `terminal_overflow` 警告と行数目安を追加
- [x] `packages/contracts` の Agent 向けテンプレートフィールドに `turns` と `terminal` バリアントを追加
- [x] `packages/video` に `renderTerminalSession` を追加（固定速度のタイピング、行末での残り一括表示、出力の即時表示、カーソル、ウインドウ枠）
- [x] neutral スキンへレンダラーを登録
- [x] `packages/video` にレンダラーの単体テストを追加
- [x] `apps/web` に `turns` フィールドと端末用 effects バリアントを追加
- [x] 新しいターンへの未使用セリフ自動割り当てと、削除時の効果ターゲット詰めを追加
- [x] フォームの読み書き・ラウンドトリップのテストを追加
- [x] `CONTEXT.md`、`docs/mvp/content-schema.md`、ユーザーガイドを更新

## Phase 2: 演出の拡張（未着手）

- [ ] ターン単位の `emphasize`（出力行の強調、エラー行の色分け）
- [ ] 出力行のトーン（成功・警告・エラー）
- [ ] 入力速度のターン単位上書き
- [ ] ウインドウ枠のバリエーション（最大化、枠なし、タイトルバーの省略）
- [ ] セリフ同期なしの自動再生（固定ペースで順番にタイプするモード）
- [ ] アニメ付きスクロール（折返し行数を確定できる方式に限る）
- [ ] `reveal` を共有 Cue Effect へ昇格するかの再検討

## 完了条件

- ターミナルの Cue を追加し、ターンを編集し、セリフ同期の効果を設定できる。
- タイピングが固定速度で進み、セリフ尺からはみ出した残りが行末で一括表示される。
- 出力が入力完了後にまとめて表示される。
- effect のないターンは最初から表示される。
- 行数目安を超えると `terminal_overflow` 警告が出る。
- 横型・縦型の両方でプレビューとMP4が同じ表示になる。
