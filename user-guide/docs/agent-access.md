---
sidebar_position: 20
title: エージェント連携（MCP / CLI）
---

# エージェント連携（MCP / CLI）

Kakeai は、利用者自身のコーディングエージェントから作品を操作するための MCP（stdio）サーバーと CLI（`kakeai-agent`）を同梱しています。どちらも同じ操作コアへ接続する薄い束縛で、できることは同じです。エージェントは作品の作成・改名、台本の編集、素材の検索・取り込み、キャラクターの台本へのコピーと声の付け替え、Voice Profile の読み取り・作成・更新と話者への割り当て、Theme / Face Set の読み取り、設定済み TTS アダプターへの音声合成、Composition の作成・publish、レンダー投入、render 成果物の指定時刻の静止画の取得を行えます。実体の削除、外部サービスへの公開、Voice Profile の削除、Character の作成・外観変更・削除、Face Set・Theme の管理（作成・更新・削除）は公開していません。Kakeai が提供する生成は、利用者が設定した接続先だけを使います。

## 前提

- Kakeai アプリが同じユーザーで起動していること。MCP サーバーはアプリのローカル制御ソケットへ接続するだけで、アプリを自動起動しません。
- TTS を使う場合は、**対象 locale と完全一致する Voice Profile**（既存 Profile を声だけの話者へ割り当てる。無ければエージェントが声を選んで作成する）または**対象 locale の声を持つキャラクター**（声の無い既存キャラクターにはエージェントが声を付けられます）が必要です。どちらも無い場合、エージェントは TTS を開始せず停止します。立ち絵が必要で使えるキャラクターが無い場合は、キャラクターの新規作成を依頼します。
- TTS を使う場合は、利用者が設定した TTS エンジン（VOICEVOX / AivisSpeech / OpenAI 互換）が起動していること。事前確認の操作は無く、`TTS_ENGINE_UNAVAILABLE` で判明します。
- リポジトリで `npm install` が完了していること。
- 既定のソケットは `<データディレクトリ>/agent/agent.sock` です。データディレクトリを変えている場合は `KAKEAI_DATA_DIR` を設定してください。

## 起動

リポジトリ内の `node_modules/.bin/kakeai-mcp` を MCP サーバーのコマンドに指定します。

```json
{
  "mcpServers": {
    "kakeai": {
      "command": "/path/to/kakeai/node_modules/.bin/kakeai-mcp",
      "env": {
        "KAKEAI_AGENT_ID": "my-coding-agent"
      }
    }
  }
}
```

開発中は `npm run start --workspace @kakeai/mcp` でも起動できます。`kakeai-mcp --help` で引数を確認できます。

| 設定 | 意味 |
| --- | --- |
| `KAKEAI_DATA_DIR` / `--data-dir` | Kakeai のデータディレクトリ。既定は macOS なら `~/Library/Application Support/Kakeai` |
| `KAKEAI_SOCKET` / `--socket` | ソケットパスの明示指定。データディレクトリより優先 |
| `KAKEAI_AGENT_ID` / `--agent-id` | ハンドシェイクで送るエージェント識別子。既定は `mcp`。台本版の帰属に使われる |

stdout は MCP の通信専用です。ログは stderr に出るため、エージェント設定で stdout に混ぜないでください。

## ツール

最初に `kakeai_schema_get` を呼んでください。Content Schema の版、VisualTemplate の入力フィールドと制約、警告コード、全操作カタログ（読み取り／変更、Job を返すか）が返ります。

| 用途 | ツール |
| --- | --- |
| スキーマ確認 | `kakeai_schema_get` |
| テンプレート入力の形 | `kakeai_template_get`（1件の JSON Schema と入力例） |
| 作品 | `kakeai_work_list` / `kakeai_work_get` / `kakeai_work_create` / `kakeai_work_update` / `kakeai_work_clone` |
| 台本 | `kakeai_script_get` / `kakeai_script_list_versions` / `kakeai_script_validate` / `kakeai_script_save` / `kakeai_script_edit` / `kakeai_script_restore` |
| 素材 | `kakeai_asset_list`（検索・ページング） / `kakeai_asset_get` / `kakeai_asset_import` / `kakeai_asset_tag` |
| キャラクター | `kakeai_character_list` / `kakeai_character_get` |
| ライブラリ読み取り | `kakeai_theme_list` / `kakeai_theme_get` / `kakeai_face_set_list` / `kakeai_face_set_get` / `kakeai_voice_profile_list` / `kakeai_voice_profile_get` |
| 音声合成 | `kakeai_tts_create` / `kakeai_tts_create_bulk` / `kakeai_tts_attach_bulk` |
| Composition | `kakeai_composition_list` / `kakeai_composition_get` / `kakeai_composition_draft_get` / `kakeai_composition_authoring_context` / `kakeai_composition_create` / `kakeai_composition_draft_save` / `kakeai_composition_publish` |
| レンダー | `kakeai_render_start` |
| プレビュー | `kakeai_preview_script_frame`（保存版の指定時刻）/ `kakeai_preview_asset_frame`（素材）/ `kakeai_preview_frame`（render 成果物）。いずれも絵は image ブロックでも返る |
| Job | `kakeai_job_get` / `kakeai_job_list` / `kakeai_job_cancel` / `kakeai_job_wait` |

