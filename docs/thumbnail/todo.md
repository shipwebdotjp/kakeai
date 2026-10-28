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

### [x] T7 Thumbnail Appearance と前景切り抜きテンプレート

- [x] `packages/contracts` に `ThumbnailAppearance`（疎な上書き）、解決・マージ・正規化、文書v2、`thumbnail.cutout-hero@1` を追加する
- [x] 旧4テンプレートの定義・描画・入力型を削除し、カタログを `cutout-hero` のみにする
- [x] `packages/video` に背景全面・前景切り抜き・下部見出しの描画、左右・反転・倍率、自動文字サイズ、Appearance の縁取り色・太さを実装する
- [x] Prisma に `LanguageEdition.thumbnailAppearanceJson` を追加し、共通Appearanceの取得・保存APIを実装する
- [x] 候補CRUD・プレビュー・PNG生成へ `appearanceOverride` と未保存の共通Appearanceを配線する
- [x] Web に共通Appearance編集、候補上書き、Font Catalog連携、未保存Appearanceのプレビューを追加する
- [x] [spec.md](./spec.md)、API契約、ユーザーガイド、CONTEXT、ADR-0084、ADR-0059/0080のamendedを更新する
- 完了条件: 共通→候補のプロパティ単位継承、未保存Appearanceのプレビュー、背景・前景両AssetのPNG出力、v1文書の読み取りがテストで確認でき、`npm run typecheck` と `npx vitest run --testTimeout=20000` が通る。

### [x] T8 外観プリセット

- [x] `ThumbnailAppearancePreset` をPrismaに追加し、アプリ全体の名前付き外観プリセットを保存できるようにする
- [x] プリセットの一覧・取得・作成・上書き・削除APIを追加する
- [x] 空の外観パッチを拒否し、保存時に正規化する
- [x] プリセットは疎なパッチとして保存し、適用先テーマの未指定項目を継承する
- [x] プリセットの適用は言語版共通Appearanceの下書きへのスナップショットコピーとし、プリセットへの参照は保存しない
- [x] Webの共通の見た目セクションに、新規保存・読込み・上書き・削除UIを追加する
- [x] [spec.md](./spec.md)、API契約、ユーザーガイド、CONTEXT、ADR-0085を更新する
- 完了条件: プリセットを別の言語版・作品へ適用でき、プリセットの更新・削除が適用済みの言語版を変えないことがテストで確認できる。

### [x] T9 切り抜きヒーローの拡大・基準点・文字幅

- [x] `subjectScale` の範囲を0.5–1.8へ広げ、50%幅の頭打ちをなくして実際に拡大できるようにする
- [x] `subjectAnchor`（下端中央・中央・四隅）を追加し、拡大・縮小の基準点を選べるようにする
- [x] `textWidth`（30–100%）と `wrapText` を追加し、折り返しを止めて被写体と重ねられるようにする
- [x] 数値入力をスライダー＋数値入力で編集できるようにする
- [x] 既存候補で新しい任意項目が未設定でもUI既定値が表示されるよう、テンプレートのUI既定値を候補入力へマージする
- [x] 契約・コンパイラ・UIヘルパーのテストと、spec・ユーザーガイドを更新する
- 完了条件: 0.5倍と1.8倍、6種の基準点、文字幅、折り返しON/OFFがプレビューとPNGに反映される。

### [x] T10 作品共通のサムネイル外観と他言語候補の取り込み

- [x] 外観の所有先を `LanguageEdition` から `Work` へ移し、解決順を Theme → Work → 候補上書きにする
- [x] Thumbnail Appearance の Font Face を `fontFaceByLocale` に変え、localeごとの解決とUIタブを実装する
- [x] 外観APIを `GET/PUT /works/:workId/thumbnail-appearance?languageEditionId=...` へ変更し、EditionのWork所属を検証する
- [x] Thumbnail文書をv3へ上げ、旧候補・Edition外観値・旧形式プリセットを破棄するDB更新を追加する
- [x] Webのサムネイル画面に現在localeを表示し、他言語版の候補を取り込むフォームと破棄操作を追加する
- [x] 外観プリセットの適用先をWork共通外観の下書きへ移す
- [x] [spec.md](./spec.md)、MVP仕様・API契約、ユーザーガイド、CONTEXT、ADR-0111/0112を更新する
- 完了条件: Work外観のライブ反映、locale別フォント、候補固有上書きの優先、他言語候補の取り込みと破棄、DB更新後の保持データがテストで確認でき、`npm run typecheck` と `npm test` が通る。

