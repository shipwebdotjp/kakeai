# MVP API契約

## 目的と適用範囲

この文書は、Web UIとローカルAPIの間のHTTP契約を定める。編集データの正本、DBモデル、レンダーの不変スナップショットは [spec.md](./spec.md)、台本本文の構造は [content-schema.md](./content-schema.md) を正とする。この文書はそれらをAPI DTOへ写すものであり、DB行やローカルファイルパスを公開しない。

対象は開発者がローカルMacで起動するMVPである。認証、共有、外部公開、WebHook、汎用AI Job APIは定義しない。容量を回収するための明示削除APIだけを定義する。ファイルのアップロードと配信以外はJSON APIとする。

## 共通規約

### 基本

- ベースURLは /api/v1 とする。破壊的変更は /api/v2 を追加して行い、v1には後方互換な追加だけを行う。
- JSONのContent-Typeは application/json; charset=utf-8、文字コードはUTF-8、日時はUTCのRFC 3339形式、IDは不透明な文字列とする。
- 成功したJSONレスポンスは常に { "data": ... } で包む。配列も data に入れる。
- リクエストの未定義フィールドは拒否する。API入力、ContentDocument、VisualTemplate入力はZodで検証する。
- APIは絶対ローカルパス、storageKey、Job入力スナップショット、Composition生成の内部設定を返さない。素材やMP4はcontent URL経由で参照する。
- 認証は行わないが、通常起動時のWeb UI、API、素材・Artifactのcontent URLは同じループバックoriginで提供し、ネットワークインターフェースへ公開しない。開発時のVite dev serverは信頼済みループバックproxyとして同じパスを中継し、ブラウザからAPIポートを直接呼ばせない。JSON APIとmultipartアップロードは、厳密な `Host` と `Origin` の検証を要求する。DNSリバインディングは `Host` 検証で、CSRFは `Origin` 検証で防ぐ。独自ヘッダや起動時トークンは用いない。
- `GET /assets/:assetId/content`、`GET /artifacts/:artifactId/content`、published CompositionVersion bundleのcontent URLは、ブラウザが独自ヘッダを付けられないsubresource・Range requestとして利用できなければならない。同一originのUIシェルの応答、および開発時にシェルをVite dev serverが配信する場合に備えて同一originのAPIのGET応答で、プロセスごとにランダムなホスト専用・非永続の `Kakeai-Media-Session` Cookieを `HttpOnly; SameSite=Strict; Path=/api/v1/` で発行する。`Sec-Fetch-Site` が `cross-site` の要求では発行しない。content配信はこのCookieと厳密なHost検証で認可し、`Origin` がある場合は同一originだけを受け入れる。`Sec-Fetch-Site` がある場合も `same-origin` でなければならない。JSON APIはこのCookieだけでは認可しない。将来UIをHTTPSで提供するときはCookieに `Secure` を追加する。
- content配信は上記メディアセッションCookieで認可する。`contentUrl` は資格情報をクエリへ埋め込まない同一originの相対URLとし、HyperFrames Playerは不透明originになるsandboxで実行しない。Composition bundleの相対依存はentry URLを基準に解決し、path traversal、絶対パス、draftは配信しない。

### 成功・失敗の共通形式

成功例:

~~~json
{
  "data": {
    "id": "wrk_abc123"
  }
}
~~~

JSONエラーは次の形式にする。codeはUIの分岐・テストに使う安定した英大文字の識別子、messageは利用者に表示できる日本語文とする。スタックトレース、ローカル絶対パス、外部コマンドの生出力は返さない。

~~~json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "入力内容を確認してください。",
    "requestId": "req_01J...",
    "details": {
      "issues": [
        {
          "path": ["content", "locale"],
          "code": "invalid_value",
          "message": "利用できる言語は ja-JP または en-US です。"
        }
      ]
    }
  }
}
~~~

requestIdは各HTTPリクエストに付与し、APIとワーカーのログを照合するために使う。detailsはコードごとに後述の形を持ち、省略可能とする。

### APIで返す主要DTO

| DTO | 主なフィールド | 備考 |
| --- | --- | --- |
| WorkSummary | id, title, originalLocale, updatedAt, languageEditions | 作品一覧用。各Editionには現在の台本版と最新Render Jobの要約を含める。 |
| Work | WorkSummaryのフィールド、createdAt, parentWorkId | 一覧と管理に使う作品名 `title` を持つ。動画内に表示するタイトルはContentDocument側のSceneスロットであり、こちらとは別である。 |
| LanguageEditionSummary | id, workId, locale, updatedAt, currentScriptVersion | currentScriptVersionは `currentScriptVersionId` が指すID、版番号、作成日時の要約。`locale` は `ja-JP` または `en-US`。 |
| ScriptVersion | id, languageEditionId, versionNumber, contentSchemaVersion, content, createdAt, author, authorAgentId, agentRequestId, agentRequestHash | contentはContentDocumentそのもの。保存後に更新しない。`author` は `human` / `agent` で作成時に確定し、以後変更しない。`authorAgentId`・`agentRequestId`・`agentRequestHash` は該当しない場合null。詳細は [Agent Access 仕様](../agent-access/spec.md) の帰属を正とする。 |
| Asset | id, kind, origin, status, originalFilename, mediaType, byteSize, sha256, durationMs, widthPx, heightPx, hasAudio, createdAt, contentUrl | statusは `processing` / `ready` / `failed`。durationMsはreadyなrender Renditionの尺（imageではnull）、widthPxとheightPxはaudioではnull。hasAudioは音声ストリームの有無（imageは常にfalse）。contentUrlは原本へのURLであり、編集・レンダーにはreadyなAssetだけを選択できる。 |
| Composition | id, runtimeCompositionId, name, createdAt, updatedAt, draft, versions | Kakeai管理AIが編集する再利用可能なHyperFrames projectの論理単位。Assetではない。`draft` は高々1つの可変な作業コピー（`id`, `compositionId`, `entrypoint`, `storageKey`, `updatedAt`, `styleProvenance`）で、ScriptVersion・Jobから参照しない。`versions` はpublish済みCompositionVersionの配列。 |
| CompositionVersion | id, compositionId, versionNumber, bundleHash, storageKey, manifest, styleProvenance, createdAt | publish済みの不変bundle。manifestはruntime composition ID、entrypoint、Canvas Profile、その固定寸法、既定尺、依存一覧を持つ。`canvasProfile` は `landscape`（1920×1080、既定）または `portrait`（1080×1920）で、versionごとに不変。`contentHash` は任意。`storageKey` はアプリデータルート相対の内部キーであり、参照やURL生成に使わない（絶対パスは返さない）。`styleProvenance` はauthoring元Theme/Skin/Style Kit hashとFont診断の不変記録で、`authored` / `neutral` / `legacy` の判別union（[../visual-skins/spec.md](../visual-skins/spec.md)）。 |
| CompositionDraftFiles | entrypoint, files, binaryFiles | draftのentrypointと、bundle相対パスをキーにしたファイル内容のマップ。`files` はUTF-8テキスト、`binaryFiles` はbase64文字列（存在する場合のみ）。seedとAIの更新内容を含む。 |
| Job | id, kind, status, workId, assetId, languageEditionId, scriptVersionId, progressPercent, createdAt, startedAt, finishedAt, error, ttsResult, artifacts | 入力スナップショット自体は返さない。`artifacts` は出力の要約配列。kindは `asset_ingest` / `render` / `tts`。`ttsResult` は `tts` Jobが生成したAudio Take候補で、それ以外はnull。 |
| Artifact | id, jobId, role, format, byteSize, durationMs, widthPx, heightPx, fps, videoCodec, audioCodec, createdAt, contentUrl | Jobの出力ファイル。MVPは role=render / format=mp4。videoCodecとaudioCodecはレンダー時のffprobe結果で、取得できない場合はnull。ファイルは同一originのメディアCookieを使ってcontentUrlから取得・再生する。 |
| VoiceProfile | id, name, adapterId, voiceId, locale, settings, createdAt, updatedAt | アプリ共通の声の設定。`adapterId` は登録済みアダプター記述子の ID（作成後は不変）、`voiceId` はアダプター定義の不透明な声 ID、`locale` は声の言語、`settings` はアダプター固有の追加分（OpenAI互換は `{ model }`）。詳細は [../tts/spec.md](../tts/spec.md)。 |
| VoiceAdapter | id, label, defaultLocale, voiceSelection, modelSelection | 登録済み TTS アダプター記述子。`defaultLocale` は固定言語（無ければnull）、`voiceSelection` は `list` / `list-or-manual`、`modelSelection` はモデル指定の要否。 |
| TtsVoice | voiceId, name, locale? | 接続中エンジンの声。`voiceId` はアダプター定義の不透明な ID、`locale` は任意の申告言語。 |
| BulkTtsJobsResult | jobs, excluded | 一括TTS生成の応答。`jobs` は `narrationSegmentId` と Job DTO の組、`excluded` は `narrationSegmentId`・エラーコード・安全な理由。詳細は [../tts/spec.md](../tts/spec.md)。 |
| Thumbnail | id, languageEditionId, label, schemaVersion, template, input, isPrimary, createdAt, updatedAt | 言語版のサムネイル候補。`template` は `{ id, version }`、`input` はテンプレート固有のJSON。複数候補を持ち、`isPrimary` が投稿に使う1枚。詳細は [../thumbnail/spec.md](../thumbnail/spec.md)。 |
| ThumbnailPreview | html, width, height | 未保存のサムネイル入力をコンパイルした静止画HTML（1280x720）。DBへ書かない。 |
| CharacterLibraryEntry | id, name, voices, appearances, createdAt, updatedAt | アプリ共通のキャラクター。`voices` は locale 別の声の対応（`locale` 重複拒否）。`appearances` は画像 Asset と表情・ポーズ・任意の表示名 `label`・任意の `faceSetId`。詳細は [../character-library/spec.md](../character-library/spec.md)。 |
| FaceSet | id, name, layers, expressions, createdAt, updatedAt | アプリ共通の顔素材。`layers` は `{ id, part: brow\|eye\|mouth\|foreground, assetId, blinkLayerId, speakingLayerId }`、`expressions` は `{ id, name, browLayerId, eyeLayerId, mouthLayerId }` で、`normal` の preset を必ず含む。`assetId` は ready な画像 Asset。詳細は [../face-expression/spec.md](../face-expression/spec.md)。 |