`kakeai_schema_get` の `agentOperations` が、公開されている全操作（読み取り／変更、Job を返すか）の正です。`kakeai_job_wait` は Job を待つための束縛の便宜ツールで、Agent 操作ではありません。

応答には契約の要約 `schemaDigest` と `operationDigest`、対応プロトコル版の `minProtocolVersion` と `protocolVersion` が入ります。`operationDigest` は操作の入力・出力スキーマの要約で、操作の形が変わると変わります。記録した値が変わったときは、キャッシュしたスキーマや ID を使わず `kakeai_schema_get` を取り直してください。任意フィールドの追加や列挙値の追加では版は上がらず、必須化や削除、意味を変えたときだけ `protocolVersion` が変わります。

表・グラフ・フロー・セリフ同期の効果・入れ子など、`kakeai_schema_get` の `inputFields` だけでは JSON の形が分からない入力は、`kakeai_template_get` に `{ "id": "...", "version": 1 }` を渡してください。`inputSchema`（保存時検証と同じスキーマから作った JSON Schema）と、そのまま使える `example` が返ります。`example` の `<assetId>` のような `<...>` は実在する ID に置き換えます。`schemaDigest` はテンプレート入力の変更でも変わるため、記録した値と違うときは取り直してください。

`kakeai_script_edit` は `baseScriptVersionId` が現在の版と一致している必要があります。`requestId` を付けると再送が冪等になります。

- `kakeai_job_list` は `kind`（既定は `render`）で `render` または `tts` の Job を選べます。`asset_ingest` は Work に紐づかないため指定できず、`kakeai_job_get` で確認します。
- `kakeai_script_save` は任意の `baseScriptVersionId`（基準版ガード）と `sourceScriptVersionId`（同一 Edition の復元元）を受け付けます。基準版を省略すると従来どおり last-write-wins です。
- `kakeai_work_create` は指定した `locale`（既定 `ja-JP`、`en-US` も可）で初期台本を作ります。

### 制作履歴・復元

- `kakeai_script_list_versions` は Edition の版履歴を新しい順に全件返します（Edition の版数は通常小さい想定です）。`currentScriptVersionId` と各版の要約（版番号・作成者・要求ID・復元元・作成日時）を含み、ContentDocument は含みません。過去版を選ぶときや、復元の基準版を決めるときに使います。
- `kakeai_script_restore` は過去版の `scriptVersionId` を指定して、その内容を新しい版として復元します。ContentDocument を取得して送り直す必要はありません。`requestId` は必須で、同じ ID・同じ復元元の再送は既存の版を返します。任意の `baseScriptVersionId` を渡すと、その版が current のときだけ復元し、一致しなければ `SCRIPT_BASE_STALE` になります。復元元が current の場合は `VALIDATION_ERROR` です。
- `kakeai_work_clone` は作品の現在版から子 Work を作ります。元の Work は変更せず、子には `parentWorkId` が付き、初期版には `sourceScriptVersionId` が記録されます。複製されるのは元の `originalLocale` の Edition の現在版だけで、他の言語版・版履歴・Job・サムネイルは複製しません。`requestId` はありません。タイムアウト後は `kakeai_work_list` で `parentWorkId`・`title`・`createdAt` を確認してから再実行してください。

### 冪等化（requestId）

`kakeai_tts_create` / `kakeai_tts_create_bulk` / `kakeai_render_start` / `kakeai_composition_publish` は、任意の `requestId` を受け付けます。同じ `requestId` と同じ入力で呼び直すと、Job や CompositionVersion を作らず、既存のものの現在の状態を返します。タイムアウト後の再送でも二重生成は起こりません。

- `requestId` は操作ごとに一意にしてください。同じ ID を別の入力で使うと `IDEMPOTENCY_CONFLICT` になります。
- 再送は「投入直後の状態」ではなく現在の状態を返します。終了済みの Job は `succeeded` で返ります。
- 同じ ID の処理が別で実行中の場合は `AGENT_IDEMPOTENCY_IN_PROGRESS` を返します。Job を待って結果を確認してください。
- 失敗した呼び出しは記録に残らないので、原因を直した同じ `requestId` で再実行できます。
- `composition.publish` の `dryRun` は副作用がないため記録されません。

台帳の鍵には接続時の `agentId` も含みます。識別子を送らないクライアントは `unknown` の枠を共有するため、衝突を避けるには `KAKEAI_AGENT_ID`（MCP）や `--agent-id`（CLI）で識別子を指定してください。

`kakeai_tts_attach_bulk` と `kakeai_script_restore` は台帳に載りません。`requestId` が必須で、`kakeai_script_edit` と同じ版単位の冪等になります。同じ `requestId` の再送は既存の版を返し、異なる内容での再利用は `IDEMPOTENCY_CONFLICT` になります。

`kakeai_work_create` / `kakeai_work_clone` / `kakeai_script_save` は operation の `requestId` を持たず、再送で Work や版が増える可能性があります。`AGENT_REQUEST_TIMEOUT` の後は、`kakeai_work_list`（作成済みの Work は `createdAt`、複製した子 Work は `parentWorkId` で確認）/ `kakeai_script_get` / `kakeai_script_list_versions` で変更が反映されたかを確認してから再実行してください。MCP/CLI の要求 ID は応答の対応づけ用で、再送の重複排除ではありません。

