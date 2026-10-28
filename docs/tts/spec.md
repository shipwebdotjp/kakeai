# TTS（ローカルTTSアダプター）仕様

## 目的と境界

この文書は、Kakeai が別途起動したローカル TTS エンジンへ接続し、`NarrationSegment` ごとに音声 Take を生成する機能の正とする。ContentDocument の構造は [../mvp/content-schema.md](../mvp/content-schema.md)、HTTP 契約は [../mvp/api-contract.md](../mvp/api-contract.md)、DB モデルと Job 状態遷移は [../mvp/spec.md](../mvp/spec.md) を正とし、この文書はそれらへの TTS 固有の追加を定める。

- アプリ内へ音声モデルを組み込まない。TTS エンジンの起動・停止・同梱・更新は Kakeai の責務に含めない。
- 複数のローカル TTS エンジンを同時に利用できる。VOICEVOX ENGINE と AivisSpeech Engine、および OpenAI 互換 API を話す TTS サーバーを対象とする。VOICEVOX/AivisSpeech では通常話者のみとし、歌唱、モーフィング、辞書編集、音高・抑揚・音量の調整、Aivis Cloud API は含めない。
- 別言語の声には全く別の基盤（別プロトコル・別方式のエンジン）が必要になるため、アダプターは登録式の基盤とする（[ADR-0051](../adr/0051-tts-adapter-registry-v2.md)）。対象は別のローカルTTSエンジン（ループバック・認証なし）までとする。
- TTS は利用者の明示的な生成操作だけで実行する。自動生成・自動保存・既存 ScriptVersion の書換えは行わない。生成した音声は通常の手動音声と同じ Audio Take 候補として編集フォームへ追加し、明示保存でだけ ScriptVersion へ入る。
- エンジン本体の利用表記と、選択した音声モデル／ライブラリの個別規約の確認は利用者の責任とし、UI とユーザーガイドで案内する。AivisSpeech 本体のクレジット表記は必須ではないが、音声モデルごとにライセンス確認が必要である。

## ContentDocument v3

`Speaker` は必須の `voiceProfileId: string | null` を持ち、ContentDocument の `schemaVersion` は `1` である。`voiceProfileId` はアプリ共通の Voice Profile を参照し、`null` は TTS に使う声が未設定であることを表す。JSON ではこのキーを省略しない。

- アダプター固有の値（VOICEVOX のキャラクター UUID やスタイル ID）は Voice Profile 側にだけ保持し、ContentDocument へ持ち込まない。
- v3 は [ContentDocument v3](../mvp/content-schema.md) と [複合ビジュアル](../composite-visuals/spec.md) を正とする。保存済み `ScriptVersion` が無い前提のため、v1/v2 の読出し正規化や移行コードは持たない。

## Voice Profile

Voice Profile はアプリ共通の声の設定であり、作品台本（`Speaker`）から ID で参照する。

