# エージェントMP4制作 仕様

## 目的と境界

この文書は、AI エージェントが Kakeai の Agent Access（MCP / CLI）だけで
1本の MP4 を完成させるための、現時点の到達点と次の改善を定める。
調査の詳細は [findings.md](./findings.md) を正とする。

- 主線は「新規または既存の Work から、台本・素材・キャラクター・TTS・検証・
  レンダーを経て、`role: "render"` / `format: "mp4"` の Artifact を作る」こと。
- 最終的な絵・音の確認、サムネイルの最終判断、YouTube 投稿設定は人間が行う。
  SRT と MP4 の取得は後続の B18 でエージェントへ公開した（[`script.subtitles` / `artifact.get`](../agent-access/spec.md)）。
- エージェントは、レンダー Job が `succeeded` になり、Artifact が存在するところまで
  責任を持つ。MP4 の視聴と品質判断は人間が行う。
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
| 人間プリフライト | エージェントが制作を始める前に人間が用意する前提。アプリ起動、TTS Adapter、対象 locale の Voice Profile（または声付きキャラクター）、必要なら素材 |
| 声付きキャラクター | `CharacterLibraryEntry.voices` に、対象 Edition の locale と完全一致する `voiceProfileId` を持つエントリ |
| 声だけの話者 | `characterId: null` の Speaker。既存の Voice Profile を `speaker.add` / `speaker.setVoiceProfile` で割り当て、立ち絵を持たない |
| レンダー完了 | `render` Job が `succeeded` になり、`job.get.artifacts` に `role: "render"` / `format: "mp4"` の Artifact が存在する状態 |
| 停止条件 | エージェントが自動修復せず、人間に判断を返す条件 |

## 合格ライン

次のすべてを満たしたとき、今回のMP4主線は達成とする。

1. エージェントが、人間プリフライト済みの環境で、新規 ja-JP 作品を
   `work.create` から `render.start` まで通せる。
2. `render` Job が `succeeded` になり、`artifacts` に
   `role: "render"` / `format: "mp4"` の Artifact があり、エージェントが
   その `id`・`durationMs`・`widthPx`・`heightPx` を報告できる。
3. 人間が UI から MP4 を取得して確認できる。
4. 声の前提が欠けている場合、エージェントは TTS を開始する前に停止し、
   `voiceProfile.listVoices` → `voiceProfile.create` で対象 locale の Profile を
   用意する（立ち絵が必要なら `character.create` / `character.update` で
   声付き Character を用意する）。用意できなければ人間に依頼する。無駄な
   TTS Job を積まない。
5. en-US を選んだ場合も、`work.create` 後の最初の `script.edit` が
   locale 不一致で失敗しない。
6. 同じ `requestId` の再送で、レンダー Job や一括TTS Job が二重に増えない。

## スコープ

### 今回やること

- ja-JP / en-US の Work 作成と台本編集
- 既存 Voice Profile を割り当てた声だけの話者、またはキャラクターライブラリからのコピーによる話者・立ち絵の設定
- Theme・Face Set・Voice Profile の読み取り
- 素材の検索・取り込み・タグ付け・ready 確認
- 一括TTS（`requestId` 付き）と `tts.attachBulk` による確定
- `script.validate` による保存前検証
- `render.start` と Job 待機、Artifact の確認
- 上記を迷わず通すためのスキル・ユーザーガイド・エラー説明の整備
- en-US の初期台本バグの修正
- MP4主線の回帰テスト

### 今回やらないこと

- 最終的な絵・音の品質判断（人間）
- サムネイルの作成・選択・PNG取得（P1 時点では対象外。B13 で公開済み）
- SRT 字幕のエクスポート（B18 で `script.subtitles` として公開済み）
- YouTube 投稿設定・チャプター（人間 / 将来）
- MP4 Artifact のダウンロード（B18 で `artifact.get` の絶対パスとして公開済み。視聴・品質判断は人間）
- 下書きプレビュー（将来）
- Agent 操作としての版の削除・履歴圧縮（Web UI / HTTP では [work-history](../work-history/spec.md) で実装済み）、全 Edition の複製、Work 作成・複製の `requestId` 冪等化
- Theme の作成・更新・削除と Voice Profile / Face Set の削除（人専用。Face Set の作成・部分更新は B20 で公開済み。読み取りと既存 Voice Profile の話者への割り当ては P5 で対象）
- 新規 Composition の authoring（必要時のみ別スキル）
- 縦型（9:16）の完成動画、リモート接続、アプリ自動起動