`kakeai_script_save` と `kakeai_script_restore` の `baseScriptVersionId` は任意です。省略すると last-write-wins、指定するとその版が current のときだけ保存・復元し、一致しなければ `SCRIPT_BASE_STALE` になります。

CLI も同じ入力を使います（例: `kakeai-agent render.start --input '{"scriptVersionId":"scr-123","requestId":"render-1"}'`）。

### 大量のリクエスト

短時間に大量の要求を送ると、接続内の未処理要求が上限に達し、要求の一部が `AGENT_BACKPRESSURE` で返ることがあります。接続は閉じられず、その要求だけが実行されませんでした。少し待ってから同じ要求を再送してください。必要なら要求を束ねて減らして送ります。

### 素材の検索

`kakeai_asset_list` は素材を検索し、`{ assets, nextCursor, total }` の 1 ページを返します。`total` は同じ絞り込み条件に一致する素材の総数です。

- `kind`・`status`（`ready` など）・`filename`（大文字小文字を区別しない部分一致）・`tags`・`favorite` を組み合わせられます。
- `tags` は `tagMode` で `and`（すべて含む、既定）と `or`（いずれかを含む）を明示します。タグは完全一致で、要素として照合します（`bgm` は `bgm_loop` に一致しません）。ASCII の英字は大文字小文字を区別しません（`Summer` は `summer` に一致します）。`%` と `_` は通常の文字で、タグ名に含めてもワイルドカードにはなりません。
- `hasAudio`（音声トラックの有無）と `durationMinMs` / `durationMaxMs`（長さの範囲）で絞り込めます。長さを持たない素材は範囲に一致しません。
- `archived` は既定で `exclude`（アーカイブ済みを除外）です。`include` / `only` は明示したときだけ使います。
- 返却順は `sort` で選べます（`createdAt_desc` が既定、`createdAt_asc`、`filename_asc`、`duration_asc`）。`limit` は既定 50、最大 100 です。`cursor` には前ページの `nextCursor` をそのまま渡します。カーソルは絞り込み条件と並び順ごとに意味を持つため、別の条件や別の `sort` へ流用しません（別の `sort` で使うと `VALIDATION_ERROR` になります）。

### TTS（音声合成）