値がないDTOフィールドは省略せずnullを返す。これにはdurationMs、workId、assetId、languageEditionId、scriptVersionId、startedAt、finishedAt、errorが含まれる。`artifacts` は値がないとき空配列とする。

## エンドポイント一覧

| メソッド | パス | 成功 | 用途 |
| --- | --- | --- | --- |
| GET | /health | 200 | APIとローカルレンダーワーカーの稼働確認 |
| GET | /works | 200 | 作品一覧 |
| POST | /works | 201 | Work、初期言語 Edition、ContentDocument v8の初期ScriptVersionを作成 |
| GET | /works/:workId | 200 | 作品とEditionの取得 |
| PATCH | /works/:workId | 200 | 管理上の作品名を変更 |
| POST | /works/:workId/clone | 201 | 元作品の現在版を複製した新しい子Workを作成 |
| DELETE | /works/:workId | 204 | 作品、版、Job、Artifactを明示削除 |
| GET | /language-editions/:editionId/current-script-version | 200 | 現在の完全な台本を取得 |
| GET | /language-editions/:editionId/script-versions | 200 | 台本版のメタデータ履歴を取得 |
| POST | /language-editions/:editionId/script-versions | 201 | 検証済みContentDocumentから新しい不変版を作成 |
| GET | /script-versions/:scriptVersionId | 200 | 指定した完全な台本版を取得 |
| GET | /assets | 200 | アプリ共通素材ライブラリを取得 |
| POST | /assets | 202 / 200 | 原本をアップロードし、素材取り込みJobを開始または既存素材を取得 |
| GET | /assets/:assetId | 200 | 素材メタデータを取得 |
| PATCH | /assets/:assetId | 200 | タグ・お気に入り・アーカイブを更新 |
| GET | /assets/:assetId/content | 200 / 206 | 素材ファイルを配信 |
| GET | /assets/:assetId/render-content | 200 / 206 | readyなrender Renditionを配信 |
| GET | /assets/:assetId/frame | 200 | セリフゲート保持用の静止フレームPNGを配信 |
| DELETE | /assets/:assetId | 204 | 未参照の素材を明示削除 |
| GET | /compositions | 200 | Composition Libraryの一覧を取得 |
| POST | /compositions | 201 | Compositionとactive draftを作成（AI authoring。任意の `authoringStyle` でStyle Kitをseed） |
| POST | /composition-authoring-contexts | 200 | 公開Theme RevisionとCanvas Profileから非永続のComposition Authoring Contextを返す（AI authoring） |
| GET | /compositions/:compositionId | 200 | Compositionとpublish済みversionのメタデータを取得 |
| GET | /compositions/:compositionId/draft/files | 200 | draftのentrypointとファイル内容を取得（AI authoring） |
| POST | /compositions/:compositionId/draft | 200 | draftのentrypoint・テキスト/バイナリbundleファイル・manifestを更新（AI authoring） |
| POST | /compositions/:compositionId/publish | 201 / 200 | draftを検証し不変のCompositionVersionを公開。`?dryRun=true` ではversionを作らず検証のみ（200 `{ manifest }`）（AI authoring） |
| GET | /compositions/versions/:compositionVersionId/content/*bundlePath | 200 / 206 | published bundleのentrypointまたは相対依存を配信。previewレスポンス内のURLだけを使用する |
| GET | /script-versions/:scriptVersionId/preview | 200 | 信頼済みComposition HTMLと素材URLを取得 |
| GET | /script-versions/:scriptVersionId/subtitles | 200 | 保存済み版の字幕（SRT）をダウンロード |
| POST | /language-editions/:editionId/draft-preview | 200 | 未保存の台本案から書込みなしでドラフト・プレビューを合成 |
| GET | /language-editions/:editionId/thumbnails | 200 | 言語版のサムネイル候補一覧を取得（[../thumbnail/spec.md](../thumbnail/spec.md)） |
| POST | /language-editions/:editionId/thumbnails | 201 | サムネイル候補を作成 |
| PUT | /language-editions/:editionId/primary-thumbnail | 200 | 投稿に使うサムネイル候補を選択 |
| POST | /language-editions/:editionId/thumbnail-preview | 200 | 未保存のサムネイル入力を書込みなしでプレビュー |
| GET | /thumbnails/:thumbnailId | 200 | サムネイル候補を取得 |
| PUT | /thumbnails/:thumbnailId | 200 | サムネイル候補を明示保存（上書き） |
| DELETE | /thumbnails/:thumbnailId | 204 | サムネイル候補を削除 |
| GET | /thumbnails/:thumbnailId/image | 200 | 候補のPNGをオンデマンド生成して配信 |
| POST | /script-versions/:scriptVersionId/render-jobs | 202 | 入力スナップショットを持つRender Jobをキューへ追加 |
| GET | /works/:workId/jobs | 200 | 作品のRender Job履歴を新しい順に取得 |
| GET | /jobs/:jobId | 200 | Render Jobの状態をポーリング |
| POST | /jobs/:jobId/cancel | 200 | queued Jobをキャンセル |
| GET | /artifacts/:artifactId | 200 | Artifactのメタデータを取得 |
| GET | /artifacts/:artifactId/content | 200 / 206 | Artifactファイルを配信 |
| DELETE | /artifacts/:artifactId | 204 | 生成済み出力を明示削除 |
| GET | /voice-adapters | 200 | 登録済みアダプター記述子（`id`・表示名・能力）を取得 |
| GET | /voice-profiles | 200 | アプリ共通のVoice Profile一覧を取得 |
| POST | /voice-profiles | 201 | Voice Profileを作成 |
| PATCH | /voice-profiles/:voiceProfileId | 200 | Voice Profileの表示名・声・言語・設定を更新 |
| DELETE | /voice-profiles/:voiceProfileId | 204 | 未参照のVoice Profileを削除 |
| GET | /voice-profiles/voices?adapterId=<id>[&model=<model>] | 200 | 接続中エンジンの声（`voiceId`・表示名・任意の `locale`）を取得。`model` は声がモデル依存のアダプターで使う（[../tts/spec.md](../tts/spec.md)） |
| GET | /voice-profiles/models?adapterId=<id> | 200 | 接続中エンジンのモデル候補（`models`）を取得。非対応は空配列 |
| POST | /script-versions/:scriptVersionId/narration-segments/:narrationSegmentId/tts-jobs | 202 | TTS Jobをキューへ追加（[../tts/spec.md](../tts/spec.md)） |
| POST | /script-versions/:scriptVersionId/tts-jobs | 202 | 音声が未選択の要点セリフを一括でTTS Jobへ追加。投入Jobと除外セリフを返す（[../tts/spec.md](../tts/spec.md)） |
| GET | /characters | 200 | キャラクターライブラリの一覧を取得（[../character-library/spec.md](../character-library/spec.md)） |
| POST | /characters | 201 | キャラクターを作成 |
| PATCH | /characters/:characterId | 200 | キャラクターの名前・声・外観を更新 |
| DELETE | /characters/:characterId | 204 | キャラクターを削除 |
| GET | /face-sets | 200 | Face Set ライブラリの一覧を取得（[../face-expression/spec.md](../face-expression/spec.md)） |
| POST | /face-sets | 201 | Face Set（Face Layer と Expression Preset を含む）を作成 |
| PATCH | /face-sets/:faceSetId | 200 | Face Set の名称・Face Layer・Expression Preset を更新 |
| DELETE | /face-sets/:faceSetId | 204 | 未参照の Face Set を削除 |
| GET | /themes | 200 | Theme 一覧（組み込み＋利用者テーマ）を取得（[../theme-customization/spec.md](../theme-customization/spec.md)） |
| POST | /themes | 201 | Theme の作成・複製 |
| POST | /themes/preview | 200 | 代表サンプルによる Theme Draft 非永続プレビューを合成（`fontDiagnostics` 付き） |
| GET | /themes/:themeId | 200 | Theme 詳細と全 Revision / Draft を取得 |
| PUT | /themes/:themeId/draft | 200 | Theme Draft を保存・更新 |
| DELETE | /themes/:themeId/draft | 200 | Theme Draft を破棄 |
| POST | /themes/:themeId/publish | 200 | Theme Draft を検証し、不変の Theme Revision として公開 |
| POST | /themes/:themeId/archive | 200 | 利用者 Theme をアーカイブ |
| GET | /fonts | 200 | Font Catalog を取得（[../theme-customization/spec.md](../theme-customization/spec.md)） |
| POST | /fonts/refresh | 200 | Font Catalog を再検出・更新 |

この一覧のパスはすべて /api/v1 を先頭に持つ。たとえば作品一覧は GET /api/v1/works である。

## ヘルスチェック

GET /health は起動確認とUIの初期診断に使う。レンダーワーカーが停止していてもAPI自体は使えるため、HTTP 200のまま worker.status を notReady とする。

~~~json
{
  "data": {
    "apiVersion": "v1",
    "worker": {
      "status": "ready"
    },
    "capabilities": {
      "locales": ["ja-JP", "en-US"],
      "jobKinds": ["asset_ingest", "render"],
      "assetKinds": ["image", "video", "audio"]
    },
    "storage": {
      "warningThresholdBytes": 85899345920,
      "status": "ok"
    }
  }
}
~~~

## 作品と台本

### 作品一覧

GET /works は更新日時の降順でWorkSummaryの配列を返す。MVPではページネーションや検索条件は追加しない。

~~~json
{
  "data": [
    {
      "id": "wrk_abc123",
      "title": "テンプレート解説",
      "originalLocale": "ja-JP",
      "updatedAt": "2026-10-08T03:20:00.000Z",
      "languageEditions": [
        {
          "id": "led_ja_123",
          "workId": "wrk_abc123",
          "locale": "ja-JP",
          "updatedAt": "2026-10-08T03:20:00.000Z",
          "currentScriptVersion": {
            "id": "scr_002",
            "versionNumber": 2,
            "createdAt": "2026-10-08T03:20:00.000Z"
          },
          "latestRenderJob": {
            "id": "job_001",
            "status": "succeeded",
            "finishedAt": "2026-10-08T03:25:12.000Z"
          }
        }
      ]
    }
  ]
}
~~~

latestRenderJobはRender Jobがまだないときはnullとする。失敗した最新Jobも、その失敗状態のまま返す。

### 作品作成と名称変更

POST /works は、Work、`originalLocale` のLanguageEdition、`schemaVersion: 1` の `explanation-scenes@1` と `visualTheme: soft-editorial@1` を持つ初期ScriptVersion（`versionNumber: 1`）を同じトランザクションで作成する。初期Sceneは導入、要点1件、結びとし、各Sceneにはテンプレート既定の `accent`（`theme.primary`）と `label` を入れる。要点Sceneは音声主導の `timing.mode: "auto"`、導入と結びはテンプレート既定の固定尺にする。Editionの `currentScriptVersionId` を初期版に設定する。クライアントは初期のContentDocumentを送らない。

~~~http
POST /api/v1/works
Content-Type: application/json

{
  "title": "テンプレート解説",
  "originalLocale": "ja-JP"
}
~~~

originalLocaleは必須とし、受け付ける値は `ja-JP` または `en-US` である。成功時は201 Createdと、作成した完全なWork DTOを返す。

~~~json
{
  "data": {
    "id": "wrk_abc123",
    "title": "テンプレート解説",
    "originalLocale": "ja-JP",
    "parentWorkId": null,
    "createdAt": "2026-10-08T03:00:00.000Z",
    "updatedAt": "2026-10-08T03:00:00.000Z",
    "languageEditions": [
      {
        "id": "led_ja_123",
        "workId": "wrk_abc123",
        "locale": "ja-JP",
        "updatedAt": "2026-10-08T03:00:00.000Z",
        "currentScriptVersion": {
          "id": "scr_001",
          "versionNumber": 1,
          "createdAt": "2026-10-08T03:00:00.000Z"
        },
        "latestRenderJob": null
      }
    ]
  }
}
~~~

PATCH /works/:workId は管理画面・一覧に表示するtitleだけを更新する。

~~~http
PATCH /api/v1/works/wrk_abc123
Content-Type: application/json

{
  "title": "テンプレート解説（改訂）"
}
~~~

この操作はContentDocumentのSceneスロット（導入タイトル等）、ScriptVersion、既存Artifactを変更しない。動画に表示する文言は台本保存で変更する。

DELETE /works/:workId は確認済みの破壊的操作である。子Workがあるときは409 `WORK_HAS_CHILDREN` を返す。子がなければ、当該WorkのEdition、ScriptVersion、Job、ArtifactのDB行と実体を削除する。共有Assetは削除しない。削除済みWorkの出力・履歴は復元できない。

### 台本の取得と版履歴

編集画面は最初に GET /language-editions/:editionId/current-script-version を呼び、完全なScriptVersion DTOを取得する。currentはEditionの `currentScriptVersionId` が指すScriptVersionであり、最大のversionNumberから推測しない。特定の版やレンダー履歴から台本を開く場合は GET /script-versions/:scriptVersionId を使う。

GET /language-editions/:editionId/script-versions は、本文を含まない版の一覧を版番号の降順で返す。MVPのUIでは履歴表示を必須にしないが、将来の差分表示やレンダーの追跡に備えて公開する。

~~~json
{
  "data": [
    {
      "id": "scr_002",
      "languageEditionId": "led_ja_123",
      "versionNumber": 2,
      "contentSchemaVersion": 3,
      "author": "human",
      "authorAgentId": null,
      "agentRequestId": null,
      "agentRequestHash": null,
      "createdAt": "2026-10-08T03:20:00.000Z"
    },
    {
      "id": "scr_001",
      "languageEditionId": "led_ja_123",
      "versionNumber": 1,
      "contentSchemaVersion": 3,
      "author": "human",
      "authorAgentId": null,
      "agentRequestId": null,
      "agentRequestHash": null,
      "createdAt": "2026-10-08T03:00:00.000Z"
    }
  ]
}
~~~

### 台本の保存

POST /language-editions/:editionId/script-versions は既存の版を更新しない。クライアントはContentDocument全体をcontentに渡す。保存はlast-write-winsとし、受理時は表示用に単調増加のversionNumberを割り当て、新版のIDへ `currentScriptVersionId` を進める。書込みで受け入れるContentDocumentは `schemaVersion: 1` とする。contentの完全な契約は [content-schema.md](./content-schema.md) に従う。Scene・行・Cueの追加、削除、移動、分割、範囲変更の意味論は [台本編集操作コア](../editor-core/spec.md) を正とし、このHTTP APIは要素単位の操作を公開せず、編集済みの文書全体だけを受け取る。

~~~jsonc
{
  "sourceScriptVersionId": null,
  "content": {
    "schemaVersion": 1,
    "locale": "ja-JP",
    "template": {
      "id": "explanation-scenes",
      "version": 1
    },
    "speakers": [],
    "characters": [],
    "audioTakes": [],
    "scenes": [
      // 導入、0件以上の要点、結びをこの順で全て含める。各Sceneは label を持つ
    ],
    "audioCues": []
  }
}
~~~

上の例は構造を示すためのjsoncである。実際の送信値はコメントを含まない完全なContentDocumentでなければならない。APIはEditionのlocale、`explanation-scenes@1` のScene構成、すべてのreadyなAsset参照、publish済みCompositionVersion参照、`faceSetId`／`expressionId` の参照整合、キャラクターの `voices`（`locale` 重複、話者の声との一致）、音声尺とScene尺の制約を検証し、違反は422 VALIDATION_ERRORのdetails.issuesに該当フィールドのJSON Pointerと理由を含める。insert Sceneは主動画Cueが `media.full-bleed@1` のbackground・scene rangeで、readyな `video` Assetを参照し、その確定尺がScene尺と一致することを検証する。`embeddedAudio: true` で音声ストリームを持たない動画は `meta.warnings` に `insert_video_without_audio` を返す。参照先 Voice Profile が欠けた台本も保存でき、生成時にだけ「未設定」として拒否する（[../tts/spec.md](../tts/spec.md)）。`faceSetId` は参照先 Face Set が存在し、その Face Layer が ready な画像 Asset を指し、ベース画像と寸法が一致すること、`normal` preset を含むことを検証する。`expressionId` は、話者（`Speaker.characterId`）に対応するキャラクターの、そのSceneで有効な Character Appearance が参照する Face Set 内に存在することを検証する。`speakerId` が `null` のラインに `expressionId` を指定できない（[../face-expression/spec.md](../face-expression/spec.md)）。`composition.full-bleed@1` はbackground層だけに置け、`scene` / `lines` / `offset` の全 range を使え、Canvas Profileが `landscape` のversionだけを指定できる（`portrait` は422で拒否）。同じCompositionVersionを一つのContentDocument内で複数回参照できない。実効表示窓は `min(range 尺, manifest.durationMs)` とし、Cue transition は実効表示窓内に収め、Scene crossfade で必要窓が child 尺を超える場合は保存・レンダー投入時に422で拒否する。ContentDocumentは対応済みVisualTemplateの複数Cue、`lines`、`offset` の範囲指定も受け入れる。テンプレートごとの最大行数・最小フォントサイズに照らしたテキスト量は、収まらなくても保存を拒否せず、`meta.warnings` に該当フィールドのJSON Pointerと理由を返す。過去版を復元する場合、UIは復元元を `sourceScriptVersionId` に指定してその内容を新しい版として保存する。復元元は同じEditionの版だけを受け入れる。

成功時は201 Createdと、新しい完全なScriptVersion DTOを返す。

~~~json
{
  "data": {
    "id": "scr_003",
    "languageEditionId": "led_ja_123",
    "versionNumber": 3,
    "contentSchemaVersion": 1,
    "content": {
      "schemaVersion": 1,
      "locale": "ja-JP",
      "template": {
        "id": "explanation-scenes",
        "version": 1
      },
      "speakers": [],
      "characters": [],
      "audioTakes": [],
      "scenes": [],
      "audioCues": []
    },
    "author": "human",
    "authorAgentId": null,
    "agentRequestId": null,
    "agentRequestHash": null,
    "createdAt": "2026-10-08T03:30:00.000Z"
  }
}
~~~

この成功例のcontentは長さを省略した形である。実際には導入、0件以上の要点、結びをこの順で保持した、リクエストと同じ検証済みのContentDocumentを返す。

テキストがテンプレートの目安を超えた場合も201 Createdを返し、警告を `meta.warnings` に含める。保存されたContentDocumentには入力がそのまま残る。

~~~json
{
  "data": { "...": "省略" },
  "meta": {
    "warnings": [
      {
        "path": ["scenes", 2, "slots", "body"],
        "code": "text_overflow",
        "message": "本文がテンプレートの目安を超えています。プレビューで確認してください。"
      }
    ]
  }
}
~~~

## 素材ライブラリ

Assetは全Workで再利用できる。アップロードされた原本は不変に扱い、非同期の素材取り込みJobが形式・長さ・寸法を検査してメタデータを記録する。原本を直接レンダーに使えない場合にだけ、必要時にrender Renditionを作る。`status=ready` のAssetだけを台本、プレビュー、レンダーで使える。実体が欠損または改変されたAssetは、削除済みでない限り同一SHA-256の再アップロードで同じAsset ID・メタデータのまま復旧できる。

### 一覧とメタデータ

GET /assets は素材ライブラリを検索し、`{ assets, nextCursor }` の1ページを返す。並び順は `createdAt` 降順・`id` 降順で固定する。クエリは `kind`（image / video / audio）、`status`（processing / ready / failed）、`filename`（大文字小文字を区別しない部分一致）、`tags`（繰り返し指定またはカンマ区切り。短縮形の `tag` も同じ意味）、`tagMode`（`and` が既定、`or` でいずれか一致）、`favorite`（true / false）、`archived`（`exclude` が既定、`include` はアーカイブ済みも含む、`only` はアーカイブ済みだけ）、`limit`（既定50、最大100）、`cursor`（前ページの `nextCursor` をそのまま渡す不透明値）を組み合わせられる。不正な値や壊れた cursor は422 `VALIDATION_ERROR` とし、`nextCursor` は最終ページでnullになる。返却順・cursor・limit上限はHTTP、ローカルソケット、MCP、CLIで同じ契約を共有する。各Assetは利用者が編集できる `tags`・`favoritedAt`・`archivedAt` を含む。`favoritedAt` はお気に入り、`archivedAt` は一覧・ピッカーから既定で隠すアーカイブを表し、どちらもnullなら未設定。

~~~json
{
  "data": {
    "assets": [
      {
        "id": "ast_image_001",
        "kind": "image",
        "origin": "uploaded",
        "status": "ready",
        "originalFilename": "background.png",
        "mediaType": "image/png",
        "byteSize": 348921,
        "sha256": "sha256:4d8b...",
        "durationMs": null,
        "widthPx": 1920,
        "heightPx": 1080,
        "hasAudio": false,
        "tags": ["背景", "夏"],
        "favoritedAt": null,
        "archivedAt": null,
        "createdAt": "2026-10-08T03:10:00.000Z",
        "contentUrl": "/api/v1/assets/ast_image_001/content"
      }
    ],
    "nextCursor": null
  }
}
~~~

GET /assets/:assetId は同じ1件のAsset DTOを返す。GET /assets/:assetId/content は原本を検出済みのMIME typeで返し、動画・音声の確認に必要なHTTP Range requestをサポートする。GET /assets/:assetId/render-content は、正規化Renditionがあればそれを、無ければ原本を返す。正常な部分応答は206 Partial Contentとする。両エンドポイントはメディアセッションCookieで認可されるため、`<img>`、`<audio>`、`<video>` の通常の読み込みとシークで利用できる。Compositionで使うURLは後者であり、原本をそのまま使える場合も同じURLから原本が返る。

GET /assets/:assetId/frame はセリフゲート動画再生の保持区間に使う静止フレームPNGを返す。`ms` は0以上の整数で、readyなvideoの確定尺内に限る。Renditionの実フレームから `ms` 以下で最後のPTSを選び、`renditionSha256 + 解決PTS + extractorVersion` をキーに正規化したPNGをキャッシュして配信する。未ready・非video・尺超過・未指定の `ms` は422 `VALIDATION_ERROR` または `ASSET_UNAVAILABLE` とする。正本JSON・DTO・Job snapshotにはフレーム番号やローカルパスを保存しない。

### タグとメタデータの更新

PATCH /assets/:assetId は `{ "tags"?: [string, ...], "favorited"?: boolean, "archived"?: boolean }` の部分更新を受け取り、少なくとも1つのフィールドを必須とする。`tags` はタグ配列を丸ごと置き換える。`favorited` はお気に入り（`favoritedAt` を現在時刻またはnullへ）、`archived` はアーカイブ（`archivedAt` を現在時刻またはnullへ）を切り替える。更新後のAsset DTOを返す。タグは各要素の前後空白を除去し、空文字を除き、重複を1つにまとめる。1素材あたり最大30個、1タグ最大40文字。空配列はタグ無し（`tagsJson` はNULL）として保存する。存在しない素材は404 `RESOURCE_NOT_FOUND`、契約違反は422 `VALIDATION_ERROR` とする。タグ・お気に入り・アーカイブは原本の同一性（`sha256`・`storageKey`・`kind`・寸法・長さ）に影響しない。

~~~http
PATCH /api/v1/assets/ast_image_001
Content-Type: application/json

{ "tags": ["背景", "夏"], "favorited": true }
~~~

### アップロード

POST /assets は multipart/form-data を受け取り、必須のファイルフィールド名をfileとする。任意の文字列フィールドやクライアント申告のMIME typeをAssetの正本として信用しない。APIがバイト列、ファイル種別、画像寸法、動画・音声の長さを検査して原本Assetを作り、`asset_ingest` Jobをキューへ追加する。既定上限は4GiB、動画・音声30分、画像・動画3840x2160であり、運用設定で変更できる。

~~~http
POST /api/v1/assets
Content-Type: multipart/form-data; boundary=...

--...
Content-Disposition: form-data; name="file"; filename="background.png"
Content-Type: image/png

<binary bytes>
--...--
~~~

取り込みは一時ファイルでSHA-256計算・形式検証・メディア検査を完了してから、SHA-256の一意制約の下で行う。新規のバイト列であれば、一時ファイルをアプリ管理領域へ原子的に確定し、`status=processing` のAsset行と `asset_ingest` Jobを作って202 Acceptedを返す。workerは原本のメタデータを記録し、原本をそのまま使える場合はrender Renditionを作らずにAssetを `ready` にする。原本を直接レンダーに使えない場合（非対応コーデック、可変フレームレート、回転メタデータなど）だけ、画像の向きを適用し、動画をH.264/AAC・定フレームレートへ、音声をWAVへ正規化した不変のrender Renditionを作る。失敗時にAssetを `failed` にする。

同じSHA-256のAsset行が既にある場合、その `storageKey` の実体を確認する。存在し、byteSizeとSHA-256が記録値に一致する場合は、一時ファイルを破棄して新しい行・ファイルを作らず、既存Assetがreadyなら200 OK、processingなら202 Acceptedを返す。既存Assetがfailedならprocessingへ戻して新しいasset_ingest Jobを作り、202 Acceptedを返す。実体が欠損している、またはハッシュ不一致の場合は、検証済みの一時ファイルで内容ハッシュ由来の同じ `storageKey` を上書きし、Assetをprocessingへ戻して新しいasset_ingest Jobを作る。

通常の重複排除時は次のmeta情報を返す。

~~~json
{
  "data": {
    "id": "ast_image_001",
    "kind": "image",
    "origin": "uploaded",
    "status": "ready",
    "originalFilename": "background.png",
    "mediaType": "image/png",
    "byteSize": 348921,
    "sha256": "sha256:4d8b...",
    "durationMs": null,
    "widthPx": 1920,
    "heightPx": 1080,
    "tags": [],
    "favoritedAt": null,
    "archivedAt": null,
    "createdAt": "2026-10-08T03:10:00.000Z",
    "contentUrl": "/api/v1/assets/ast_image_001/content"
  },
  "meta": {
    "deduplicated": true
  }
}
~~~

アップロードサイズの上限はサーバー設定で管理する。既定4GiBを超えた場合は413 FILE_TOO_LARGEとし、details.maxBytesを返す。長さまたは寸法の上限を超えた場合は422 MEDIA_LIMIT_EXCEEDEDとし、detailsには測定値と該当する上限を返す。管理領域が80GiB以上ならhealthのstorage.statusを`warning`にし、UIへ警告するが、書込みは停止しない。

DELETE /assets/:assetId は、残っているScriptVersionまたはqueued/running render Jobの入力スナップショットがそのAssetを参照すると409 `ASSET_IN_USE` を返す。参照がなければ、Asset自身のasset_ingest Job、原本、Rendition、Asset行を削除して204 No Contentを返す。Workの削除後などに残ったAssetは、UIからの明示削除または「未参照素材を清掃」で回収できる。

## Face Set ライブラリ

Face Set は、眉・目・口・前景の Face Layer と Expression Preset を持つアプリ共通の顔素材である。作品の Character Appearance は `faceSetId` で参照し、内容をコピーしない。詳細は [../face-expression/spec.md](../face-expression/spec.md) を正とする。

- `POST /face-sets` は `{ name, layers, expressions }` を受け取る。`layers` は `{ id, part: "brow"|"eye"|"mouth"|"foreground", assetId, blinkLayerId?, speakingLayerId? }`、`expressions` は `{ id, name, browLayerId?, eyeLayerId?, mouthLayerId? }`。`normal` の preset を必ず1つ含む。`blinkLayerId` は `part: "eye"` にだけ、`speakingLayerId` は `part: "mouth"` にだけ許可する。
- `PATCH /face-sets/:faceSetId` は `POST` と同じ形で全体を置き換える。`POST`／`PATCH` は、各 `assetId` が ready な画像 Asset であること、全 Face Layer の `widthPx`／`heightPx` が一致すること、preset が同一 Face Set 内の Face Layer だけを参照することを検証する。違反は422 `VALIDATION_ERROR` の `details.issues` で返す。
- `DELETE /face-sets/:faceSetId` は、いずれかの Character Appearance（ライブラリまたは保存済み ScriptVersion の外観）から `faceSetId` で参照されている間は409 `FACE_SET_IN_USE` を返す。Face Layer を削除・置換しても、それを参照する Expression Preset が残る操作は拒否する。
- 保存済み ScriptVersion の外観は Face Set をコピーしないため、Face Set の更新は次回のプレビュー／レンダーに反映される。Render Job は投入時に解決した Face Set を入力スナップショットへ固定する（[ADR-0045](../adr/0045-face-set-global-reference.md)）。

## Composition Library

Compositionは再利用するHyperFrames projectの論理単位で、draftを編集してpublishすると不変のCompositionVersionになる。詳細は [../composition-library/spec.md](../composition-library/spec.md) を正とする。AI authoringは次のエンドポイントを使う。入力はZodで検証し、draft・bundleのパスはアプリデータルート相対で解決する。絶対パスと `..` を含むパスは拒否する。

- `POST /composition-authoring-contexts` は `{ visualTheme: { id, version }, canvasProfile? }` を受け、公開Theme Revision（組み込みまたはpublish済みの利用者revision）からSkin、token、Style Kit hash、Font診断を解決した非永続のComposition Authoring Contextを返す。書込みは行わない。draftのみのTheme、未知のTheme、archive済みのみのThemeは422 `VALIDATION_ERROR` で拒否する。同じ入力は同じ `kit.hash` を返す。
- `POST /compositions` は `{ name, runtimeCompositionId, entrypoint?, canvasProfile?, authoringStyle? }` を受け取り、Compositionとactive draftをdefault `index.html`・`manifest.json` 付きで作成する。`canvasProfile` は `landscape`（既定）または `portrait` で、seed HTMLとmanifestの寸法に反映する。`runtimeCompositionId` はComposition間で一意。`authoringStyle: { visualTheme: { id, version } }` を指定すると、同じContextを再解決し、`kakeai-style/`（`STYLE.md`、`tokens.css`、`fonts.css`、`components.css`、`kit-lock.json`）をseedへ加え、`styleProvenance` を記録する。未指定の新規draftは `neutral` として記録する。
- `GET /compositions/:compositionId/draft/files` は `{ entrypoint, files, binaryFiles? }` を返し、seedを含むdraftを読み戻せる。`files` はUTF-8テキスト、`binaryFiles` はbase64文字列。
- `POST /compositions/:compositionId/draft` は `{ entrypoint?, files?, filesBase64?, manifest? }` を受け取り、指定したファイルだけを上書きする（部分更新、削除なし）。`files` はテキスト、`filesBase64` はbase64文字列のバイナリファイル（画像など）で、同じ正規化パスを両方に含めることはできない。親ディレクトリは自動作成する。`kakeai-style/` は予約された保護パスであり、そこへの更新とentrypoint指定は422 `STYLE_KIT_MODIFIED` で拒否する。`manifest`（`{ durationMs?, dependencies?, canvasProfile? }`）を渡すとサーバが `manifest.json` を生成する。`canvasProfile` 省略時は現在のdraftのプロファイル、無ければ `landscape` を使う。
- `POST /compositions/:compositionId/publish` は任意の `{ entrypoint? }` でdraftを検証し、CompositionVersionを作る。検証はentrypointの存在、manifestのruntime composition ID・Canvas Profileと一致する寸法・有限尺・依存の実在、外部URLの不在、entryの `data-composition-id` 一致、entry rootの `data-width`／`data-height` とmanifest寸法の一致、音声要素の不在、HyperFrames lintのerror不在（warningは許容）を確認する。`styleProvenance` が `authored` のdraftでは、さらに `kakeai-style/` の各保護ファイルと `kit-lock.json` をseed時のhashと照合し、変更・欠落・余分なファイルを422 `STYLE_KIT_MODIFIED`（`details.issues` に該当path）で拒否する。publishはkitをbundleへコピーし、解決済みの `styleProvenance` をversionへ固定する。`?dryRun=true` ではversionを作らず同じ検証だけを行い、成功時200 `{ manifest }` と `meta.fontDiagnostics` を返す。publish成功時も `meta.fontDiagnostics` に診断結果を返す。同じdraftを再publishすると新しいversionNumberの不変versionが作られる。
- 検証失敗は422 `VALIDATION_ERROR` と `details.issues`（`path`・`code`・`message`）で返す。`manifest` の `contentHash` は任意で、publish時にサーバが計算した `bundleHash` を保存・返却するmanifestの `contentHash` に設定する。
- `GET /compositions`、`GET /compositions/:compositionId` は一覧・メタデータを返す。published bundleは `GET /compositions/versions/:compositionVersionId/content/*bundlePath` で配信し、path traversalは403 `LOCAL_ACCESS_DENIED` で拒否する。

台本は `composition.full-bleed@1` の `input.compositionVersionId` としてversion IDだけを参照する。参照はpublish済みversionに限り、同一ContentDocument内で同じversionを複数回参照できない。`composition.full-bleed@1` はCanvas Profileが `landscape` のversionだけをbackgroundに置ける。`portrait` は `scene.device-frame@1` の画面に置き、保存・draft preview・preview・renderはいずれもfull-bleedのportrait参照を422で拒否する。

### Font診断

Composition Authoring Context生成時、Theme Draft代表プレビュー時、Composition publish（dry-run含む）前、Render Job作成時には、KakeaiはHyperFramesと同じChromiumでThemeのFont Faceの`@font-face local()`解決可否を診断し、`fontDiagnostics` 文字列配列として返す。解決できないFaceはStyle Kitの`fonts.css`で定義済みのgeneric stackへフォールバックし、処理は継続する（拒否しない）。`GET /fonts` が返すFaceは、Chromium検証済みのものだけ `verifiedLocalFace: true/false` を持つ（未検証は省略）。Font Catalog自体が利用できない環境では全Font Faceがgeneric stackで描画され、その旨を診断に含める。

## プレビュー

GET /script-versions/:scriptVersionId/preview は、保存済みの完全なScriptVersionだけをプレビュー対象にする。編集中で未保存のフォーム値をこのエンドポイントへ送らない。

APIはContentDocument、参照Asset、参照CompositionVersionを検証し、利用可能なものだけからアプリ管理のVisualTemplateとparent Composition HTMLを生成する。Asset IDの表示参照への解決は、プレビュー向けの `assetResolver`（各Assetのレンダー用content URLへ変換。正規化Renditionが無ければ原本）をコンパイラに注入して行う。CompositionVersionはentrypointと相対依存を解決する読み取り専用content URLへ変換する。コンパイラは解決方式を知らず、レンダーでは同じコンパイラにレンダー用のローカルファイルパス（Renditionが無ければ原本）と検証済みbundleを解決するresolverを注入する。利用者入力をHTMLまたはJavaScriptとしてそのまま返すことはない。Web UIは返されたHTMLを同一originで実行するHyperFrames Playerへ渡し、Asset URLを同じレスポンスの `assets[].contentUrl`、Composition entry URLを `compositions[].entryUrl` から解決する。Playerの素材読み込みはメディアセッションCookieで認可される。

~~~json
{
  "data": {
    "scriptVersionId": "scr_003",
    "compositionHtml": "<!doctype html><html>...</html>",
    "assets": [
      {
        "assetId": "ast_image_001",
        "contentUrl": "/api/v1/assets/ast_image_001/render-content",
        "sha256": "sha256:4d8b..."
      }
    ],
    "compositions": [
      {
        "compositionVersionId": "cmpver_001",
        "entryUrl": "/api/v1/compositions/versions/cmpver_001/content/index.html"
      }
    ],
    "renderer": {
      "engine": "hyperframes",
      "compilerVersion": "app-1",
      "playerVersion": "0.8.141"
    },
    "timeline": {
      "totalDurationMs": 18340,
      "scenes": [
        {
          "sceneId": "scene-point-1",
          "startMs": 0,
          "durationMs": 6120,
          "lines": [
            { "lineId": "line-point-1-1", "startMs": 500, "durationMs": 3200 }
          ],
          "cues": [
            { "cueId": "cue-point-1-bg", "startMs": 0 }
          ]
        }
      ]
    }
  }
}
~~~

`timeline` は解決済みのScene区間・line区間・Cue開始時刻（絶対ms）・総尺であり、プレビューの再生コントロール（Scene／セリフ／Cue移動、±x秒、コマ送り）がUIで再計算しないための非永続の派生データである。出力fpsは `output.fps`（30）を用いる。解決ロジックはコンパイラと同じタイムライン解決器を使う。詳細は [../editor/spec.md](../editor/spec.md) と [../preview-workflow/spec.md](../preview-workflow/spec.md) を正とする。

この結果は永続化しないプレビュー用の派生データである。Assetがprocessingなら409 `ASSET_PROCESSING`、failed・欠損・破損・削除済みなら422 `ASSET_UNAVAILABLE` を返す。参照先がpublish済みCompositionVersionでない、versionが削除済み、bundle欠損・破損、またはmanifest不一致なら422 `COMPOSITION_UNAVAILABLE` を返す。Composition HTMLが生成できない場合は422 PREVIEW_INPUT_INVALIDとし、原因となったContentDocumentまたはVisualTemplateの位置をJSON Pointerとしてdetails.issuesに含める。ファイルシステムパスは返さない。

## ドラフト・プレビュー

POST /language-editions/:editionId/draft-preview は、未保存のContentDocumentだけをプレビュー対象にする。本文は `{ "content": ContentDocument }` とする。DBへの書込み、ScriptVersion作成、Job作成、ファイル保存、キャッシュ保存を一切行わない。

言語版の存在、ContentDocument、参照素材と参照CompositionVersionの準備完了状態を検証し、保存済みプレビューと同じコンパイラ・resolverで合成する。ドラフト応答は `source: { "kind": "draft" }` の判別子を持ち、`scriptVersionId` は含まない。Composition HTML、素材URL、Composition bundle entry URL、レンダラー情報、解決済みタイムラインは保存済みプレビューと同じ形である。

~~~json
{
  "data": {
    "source": { "kind": "draft" },
    "compositionHtml": "<!doctype html><html>...</html>",
    "assets": [
      {
        "assetId": "ast_image_001",
        "contentUrl": "/api/v1/assets/ast_image_001/render-content",
        "sha256": "sha256:4d8b..."
      }
    ],
    "compositions": [],
    "renderer": {
      "engine": "hyperframes",
      "compilerVersion": "app-1",
      "playerVersion": "0.8.141"
    },
    "timeline": { "totalDurationMs": 18340, "fps": 30, "scenes": [] }
  }
}
~~~

失敗は保存済みプレビューと同じエラー契約で返す（存在しない言語版は404 `RESOURCE_NOT_FOUND`、不正なContentDocumentは422 `VALIDATION_ERROR`、素材の未準備は `ASSET_PROCESSING` / `ASSET_UNAVAILABLE`、CompositionVersionの未準備は `COMPOSITION_UNAVAILABLE`、生成不能なタイミングは422 `PREVIEW_INPUT_INVALID`）。詳細は [../preview-workflow/spec.md](../preview-workflow/spec.md) を正とする。

## レンダー

### Render Jobの作成

POST /script-versions/:scriptVersionId/render-jobs は、対象の版、参照Assetとreadyなrender Renditionのハッシュ・メタデータ、参照CompositionVersionのID・bundle hash・manifest、解決済みVisual Skin Ref、Font診断（`missingFonts` と `diagnostics`）、テンプレート版、出力設定、実行環境の版、`snapshotSchemaVersion` を固定したJobを作る。Composition HTMLはキュー投入時に固定せず、workerがこのスナップショットJSONを信頼済みコンパイラで実行時に生成する。HTTPリクエスト中にMP4を生成しない。Jobは複数のArtifactを持て、MVPのrender Jobは `role=render` / `format=mp4` のArtifactを1つ生成する。

MVPの出力設定は固定であるため、リクエストボディは空のJSON objectとする。

~~~http
POST /api/v1/script-versions/scr_003/render-jobs
Content-Type: application/json

{}
~~~

入力がレンダー可能であれば202 Acceptedと、作成直後のJob DTOを返す。

~~~json
{
  "data": {
    "id": "job_002",
    "kind": "render",
    "status": "queued",
    "workId": "wrk_abc123",
    "assetId": null,
    "languageEditionId": "led_ja_123",
    "scriptVersionId": "scr_003",
    "progressPercent": 0,
    "createdAt": "2026-10-08T03:35:00.000Z",
    "startedAt": null,
    "finishedAt": null,
    "error": null,
    "artifacts": []
  }
}
~~~

固定尺の選択音声合計超過など、レンダー入力を組み立てる時点で判定する問題は422 RENDER_INPUT_INVALIDとする。Asset参照の欠落や素材種別と用途の不一致、`explanation-scenes@1` のScene構成は台本保存の段階で422 VALIDATION_ERRORまたはASSET_NOT_FOUNDとして拒否する。Assetがまだprocessingなら409 `ASSET_PROCESSING` とし、failedなAssetは422 `ASSET_UNAVAILABLE` とする。短時間に同じ版を複数回レンダーすることは許可し、その都度異なるJobを作る。UIは送信中にボタンを無効化して、二重クリックによる意図しない重複だけを防ぐ。

### Jobのポーリングと履歴

GET /jobs/:jobId は常に最新のJob DTOを返す。UIはqueuedまたはrunningの間だけこのエンドポイントをポーリングする。GET /works/:workId/jobs はそのWorkのRender Jobを作成日時の降順で返し、レンダー履歴画面に使う。

POST /jobs/:jobId/cancel は `status=queued` のJobだけを `cancelled` に遷移させ、200 OKで更新済みJob DTOを返す。render Jobのキャンセルは入力・素材を変更しない。asset_ingest JobのキャンセルはAssetを `failed` にし、同じ原本を再アップロードした場合は新しいasset_ingest Jobを作って再試行する。`running`、`succeeded`、`failed`、`cancelled` のJobは409 `JOB_NOT_CANCELLABLE` とする。実行中のFFmpegやChromeを止める操作はMVPの対象外である。

成功したJobの例:

~~~json
{
  "data": {
    "id": "job_002",
    "kind": "render",
    "status": "succeeded",
    "workId": "wrk_abc123",
    "assetId": null,
    "languageEditionId": "led_ja_123",
    "scriptVersionId": "scr_003",
    "progressPercent": 100,
    "createdAt": "2026-10-08T03:35:00.000Z",
    "startedAt": "2026-10-08T03:35:02.000Z",
    "finishedAt": "2026-10-08T03:36:14.000Z",
    "error": null,
    "artifacts": [
      {
        "id": "art_001",
        "jobId": "job_002",
        "role": "render",
        "format": "mp4",
        "byteSize": 18432000,
        "durationMs": 72000,
        "widthPx": 1920,
        "heightPx": 1080,
        "fps": 30,
        "videoCodec": "h264",
        "audioCodec": "aac",
        "createdAt": "2026-10-08T03:36:14.000Z",
        "contentUrl": "/api/v1/artifacts/art_001/content"
      }
    ]
  }
}
~~~

失敗したJobの取得自体は成功なので、HTTP statusは200 OKである。UIはdata.statusとdata.error.codeを見て状態を表示する。

~~~json
{
  "data": {
    "id": "job_002",
    "kind": "render",
    "status": "failed",
    "workId": "wrk_abc123",
    "assetId": null,
    "languageEditionId": "led_ja_123",
    "scriptVersionId": "scr_003",
    "progressPercent": 43,
    "createdAt": "2026-10-08T03:35:00.000Z",
    "startedAt": "2026-10-08T03:35:02.000Z",
    "finishedAt": "2026-10-08T03:36:14.000Z",
    "error": {
      "code": "ASSET_UNAVAILABLE",
      "message": "背景素材のファイルが見つからないため、レンダーできませんでした。"
    },
    "artifacts": []
  }
}
~~~

GET /artifacts/:artifactId は完全なArtifact DTOを返す。GET /artifacts/:artifactId/content は `format` に応じたMIME typeでファイルを配信し、動画にはRange requestをサポートする。このエンドポイントもメディアセッションCookieで認可されるため、`<video>` の再生・シークで利用できる。DELETE /artifacts/:artifactId はファイルとArtifact行を削除して204 No Contentを返す。対応するJobは履歴として残すが、artifactsは空配列となり、出力が削除済みであることをUIへ表示する。Assetへの自動昇格はMVPの対象外である。

## 字幕エクスポート

GET /script-versions/:scriptVersionId/subtitles は、保存済みの版からYouTubeへそのまま取り込めるSubRip（`.srt`）字幕ファイルを生成して返す。レンダーとは独立し、JobもArtifactも作らず、ダウンロードのたびに正本から作り直す。タイミング解決はレンダーと同じ `resolveTimeline` を使い、本文は `NarrationSegment.captionText` とする。詳細は [../subtitle-export/spec.md](../subtitle-export/spec.md) を正とする。

~~~http
GET /api/v1/script-versions/scr_003/subtitles
~~~

成功は200 OKとSRTバイト列を返す。`Content-Type` は `application/x-subrip; charset=utf-8`、`Content-Disposition: attachment` でファイル名（Workタイトル由来の `.srt`）を付ける。メディアセッションCookieは要求せず、既存の全リクエスト共通ガード（loopback・same-origin）で保護する。

存在しない版は404 `RESOURCE_NOT_FOUND` とする。固定尺の選択音声合計超過など、タイミングを解決できない入力はレンダー投入時と同じ422 `RENDER_INPUT_INVALID` とする。

## サムネイル

言語版ごとにYouTube投稿用のサムネイル候補を作成・管理する。候補は動画の台本とは別の可変な正本で、明示保存で上書きし、版履歴を持たない。ブランドはその言語版の現行ScriptVersionのVisual Themeを共有する。詳細は [../thumbnail/spec.md](../thumbnail/spec.md) を正とする。

- GET /language-editions/:editionId/thumbnails は候補一覧を返す。各候補に `isPrimary` を含める。
- POST /language-editions/:editionId/thumbnails は `{ label, template, input }` から候補を作成する。最初の候補は自動的に投稿用になる。
- PUT /language-editions/:editionId/primary-thumbnail は `{ thumbnailId }`（解除は null）で投稿用の候補を切り替える。
- PUT /thumbnails/:thumbnailId は `{ label, template, input }` で候補を明示保存（上書き）する。
- DELETE /thumbnails/:thumbnailId は候補を削除する。投稿用を削除した場合は別の候補へ付け替えるか null にする。
- POST /language-editions/:editionId/thumbnail-preview は `{ template, input }` のコンパイル済みHTMLを返す。DBへ書かない。
- GET /thumbnails/:thumbnailId/image は 1280x720 のPNGをオンデマンド生成して返す。JobもArtifactも作らない。

未知のテンプレート参照・入力不整合・素材種別違反は 422 `VALIDATION_ERROR`、静止画へ変換できない場合は 422 `THUMBNAIL_INPUT_INVALID` を返す。存在しない候補・言語版は 404 `RESOURCE_NOT_FOUND`（候補のPNGは `Content-Disposition: attachment` と `Cache-Control: private, max-age=0, must-revalidate` を付け、メディアセッションCookieで認可する）。

## エラー契約

### HTTPエラー

| HTTP status | code | 発生条件 | details |
| --- | --- | --- | --- |
| 400 | MALFORMED_JSON | JSON構文が不正、空でないべきbodyが空 | 任意 |
| 403 | LOCAL_ACCESS_DENIED | loopback以外のHost、許可しないOrigin／Fetch Site、または必要なメディアCookieがない | 任意 |
| 404 | RESOURCE_NOT_FOUND | 指定IDのWork、Edition、ScriptVersion、Asset、Job、Artifactがない | resource, id |
| 409 | ASSET_PROCESSING | 参照Assetの取り込みJobが完了していない | assetIds |
| 409 | ASSET_IN_USE | Asset削除時に残存する版またはJobが参照している | assetId, references |
| 409 | FACE_SET_IN_USE | Face Set削除時に外観（ライブラリまたは保存済み版）が参照している | faceSetId, references |
| 409 | WORK_HAS_CHILDREN | 子Workを持つWorkの削除 | workId, childWorkIds |
| 409 | JOB_NOT_CANCELLABLE | queued以外のJobをキャンセルしようとした | jobId, status |
| 413 | FILE_TOO_LARGE | アップロードが設定済み上限を超過 | maxBytes |
| 415 | UNSUPPORTED_MEDIA_TYPE | 許可されない画像、動画、音声形式 | receivedMediaType, allowedMediaTypes |
| 422 | VALIDATION_ERROR | Zod検証、未対応locale、Scene構成規則などに違反 | issues |
| 422 | ASSET_NOT_FOUND | ContentDocumentが存在しないAsset IDを参照 | assetIds |
| 422 | ASSET_UNAVAILABLE | Asset行はあるが実体ファイルが欠損・改変されている。元のバイト列の再アップロードで復旧できる | assetIds |
| 422 | MEDIA_INSPECTION_FAILED | アップロード後にメディア情報を安全に取得できない | 任意 |
| 422 | MEDIA_LIMIT_EXCEEDED | 長さまたは寸法がサーバー設定の上限を超える | measured, limits |
| 422 | PREVIEW_INPUT_INVALID | 保存済み台本をCompositionへ変換できない | issues |
| 422 | RENDER_INPUT_INVALID | レンダー投入時の音声尺超過など。字幕エクスポートのタイミング解決失敗も同じcode | issues |
| 422 | THUMBNAIL_INPUT_INVALID | 保存済みまたは編集中のサムネイル入力を静止画へ変換できない | issues |
| 422 | TTS_INPUT_INVALID | TTS生成要求の空本文・Speaker/Profile未設定・Profileのアダプター外の声・不正な話速 | issues |
| 503 | TTS_ENGINE_UNAVAILABLE | TTSエンジン未起動または接続失敗 | 任意 |
| 500 | INTERNAL_ERROR | 予期しないAPI内部エラー | requestIdのみ |
| 503 | DATABASE_BUSY | busy timeoutを超えるSQLite競合 | 任意のretryAfterMs |

未対応localeのように画面側で個別表示が必要な検証は、MVPではVALIDATION_ERRORのdetails.issuesに含める。専用codeが必要になった時点で後方互換な追加として定義する。

一括TTS生成（POST /script-versions/:scriptVersionId/tts-jobs）は、個別のセリフを生成できないときも全体を失敗させない。投入できなかったセリフは、その理由を応答の `excluded` に `TTS_INPUT_INVALID` または `TTS_ENGINE_UNAVAILABLE` のコードと安全なメッセージで含める。外部 HTTP エラーの本文は返さない。投入済み Job の実行中の失敗は、個別生成と同じく `GET /jobs/:jobId` の `status: failed` で伝える。

### レンダー失敗

Render Jobの実行中の失敗は、Render Job作成リクエストのエラーではない。そのためJob作成は202 Acceptedを返し、失敗は後続のGET /jobs/:jobIdでstatus: failedとして伝える。

MVPで利用者に表示するJob error codeは次に限定する。

| code | 意味 |
| --- | --- |
| ASSET_INGEST_FAILED | 素材の検査または正規化に失敗した。Assetを差し替えるか、別のファイルをアップロードする。 |
| ASSET_UNAVAILABLE | スナップショットに含まれる素材またはRenditionが欠損・改変・削除されている。削除されていないAssetなら元のバイト列の再アップロードで復旧できる。 |
| RENDER_FAILED | HyperFrames、FFmpeg、またはMP4確定保存に失敗した。詳細な内部ログはJob IDで追跡する。 |
| WORKER_INTERRUPTED | ワーカー停止・異常終了で `running` のまま残ったJobを起動時に掃除した。自動再試行はせず、新しいRender Jobを作る。 |

RENDER_INPUT_INVALIDはキュー投入前の422であり、Job error codeではない。この区別により、利用者は入力を直すべきか、同じ入力で再実行すべきかを判断できる。

## 実装上の対応

- packages/contractsに、各request、response、error envelope、ContentDocument、VisualTemplate入力、Jobのkind別inputSnapshotの判別unionのZodスキーマを置く。Express route、React Hook Form、TanStack Query、ワーカーはそこから導出した型だけを使う。contentJsonはキー順を安定させたJSON文字列として保存する（JCS正規化やcontentHashは持たない）。
- MVPではAPIとレンダーワーカーを単一プロセスで起動し、ワーカーはAPIプロセス内のバックグラウンドループとしてキューを処理する。将来の分離に備えてコード境界は分けておく。
- APIはJSON APIとmultipartアップロードで厳密な `Host` と `Origin` を検証する（独自ヘッダ・起動時トークンは用いない）。同一originのUIシェルおよびAPIのGET応答はプロセスごとにランダムな `HttpOnly; SameSite=Strict; Path=/api/v1/` のメディアセッションCookieを発行する。素材・Artifactのcontent配信は、そのCookieとHost（および存在する場合のOrigin／Fetch Site）を検証して、通常のブラウザsubresource・Range requestを許可する。JSON APIはCookieだけを資格情報として受け入れない。
- 素材とArtifactのstorageKeyは内容ハッシュ由来のパスとし、`originalFilename` をパス生成に使わない。
- アプリ管理データのルートはOS提供のアプリデータディレクトリ（macOSではApplication Support配下）とし、特定OSの絶対パスをコードへ埋め込まない。開発時は環境変数 `KAKEAI_DATA_DIR` で差し替える。`db/`、`assets/`、`artifacts/`、`tmp/` を分け、`storageKey` はルート相対で解決する。
- APIがScriptVersionを返すときはDBのcontentJsonを復元・検証してcontentとして返す。現行版は `schemaVersion: 1` とし、旧版の読出し解釈や移行コードは持たない。検証不能なデータは500 INTERNAL_ERRORとして扱い、無検証で返さない。
- Assetの取り込みは、一時領域への保存、ハッシュ計算とメディア検査、既存SHA-256行とそのstorageKeyの確認、アプリ管理領域への確定、Asset行とasset_ingest Jobの作成の順に行う。workerは原本を検査してメタデータを記録し、原本を直接レンダーに使えない場合にだけrender Renditionを作ってからAssetをreadyにする。既存Assetの実体が欠損・破損している場合は、内容ハッシュ由来の同じstorageKeyを上書きして取り込み直す。競合アップロードは一意制約で直列化し、失敗時の一時ファイルは清掃する。
- すべての書込みはDBトランザクションの単位を [spec.md](./spec.md) の「書込みとJob状態遷移」に合わせる。ファイルシステム操作と完全な原子性は持てないため、確定前のファイルを公開せず、確定に失敗した孤立ファイルは起動時に清掃する。削除時はDBから参照を切った後に実体を隔離し、隔離ファイルは起動時に清掃する。
- プレビューとレンダーは同じコンパイラと信頼済みVisualTemplateを使い、Asset解決だけを `assetResolver` の注入で切り替えて生成する。render時は正本JSON、Rendition（無ければ原本）、テンプレート版、出力設定をJobスナップショットへ固定し、ワーカーはそのJSONを実行時にコンパイルする。実行ツールの版は診断用に記録するが、完全な再現性は保証しない。
- Job取得は単一workerを前提にPrismaだけで行う。最古のqueued Jobを検索し、`id` と `status=queued` を条件に `updateMany` して更新件数が1のときだけ実行する。これは偶発的な二重実行を減らすベストエフォートであり、複数workerを厳密に排他するための生SQL・分散ロック・専用キューは導入しない。cancelも `status=queued` を条件に同じ方式で更新する。
