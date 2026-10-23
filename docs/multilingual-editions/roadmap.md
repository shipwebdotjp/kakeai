# 多言語Edition のロードマップ

完成条件は [spec.md](./spec.md) の完了条件とする。順序は既存 ja 作品を壊さない最小の通し経路を先に作り、次にエージェント経路を正規化する。

## R1: 言語版の作成と切替

- contracts: Edition 作成リクエストスキーマ（`locale`・`sourceEditionId`）
- api: `POST /works/:workId/language-editions`。Transactionで Edition + 初期版（シードコピーの置き換え規則を [spec.md](./spec.md) どおり適用）
- web: 編集画面の言語版切替（`languageEditions[0]` 固定の解消）、Edition 追加の UI
- video: コンパイラの数値・通貨フォーマットを document locale に従わせる

完了条件: 既存 ja 作品の動作不変を保ち、手動編集だけで en-US 版を編集・プレビュー・レンダーできる。

## R2: 翻訳のエージェント接続

- agent-access: `edition.create` 操作の追加、`script.save` に Edition locale と `ContentDocument.locale` の一致検証（`EDITION_LOCALE_MISMATCH`）
- skills: `skills/kakeai-production/` に翻訳版制作の手順を追加
- MCP/CLI から `edition.create` / `script.save` が通ることの確認（両者は `@kakeai/agent-client` の薄い束縛で、操作追加が反映され流れる）

完了条件: 外部エージェントが ja 版を読み、en-US Edition を作り、翻訳 contentJson を候補保存し、人が承認してレンダーできる。

## R3（将来候補）

- 翻訳版のTTS実運用の観点整理（voiceProfileId の選び直し UX、`voices` 対応表からの自動選択）
- locale 別テキスト上限・読速チェック（TODO E として [../multilingual-voice/todo.md](../multilingual-voice/todo.md) に残る）
- 素材の言語タグの実用運用（`Asset.language` の検討は spec どおり留着）

R3 は R1/R2 を使い始めて課題がわかってから具体化する。