## 人間プリフライト

エージェントは制作前に次を確認する。満たせない場合は、制作を進めずに
人間へ返す。

| 前提 | エージェントの確認方法 | 欠けた場合 |
| --- | --- | --- |
| Kakeai が起動している | ソケット接続。失敗は `AGENT_APP_UNAVAILABLE` | アプリ起動を依頼する |
| TTS 対象の話者に有効な声がある | 既存作品は `script.get` の `speakers[].voiceProfileId` を確認し、`voiceProfile.get` で実在と locale を確かめる。新規作品は `voiceProfile.list` で対象 locale と完全一致する Profile を探し、立ち絵が必要なら `character.list` の `voices` も確認する | 新規で Profile が無ければ、`voiceProfile.listVoices` で声候補を探して `voiceProfile.create` で作成する。立ち絵が必要なら `character.create` か `character.update` で声付き Character を用意する。画像素材が無いなど用意できなければ人間に依頼する。既存作品は有効な声を持つ話者を再利用する。TTS を開始しない |
| TTS Adapter が利用できる | 事前確認の操作は無い。TTS Job の `TTS_ENGINE_UNAVAILABLE` で判明 | エンジン起動を依頼する。Adapter 設定は変更しない |
| 素材がある、または取り込める | `asset.list` / `asset.import`。参照前に `asset.get` で `ready` を確認 | 素材を用意するか、取り込み先を確認する |
| テーマが決まっている | 既存作品の `script.get` から参照をコピー、または `theme.list` / `theme.get` で最新 Revision を確認して選ぶ | 既定テーマで進める。人間の指定があれば従う |

対象 locale の Voice Profile が無い場合に、外部で生成した音声を `asset.import` して
`line.assignTake` する経路は許容する。ただしこれは Kakeai の TTS を使わない
代替であり、標準のMP4主線ではない。

## MP4主線

| # | 操作 | 完了条件 |
| --- | --- | --- |
| 1 | `schema.get` | `contentSchemaVersion`、Template、`warningCodes`、`agentOperations`、`schemaDigest` / `operationDigest` を取得 |
| 2 | `work.create` | Work と Edition、初期 ScriptVersion を取得。ja-JP を既定とする |
| 3 | `script.get` | 対象 Edition の current ScriptVersion と `content.locale` を確認 |
| 4 | 声の確認 | 既存の Speaker に `voiceProfileId` があればそれを使う。無ければ `voiceProfile.list` で対象 locale と完全一致する Profile を選ぶ。無ければ `voiceProfile.listVoices` で声候補を探して `voiceProfile.create` で作成する。立ち絵が必要なら `character.list` で対象 locale の声を持つキャラクターを選ぶ。声の無い既存 Character には `character.setVoices` で声を付ける。使える Character が無ければ `character.create` で作る（外観の画像は `asset.import` した ready な画像だけ） |
| 5 | `script.edit`（1回目） | 声だけの話者なら `speaker.add`（既存 Profile）と `line.add`（`speakerId: { key }`）を同じ呼び出しに入れる。立ち絵が必要なら `character.addFromLibrary` で声付きキャラクターをコピーし、`created.speakerIds` を取得する。既存の有効な話者を使う場合は省略可 |
| 6 | `script.edit`（2回目以降） | Scene・セリフ・Cue・BGM・立ち絵を追加。話者 ID は 5 で得た ID または `{ key }` を使う。表・グラフ・フロー・効果・入れ子の入力は `template.get` の JSON Schema と例から組み立てる |
| 7 | `asset.list` / `asset.import` / `job.wait` / `asset.get` | 参照する素材がすべて `ready` |
| 8 | `script.validate` | `VALIDATION_ERROR` が無い。警告は `warningCodes` と照合 |
| 9 | `tts.createBulk`（`requestId` 必須） | `jobs` と `excluded` を取得。`excluded` に `TTS_INPUT_INVALID` があれば声の前提を見直す |
| 10 | `tts.attachBulk`（同じ `agentId`） | `finalized` になり、成功分が1つの ScriptVersion に添付される。`pending` なら繰り返す |
| 11 | `script.validate` | 添付後の版を再検証する |
| 12 | `render.start`（`requestId` 付き） | `render` Job を取得 |
| 13 | `job.wait` / `job.get` | `succeeded`。`artifacts` に `role: "render"` / `format: "mp4"` がある |
| 14 | `artifact.get` / `artifact.export` / `script.subtitles` | 正本の絶対パス `filePath`、必要ならワークスペースへの `exportedPath`、保存版の SRT を取得する |
| 15 | 報告 | Work / Edition / ScriptVersion / Job / Artifact ID、尺、寸法、MP4 のパスを報告。品質判断は人間に返す |