TTS は、利用者が事前に設定したループバックの TTS アダプター（VOICEVOX / AivisSpeech / OpenAI 互換）へ合成 Job を投入する操作です。接続先・認証情報・アダプター設定の変更と Voice Profile の削除はエージェントから行えませんが、Voice Profile の作成・更新と話者への割り当てはできます（[声だけの話者](#声だけの話者)）。TTS 以外の生成アダプターは現時点でありません。画像などの生成はエージェント側の道具で行い、`kakeai_asset_import` で素材として取り込みます。Kakeai は生成サービスの認証情報を保持しません。

対象の話者に `voiceProfileId` が無い場合は TTS を開始しないでください。既存作品は `kakeai_script_get` の `speakers[]` と `kakeai_voice_profile_get` で有効な声を確認します。新規作品は `kakeai_voice_profile_list` で対象 locale と完全一致する Profile を探し、無ければ声候補から選んで作成します（[声だけの話者](#声だけの話者)）。立ち絵が必要な場合は、声を持つ既存キャラクターを選ぶか、声の無い既存キャラクターへ声を付けてからコピーします。使えるキャラクターが無い場合だけ、新規作成を依頼します（[キャラクター](#キャラクター)）。

1. 対象の台本を保存し、`scriptVersionId` を用意します。**一括生成から確定までは台本を書き換えないでください。**確定前に保存し直すと元の版が最新でなくなり、確定は `SCRIPT_BASE_STALE` で停止します。
2. 1 セリフなら `kakeai_tts_create`（`scriptVersionId` と `narrationSegmentId`、任意で `speechText` / `voiceId` / `speedScale`）を使います。`speedScale` の既定は 1.0、範囲は 0.5〜2.0 です。通常は `speechText` を省略し、保存済みの読み上げテキストを使います。上書きする場合は、添付前にセリフ側も同じテキストへ更新します。
3. 要点シーンで音声が未選択のセリフをまとめて生成するなら `kakeai_tts_create_bulk`（`scriptVersionId`）を使います。`requestId` は契約上は任意ですが、**確定には必須**なので必ず付けてください（付けない実行は確定できません）。応答の `jobs` にセリフごとの Job、`excluded` に生成できなかったセリフと理由が入ります。除外があっても他の生成は続きます。
4. 一括生成の確定は `kakeai_tts_attach_bulk`（`scriptVersionId`、元の `bulkRequestId`、添付自身の `requestId`）で行います。開始したときと**同じ binding・同じ `agentId`** で呼んでください。別の `agentId` では元の一括要求を見つけられず `RESOURCE_NOT_FOUND` になります。Job が1件でも未完了なら台本を変更せず `pending`（件数付き）を返すので、繰り返し呼んで待ちます。全 Job が終端状態になると成功分だけを一つの台本版へ添付して `finalized` を返します。100件以上の対応表を手で作る必要はありません。同じ `requestId` の再送は既存の版を返します。
5. `finalized` の `failures` に残った行は、新しい `bulkRequestId` で `kakeai_tts_create_bulk` を実行し直してから、もう一度確定します。対象の版は、返された新しい版（添付0件なら元の版）です。
6. 単体生成の添付は `kakeai_script_edit` の `line.assignTake`（`assetId` に `ttsResult.assetId`、`source: "tts"`）で行います。添付前に `kakeai_script_get` で最新の台本を読み直し、対象セグメントが残っていて、読み上げテキストが合成した内容と一致することを確認します。変わっていたら、その Take は使わずに生成し直します。

### 声だけの話者

台本の Speaker は、Character を持たない「声だけの話者」として作れます。立ち絵が不要なナレーションは、この経路が最も少ない往復で済みます。利用者名は「ナレーター（声だけの話者）」でもかまいません。

1. `kakeai_voice_profile_list` で、台本の `locale` と**完全一致**する `locale` を持つ Profile を選びます。`ja-JP` と `en-US` は別物で、`en` のような部分一致はしません。無ければ `kakeai_voice_profile_list_voices`（`adapterId`、OpenAI 互換の絞り込みには `kakeai_voice_profile_list_models` で選んだ `model`）で声候補を探し、`kakeai_voice_profile_create`（`name`・`adapterId`・`voiceId`・`locale`・`settings`。OpenAI 互換は `settings.model` が必須、参照音声を使う場合は `settings.refAudioAssetId`・`settings.refText`・`settings.langCode` も必須）で作成します。声を選び間違えたら `kakeai_voice_profile_update` で直せます（`adapterId` は変更できません）。
2. 1 回の `kakeai_script_edit` に `speaker.add` と `line.add` を入れます。`speaker.add` の `key` を `line.add` の `speakerId` で参照できます。

```json
{
  "baseScriptVersionId": "scr-003",
  "requestId": "edit-2026-10-25-1",
  "operations": [
    { "op": "speaker.add", "key": "speaker-1", "name": "ナレーション", "voiceProfileId": "vp-001" },
    { "op": "line.add", "sceneId": "scene-002", "speakerId": { "key": "speaker-1" }, "captionText": "最初の要点です。" }
  ]
}
```

3. 既存の話者へ声を割り当て直す場合は `speaker.setVoiceProfile` に `speakerId` と `voiceProfileId` を渡します。`voiceProfileId: null` で解除できます。`speakerId` は ID でも `{ "key": ... }` でもかまいません。

割り当ての規則は次のとおりです。

- Voice Profile は実在し、台本の `locale` と完全一致する必要があります。参照先が無い場合は `EDIT_TARGET_NOT_FOUND`、locale が違う場合は `EDIT_PRECONDITION_FAILED` です。
- Character を持つ話者は、その Character の同じ locale の声と一致する Profile しか設定できません。Character にその locale の声が無い場合は `null` への解除だけができます。Character に声がある場合は `null` にできません。不一致は `EDIT_PRECONDITION_FAILED` です。
- 声の変更は以後の TTS にだけ影響し、既存の Audio Take は変わりません。
- Voice Profile の削除は UI で人間が行います。エージェントは作成・更新と話者への割り当てができます。更新は以後の TTS にだけ影響し、既存の Audio Take は変わりません。

声だけの話者へ切り替えるときは `expressionId` を指定しないでください。`line.setSpeaker` は自動で消しますが、`line.add` は声だけの話者への明示的な `expressionId` を拒否し、`line.setExpression` も声だけの話者には指定できません。

`speaker.add` だけを行った `kakeai_script_edit` がタイムアウトした場合、同じ `requestId` の再送は版を増やしませんが `created` を返しません。`kakeai_script_get` で新しい版を読み、Speaker の ID を確認してください。

### キャラクター

`kakeai_character_list` / `kakeai_character_get` はキャラクターライブラリの読み取りを公開し、`kakeai_character_set_voices` で声（locale 別の Voice Profile 割り当て）の付け替えができます。キャラクターの作成・外観変更・削除はエージェントからは行えません。

立ち絵が必要な場合は、対象 locale の声を持つ Entry を選びます。使いたい Entry に声が無い場合は、先に `kakeai_character_set_voices`（`characterId` と `voices: [{ locale, voiceProfileId }]`。Profile は実在し `locale` が一致すること）で声を付けてからコピーします。声が無い Entry をそのままコピーすると `voiceProfileId: null` になり、その話者の TTS は `TTS_INPUT_INVALID` で失敗します。既存作品の話者に有効な `voiceProfileId` があれば、ライブラリから追加せずそのまま使えます。

台本へ入れるときは、`kakeai_script_edit` の操作 `character.addFromLibrary`（`libraryCharacterId`）で新しいローカル Character・Appearance・Speaker としてコピーします。結果の `created.characterIds` / `created.appearanceIds` / `created.speakerIds` を読み、次の `kakeai_script_edit` で `line.setSpeaker` と `standing.set` に使います。`character.addFromLibrary` は `key` を持たないため、同じ呼び出し内で `{ "key": ... }` として参照することはできません。

### Face Set

立ち絵の表情を切り替えるときは、`kakeai_character_get` の外観（`appearances[]`）から `faceSetId` を読み、`kakeai_face_set_get` で `expressions[].id` を確認して、`line.setExpression` に渡します。表情を使うのは Character を持つ話者の行です。声だけの話者には顔がないため使いません。Face Set の作成・更新・削除は UI で人間が行います。

### Theme

`kakeai_theme_list` は選択できる Theme と最新公開 Revision の `version` を返し、`kakeai_theme_get` はその定義を返します。選べる・取得できるのは一覧に載っている最新 Revision だけです。Theme Draft、アーカイブ済み Theme、最新でない Revision、フォント診断は返らず、取得すると `RESOURCE_NOT_FOUND` になります。

`document.setVisualTheme` で組み込み Theme の最新 Revision、またはアーカイブされていない利用者 Theme の最新 Revision を選びます。`kakeai_script_save` は、Theme の**変更**がアーカイブ済み・最新でない Revision を指す場合だけ拒否します。Theme を変えない保存は、その Theme がアーカイブ済みでも通ります。Theme の作成・更新・アーカイブ・削除は UI で人間が行います。

#### Web UI での表示

エージェントが作った声だけの話者は台本に保存され、TTS にもそのまま使えます。ただし現在の行情報の話者選択は Character を持つ話者だけを一覧するため、Web UI から声だけの話者を選び直すことはできません。声だけの話者から Character 付きの話者へ変更することはできます。声だけの話者への付け替えや声の変更は、エージェントの `speaker.setVoiceProfile` / `line.setSpeaker` で行ってください。

## 動画制作の流れとMP4の合格ライン

エージェントは、`schema.get` → 作品と台本 → 声のプリフライト → 素材 → 映像演出・BGM → TTS → 検証 → レンダーの順で進めます。MP4 の合格ラインは次の2つです。

1. `render` Job が `succeeded` になる。
2. `kakeai_job_get` の `artifacts` に `role: "render"` / `format: "mp4"` の Artifact が存在する。

エージェントは Artifact の ID・尺（`durationMs`）・寸法（`widthPx` / `heightPx`）を報告します。最終的な絵・音の確認、MP4 の取得、サムネイル、SRT 字幕、YouTube の投稿設定は人間が行います。`kakeai_preview_script_frame` / `kakeai_preview_asset_frame` / `kakeai_preview_frame` による静止画確認は任意の補助で、合格ラインには含みません。詳しい手順は [スキル](#スキル) の `kakeai-production` を参照してください。

## 長尺操作

`kakeai_asset_import`、`kakeai_render_start`、`kakeai_tts_create`、`kakeai_tts_create_bulk` は Job を投入してすぐ返ります。

1. `kakeai_asset_import` は `jobId` を返します（同じ内容の素材が既にあれば `null`）。
2. `kakeai_render_start` は `job` を返します。
3. `kakeai_tts_create` は `job` を、`kakeai_tts_create_bulk` は `jobs`（セリフごとの Job）と `excluded` を返します。`kakeai_tts_attach_bulk` は短時間の確定操作で、Job を待機しない代わりに `pending` / `finalized` と件数を返します。
4. `kakeai_job_wait` に Job ID を渡すと、終端状態までポーリングします。`timeoutMs` を超えた場合は `timedOut: true` と最後の Job を返すので、そのまま再度呼び出せます。一括生成のように複数の Job がある場合は、Job ID ごとに待つか `kakeai_job_get` で個別に確認します。
5. 個別に確認する場合は `kakeai_job_get`、作品内の一覧は `kakeai_job_list` を使います。`kind` で `render`（既定）と `tts` を選べます。`asset_ingest` は Work に紐づかないため `kakeai_job_list` の対象外で、`kakeai_job_get` で確認します。
6. TTS Job の ID を失った場合は、`kakeai_job_list` に `{ "workId": "...", "kind": "tts" }` を渡して再発見します。ただし `requestId` なしで開始した一括生成は、Job を見つけても確定できません。

## CLI（kakeai-agent）

MCP の代わりに、同じ操作をシェルから実行できます。接続先・検証・エラーコードは MCP と共通で、操作名は MCP ツール名ではなく正規の `domain.verb` です。

リポジトリで `npm install` した後、`node_modules/.bin/kakeai-agent` を使います。開発中は `npm run start --workspace @kakeai/cli -- schema.get` でも実行できます。

```sh
kakeai-agent schema.get
kakeai-agent work.create --input '{"title":"新しい作品"}'
kakeai-agent work.update --input '{"workId":"work-123","title":"改訂版の作品名"}'
kakeai-agent work.create --input input.json
echo '{"title":"標準入力から"}' | kakeai-agent work.create --input -
kakeai-agent job.get --input '{"jobId":"job-123"}'
kakeai-agent operations --pretty
kakeai-agent --help
```

| MCP ツール | CLI |
| --- | --- |
| `kakeai_schema_get` | `kakeai-agent schema.get` |
| `kakeai_template_get` | `kakeai-agent template.get --input '{"id":"table.simple","version":1}'` |
| `kakeai_work_create` | `kakeai-agent work.create --input ...` |
| `kakeai_work_update` | `kakeai-agent work.update --input ...` |
| `kakeai_script_edit` | `kakeai-agent script.edit --input ...` |
| `kakeai_asset_list` | `kakeai-agent asset.list --input '{"tags":["bgm"],"status":"ready"}'` |
| `kakeai_asset_import` | `kakeai-agent asset.import --input ...` |
| `kakeai_character_list` | `kakeai-agent character.list` |
| `kakeai_character_set_voices` | `kakeai-agent character.setVoices --input ...` |
| `kakeai_voice_profile_list` | `kakeai-agent voiceProfile.list` |
| `kakeai_voice_profile_list_voices` | `kakeai-agent voiceProfile.listVoices --input '{"adapterId":"voicevox"}'` |
| `kakeai_voice_profile_list_models` | `kakeai-agent voiceProfile.listModels --input '{"adapterId":"openai-compatible"}'` |
| `kakeai_voice_profile_create` | `kakeai-agent voiceProfile.create --input ...` |
| `kakeai_voice_profile_update` | `kakeai-agent voiceProfile.update --input ...` |
| `kakeai_theme_list` | `kakeai-agent theme.list` |
| `kakeai_face_set_list` | `kakeai-agent faceSet.list` |
| `kakeai_tts_create` | `kakeai-agent tts.create --input ...` |
| `kakeai_tts_create_bulk` | `kakeai-agent tts.createBulk --input ...` |
| `kakeai_tts_attach_bulk` | `kakeai-agent tts.attachBulk --input ...` |
| `kakeai_render_start` | `kakeai-agent render.start --input ...` |
| `kakeai_preview_script_frame` | `kakeai-agent preview.scriptFrame --input ... [--out ...]` |
| `kakeai_preview_asset_frame` | `kakeai-agent preview.assetFrame --input ... [--out ...]` |
| `kakeai_preview_frame` | `kakeai-agent preview.frame --input ... [--out ...]` |
| `kakeai_job_wait` | `kakeai-agent job.wait <jobId>` |

MCP ツール名は `kakeai_<domain>_<verb>` の snake_case、CLI のサブコマンドは正規の `domain.verb` です。`createBulk` や `authoringContext` のように語が複数ある操作では機械的な読み替えが一致しないため、`kakeai-agent operations` か `schema.get` の `agentOperations` で正規名を確認してください。同じ操作・同じ入力なら、CLI の stdout JSON は MCP の `structuredContent` と一致します（画像を返す操作の `--out` 指定時を除く。`--out` 指定時は画像がファイルに書かれ、stdout JSON は `pngBase64` / `imageBase64` の代わりに `path` を含みます）。

### レンダー前のプレビュー（`preview.scriptFrame` / `preview.assetFrame`）

レンダーする前に、保存済みの台本版や素材の絵を確認できます。これは任意の補助で、MP4 の合格ラインには含まれません。最終的な絵・音の判断は人間が行います。

```sh
# 保存版の 5 秒時点を PNG で確認する
kakeai-agent preview.scriptFrame --input '{"scriptVersionId":"scr-123","timeMs":5000}' --out script-frame.png

# 素材（画像は原本、動画は指定時刻の PNG）を確認する
kakeai-agent preview.assetFrame --input '{"assetId":"ast-123","timeMs":1500}' --out asset-frame.png
```

- `preview.scriptFrame` は `script.get` / `script.edit` が返す `scriptVersionId` と、`script.validate` の解決済み `timeline` から時刻を選びます。シーンの開始直後はトランジション中なので、開始から 500ms ほど後にすると構図を確認しやすくなります。
- 文字切れ、要素の重なり、画像の欠落、表の見切れ、立ち絵の位置を確認します。問題があれば `script.edit` で直し、新しい版で再度プレビューします。
- `preview.assetFrame` の画像は保存されている画像そのもの（正規化された画像があればそれ）で、`mimeType` が実際の形式です。動画は指定時刻の PNG、音声は `VALIDATION_ERROR` になります。画像に `timeMs` は指定できません。MCP の image ブロックは PNG / JPEG の素材だけに付き、WebP / GIF / BMP / AVIF は `structuredContent` または CLI の `--out` で取得します。
- `preview.scriptFrame` は台本版・Job・Artifact を作りません。読み取り操作です。
- 画像プレビューの読み取りタイムアウトは最大 30 秒です。タイムアウトした場合は同じ入力で 1 回だけ再送し、それでもだめならレンダーに進んで人間に確認を返します。プレビューは構図確認用で、色・動き・音の最終判断には代わりません。

### 静止画の取得（`preview.frame`）

render が完了した成果物の指定時刻の絵を、原寸 PNG で確認できます。`artifactId` は `job.get` の `artifacts` で取得します。これは任意の補助で、MP4 の合格ラインには含まれません。最終的な絵・音の判断は人間が行います。

```sh
# JSON で受け取る（pngBase64 に原寸 PNG の base64 が入る）
kakeai-agent preview.frame --input '{"artifactId":"art-123","timeMs":1500}'

# PNG ファイルに書き出す（stdout は pngBase64 なしのメタ情報 + path）
kakeai-agent preview.frame --input '{"artifactId":"art-123","timeMs":1500}' --out frame.png
```

- `timeMs` はミリ秒で、`artifact` の確定尺を超えると `VALIDATION_ERROR` になります。
- 応答の `resolvedTimeMs` が実際に抜いた時刻、`width`・`height` が原寸の寸法です。指定時刻直前のフレームに丸められるため、`resolvedTimeMs` が `timeMs` より少し前になることがあります。
- 対象は render の MP4 成果物だけです。字幕などの成果物を指定すると `VALIDATION_ERROR` になります。
- 初回はサーバー側のフレーム走査が入るため、長尺の動画では `AGENT_REQUEST_TIMEOUT` になることがあります。その場合は同じ入力でもう一度呼び直してください（2回目はキャッシュが効きます）。

### `--input` と共通オプション

`--input` はインライン JSON、ファイルパス、`-`（標準入力）を受け付けます。省略すると `{}` として扱います。入力は送信前に契約スキーマで検証され、応答も検証されてから出力されます。`--pretty` は出力 JSON をインデントします。

| 設定 | 意味 |
| --- | --- |
| `--agent-id` | ハンドシェイクで送るエージェント識別子。既定は `cli`。`KAKEAI_AGENT_ID` でも指定できる |
| `--data-dir` / `KAKEAI_DATA_DIR` | Kakeai のデータディレクトリ |
| `--socket` / `KAKEAI_SOCKET` | ソケットパスの明示指定。データディレクトリより優先 |
| `--timeout` | 1 要求のタイムアウト（ミリ秒）。読み取り・変更の両方に適用 |

### 長尺操作

```sh
# jobId を取得してから待つ
job_id=$(kakeai-agent asset.import --input '{"path":"/path/to/image.png"}' | jq -r .jobId)
kakeai-agent job.wait "$job_id" --timeout-ms 60000 --interval-ms 500

# 操作結果を受け取ったまま待つ
kakeai-agent render.start --input '{"scriptVersionId":"scr-123"}' --wait
kakeai-agent tts.create --input '{"scriptVersionId":"scr-123","narrationSegmentId":"line-1"}' --wait

# 一括生成は複数 Job を返すため、--wait は wait: null になる
kakeai-agent tts.createBulk --input '{"scriptVersionId":"scr-123"}'
```

`job.wait` は `{ job, timedOut, polls }` を、`--wait` は操作結果を `{ result, wait }` に包んで返します。どちらも MCP の `kakeai_job_wait` と同じ有界ポーリングで、予算を超えた場合は失敗ではなく `timedOut: true` と最後の Job を返します。`--wait` で Job が投入されなかった場合（同じ内容の素材が既にある場合）と、`tts.createBulk` のように複数 Job を投入した場合は `wait: null` です。後者は `job.wait <jobId>` を Job ごとに実行するか、`job.get` で確認します。待ち時間の既定は 60000 ミリ秒、ポーリング間隔は 500 ミリ秒です。

### 終了コードとエラー

- `0`: 成功（`--help`、`--version`、`operations` を含む）
- `1`: 操作または検証の失敗。stderr に `{ "code": "...", "issues": [...] }` を 1 行で出力する。`--out` の書込み失敗もここに含む（`CLI_OUTPUT_ERROR`）
- `2`: 使い方または `--input` の誤り（`CLI_USAGE_ERROR` / `CLI_INPUT_ERROR`）

stdout は常にコマンド出力専用で、失敗時は空です。スタックトレースは出力しません。

## スキル

Kakeai は、エージェントが制作手順をたどるためのスキル（手順書）をリポジトリで配布しています。どちらも MCP / CLI の同じ Agent Access 操作だけを使い、HTTP API・ソケット・Prisma を直接使いません。

| スキル | 内容 |
| --- | --- |
| [`skills/kakeai-production/`](https://github.com/shipwebdotjp/kakeai/tree/main/skills/kakeai-production) | 1 本の動画を作る横断手順。`schema.get` → 作品と台本 → キャラクター → 素材 → 映像演出・立ち絵・BGM → TTS → 検証 → レンダー、および再送・古い基準版の扱い |
| [`skills/kakeai-composition/`](https://github.com/shipwebdotjp/kakeai/tree/main/skills/kakeai-composition) | 再利用する Composition の draft 作成・QA・publish と、台本からの参照 |

`kakeai-production` には、声のプリフライト（`voiceProfile.list`、無ければ `voiceProfile.listVoices` で声を選んで `voiceProfile.create` で作成）、声だけの話者の作り方（`speaker.add` + `line.add`）、既存話者への声の割り当て（`speaker.setVoiceProfile`）、Face Set / Theme の読み取り、一括TTSの順序（`requestId`、同じ `agentId`、確定までの台本保存禁止）、MP4の合格ライン（render Job 成功 + MP4 Artifact）が含まれます。

スキルは、Kakeai リポジトリの GitHub Release と対になる不変タグ `vMAJOR.MINOR.PATCH` からのみ導入します。`main` からは導入しません。タグは Kakeai アプリとスキルの共通バージョンです。どのタグでどの操作が必要かは [スキル互換性履歴](https://github.com/shipwebdotjp/kakeai/blob/main/docs/agent-access/skill-compatibility.md) に記録しています。

### プロジェクトへ導入する

```sh
npx skills@1.7.4 add shipwebdotjp/kakeai#v0.1.0 \
  --skill kakeai-production --skill kakeai-composition
```

エージェントの選択を聞かれたら、利用するエージェントを選びます。`skills-lock.json` が作られ、`.agents/skills/` にスキルの実体が置かれます。共有ワークスペースでは `skills-lock.json` をコミットし、`.agents/` は再生成対象として `.gitignore` に入れます。

### すべてのプロジェクトで使う

```sh
npx skills@1.7.4 add shipwebdotjp/kakeai#v0.1.0 \
  --skill kakeai-production --skill kakeai-composition -g
```

グローバル導入は `skills-lock.json` を作りません。更新は、同じ `-g` 付きの `add` を新しいタグで再実行します。

### 新しいタグへ更新する

```sh
npx skills@1.7.4 add shipwebdotjp/kakeai#v0.1.1 \
  --skill kakeai-production --skill kakeai-composition
```

`npx skills update` は使いません。`update` はロックに記録された ref を追うだけで、Kakeai の新しいタグへは進みません。更新は必ず新しいタグを指定して `add` を再実行し、`skills-lock.json` の `ref` が新しいタグに変わったことを確認してコミットします。スキルと Kakeai アプリは同じタグに揃えてください。

### ロックから復元する

```sh
npx skills@1.7.4 experimental_install
```

`skills@1.7.4` では、ロックからの復元コマンド名が `experimental_install` です（`install` というコマンドはありません）。`skills-lock.json` の `ref` が指す不変タグから `.agents/skills/` を再生成します。clone 直後や `.agents/` を削除した後に実行します。

:::note[エージェント固有のリンク]
`experimental_install` が復元するのは `.agents/skills/` です。`.claude/skills/` などエージェント固有のディレクトリにもリンクが必要な場合は、同じタグを指定して `add` を再実行してください。
:::

スキルは `schema.get` を正とし、テンプレート契約や操作の JSON スキーマを複製しません。操作の入力は MCP の `inputSchema` または CLI の検証に従います。

## エラー

ツールの失敗は `isError: true` と JSON `{ "code": "...", "issues": [...] }` で返ります。主なコードは次のとおりです。

| code | 意味 |
| --- | --- |
| `AGENT_APP_UNAVAILABLE` | Kakeai が起動していない、またはソケットに接続できない |
| `AGENT_PROTOCOL_MISMATCH` | ソケットのプロトコル版が一致しない |
| `AGENT_OPERATION_UNKNOWN` | 操作名が未登録。`schema.get` / `operations` で正規名を確認する |
| `AGENT_REQUEST_TIMEOUT` | 操作がタイムアウトした。`script.edit`・`script.restore`・`kakeai_tts_attach_bulk` は同じ `requestId` で再送してよい（既存の版が返る）。`tts.create` / `tts.createBulk` / `render.start` / `composition.publish` も任意の `requestId` を付けて再送すると既存の Job／Version が返る。`work.create` / `work.clone` / `script.save` は operation の `requestId` を持たないため、`work.list`（`createdAt` / `parentWorkId`）/ `script.get` / `script.listVersions` で反映を確認してから再実行する。それ以外の変更操作は `script.get`・`job.list`・`asset.list` などで結果を確認してから再実行する |
| `SCRIPT_BASE_STALE` | `baseScriptVersionId` が現在の版と異なる。`kakeai_script_get` で取り直し、同じ意図を適用し直す。`kakeai_tts_attach_bulk` では一括生成の後に台本を保存した場合、`kakeai_script_save` / `kakeai_script_restore` では基準版ガードに指定した版が古い場合に返る |
| `IDEMPOTENCY_CONFLICT` | 同じ `requestId` を異なる内容で使った。既存の版を確認し、同じ ID を別内容で再利用しない |
| `AGENT_IDEMPOTENCY_IN_PROGRESS` | 同じ `requestId` の処理が実行中で、待機時間内に完了しなかった。実行中の Job を `kakeai_job_get` / `kakeai_job_wait` で確認する |
| `AGENT_BACKPRESSURE` | 短時間に多すぎる要求を送り、接続内の未処理要求が上限を超えた。接続は閉じられない。しばらく待ってから再送する |
| `VALIDATION_ERROR` | 入力または保存内容がスキーマに適合しない。`issues` を確認する |
| `EDIT_TARGET_NOT_FOUND` など `EDIT_*` | 台本操作の対象や前提が成立しない。Speaker・Voice Profile の参照欠落、声の locale 不一致、Character Voice との不一致、選択できない Theme Revision もここに含む |
| `ASSET_UNAVAILABLE` | 参照する素材が `ready` でない、または欠損している |
| `COMPOSITION_UNAVAILABLE` | 参照する CompositionVersion が未 publish、または bundle が欠損している |
| `TTS_INPUT_INVALID` | 読み上げテキストが空、話者・声が未設定、設定済みアダプター外の声など |
| `TTS_ENGINE_UNAVAILABLE` | 設定済みの TTS アダプターへ接続できない。利用者にエンジンの起動を依頼する |
| `RESOURCE_NOT_FOUND` / `WORK_NOT_FOUND` | 参照する台本版・セリフ・素材・作品が存在しない。別の `agentId` で呼んだ `kakeai_tts_attach_bulk` や、`requestId` なしで開始した一括生成の確定もここに含む |
| `JOB_NOT_CANCELLABLE` | queued 以外の Job は取り消せない。実行中の Job は待つ |
| `RENDER_FAILED` / `RENDER_INPUT_INVALID` | レンダーが失敗した。`job.error` を確認し、素材・尺・テンプレート入力を直す。同じ入力で無限に再試行しない |
| `MCP_TOOL_UNKNOWN` | ツール名が存在しない |
| `MCP_INTERNAL_ERROR` | MCP 側の想定外の失敗。詳細は返らない |

`failed` な Job の理由は `job.error` に、レンダー・取り込み・TTS の安定コードとして入ります。
