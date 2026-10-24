# エージェントMP4制作 仕様

## 目的と境界

この文書は、AI エージェントが Kakeai の Agent Access（MCP / CLI）だけで
1本の MP4 を完成させるための、現時点の到達点と次の改善を定める。
調査の詳細は [findings.md](./findings.md) を正とする。

- 主線は「新規または既存の Work から、台本・素材・キャラクター・TTS・検証・
  レンダーを経て、`role: "render"` / `format: "mp4"` の Artifact を作る」こと。
- 最終的な絵・音の確認、サムネイル、SRT 字幕、YouTube 投稿設定は人間が行う。
  これらは今回の非ゴールであり、[roadmap.md](./roadmap.md) に将来項目として置く。
- エージェントは、レンダー Job が `succeeded` になり、Artifact が存在するところまで
  責任を持つ。MP4 の取得・視聴・品質判断は人間が行う。
- 操作の意味は既存の正に従う。台本の構造は
  [`docs/mvp/content-schema.md`](../mvp/content-schema.md)、操作は
  [`docs/editor-core/spec.md`](../editor-core/spec.md)、Agent Access は
  [`docs/agent-access/spec.md`](../agent-access/spec.md)、TTS は
  [`docs/tts/spec.md`](../tts/spec.md) を正とする。この文書はそれらを
  置き換えず、MP4主線の運用と優先順位だけを定める。

## 用語

| 用語 | 意味 |
| --- | --- |
| MP4主線 | `schema.get` から `render.start` / Job完了まで、MP4を出すための一連の操作順 |
| 人間プリフライト | エージェントが制作を始める前に人間が用意する前提。アプリ起動、TTS Adapter、声付きキャラクター、必要なら素材 |
| 声付きキャラクター | `CharacterLibraryEntry.voices` に、対象 Edition の locale と一致する `voiceProfileId` を持つエントリ |
| レンダー完了 | `render` Job が `succeeded` になり、`job.get.artifacts` に `role: "render"` / `format: "mp4"` の Artifact が存在する状態 |
| 停止条件 | エージェントが自動修復せず、人間に判断を返す条件 |

## 合格ライン

次のすべてを満たしたとき、今回のMP4主線は達成とする。

1. エージェントが、人間プリフライト済みの環境で、新規 ja-JP 作品を
   `work.create` から `render.start` まで通せる。
2. `render` Job が `succeeded` になり、MP4 Artifact の ID・尺・寸法を
   エージェントが報告できる。
3. 人間が UI から MP4 を取得して確認できる。
4. 声の前提が欠けている場合、エージェントは TTS を開始する前に停止し、
   人間に「声付きキャラクターの作成」を依頼する。無駄な TTS Job を積まない。
5. en-US を選んだ場合も、`work.create` 後の最初の `script.edit` が
   locale 不一致で失敗しない。
6. 同じ `requestId` の再送で、レンダー Job や一括TTS Job が二重に増えない。

## スコープ

### 今回やること

- ja-JP / en-US の Work 作成と台本編集
- キャラクターライブラリからのコピーによる話者・立ち絵の設定
- 素材の検索・取り込み・タグ付け・ready 確認
- 一括TTS（`requestId` 付き）と `tts.attachBulk` による確定
- `script.validate` による保存前検証
- `render.start` と Job 待機、Artifact の確認
- 上記を迷わず通すためのスキル・ユーザーガイド・エラー説明の整備
- en-US の初期台本バグの修正
- MP4主線の回帰テスト

### 今回やらないこと

- 最終的な絵・音の品質判断（人間）
- サムネイルの作成・選択・PNG取得（人間 / 将来）
- SRT 字幕のエクスポート（人間 / 将来）
- YouTube 投稿設定・チャプター（人間 / 将来）
- MP4 Artifact のダウンロード（人間 / 将来）
- 下書きプレビュー、保存版プレビュー、素材画像の確認（将来）
- 版履歴・復元・Work 複製（将来）
- Theme / Face Set / Voice Profile の作成・更新・削除（人専用）
- 新規 Composition の authoring（必要時のみ別スキル）
- 縦型（9:16）の完成動画、リモート接続、アプリ自動起動

## 人間プリフライト

エージェントは制作前に次を確認する。満たせない場合は、制作を進めずに
人間へ返す。