- 表示名、アダプター ID、アダプター定義の不透明な声 ID（`voiceId`）、言語（`locale`）、アダプター固有の追加設定、作成・更新日時を持つ。
- `adapterId` は登録済みアダプター記述子の ID で、作成後は不変とする。アダプターを変えたい場合は新規 Profile を作成し、キャラクター／話者を付け替える。
- `locale` は選択した声の申告 locale（アダプターの一覧の `locale` またはアダプター記述子の既定）から導出・検証する。キャラクターの言語別割り当て（[../multilingual-voice/spec.md](../multilingual-voice/spec.md)）に使う。
- `voicevox` と `aivisspeech` の `voiceId` は `{speakerUuid}:{styleId}` の形で話者とスタイルを畳む。追加設定は持たない。
- `openai-compatible` の追加設定は `{ model, refAudioAssetId?, refText?, langCode?, maxTokens? }` とする。参照音声を使う場合（参照クローン）は `refAudioAssetId`・`langCode` が必須で、`maxTokens` は任意（省略時は 4096 を送る）。`refText` を付けると ICL 方式（参照テキストも条件に使う・高精度）、省略すると x-vector 方式（話者埋め込みのみ・参照言語に引っ張られにくい）になる。`refAudioAssetId` は音声 Asset の参照であり、作成・更新時に実在・音声・ready を検証する。参照中の Asset は未参照素材の清掃・個別削除から保護する（`ASSET_IN_USE`）。
- 変更は将来の生成だけに効く。既に生成済みの Asset と Job スナップショットは変えない。
- Agent Access では、Voice Profile の一覧・取得・声候補・モデル候補（`voiceProfile.list` / `voiceProfile.get` / `voiceProfile.listVoices` / `voiceProfile.listModels`）と作成・更新（`voiceProfile.create` / `voiceProfile.update`）を公開し、利用者が用意した既存 Profile またはエージェントが作った Profile を `speaker.add` / `speaker.setVoiceProfile` で Speaker に割り当てられる。割り当ては新しい Script Version を作る可逆な変更であり、以後の生成にだけ影響する。既存の Audio Take は変えない。Profile の削除は人専用のままである（[Agent Access 仕様](../agent-access/spec.md)、[ADR 0088](../adr/0088-agent-voice-profile-writes.md)）。
- Voice Profile を参照する ScriptVersion が存在する間は削除を拒否する。
- Profile を参照する Speaker を持たない台本、または参照先 Profile が欠けた台本は保存できる。生成時にだけ「未設定」として拒否する。

## TTS アダプター

音声の一覧取得と合成をアダプター境界で抽象化する。アダプター記述子（`packages/contracts`）を唯一の定義場所とし、ID・表示名・設定スキーマ・接続設定・既定 locale・声の選択方式（`voiceSelection`: `list` / `list-or-manual`）・モデル選択の要否（`modelSelection`）を持たせる。アプリが知る境界は「声の一覧を取る」と「テキスト＋声＋話速を送ると音声が返る」の2つだけで、エンジン内部の生成方式は不透明とする。

- 登録済みアダプターは `voicevox`、`aivisspeech`、`openai-compatible` の 3 つとする。各 Profile と Job は `adapterId` から記述子と接続先を解決する。
- 一覧: アダプター定義の選択肢（`voiceId`・表示名・任意の申告 `locale`）を返す。VOICEVOX 互換エンジンは `GET /speakers` の話者×スタイルを1声ずつへ畳み、`GET /version` からエンジン版を得る。
- 合成: 不透明な `voiceId`・テキスト・話速・アダプター固有 settings を渡して WAV バイト列を得る。VOICEVOX 互換の合成手順（`audio_query` の `speedScale` 上書き、`synthesis`）は共有実装に閉じ込め、AivisSpeech の AudioQuery 互換差分（`intonationScale`・`tempoDynamicsScale`・アクセント句・`kana` など）には汎用的な編集を持ち込まない。
- 接続失敗（未起動を含む）とエンジンの入力拒否（4xx）と合成失敗を、別々の安定したエラーコードへ分類する。外部 HTTP エラーの本文は API レスポンスへ漏らさない。
- 接続先はアダプター記述子の環境変数で設定する。既定と変数は次のとおり。
  - `KAKEAI_VOICEVOX_BASE_URL`: 既定 `http://127.0.0.1:50021`
  - `KAKEAI_AIVISSPEECH_BASE_URL`: 既定 `http://127.0.0.1:10101`
  - `KAKEAI_OPENAI_TTS_BASE_URL`: 既定 `http://127.0.0.1:8899`
- いずれも HTTP かつループバックのみを受け入れ、認証情報・パス・クエリ・フラグメントを拒否する。起動時に検証し、不正なら起動を失敗させる。
- エンジンの声はモデルの追加・削除で変わり得るため、生成前に毎回実行中エンジンの一覧で Profile の声を検証する。ただし `voiceSelection` が `list-or-manual` のアダプターは、一覧に無い声でも生成要求を受け付ける。

### OpenAI 互換アダプター

OpenAI 互換 API を話すローカル TTS サーバー（mlx-audio-server など）に接続する。アダプター固有 settings に必須の `model` を持ち、`voiceId` はサーバーが解釈する声名（例: `af_heart`）とする。