- 9〜10 の間は台本を保存しない。保存すると `SCRIPT_BASE_STALE` になる。
- 9 で `excluded` が多い場合、または `TTS_INPUT_INVALID` が声由来なら、
  10 に進まず人間へ返す。無理に `tts.create` を繰り返さない。
- 声だけの話者へ切り替えるときは `expressionId` を指定しない。`line.setSpeaker`
  は自動で消すが、`line.add` は明示的な `expressionId` を拒否し、
  `line.setExpression` も声だけの話者には指定できない。
- 既存の声なし話者へ割り当てる場合は、`speaker.add` で作り直さず
  `speaker.setVoiceProfile` を使う。
- `speaker.add` だけを行った `script.edit` がタイムアウトした場合、再送は版を
  増やさないが `created` を返さない。`script.get` で新しい Speaker を確認する。
- Theme は `theme.list` / `theme.get` が返す最新 Revision だけを選べる。
  アーカイブ済み・最新でない Revision への変更は `script.save` が拒否する。
  既存の Theme を変えない保存は、その Theme がアーカイブ済みでも通る。
- 13 で `failed` の場合、`job.error` を報告して停止する。同じ入力で無限に
  再試行しない。修正後に同じ `requestId` で再送してよいのは、失敗が
  台帳に残らない操作だけである。
- `preview.frame` は必須ではない。エージェントが絵を確認したい場合の補助とし、
  最終判断は人間に残す。
- 表・グラフ・フロー・セリフ同期効果・入れ子など、`inputFields` だけでは
  JSON の形が分からない入力は、`template.get` で `inputSchema` と `example` を
  取得してから組み立てる。`example` の `<...>` は実在する ID に置き換える。
  テンプレート契約を推測しない。

## 停止条件

| コード / 状況 | エージェントの行動 |
| --- | --- |
| `AGENT_APP_UNAVAILABLE` | アプリ起動を依頼する。自動起動しない |
| 対象 locale の Voice Profile が無い | `voiceProfile.listVoices` → `voiceProfile.create` で作成する（立ち絵が必要なら声付き Character も用意する）。用意できなければ人間に依頼する。TTS を開始しない |
| `EDIT_PRECONDITION_FAILED`（声の割り当て） | locale 不一致、Character Voice との不一致。声を推測せず、人間に Profile または Character Voice の設定を依頼する |
| `TTS_INPUT_INVALID`（話者・声・空テキスト） | 台本と声の設定を確認する。声を作り替えない |
| `TTS_ENGINE_UNAVAILABLE` | TTS エンジンの起動を依頼する。Adapter 設定を変更しない |
| `ASSET_UNAVAILABLE` | 素材の ready を確認する。代替素材を探す |
| `SCRIPT_BASE_STALE` | current を読み直す。一括TTS中なら新しい `bulkRequestId` でやり直す |
| `VALIDATION_ERROR` | `issues` の path を直す。テンプレート契約を推測せず `template.get` を読む |
| `RESOURCE_NOT_FOUND`（`template.get`） | `schema.get.templates` にある `id` / `version` をそのまま使う。推測しない |
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