| 前提 | エージェントの確認方法 | 欠けた場合 |
| --- | --- | --- |
| Kakeai が起動している | ソケット接続。失敗は `AGENT_APP_UNAVAILABLE` | アプリ起動を依頼する |
| TTS 対象の話者に有効な声がある | 既存作品は `script.get` の `speakers[].voiceProfileId` を確認する。新規作品は `character.list` の `voices` に対象 locale があるか確認する | 新規なら人間にキャラクター作成を依頼する。既存なら声付きキャラクターをコピーして話者を付け替える。TTS を開始しない |
| TTS Adapter が利用できる | 事前確認の操作は無い。TTS Job の `TTS_ENGINE_UNAVAILABLE` で判明 | エンジン起動を依頼する。Adapter 設定は変更しない |
| 素材がある、または取り込める | `asset.list` / `asset.import`。参照前に `asset.get` で `ready` を確認 | 素材を用意するか、取り込み先を確認する |
| テーマが決まっている | 既存作品の `script.get` から参照をコピー、または既定テーマを使う | 既定テーマで進める。人間の指定があれば従う |

声付きキャラクターが無い場合に、外部で生成した音声を `asset.import` して
`line.assignTake` する経路は許容する。ただしこれは Kakeai の TTS を使わない
代替であり、標準のMP4主線ではない。

## MP4主線

| # | 操作 | 完了条件 |
| --- | --- | --- |
| 1 | `schema.get` | `contentSchemaVersion`、Template、`warningCodes`、`agentOperations`、`schemaDigest` / `operationDigest` を取得 |
| 2 | `work.create` | Work と Edition、初期 ScriptVersion を取得。ja-JP を既定とする |
| 3 | `script.get` | 対象 Edition の current ScriptVersion と `content.locale` を確認 |
| 4 | 声の確認 | 既存の Speaker に `voiceProfileId` があればそれを使う。無ければ `character.list` で対象 locale の声を持つキャラクターを選ぶ。どちらも無ければ停止 |
| 5 | `script.edit`（1回目） | `character.addFromLibrary` で声付きキャラクターをコピーし、`created.speakerIds` を取得（既存の有効な話者を使う場合は省略可） |
| 6 | `script.edit`（2回目以降） | Scene・セリフ・Cue・BGM・立ち絵を追加。話者 ID は 5 で得た ID を使う |
| 7 | `asset.list` / `asset.import` / `job.wait` / `asset.get` | 参照する素材がすべて `ready` |
| 8 | `script.validate` | `VALIDATION_ERROR` が無い。警告は `warningCodes` と照合 |
| 9 | `tts.createBulk`（`requestId` 必須） | `jobs` と `excluded` を取得。`excluded` に `TTS_INPUT_INVALID` があれば声の前提を見直す |
| 10 | `tts.attachBulk`（同じ `agentId`） | `finalized` になり、成功分が1つの ScriptVersion に添付される。`pending` なら繰り返す |
| 11 | `script.validate` | 添付後の版を再検証する |
| 12 | `render.start`（`requestId` 付き） | `render` Job を取得 |
| 13 | `job.wait` / `job.get` | `succeeded`。`artifacts` に `role: "render"` / `format: "mp4"` がある |
| 14 | 報告 | Work / Edition / ScriptVersion / Job / Artifact ID、尺、寸法を報告。品質判断は人間に返す |

- 9〜10 の間は台本を保存しない。保存すると `SCRIPT_BASE_STALE` になる。
- 9 で `excluded` が多い場合、または `TTS_INPUT_INVALID` が声由来なら、
  10 に進まず人間へ返す。無理に `tts.create` を繰り返さない。
- 13 で `failed` の場合、`job.error` を報告して停止する。同じ入力で無限に
  再試行しない。修正後に同じ `requestId` で再送してよいのは、失敗が
  台帳に残らない操作だけである。
- `preview.frame` は必須ではない。エージェントが絵を確認したい場合の補助とし、
  最終判断は人間に残す。

## 停止条件

| コード / 状況 | エージェントの行動 |
| --- | --- |
| `AGENT_APP_UNAVAILABLE` | アプリ起動を依頼する。自動起動しない |
| 声付きキャラクターが無い | キャラクター作成を依頼する。TTS を開始しない |
| `TTS_INPUT_INVALID`（話者・声・空テキスト） | 台本と声の設定を確認する。声を作り替えない |
| `TTS_ENGINE_UNAVAILABLE` | TTS エンジンの起動を依頼する。Adapter 設定を変更しない |
| `ASSET_UNAVAILABLE` | 素材の ready を確認する。代替素材を探す |
| `SCRIPT_BASE_STALE` | current を読み直す。一括TTS中なら新しい `bulkRequestId` でやり直す |
| `VALIDATION_ERROR` | `issues` の path を直す。テンプレート契約を推測しない |
| `JOB_NOT_CANCELLABLE` | 実行中 Job は待つ。無理に取り消さない |
| `RENDER_FAILED` / `RENDER_INPUT_INVALID` | `job.error` を報告する。素材・尺・テンプレート入力を確認する |
| Worker が進まない | `job.get` の `queued` / `running` を確認し、人間に状態を報告する |

