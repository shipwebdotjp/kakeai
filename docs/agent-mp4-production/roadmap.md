# エージェントMP4制作 ロードマップ

[spec.md](./spec.md) を正とする。この文書は、MP4主線の安定後に検討する
拡張候補を優先順位と依存関係つきで整理する。ここに書いたものは約束された
仕様ではなく、必要になった時点で個別に仕様化する。

## 方針

- まず「人間プリフライト済みの環境で、エージェントが MP4 を出す」を安定させる。
- 最終的な絵・音の確認、サムネイル、SRT、YouTube 投稿設定は人間が行う。
  これらは MP4 の生成とは別の価値であり、混ぜて優先順位を曖昧にしない。
- エージェントに開放するのは可逆な操作だけとする。実体削除・外部公開・
  ライブラリ管理は人専用の境界を維持する。
- 契約を変える場合は「追加は非破壊、破壊は版上げ」の既存方針に従う。
  ただし MCP/CLI の厳格な出力検証があるため、束縛とアプリの版は揃える。

## 優先順位

| 優先 | 項目 | 何を解くか | 状態 | 着手のトリガー |
| --- | --- | --- | --- | --- |
| 高 | MP4主線の安定（P1） | en-US の初期台本、声のプリフライト、一括TTSの順序 | 完了（2026-10-24） | 今すぐ |
| 中 | 復旧力（P2） | TTS Job の再発見、全体置換の競合検出、タイムアウト後の回復整理 | 完了（2026-10-24） | エージェントの取りこぼしが運用で問題になったとき |
| 中 | 入力契約の探索性（P3-1） | `template.get` の入力 JSON Schema / 例、表・グラフ・フローの試行錯誤削減 | 完了（2026-10-24） | 複雑なテンプレートを使う制作が増えたとき |
| 中 | 視覚確認（P3） | 保存版プレビュー、素材画像、複数フレーム | 一部実装（保存版・素材） | レンダーやり直しコストが問題になったとき |
| 低 | 納品物（将来） | サムネイル、SRT、YouTube 設定、MP4 取得 | 未着手 | 投稿までエージェントに任せたくなったとき |
| 低 | 制作履歴（将来） | 版履歴・復元・Work 複製 | 一部実装（同一 Edition の復元のみ） | 反復制作ややり直しが増えたとき |
| 低 | 表現の拡張（将来） | 新規 Composition、縦型、リモート | 未着手 | 商品として必要になったとき |

## 実装済み（P1 / P2）

- P1: `work.create` が指定 locale（ja-JP / en-US）の初期 ContentDocument を
  作る。声のプリフライト、一括TTSの順序、MP4 の合格ラインと
  `preview.frame` が任意であることをスキルとガイドへ反映した。
- P2: `job.list` が `kind`（`render` / `tts`）で絞れる。`asset_ingest` は
  Work に紐づかないため対象外で、`job.get` で確認する。
- P2: `script.save` が任意の `baseScriptVersionId`（基準版ガード）と
  `sourceScriptVersionId`（同一 Edition の復元元）を受け付ける。
- P2: `AGENT_REQUEST_TIMEOUT` 後の回復手順を操作ごとに整理した。
- P3-1: `template.get` が VisualTemplate 1件の `inputSchema`（保存時検証と
  同じスキーマから導出）と検証済みの `example` を返す。`schema.get` の応答は
  増やさず、`schemaDigest` に `templateInputContracts` を含めた。
- P3-2 視覚確認（一部）: `preview.scriptFrame`（保存版）と
  `preview.assetFrame`（素材）を追加した。レンダー前に headless でシークした
  PNG を取得でき、版・Job・Artifact は作らない。詳細は
  [visual-confirmation/spec.md](../visual-confirmation/spec.md)。

## 将来の候補

### 1. 納品物の完備

MP4 の生成とは独立した価値。人間が行っている作業をエージェントへ移す場合に
個別に仕様化する。