- MP4主線の最初に `voiceProfile.list` で対象 locale と完全一致する Voice Profile を確認する。
- Profile が無い場合は、`voiceProfile.listVoices` で声候補を探して `voiceProfile.create` で作成する（`locale` は台本の locale と完全一致させ、`openai-compatible` では `settings.model` を `voiceProfile.listModels` で選ぶ）。立ち絵が必要な場合は、`character.list` で対象 locale の声を持つキャラクターを選び、声の無い既存 Character には `character.setVoices` で声を付ける。使える Character が無ければ `character.create` で作る（外観の画像は `asset.import` した ready な画像だけを使い、無ければ外観なしで作り後から `character.update` で追加する）。
- 声だけの話者は、`speaker.add` と `line.add`（`speakerId: { key }`）を同じ `script.edit` に入れて作る。既存話者へは `speaker.setVoiceProfile` で割り当てる。
- 立ち絵が必要な場合の標準は `character.addFromLibrary` によるコピーである。
- Voice Profile と Character の削除は人専用であり、エージェントは Voice Profile と Character の作成・更新、Character への声付け、既存 Profile の割り当てを行う。ライブラリの編集は既存台本のコピーへ波及しない。

### R3. 一括TTSの順序を固定する

- `tts.createBulk` は必ず `requestId` 付きで開始する。`requestId` は契約上
  任意だが、確定には必須である。
- `tts.createBulk` から `tts.attachBulk` の間は台本を保存しない。
- `tts.attachBulk` は同じ `agentId` で呼ぶ。
- `pending` は失敗ではない。`finalized` まで繰り返す。
- `excluded` / `failures` の再生成は、返された版と新しい `bulkRequestId` で行う。

### R4. レンダー完了の定義を固定する

- `render.start` は `requestId` を付ける。
- 完了は `job.status === "succeeded"` かつ MP4 Artifact の存在で判定する。
- Skill §8/§11 の `preview.frame` 必須表現を修正し、任意にする。
- `job.wait` の `timedOut: true` は失敗ではない。同じ Job ID で続ける。
- エージェントは「絵が正しい」と断定しない。最終確認は人間に返す。

### R5. 失敗時の回復を実装する（P2）

- `job.list` は `{ workId, kind? }` を受け、`kind` は `render`（既定）または
  `tts`。`asset_ingest` は Work に紐づかないため enum に含めず、指定すると
  `VALIDATION_ERROR` になる。HTTP の `GET /works/:workId/jobs` は既定の
  render のまま。
- `script.save` は任意の `baseScriptVersionId`（基準版ガード）と
  `sourceScriptVersionId`（同一 Edition の復元元）を受け付ける。
  `baseScriptVersionId` 省略時は last-write-wins、指定時は current と
  一致しなければ `SCRIPT_BASE_STALE`。存在しない版は `WORK_NOT_FOUND`、
  別 Edition の版は `VALIDATION_ERROR` になる。
- `work.create` の重複対策は `requestId` を追加せず、タイムアウト後に
  `work.list` で確認してから再実行するガイド路線とした。
- TTS Job を失った場合は `job.list { kind: "tts" }` で再発見できる。
  ただし `requestId` なしで開始した一括生成は、再発見しても確定できない。
- `AGENT_REQUEST_TIMEOUT` 後は、状態確認を先に行う。
- `script.edit` / `script.restore` / `tts.attachBulk` は同じ `requestId` で再送してよい。
- 高コスト操作は `requestId` で冪等。

### R6. 非ゴールを混ぜない

