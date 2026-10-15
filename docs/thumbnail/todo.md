# サムネイル実装TODO

[サムネイル仕様](./spec.md) を正とする。上から順に進める。

## フェーズ

### [ ] T1 契約と文書

- [ ] `packages/contracts` にサムネイル文書スキーマ（`schemaVersion: 1`、テンプレート参照＋入力）を追加する
- [ ] `ThumbnailTemplateDefinition` と同梱テンプレート・レジストリ（`id@version`、`inputFields` は `TemplateFieldSpec`）を追加する
- [ ] ADR 0058/0059/0060 を作成し、`CONTEXT.md` の用語と [../mvp/roadmap.md](../mvp/roadmap.md) を更新する
- 完了条件: 契約テストでサムネイル文書の検証と未知テンプレート拒否が通り、`npm run typecheck` が通る。

### [ ] T2 描画

- [ ] `packages/video` にサムネイル用コンパイラ（1280x720 の静止 HTML）を追加し、Theme トークンを適用する
- [ ] 同梱テンプレートを複数（アーキタイプ違い＋配置バリアント）実装し、`mediaCrop` と文字調整に対応する
- [ ] コンパイラテスト（Theme適用・バリアント・クロップ・確定性）を追加する
- 完了条件: 保存済み候補の入力から決定的に HTML を生成でき、テンプレートと Theme のテストが通る。

### [ ] T3 永続化とAPI

- [ ] Prisma に `Thumbnail` と `LanguageEdition.primaryThumbnailId` を追加し、マイグレーションを書く
- [ ] 候補の CRUD、選択ポインタ更新、`thumbnail-preview`（未保存の HTML）、`image`（オンデマンドPNG）エンドポイントを追加する
- [ ] 保存時の素材検証、選択中削除の付け替え、Work削除の連鎖削除、テンプレート版のGC条件を実装する
- [ ] PNG のラスタライズ方式（管理下 Chrome とフォント）を実装・検証する
- 完了条件: 候補の作成・保存・選択・削除・PNGダウンロードができ、API/統合テストが通る。

### [ ] T4 UI

- [ ] サムネイル編集画面を追加する（テンプレ選択、素材ピッカー、文字入力、デバウンスプレビュー、明示保存）
- [ ] 候補一覧・選択・削除・PNGダウンロードを追加する
- [ ] 汎用フォームエンジン（`TemplateFieldSpec`）と素材ピッカーを、動画編集画面と共有できるよう共通化する
- 完了条件: 言語エディションごとに複数候補を作成・選択・削除し、選んだ1枚を PNG でダウンロードできる。

### [ ] T5 契約・ガイド文書

- [ ] [../mvp/api-contract.md](../mvp/api-contract.md) にエンドポイントとDTO（Thumbnail）を追記する
- [ ] ユーザーガイドにサムネイル作成・候補管理・ダウンロードを追記する
- 完了条件: 文書と実装が一致し、`npm run typecheck` と `npm test` が通る。