| 項目 | 内容 | 依存・注意 |
| --- | --- | --- |
| サムネイル | 候補の作成・更新・primary 選択・PNG取得 | [`docs/thumbnail/spec.md`](../thumbnail/spec.md)。画像生成は外部 |
| SRT字幕 | 保存済み ScriptVersion からの字幕ダウンロード | [`docs/subtitle-export/spec.md`](../subtitle-export/spec.md)。タイミングは `resolveTimeline` と一致させる |
| YouTube 投稿設定 | タイトル・説明・タグ・公開範囲・チャプター | [`docs/youtube-publication/plan.md`](../youtube-publication/plan.md) は未実装。まずアプリ側の実装が必要 |
| MP4 Artifact の取得 | `role: "render"` の Artifact をエージェントへ渡す | メディアセッション Cookie と同一originの制約。ダウンロード操作の設計が必要 |

### 2. 視覚確認

レンダー前の確認を上げる。テンプレート入力の探索性は P3-1 で実装済み。

| 項目 | 内容 | 状態・依存 |
| --- | --- | --- |
| 保存版プレビュー | 保存済み ScriptVersion の HTML を確認 | 実装済み（`preview.scriptFrame`）。[visual-confirmation/spec.md](../visual-confirmation/spec.md) |
| 素材画像の確認 | Asset の静止画・サムネイルを確認 | 実装済み（`preview.assetFrame`）。画像は原本、動画は静止画 PNG |
| 下書きプレビュー | 未保存の ContentDocument を HTML 化して確認 | 未着手。エージェントは `script.edit` で保存するため後回し |
| 複数フレーム確認 | 複数時刻の一括取得・コンタクトシート | 未着手。単一フレームの利用実績後。出力サイズとタイムアウトの設計が必要 |

### 3. 制作履歴・復旧

| 項目 | 内容 | 状態・依存 |
| --- | --- | --- |
| 版履歴一覧 | Edition の ScriptVersion 一覧をエージェントへ | 未着手。`GET /language-editions/:id/script-versions` が既にある |
| 版復元 | 過去版を新しい版として復元 | `script.save` の `sourceScriptVersionId` による同一 Edition の復元のみ実装済み。履歴一覧からの選択は将来 |
| Work 複製 | 現在版から子 Work を作る | 未着手。`POST /works/:id/clone` が既にある |
| Work 作成の冪等化 | `work.create` の再送対策 | 未実装。`requestId` は追加せず、タイムアウト後に `work.list` で確認するガイド路線 |

### 4. ライブラリ管理・表現

| 項目 | 内容 | 依存・注意 |
| --- | --- | --- |
| Theme の読み取り | 利用可能な Theme / Revision の一覧 | 現状は既存作品の台本から拾うしかない |
| Face Set の読み取り | Face Layer / Expression の一覧 | `line.setExpression` の ID 探索 |
| Voice Profile の読み取り | 声の一覧・locale・Adapter | 書き込みは人専用のまま。読み取りだけでも診断が楽になる |
| Voice の割当て | Speaker への `voiceProfileId` 設定 | 声の管理をどこまでエージェントへ開くかの判断が必要 |
| Composition プレビュー | 新規 Composition の絵の確認 | 外部 HyperFrames CLI 依存を減らす |
| 縦型動画 | 9:16 の完成動画 | 出力全体の設計変更。Composition の portrait とは別 |
| リモート接続 | クラウドのエージェントから接続 | 現行のローカルソケット前提を崩す。認証・公開の再設計が必要 |

## 今回の非ゴールを維持する理由

- サムネイル・SRT・YouTube は「動画を作る」とは別の成果物であり、
  それぞれに正本・検証・UI がある。MP4主線に混ぜると、失敗点が増えて
  「MP4が出ない」原因が曖昧になる。
- 視覚確認は重要だが、今回の合格ラインでは人間が最終確認する。
  エージェントの確認ループは、レンダーやり直しコストが実測で問題になった
  時点で入れる方が効果が測れる。
- ライブラリ管理・削除・外部公開は不可逆または人専用の境界であり、
  MP4主線の安定とは独立に判断する。

## 更新ルール

- この文書は候補の一覧であり、実装の正は [spec.md](./spec.md) と
  [todo.md](./todo.md) に置く。
- 項目を実装するときは、この文書から [todo.md](./todo.md) へ移し、
  必要なら `docs/agent-access/spec.md` と ADR を更新する。
- 前提が変わった項目は削除してよい。優先順位は固定ではない。