- モデル一覧: `GET /v1/models` からモデル候補を得る。取得できない場合は空を返す。
- 声の一覧: `GET /v1/audio/voices?model=<model>` を試し、`{ data: [{ id, name }] }` があれば声候補とする。OpenAI 仕様に標準の声一覧が無いため、取得できなければ空を返し、利用者の手入力に委ねる（`voiceSelection: "list-or-manual"`）。
- 合成: `POST /v1/audio/speech` に `{ model, input, voice, response_format: "wav", speed }` を送り、WAV バイト列を得る。接続失敗は `TTS_ENGINE_UNAVAILABLE`、4xx は `TTS_INPUT_REJECTED`、その他は `TTS_SYNTHESIS_FAILED` に対応する。
- `defaultLocale` を持たない（`null`）ため、Profile の `locale` は利用者が選ぶ。

### 参照音声（Qwen3-TTS など）

プリセット話者名ではなく、参照音声を条件に毎回生成する方式に対応する。声の定義は参照音声 Asset・言語コードの組であり、参照テキストを付けると ICL 方式になる。ContentDocument や Job スナップショットにファイルを持ち込まず、Asset 参照で表す。

- 判別: Profile の settings に `refAudioAssetId` がある場合だけ参照クローン方式とし、無い場合は従来のプリセット方式とする。同じアダプター内で両方式を共存させる。参照テキストの有無で ICL 方式と x-vector 方式を切り替える。クロスリンガル（参照と出力の言語が異なる場合）は参照テキストの言語に引っ張られるため、`ref_text` を省略した x-vector 方式（話者埋め込みのみ・精度は落ちる）を選べる。
- 参照音声の管理: 利用者が WAV を素材として取り込み（Asset 化）、Profile の `refAudioAssetId` に指定する。`ref_audio` に渡す絶対パスは保存せず、Job 実行時に Asset の `storageKey` から解決する。参照中の Asset は `voice_profile` 参照として削除を拒否し（409 `ASSET_IN_USE`）、未参照素材の清掃でも残る。Profile の削除・差し替えで参照が外れた Asset は、次回の清掃で削除対象になる。
- 合成: `POST /v1/audio/speech` に `{ model, input, ref_audio, lang_code, max_tokens?, response_format: "wav" }` を送り、`refText` がある場合だけ `ref_text` を加える。`voice` と `speed` は送らない（Qwen3-TTS の参照クローン経路では無効であり、`voice` を送るとバッチ判定が変わるため）。`maxTokens` は省略時に 4096 を送る（サーバー既定の 1200 で長文が切れるのを避ける）。
- `ref_audio` に渡すパスは拡張子付きでなければならない。エンジン側（miniaudio）は拡張子だけで形式を判定し、拡張子のない Asset ストアパスは内容が正常でも `unsupported file format` で失敗する。worker は tmp に拡張子付きのハードリンク（失敗時はコピー）を用意して渡し、利用後に削除する。miniaudio が直接読めない形式（m4a/aac/webm など）は WAV（PCM）へ変換した実体を渡す。
- 言語コードは Qwen3-TTS の表記（`Japanese`・`English`・`Chinese`・`Korean`・`German`・`French`・`Russian`・`Portuguese`・`Spanish`・`Italian`）を使い、Profile では選択式とする。
- 合成要求のタイムアウトは参照クローン方式の初回ロード・参照エンコード・長文生成に合わせて 180 秒とし、一覧取得の 30 秒とは分ける。
- `refAudioAssetId` の解決失敗（Asset なし・ファイルなし）はエンジンへ送らず、Job 実行中の `TTS_INPUT_REJECTED` とする。

## TTS Job

1 Narration Segment につき 1 つの `tts` Job を実行する。

Agent Access（ローカルソケット / MCP / CLI）も、利用者が設定済みの Adapter への合成 Job 投入として同じ `tts` Job を扱う（[ADR 0077](../adr/0077-agent-tts-on-configured-adapters.md)、[Agent Access 仕様](../agent-access/spec.md)）。入力・出力・エラーコードはこの文書の契約を共有し、Job の状態は `job.get`、Take の反映は `script.edit` の `line.assignTake` で行う。

