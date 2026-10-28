# エージェントへのサムネイル作成・プレビュー・PNG 取得の公開

Status: accepted

Amended by [ADR 0109](./0109-agent-operation-set-update-semantics.md)（`thumbnail.update` を部分更新化）、[ADR 0111](./0111-work-scoped-thumbnail-appearance.md)（外観の所有先を Work へ変更）。

## 背景

サムネイルは Language Edition ごとの小さな可変文書（`Thumbnail`）で、テンプレートに入力と素材を差し込んで 1280x720 の PNG をオンデマンド生成する。HTTP API と Web UI は候補の CRUD・primary 選択・外観の上書き・未保存プレビュー・PNG ダウンロードを既に持つ（[サムネイル仕様](../thumbnail/spec.md)）。

Agent Access はこれまでサムネイルを公開せず、MP4 制作の後工程（サムネイル・SRT・YouTube 設定）を人間に残してきた（[MP4 制作仕様](../agent-mp4-production/spec.md)）。しかしエージェントが MP4 を完成させても、投稿用サムネイルだけは毎回人間が作り直す必要があり、作品ごとの反復コストが高い。テンプレート方式のサムネイルは AI 生成ではなく、素材と文字を差し込むだけの決定的な描画であり、PNG はいつでも同じ候補から再生成できる（[ADR 0060](./0060-thumbnail-on-demand-png.md)）。候補は永続化されるが、入力は小さな JSON であり、人間が UI で作り直せる。

サムネイル作成は台本の意味論や生成接続先を変えない。素材は利用者が取り込み済みの ready な画像だけで、外部サービスへの公開も課金生成も伴わない。したがって [ADR 0074](./0074-agent-direct-reversible-operations.md) の可逆操作の範囲として公開できる。

## 決定

サムネイルの読み取り・作成・更新・primary 選択・未保存プレビュー・PNG 取得を Agent Access に公開する。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く（加算的変更）。

- `thumbnail.listTemplates`（read）— 同梱サムネイルテンプレートの `id`・`version`・`display`・`inputSchema`（保存時検証と同じ Zod スキーマから導出した JSON Schema）・`example` を返す。サムネイルテンプレートは VisualTemplate とは別レジストリのため、`schema.get` ではなく専用の一覧操作で公開する。
- `thumbnail.list` / `thumbnail.get`（read）— 既存の `Thumbnail` DTO をそのまま返す。`isPrimary` と `appearanceOverride` を含む。
- `thumbnail.appearance`（read）— Language Edition 共通 Appearance を、Theme 由来の既定値と解決済みの値付きで返す。
- `thumbnail.create` / `thumbnail.update`（mutation）— HTTP の作成・明示保存と同じ入力（`label`・`template`・`input`・任意の `appearanceOverride`）を受け、既存サービスをそのまま呼ぶ。テンプレート入力と素材（ready な画像）の検証も既存の `validateDocument` を共有する。
- `thumbnail.setPrimary`（mutation）— 投稿用の 1 枚を選ぶ。`thumbnailId: null` で解除できる。
- `preview.thumbnail`（read）— 未保存のドラフトを headless でラスタライズし、1280x720 の PNG（base64）を返す。DB へ書かない。保存済み候補の PNG を使う `thumbnail.image` と対になる。
- `thumbnail.image`（read）— 保存済み候補の PNG をオンデマンド生成して返す。Job・Artifact は作らない。CLI の `--out` と MCP の image コンテントブロックを既存の画像系操作と同じ仕組みで使えるよう、両操作を `agentImagePreviewOperationNames` に加える。

公開しないもの:

- 候補の削除（`thumbnail.delete`）。サムネイル文書は版履歴を持たない可変文書で、削除には操作上の取り消し手段がない。実体削除を人に限る [ADR 0074](./0074-agent-direct-reversible-operations.md) の境界を維持する。不要な候補の整理は人間が UI で行う。
- Language Edition 共通 Appearance の保存。候補単位の `appearanceOverride` は作成・更新に含めるが、言語版全体の見た目は作品のブランド判断であり、UI で人が保存する。
- 外観プリセットの読み書き。プリセットは共通 Appearance のスナップショット適用のための便利機能で、作成→プレビュー→PNG 取得の主線に不要である。

`requestId` は持たず、冪等台帳に載せない（`work.create`・`voiceProfile.create` と同じ扱い）。サムネイル候補は Job や Version を増やさず、タイムアウト後は `thumbnail.list` の `label`・`createdAt` で結果を確認してから再実行できる。`preview.thumbnail` / `thumbnail.image` は画像系の読み取りタイムアウト（30 秒）を使う。

## Considered Options

- 未保存プレビューも HTML で返す。→ エージェントは HTML を描画できず、視覚確認にならない。既存の PNG 生成経路をそのまま使う方が検証も安定する。不採用。
- 保存済み候補の PNG 取得を `preview.thumbnail` に統合し、`thumbnailId` かインライン入力のどちらかを受ける。→ 入力の分岐が増え、未保存プレビューとダウンロードで冪等性・エラー条件が混ざる。読み取り 2 操作に分ける。
- 候補の削除も公開する。→ DB 行だけの削除で実体ファイルは消えないが、可変文書には版履歴がなく、操作面での取り消しができない。台本上の削除（新しい版を作る）とは性質が異なるため、人専用を維持する。
- サムネイルテンプレートを `template.get` に相乗りさせる。→ VisualTemplate とサムネイルテンプレートはレジストリも契約も別で、`template.get` の `id`/`version` の意味が濁る。専用の一覧操作にする。
- 作成・更新にも `requestId` を付ける。→ 台帳は高コスト操作（Job・Version を増やす操作）の重複防止が目的で、候補作成は `thumbnail.list` の読み直しで足りる。ADR 0088 / 0089 と同じ理由で不採用。

## Consequences

- Agent Access 仕様の MCP 操作表・操作詳細・タイムアウト・エラー表を更新し、サムネイル操作と公開しない範囲を明記する。`schemaDigest` に `thumbnailTemplateContracts` を加え、サムネイルテンプレートの入力変更も検知できるようにする。`operationDigest` と `schemaDigest` は変わり、束縛（MCP / CLI）とアプリは同じビルドで揃える。
- 制作スキルは、レンダー後にサムネイル候補を作り、`preview.thumbnail` の PNG を読んで見出しの折り返しと前景の透過を確認し、primary を選び、`thumbnail.image` で PNG を取得する手順を追加する。最終的な絵の判断は人間に残す。
- MP4 制作ロードマップの「納品物の完備」からサムネイルを実装済みへ移す。SRT 字幕・YouTube 投稿設定・MP4 取得は引き続き別項目である。
- この決定は恒久ではない。候補の削除や共通 Appearance の保存をエージェントへ開く必要が出た場合は、取り消し手段（履歴・ゴミ箱）と合わせて新しい ADR で判断する。