R6 は P1 時点の非ゴールである。P4 で版履歴一覧・復元・Work 複製を追加し、
P5 でライブラリの読み取りと既存 Voice Profile の割り当てを追加した。
引き続き、YouTube・下書きプレビュー・Theme のアーカイブ／削除は P5 の対象にしない。
Face Set の作成・部分更新は B20 として公開した（[ADR 0105](../adr/0105-agent-face-set-writes-and-preview.md)）。必要になった時点で [roadmap.md](./roadmap.md) から個別に立ち上げる。サムネイルは
[Agent Access B13](../agent-access/roadmap.md) として公開し（[ADR 0098](../adr/0098-agent-thumbnail-operations.md)）、
SRT と MP4 の取得は B18 として公開した（[ADR 0103](../adr/0103-agent-subtitles-and-artifact-path.md)）。

### R7. 回帰を固定する

- ja-JP の Voice Profile ありの MP4主線（声だけの話者）
- ja-JP の声付きキャラクターありの MP4主線
- en-US の Work 作成 + 最初の `script.edit`
- 対象 locale の Voice Profile が無い場合に、エージェントが TTS を開始しないこと（スキル手順の確認）
- 声の無い話者への `tts.createBulk` が `excluded` / `TTS_INPUT_INVALID` を返すこと
- `tts.createBulk` の `requestId` 再送で Job が増えないこと
- `tts.attachBulk` の `pending` → `finalized`
- `render.start` の `requestId` 再送で Job が増えないこと
- レンダー成功時の MP4 Artifact

### R8. テンプレート入力の契約を公開する（P3-1）

- `template.get`（`{ id, version }`）は VisualTemplate 1件の `inputSchema` と
  `example` を返す。`inputSchema` はテンプレート定義の `inputSchema` を
  `toAgentJsonSchema` で変換したもので、保存時検証と同じスキーマから導出する。
  別の検証スキーマを持たない。
- `example` は全テンプレートに必須で、保存時検証を通ることをテストで固定する。
- `schema.get` の応答はカタログのまま増やさない。未知の `id` / `version` は
  `RESOURCE_NOT_FOUND` とする。
- `schemaDigest` は `templateInputContracts` を含み、入力スキーマや例の変更でも
  変化する。新操作の追加は任意フィールドの追加と同じ扱いで、プロトコル版は
  上げない。

### R9. 制作履歴・復旧を実装する（P4）

- `script.listVersions` は `{ languageEditionId }` を受け、Edition の Script Version 履歴を
  新しい順に返す。応答は `{ languageEditionId, currentScriptVersionId, scriptVersions }` で、
  各要素は版番号・作成者・要求 ID・`sourceScriptVersionId`・作成日時を持つ要約であり、
  `ContentDocument` を含めない。Edition が存在しなければ `WORK_NOT_FOUND`。
- `script.restore` は `{ scriptVersionId, baseScriptVersionId?, requestId, authorAgentId? }` を
  受け、復元元の内容をサーバー側で読み、新しい版として保存する。呼び出し側は
  `ContentDocument` を送らない。`sourceScriptVersionId` に復元元を記録し、復元元が
  current の場合は `VALIDATION_ERROR`。`requestId` は必須で、同じ入力の再送は
  既存版を返す（`replay: true`）。異なる入力は `IDEMPOTENCY_CONFLICT`。
  `baseScriptVersionId` は任意の基準版ガードで、不一致は `SCRIPT_BASE_STALE`。
- `work.clone` は `{ workId, title }` を受け、元 Work の `originalLocale` の Edition の
  current 版から子 Work を作る。子 Work は `parentWorkId` を持ち、初期版は
  `sourceScriptVersionId` に複製元を記録する。他の Edition・版履歴・Job・Artifact・
  サムネイルは複製しない。Agent 経由の初期版は `author: "agent"` / `authorAgentId` になる。
- `work.create` / `work.clone` は operation の `requestId` を持たない。タイムアウト後は
  `work.list` の `createdAt` と `parentWorkId` で作成済みかを確認し、推測できない場合は
  人間に返す。トランスポートの `requestId` は再送の重複排除ではない。
- 既存 DTO への追加は非破壊とする。`WorkSummary` に `createdAt` / `parentWorkId`、
  `ScriptVersionSummary` に `sourceScriptVersionId` を追加する。`operationDigest` と
  `schemaDigest` は変わるが、`AGENT_PROTOCOL_VERSION` は上げない。