- Job は台本版、Segment ID、凍結した `speechText`、Voice Profile から解決した `voice`（不透明な `voiceId`）、`adapterId`、アダプター固有 settings、話速、エンジン版を入力スナップショットへ保持する。`speechText` は生成要求で直接渡せる（省略時は保存済みセグメントの値）。これにより未保存の編集内容でも生成でき、生成後に明示保存すると1つの版にまとまる。空文字・長すぎるテキストは 422 `TTS_INPUT_INVALID` とする。台本版の ID と Work・LanguageEdition を Job の対象として持つ。
- 生成成功時は WAV を `origin: "generated"` の `ready` な Audio Asset として確定する。SHA-256 が一致する既存 Asset があればその Asset を再利用し、新しい行・ファイルを作らない。
- Asset の `originalFilename` は `tts-<adapterId>-<話者名>-<声名>[-<話速>x]-<narrationSegmentId>.wav` とする。話速は 1.0 以外のときだけ付ける。名前に使えない文字は `_` に置換し、空なら `speakerId` / `voiceId` へフォールバックする。再利用時は最初の生成時の名前を保持する。
- 来歴にはアダプター、`voiceId`、話速、エンジン版、元 ScriptVersion と Segment を保存する。
- Job 結果は生成済み Audio Take 候補（`narrationSegmentId`、`assetId`、`durationMs`、`source: "tts"`）を返す。UI はこれを編集フォームへ Take として追加し、自動選択して未保存状態にする。
- 個別生成の成功時だけ、追加・選択した Take の再生を1回開始する。再生がブラウザに拒否・失敗された場合は通常の再生エラー表示に切り替え、生成結果自体は保持する。
- 生成済み音声は通常の Take と同様に切替・選択解除・削除できる。

## 一括生成

要点シーンで音声が未選択のセリフをまとめて生成できる。1 セリフにつき 1 つの `tts` Job を作る点は個別生成と同じで、入力検証・Voice Profile 解決・Job スナップショット生成も同じ処理を使う。Asset 再利用と単一 worker の逐次処理はそのまま適用する。

- 対象は保存済み `ScriptVersion` の要点シーン（`scene.kind === "point"`）のセリフのうち、`selectedAudioTakeId` が `null` のものとする。未選択の既存 Take があっても対象に含める。
- 各セリフは話者の Voice Profile の声と話速 1.0 倍を使う。一括生成のためのセリフ別声・話速は保存しない。
- 保存済み台本だけを対象とする。未保存の編集内容は一括生成へ渡さない。
- 話者未設定、声プロファイル未設定、空の読み上げテキスト、話速・スタイル不正、エンジン接続不能などで Job を作れないセリフは、そのセリフだけを除外理由つきで返し、他のセリフの生成は続行する。接続不能もセリフ単位の除外として扱い、全体を失敗させない。
- 応答はキューへ投入した Job（`narrationSegmentId` と Job DTO の組）と、除外したセリフ ID・安全な理由（エラーコードとメッセージ）を返す。外部 HTTP エラーの本文は含めない。
- Job 実行中の失敗は個別生成と同じく `GET /jobs/:jobId` の `status: failed` で伝える。
- 成功した Job ごとに Take を編集フォームへ追加する。追加後の選択は、そのセリフに利用者が既に選択した Take を上書きしない。一括生成の Take は自動再生しない。
- 一括生成の結果は通常の明示保存まで `ScriptVersion` に入らない。未保存変更または生成中は一括生成を開始できず、保存を促す。生成中は保存と個別生成を無効化し、フォームのリセットで結果が失われないようにする。
- 結果の表示は成功・対象外・失敗の件数に、未音声が残った場合だけ「成功分を保存後、未音声を一括生成して再試行できる」案内を加える。失敗専用の再試行ボタンや結果の永続的な履歴は持たない。

### 一括生成のエージェント確定