## 要件

### R1. en-US の初期台本を修正する

`work.create` は指定された locale の初期 ContentDocument を作る。
ja-JP は従来どおり。en-US で作成した直後の `script.edit` が
`VALIDATION_ERROR` にならないことをテストで固定する。

### R2. 声のプリフライトをスキルとガイドに固定する

`skills/kakeai-production/SKILL.md` と `user-guide/docs/agent-access.md` に次を明記する。

- MP4主線の最初に `character.list` で対象 locale の声を確認する。
- 無い場合は TTS を開始せず、人間にキャラクター作成を依頼する。
- 標準の声の設定は `character.addFromLibrary` によるコピーである。
- 既存話者へ声を割り当てる操作は現時点で無いことを明記する。

### R3. 一括TTSの順序を固定する

- `tts.createBulk` は必ず `requestId` 付きで開始する。
- `tts.createBulk` から `tts.attachBulk` の間は台本を保存しない。
- `tts.attachBulk` は同じ `agentId` で呼ぶ。
- `pending` は失敗ではない。`finalized` まで繰り返す。
- `excluded` / `failures` の再生成は、返された版と新しい `bulkRequestId` で行う。

### R4. レンダー完了の定義を固定する

- `render.start` は `requestId` を付ける。
- 完了は `job.status === "succeeded"` かつ MP4 Artifact の存在で判定する。
- `job.wait` の `timedOut: true` は失敗ではない。同じ Job ID で続ける。
- エージェントは「絵が正しい」と断定しない。最終確認は人間に返す。

### R5. 失敗時の回復を明文化する

- `AGENT_REQUEST_TIMEOUT` 後は、状態確認を先に行う。
- `script.edit` と `tts.attachBulk` は同じ `requestId` で再送してよい。
- 高コスト操作は `requestId` で冪等。
- `work.create` / `script.save` は再送で重複し得るため、`work.list` /
  `script.get` で確認してから再実行する。
- TTS Job を失った場合は、`requestId` が無ければ復元できないため、
  新しい `requestId` で作り直す。この制約はガイドに明記する。

### R6. 非ゴールを混ぜない

今回の変更で、サムネイル・SRT・YouTube・Artifact ダウンロード・
下書きプレビュー・履歴復元・Theme / FaceSet / Voice 管理を追加しない。
必要になった時点で [roadmap.md](./roadmap.md) から個別に立ち上げる。

### R7. 回帰を固定する

- ja-JP の声付きキャラクターありの MP4主線
- en-US の Work 作成 + 最初の `script.edit`
- 声が無い場合に `tts.createBulk` が `excluded` を返し、エージェントが
  TTS を開始しないこと（スキル手順の確認）
- `tts.createBulk` の `requestId` 再送で Job が増えないこと
- `tts.attachBulk` の `pending` → `finalized`
- `render.start` の `requestId` 再送で Job が増えないこと
- レンダー成功時の MP4 Artifact

## 受け入れ基準

- 人間プリフライト済みの ja-JP 新規作品で、エージェントが
  `work.create` から `render` 成功まで、手動の追加操作なしに通せる。
- en-US 新規作品で、`work.create` 後の `script.edit` が通る。
- 声が無い新規作品で、エージェントが TTS を開始する前に停止し、
  人間に依頼する。`TTS_INPUT_INVALID` を大量に積まない。
- `tts.createBulk` / `tts.attachBulk` の順序を守った実行で、
  一括生成が1つの ScriptVersion に確定する。
- `render.start` の再送で二重レンダーにならない。
- レンダー成功時に MP4 Artifact の ID・尺・寸法を報告できる。
- `npm run typecheck` と `npm test` が通る。

## 関連文書

- [findings.md](./findings.md): 調査結果と根拠
- [todo.md](./todo.md): 実装フェーズ
- [roadmap.md](./roadmap.md): 将来の拡張
- [Agent Access 仕様](../agent-access/spec.md)
- [エージェント新規作成の信頼性向上](../agent-new-work/spec.md)
- [制作スキル](../../skills/kakeai-production/SKILL.md)
- [ユーザーガイド: エージェント連携](../../user-guide/docs/agent-access.md)
