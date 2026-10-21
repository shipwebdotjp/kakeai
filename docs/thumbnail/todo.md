# サムネイル実装TODO

[サムネイル仕様](./spec.md) を正とする。上から順に進める。

## フェーズ

### [x] T1 契約と文書

- [x] `packages/contracts` にサムネイル文書スキーマ（`schemaVersion: 1`、テンプレート参照＋入力）を追加する
- [x] `ThumbnailTemplateDefinition` と同梱テンプレート・レジストリ（`id@version`、`inputFields` は `TemplateFieldSpec`）を追加する
- [x] ADR 0058/0059/0060 を作成し、`CONTEXT.md` の用語と [../mvp/roadmap.md](../mvp/roadmap.md) を更新する
- 完了条件: 契約テストでサムネイル文書の検証と未知テンプレート拒否が通り、`npm run typecheck` が通る。

### [x] T2 描画

- [x] `packages/video` にサムネイル用コンパイラ（1280x720 の静止 HTML）を追加し、Theme トークンを適用する
- [x] 同梱テンプレートを複数（アーキタイプ違い＋配置バリアント）実装し、`mediaCrop` と文字調整に対応する
- [x] コンパイラテスト（Theme適用・バリアント・クロップ・確定性）を追加する
- 完了条件: 保存済み候補の入力から決定的に HTML を生成でき、テンプレートと Theme のテストが通る。

### [x] T3 永続化とAPI

- [x] Prisma に `Thumbnail` と `LanguageEdition.primaryThumbnailId` を追加し、マイグレーションを書く
- [x] 候補の CRUD、選択ポインタ更新、`thumbnail-preview`（未保存の HTML）、`image`（オンデマンドPNG）エンドポイントを追加する
- [x] 保存時の素材検証、選択中削除の付け替え、Work削除の連鎖削除を実装する
- [x] PNG のラスタライズ（`@hyperframes/engine` の管理下 Chrome）を実装し、テストでは fake ラスタライザを注入する
- 完了条件: 候補の作成・保存・選択・削除・PNGダウンロードができ、API/統合テストが通る。

### [x] T4 UI

- [x] サムネイル編集画面を追加する（テンプレ選択、素材ピッカー、文字入力、デバウンスプレビュー、明示保存）
- [x] 候補一覧・選択・削除・PNGダウンロードを追加する
- [x] `TemplateFieldSpec` に従う専用フォームレンダラを追加し、素材ピッカー（`MediaPicker`）を動画編集画面と共有する
- 補足: `CueField` の共通化（動画編集画面からの抽出）は回帰リスクを避けて今回は行わず、テンプレート入力用の専用レンダラを持つ。
- 完了条件: 言語エディションごとに複数候補を作成・選択・削除し、選んだ1枚を PNG でダウンロードできる。

### [x] T5 契約・ガイド文書

- [x] [../mvp/api-contract.md](../mvp/api-contract.md) にエンドポイントとDTO（Thumbnail）を追記する
- [x] ユーザーガイドにサムネイル作成・候補管理・ダウンロードを追記する
- 完了条件: 文書と実装が一致し、`npm run typecheck` と `npm test` が通る。

### [x] T6 文字の部分装飾

- [x] `packages/contracts` に限定記法のパーサと `richText` フィールド種別を追加し、同梱テンプレートの文字入力を `@1` のまま拡張する（[ADR 0080](../adr/0080-thumbnail-inline-text-marks.md)）
- [x] `packages/video` で装飾区間を `<span>` に描画し、アクセント色と縁取り色を Theme から解決する
- [x] 保存時検証とプレビューで不正な記法を `VALIDATION_ERROR` として返す
- [x] Web UI に textarea とツールバー（選択範囲の装飾）を追加する
- [x] [spec.md](./spec.md) とユーザーガイドに記法・制約を追記する
- 完了条件: 単語単位の太字・斜体・アクセント・縁取りがプレビューと PNG に反映され、許可されない記法が保存時に拒否される。