Web は Take を編集フォームへ追加して明示保存するのに対し、Agent Access は `tts.attachBulk` で成功 Job だけを一つの版へ原子的に添付する。詳細は [Agent Access 仕様](../agent-access/spec.md) を正とする。

- `tts.createBulk` は `requestId` 付きで開始したものだけ確定対象になる。`requestId` なしの実行や別エージェントの実行は確定できない。
- `tts.attachBulk`（`scriptVersionId`・元の `bulkRequestId`・添付自身の必須 `requestId`）は、Job が1件でも未完了なら版を作らず `pending` を返し、全 Job が終端状態になったら成功 Job のみを添付して `finalized` を返す。
- 確定前に台本を書き換えてはならない。元の版が current でなくなると `SCRIPT_BASE_STALE` で停止する。
- 失敗・対象外行を再生成するときは、返された新しい版（添付0件なら元版）に対して新しい `bulkRequestId` で `tts.createBulk` を実行する。

## エラー

生成要求（キュー投入前）:

| code | HTTP | 発生条件 |
| --- | --- | --- |
| `TTS_INPUT_INVALID` | 422 | 空の `speechText`、Speaker/Profile 未設定、Profile のアダプター外の声、不正な話速 |
| `TTS_ENGINE_UNAVAILABLE` | 503 | エンジン未起動・接続失敗・不正な応答 |

Job 実行中の失敗（`GET /jobs/:jobId` の `status: failed`）:

| code | 意味 |
| --- | --- |
| `TTS_ENGINE_UNAVAILABLE` | 合成時にエンジンへ接続できない |
| `TTS_INPUT_REJECTED` | エンジンが入力を拒否した |
| `TTS_SYNTHESIS_FAILED` | 合成または WAV 確定に失敗した |

## API 概要

- `GET /voice-adapters` で登録済みアダプター記述子（`id`・表示名・`defaultLocale`・`voiceSelection`・`modelSelection`）を取得する
- `GET /voice-profiles`、`POST /voice-profiles`、`PATCH /voice-profiles/:id`、`DELETE /voice-profiles/:id`
- `GET /voice-profiles/voices?adapterId=<id>[&model=<model>]` で接続中エンジンの声（`voiceId`・表示名・任意の `locale`）を取得する。`model` は声がモデル依存のアダプター（OpenAI 互換）で使う
- `GET /voice-profiles/models?adapterId=<id>` で接続中エンジンのモデル候補を取得する。対応しないアダプターは空配列を返す
- `POST /script-versions/:scriptVersionId/narration-segments/:narrationSegmentId/tts-jobs`
  - 任意の `speechText`、`voiceId`、`speedScale`（既定 1.0）を受け付ける。`speechText` を省略すると保存済みセグメントの値を使い、`voiceId` を省略すると話者の Voice Profile の声を使う
- `POST /script-versions/:scriptVersionId/tts-jobs`
  - リクエスト本文は空とする。保存済み台本の要点シーンで音声が未選択のセリフを対象に、セリフごとの `tts` Job を作る
  - 応答（202）は投入した Job の一覧と除外したセリフ（ID・エラーコード・理由）を返す
- `GET /health` の `capabilities.jobKinds` に `tts`、`capabilities.voiceAdapters` に登録済みアダプター（`voicevox`、`aivisspeech`、`openai-compatible`）を含める

Job 種別は `asset_ingest` / `render` / `tts` の 3 つとなる。単一 worker、`queued → running → succeeded|failed`・`queued → cancelled`（render は `running → cancelled` も可）の状態遷移、リースなし、起動時 `WORKER_INTERRUPTED` 掃除は [ADR 0020](../adr/0020-no-job-lease-startup-reap.md) と [../mvp/spec.md](../mvp/spec.md) の規則をそのまま適用する。実行中の tts Job はキャンセルしない。

## Prisma

既存の `VoiceProfile.adapterId`（文字列）と `settingsJson` をそのまま使う。アダプター追加に伴う migration は不要で、既存 VOICEVOX Profile・Job・Asset は変更しない。