- Agent 操作としての版の削除・履歴圧縮（Web UI / HTTP では実装済み）、Edition をまたぐ復元、全 Edition の複製、`work.create` /
  `work.clone` の台帳冪等化は今回の非ゴールとする。

### R10. ライブラリ読み取りと声の割り当て（P5）

- `theme.list` / `theme.get`、`faceSet.list` / `faceSet.get`、`voiceProfile.list` /
  `voiceProfile.get` を追加する。一覧はページングせず、未知の ID は
  `RESOURCE_NOT_FOUND`。Theme はアーカイブされていない利用者 Theme の最新公開
  Revision と組み込み Theme だけを返し、Theme Draft・アーカイブ済み Theme・
  最新でない Revision・Font 診断は返さない。
- `speaker.add` と `speaker.setVoiceProfile` を追加し、`line.add` / `line.setSpeaker` の
  `speakerId` を ID または `{ key }` で参照できるようにする。`speaker` カテゴリを追加する。
- Voice Profile は実在し、`ContentDocument.locale` と完全一致すること。Character 付き
  話者は、文書 locale の Character Voice と一致する場合だけ設定できる。Character に
  その声が無い場合は `null` への解除だけを許す。参照欠落は `EDIT_TARGET_NOT_FOUND`、
  locale・Character Voice の不一致は `EDIT_PRECONDITION_FAILED`。
- `line.setSpeaker` は声だけの話者への変更時に `expressionId` を消す。`line.add` は
  声だけの話者への明示的な `expressionId` を拒否する。
- `document.setVisualTheme` は最新 Revision だけを選べる。`script.save` は Theme の
  変更がアーカイブ済み・最新でない Revision を指す場合だけ拒否し、Theme を変えない
  保存と `script.restore` は許可する。
- DB migration と HTTP API の変更は無い。`operationDigest` と `schemaDigest` は変わるが、
  `AGENT_PROTOCOL_VERSION` は上げない。操作カタログとカテゴリ enum が変わるため、
  束縛とアプリは同じビルドで揃える。
- Voice Profile・Character の削除と Face Set・Theme の管理は引き続き人専用とする。

## 受け入れ基準

- 人間プリフライト済みの ja-JP 新規作品で、エージェントが
  `work.create` から `render` 成功まで、手動の追加操作なしに通せる。
- 対象 locale の Voice Profile がある新規作品で、`speaker.add` → `line.add`
  → TTS → 確定 → レンダーまで通せる。声付きキャラクターを使う経路も通る。
- en-US 新規作品で、`work.create` 後の `script.edit` が通る。
- 対象 locale の Voice Profile が無い新規作品で、エージェントが TTS を開始する前に停止し、
  人間に依頼する。`TTS_INPUT_INVALID` を大量に積まない。
- `theme.list` / `theme.get` で最新 Revision を選べ、アーカイブ済み・最新でない
  Revision への変更は `script.save` で拒否される。
- 声だけの話者へ切り替えた行に `expressionId` が残らず、`line.add` の明示的な
  `expressionId` は拒否される。
- `tts.createBulk` / `tts.attachBulk` の順序を守った実行で、
  一括生成が1つの ScriptVersion に確定する。
- `render.start` の再送で二重レンダーにならない。
- レンダー成功時に MP4 Artifact の ID・尺・寸法を報告できる。
- `template.get` だけで、表・グラフ・フロー・効果・入れ子の入力 JSON を
  推測せずに組み立てられる。`schema.get` の応答サイズはほぼ変わらない。
- スキルとガイドに、声のプリフライト、MP4 の合格ライン、`preview.frame`
  が任意であること、一括TTSの順序が明記されている。
- `script.listVersions` で現在版と履歴を取得でき、`script.restore` で
  ContentDocument を再送せずに過去版を新しい版として復元できる。
- `script.restore` の同じ `requestId` 再送で版が増えず、異なる入力は
  `IDEMPOTENCY_CONFLICT` になる。
- `work.clone` が `parentWorkId` と `sourceScriptVersionId` を記録した子 Work を作る。
- `work.create` / `work.clone` のタイムアウト後、`work.list` の
  `createdAt` / `parentWorkId` で作成済みかを判断する手順がスキルとガイドにある。
- `npm run typecheck` と `npm test` が通る。

## 関連文書

- [findings.md](./findings.md): 調査結果と根拠
- [todo.md](./todo.md): 実装フェーズ
- [roadmap.md](./roadmap.md): 将来の拡張
- [Agent Access 仕様](../agent-access/spec.md)
- [エージェント新規作成の信頼性向上](../agent-new-work/spec.md)
- [制作スキル](../../skills/kakeai-production/SKILL.md)
- [ユーザーガイド: エージェント連携](../../user-guide/docs/agent-access.md)

## 実装状況

2026-10-25 時点。

- **P1: 完了。** `work.create` は指定 locale の初期 ContentDocument を作る
  （ja-JP 既定 / en-US 可）。声のプリフライトと MP4 の合格ラインをスキルと
  ガイドへ反映済み。
- **P2: 完了。** `job.list` の `kind`（`render` / `tts`）と `script.save` の
  基準版ガード / `sourceScriptVersionId` を実装済み。`work.create` の冪等化は
  `requestId` を追加せず、`work.list` で確認するガイド路線。
- **P3-1 入力契約の探索性: 完了。** `template.get` が VisualTemplate 1件の
  `inputSchema`（保存時検証と同じスキーマから導出）と検証済みの `example` を返す。
  `schema.get` の応答は増やさず、`schemaDigest` に `templateInputContracts` を
  含めた。
- **P3-2 視覚確認: 一部実装済み。** 保存版プレビュー
  （`preview.scriptFrame`）と素材プレビュー（`preview.assetFrame`）を追加した。
  下書きプレビューと複数フレームは将来項目として残している。契約・実測は
  [../visual-confirmation/spec.md](../visual-confirmation/spec.md) と
  [../visual-confirmation/spike.md](../visual-confirmation/spike.md) を正とする。
- **P4 制作履歴・復旧: 完了。** `script.listVersions` で Edition の版履歴と
  current を取得し、`script.restore` で過去版を新しい版として復元できるように
  した。`work.clone` は現在版から子 Work を作り、`parentWorkId` と
  `sourceScriptVersionId` を記録する。`WorkSummary` に `createdAt` /
  `parentWorkId`、`ScriptVersionSummary` に `sourceScriptVersionId` を追加し、
  `work.create` / `work.clone` のタイムアウト回復をスキルとガイドに固定した。
- **P5 ライブラリ読み取りと声の割り当て: 完了。** `theme.list` / `theme.get`、
  `faceSet.list` / `faceSet.get`、`voiceProfile.list` / `voiceProfile.get` を追加し、
  `speaker.add` / `speaker.setVoiceProfile` と `speakerId: { key }` 参照を
  操作コアへ追加した。新規作品は、対象 locale の既存 Voice Profile を割り当てた
  声だけの話者でも TTS できる。立ち絵が必要な場合だけ
  `character.addFromLibrary` を使う。Theme は最新公開 Revision だけを選択でき、
  ライブラリと Profile の削除は人専用のままである（Voice Profile の作成・更新は B11 で公開した）。
- **P6 サムネイル: 完了（任意の後工程）。** `thumbnail.listTemplates` /
  `thumbnail.list` / `thumbnail.get` / `thumbnail.appearance`、
  `thumbnail.create` / `thumbnail.update` / `thumbnail.setPrimary`、
  `preview.thumbnail` / `thumbnail.image` を公開した。MP4 の合格ラインは変えず、
  レンダー成功後に投稿用サムネイルを作り、PNG を取得できる。候補の削除、
  Work 共通 Appearance の保存、外観プリセットは人専用のままである
  （[Agent Access B13](../agent-access/roadmap.md)、[ADR 0098](../adr/0098-agent-thumbnail-operations.md)）。
