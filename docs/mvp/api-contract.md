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
- `GET /assets/:assetId/content` と `GET /artifacts/:artifactId/content` は、ブラウザが独自ヘッダを付けられないsubresource・Range requestとして利用できなければならない。同一originのUIシェルの応答、および開発時にシェルをVite dev serverが配信する場合に備えて同一originのAPIのGET応答で、プロセスごとにランダムなホスト専用・非永続の `Kakeai-Media-Session` Cookieを `HttpOnly; SameSite=Strict; Path=/api/v1/` で発行する。`Sec-Fetch-Site` が `cross-site` の要求では発行しない。content配信はこのCookieと厳密なHost検証で認可し、`Origin` がある場合は同一originだけを受け入れる。`Sec-Fetch-Site` がある場合も `same-origin` でなければならない。JSON APIはこのCookieだけでは認可しない。将来UIをHTTPSで提供するときはCookieに `Secure` を追加する。
- content配信は上記メディアセッションCookieで認可する。`contentUrl` は資格情報をクエリへ埋め込まない同一originの相対URLとし、HyperFrames Playerは不透明originになるsandboxで実行しない。

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
          "message": "MVPで利用できる言語は ja-JP です。"
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
| LanguageEditionSummary | id, workId, locale, updatedAt, currentScriptVersion | currentScriptVersionは `currentScriptVersionId` が指すID、版番号、作成日時の要約。MVPでは1 Workにつき1つのja-JP Editionだけを作る。 |
| ScriptVersion | id, languageEditionId, versionNumber, contentSchemaVersion, content, createdAt | contentはContentDocumentそのもの。保存後に更新しない。 |
| Asset | id, kind, origin, status, originalFilename, mediaType, byteSize, sha256, durationMs, widthPx, heightPx, createdAt, contentUrl | statusは `processing` / `ready` / `failed`。durationMsはreadyなrender Renditionの尺（imageではnull）、widthPxとheightPxはaudioではnull。contentUrlは原本へのURLであり、編集・レンダーにはreadyなAssetだけを選択できる。 |
| Job | id, kind, status, workId, assetId, languageEditionId, scriptVersionId, progressPercent, createdAt, startedAt, finishedAt, error, ttsResult, artifacts | 入力スナップショット自体は返さない。`artifacts` は出力の要約配列。kindは `asset_ingest` / `render` / `tts`。`ttsResult` は `tts` Jobが生成したAudio Take候補で、それ以外はnull。 |
| Artifact | id, jobId, role, format, byteSize, durationMs, widthPx, heightPx, fps, createdAt, contentUrl | Jobの出力ファイル。MVPは role=render / format=mp4。ファイルは同一originのメディアCookieを使ってcontentUrlから取得・再生する。 |
| VoiceProfile | id, name, adapterId, settings, createdAt, updatedAt | アプリ共通の声の設定。`adapterId` は `voicevox` または `aivisspeech`（作成後は不変）、`settings` はアダプター専用で両者とも `speakerUuid` と `defaultStyleId`。詳細は [../tts/spec.md](../tts/spec.md)。 |
| TtsVoice | voiceId, name, styles | 接続中エンジンの話者。`styles` は `styleId` と表示名の配列。`styleId` は 32bit 符号付き整数。 |
| CharacterLibraryEntry | id, name, voiceProfileId, appearances, createdAt, updatedAt | アプリ共通のキャラクター。`appearances` は画像 Asset と表情・ポーズ・任意の表示名 `label`。詳細は [../character-library/spec.md](../character-library/spec.md)。 |

値がないDTOフィールドは省略せずnullを返す。これにはdurationMs、workId、assetId、languageEditionId、scriptVersionId、startedAt、finishedAt、errorが含まれる。`artifacts` は値がないとき空配列とする。

## エンドポイント一覧

| メソッド | パス | 成功 | 用途 |
| --- | --- | --- | --- |
| GET | /health | 200 | APIとローカルレンダーワーカーの稼働確認 |
| GET | /works | 200 | 作品一覧 |
| POST | /works | 201 | Work、ja-JP Edition、ContentDocument v3の初期ScriptVersionを作成 |
| GET | /works/:workId | 200 | 作品とEditionの取得 |
| PATCH | /works/:workId | 200 | 管理上の作品名を変更 |
| DELETE | /works/:workId | 204 | 作品、版、Job、Artifactを明示削除 |
| GET | /language-editions/:editionId/current-script-version | 200 | 現在の完全な台本を取得 |
| GET | /language-editions/:editionId/script-versions | 200 | 台本版のメタデータ履歴を取得 |
| POST | /language-editions/:editionId/script-versions | 201 | 検証済みContentDocumentから新しい不変版を作成 |
| GET | /script-versions/:scriptVersionId | 200 | 指定した完全な台本版を取得 |
| GET | /assets | 200 | アプリ共通素材ライブラリを取得 |
| POST | /assets | 202 / 200 | 原本をアップロードし、素材取り込みJobを開始または既存素材を取得 |
| GET | /assets/:assetId | 200 | 素材メタデータを取得 |
| GET | /assets/:assetId/content | 200 / 206 | 素材ファイルを配信 |
| GET | /assets/:assetId/render-content | 200 / 206 | readyなrender Renditionを配信 |
| DELETE | /assets/:assetId | 204 | 未参照の素材を明示削除 |
| GET | /script-versions/:scriptVersionId/preview | 200 | 信頼済みComposition HTMLと素材URLを取得 |
| POST | /script-versions/:scriptVersionId/render-jobs | 202 | 入力スナップショットを持つRender Jobをキューへ追加 |
| GET | /works/:workId/jobs | 200 | 作品のRender Job履歴を新しい順に取得 |
| GET | /jobs/:jobId | 200 | Render Jobの状態をポーリング |
| POST | /jobs/:jobId/cancel | 200 | queued Jobをキャンセル |
| GET | /artifacts/:artifactId | 200 | Artifactのメタデータを取得 |
| GET | /artifacts/:artifactId/content | 200 / 206 | Artifactファイルを配信 |
| DELETE | /artifacts/:artifactId | 204 | 生成済み出力を明示削除 |
| GET | /voice-profiles | 200 | アプリ共通のVoice Profile一覧を取得 |
| POST | /voice-profiles | 201 | Voice Profileを作成 |
| PATCH | /voice-profiles/:voiceProfileId | 200 | Voice Profileの表示名と設定を更新 |
| DELETE | /voice-profiles/:voiceProfileId | 204 | 未参照のVoice Profileを削除 |
| GET | /voice-profiles/voices?adapterId=voicevox\|aivisspeech | 200 | 接続中エンジンの話者とスタイルを取得（[../tts/spec.md](../tts/spec.md)） |
| POST | /script-versions/:scriptVersionId/narration-segments/:narrationSegmentId/tts-jobs | 202 | TTS Jobをキューへ追加（[../tts/spec.md](../tts/spec.md)） |
| GET | /characters | 200 | キャラクターライブラリの一覧を取得（[../character-library/spec.md](../character-library/spec.md)） |
| POST | /characters | 201 | キャラクターを作成 |
| PATCH | /characters/:characterId | 200 | キャラクターの名前・声・外観を更新 |
| DELETE | /characters/:characterId | 204 | キャラクターを削除 |

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
      "locales": ["ja-JP"],
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

POST /works は、Work、ja-JPのLanguageEdition、`schemaVersion: 3` の `explanation-scenes@1` を持つ初期ScriptVersion（`versionNumber: 1`）を同じトランザクションで作成する。初期Sceneは導入、要点3件、結びとし、各Sceneにはテンプレート既定の `accentColor` を入れる。要点Sceneは音声主導の `timing.mode: "auto"`、導入と結びはテンプレート既定の固定尺にする。Editionの `currentScriptVersionId` を初期版に設定する。クライアントは初期のContentDocumentを送らない。

~~~http
POST /api/v1/works
Content-Type: application/json

{
  "title": "テンプレート解説",
  "originalLocale": "ja-JP"
}
~~~

originalLocaleは将来の互換性のため必須とするが、MVPで受け付ける値はja-JPだけである。成功時は201 Createdと、作成した完全なWork DTOを返す。

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
      "createdAt": "2026-10-08T03:20:00.000Z"
    },
    {
      "id": "scr_001",
      "languageEditionId": "led_ja_123",
      "versionNumber": 1,
      "contentSchemaVersion": 3,
      "createdAt": "2026-10-08T03:00:00.000Z"
    }
  ]
}
~~~

### 台本の保存

POST /language-editions/:editionId/script-versions は既存の版を更新しない。クライアントはContentDocument全体をcontentに渡す。保存はlast-write-winsとし、受理時は表示用に単調増加のversionNumberを割り当て、新版のIDへ `currentScriptVersionId` を進める。書込みで受け入れるContentDocumentは `schemaVersion: 3` とする。contentの完全な契約は [content-schema.md](./content-schema.md) に従う。

~~~jsonc
{
  "sourceScriptVersionId": null,
  "content": {
    "schemaVersion": 3,
    "locale": "ja-JP",
    "template": {
      "id": "explanation-scenes",
      "version": 1
    },
    "speakers": [],
    "characters": [],
    "audioTakes": [],
    "scenes": [
      // 導入、0件以上の要点、結びをこの順で全て含める
    ],
    "audioCues": []
  }
}
~~~

上の例は構造を示すためのjsoncである。実際の送信値はコメントを含まない完全なContentDocumentでなければならない。APIはEditionのlocale、`explanation-scenes@1` のScene構成、すべてのreadyなAsset参照、音声尺とScene尺の制約を検証し、違反は422 VALIDATION_ERRORのdetails.issuesに該当フィールドのJSON Pointerと理由を含める。ContentDocumentは対応済みVisualTemplateの複数Cue、`lines`、`offset` の範囲指定も受け入れる。テンプレートごとの最大行数・最小フォントサイズに照らしたテキスト量は、収まらなくても保存を拒否せず、`meta.warnings` に該当フィールドのJSON Pointerと理由を返す。過去版を復元する場合、UIは復元元を `sourceScriptVersionId` に指定してその内容を新しい版として保存する。復元元は同じEditionの版だけを受け入れる。

成功時は201 Createdと、新しい完全なScriptVersion DTOを返す。

~~~json
{
  "data": {
    "id": "scr_003",
    "languageEditionId": "led_ja_123",
    "versionNumber": 3,
    "contentSchemaVersion": 3,
    "content": {
      "schemaVersion": 3,
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

GET /assets は作成日時の降順でAsset配列を返す。任意の kind=image、kind=video、kind=audio クエリで絞り込みできる。存在しないkindは422 VALIDATION_ERRORとする。各Assetは利用者が編集できる `tags` を含む。タグによる絞り込みはサーバーでは行わず、取得済み配列をクライアント側で絞り込む。

~~~json
{
  "data": [
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
      "tags": ["背景", "夏"],
      "createdAt": "2026-10-08T03:10:00.000Z",
      "contentUrl": "/api/v1/assets/ast_image_001/content"
    }
  ]
}
~~~

GET /assets/:assetId は同じ1件のAsset DTOを返す。GET /assets/:assetId/content は原本を検出済みのMIME typeで返し、動画・音声の確認に必要なHTTP Range requestをサポートする。GET /assets/:assetId/render-content は、正規化Renditionがあればそれを、無ければ原本を返す。正常な部分応答は206 Partial Contentとする。両エンドポイントはメディアセッションCookieで認可されるため、`<img>`、`<audio>`、`<video>` の通常の読み込みとシークで利用できる。Compositionで使うURLは後者であり、原本をそのまま使える場合も同じURLから原本が返る。

### タグの更新

PATCH /assets/:assetId は `{ "tags": [string, ...] }` を受け取り、タグ配列を丸ごと置き換えて更新後のAsset DTOを返す。タグは各要素の前後空白を除去し、空文字を除き、重複を1つにまとめる。1素材あたり最大30個、1タグ最大40文字。空配列はタグ無し（`tagsJson` はNULL）として保存する。存在しない素材は404 `RESOURCE_NOT_FOUND`、契約違反は422 `VALIDATION_ERROR` とする。タグは原本の同一性（`sha256`・`storageKey`・`kind`・寸法・長さ）に影響しない。

~~~http
PATCH /api/v1/assets/ast_image_001
Content-Type: application/json

{ "tags": ["背景", "夏"] }
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

## プレビュー

GET /script-versions/:scriptVersionId/preview は、保存済みの完全なScriptVersionだけをプレビュー対象にする。編集中で未保存のフォーム値をこのエンドポイントへ送らない。

APIはContentDocumentと参照Assetを検証し、すべてがreadyであることを確認してアプリ管理のVisualTemplateからComposition HTMLを生成する。Asset IDの表示参照への解決は、プレビュー向けの `assetResolver`（各Assetのレンダー用content URLへ変換。正規化Renditionが無ければ原本）をコンパイラに注入して行う。コンパイラは解決方式を知らず、レンダーでは同じコンパイラにレンダー用のローカルファイルパス（Renditionが無ければ原本）を解決する `assetResolver` を注入する。利用者入力をHTMLまたはJavaScriptとしてそのまま返すことはない。Web UIは返されたHTMLを同一originで実行するHyperFrames Playerへ渡し、Asset URLを同じレスポンスの `assets[].contentUrl` から解決する。Playerの素材読み込みはメディアセッションCookieで認可される。

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
          ]
        }
      ]
    }
  }
}
~~~

`timeline` は解決済みのScene区間・line区間・総尺であり、プレビューの再生コントロール（Scene／セリフ移動、±x秒、コマ送り）がUIで再計算しないための非永続の派生データである。出力fpsは `output.fps`（30）を用いる。解決ロジックはコンパイラと同じタイムライン解決器を使う。詳細は [../editor/spec.md](../editor/spec.md) を正とする。

この結果は永続化しないプレビュー用の派生データである。Assetがprocessingなら409 `ASSET_PROCESSING`、failed・欠損・破損・削除済みなら422 `ASSET_UNAVAILABLE` を返す。Composition HTMLが生成できない場合は422 PREVIEW_INPUT_INVALIDとし、原因となったContentDocumentまたはVisualTemplateの位置をJSON Pointerとしてdetails.issuesに含める。ファイルシステムパスは返さない。

## レンダー

### Render Jobの作成

POST /script-versions/:scriptVersionId/render-jobs は、対象の版、参照Assetとreadyなrender Renditionのハッシュ・メタデータ、テンプレート版、出力設定、実行環境の版、`snapshotSchemaVersion` を固定したJobを作る。Composition HTMLはキュー投入時に固定せず、workerがこのスナップショットJSONを信頼済みコンパイラで実行時に生成する。HTTPリクエスト中にMP4を生成しない。Jobは複数のArtifactを持て、MVPのrender Jobは `role=render` / `format=mp4` のArtifactを1つ生成する。

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

## エラー契約

### HTTPエラー

| HTTP status | code | 発生条件 | details |
| --- | --- | --- | --- |
| 400 | MALFORMED_JSON | JSON構文が不正、空でないべきbodyが空 | 任意 |
| 403 | LOCAL_ACCESS_DENIED | loopback以外のHost、許可しないOrigin／Fetch Site、または必要なメディアCookieがない | 任意 |
| 404 | RESOURCE_NOT_FOUND | 指定IDのWork、Edition、ScriptVersion、Asset、Job、Artifactがない | resource, id |
| 409 | ASSET_PROCESSING | 参照Assetの取り込みJobが完了していない | assetIds |
| 409 | ASSET_IN_USE | Asset削除時に残存する版またはJobが参照している | assetId, references |
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
| 422 | RENDER_INPUT_INVALID | レンダー投入時の音声尺超過など | issues |
| 422 | TTS_INPUT_INVALID | TTS生成要求の空本文・Speaker/Profile未設定・無効スタイル・不正な話速 | issues |
| 503 | TTS_ENGINE_UNAVAILABLE | TTSエンジン未起動または接続失敗 | 任意 |
| 500 | INTERNAL_ERROR | 予期しないAPI内部エラー | requestIdのみ |
| 503 | DATABASE_BUSY | busy timeoutを超えるSQLite競合 | 任意のretryAfterMs |

未対応localeのように画面側で個別表示が必要な検証は、MVPではVALIDATION_ERRORのdetails.issuesに含める。専用codeが必要になった時点で後方互換な追加として定義する。

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
- APIがScriptVersionを返すときはDBのcontentJsonを、そのschemaVersionに対応するZodスキーマで復元・検証してcontentとして返す。MVPの保存済み版は `schemaVersion: 3` のみで、旧版の読出し解釈は持たない。検証不能なデータは500 INTERNAL_ERRORとして扱い、無検証で返さない。
- Assetの取り込みは、一時領域への保存、ハッシュ計算とメディア検査、既存SHA-256行とそのstorageKeyの確認、アプリ管理領域への確定、Asset行とasset_ingest Jobの作成の順に行う。workerは原本を検査してメタデータを記録し、原本を直接レンダーに使えない場合にだけrender Renditionを作ってからAssetをreadyにする。既存Assetの実体が欠損・破損している場合は、内容ハッシュ由来の同じstorageKeyを上書きして取り込み直す。競合アップロードは一意制約で直列化し、失敗時の一時ファイルは清掃する。
- すべての書込みはDBトランザクションの単位を [spec.md](./spec.md) の「書込みとJob状態遷移」に合わせる。ファイルシステム操作と完全な原子性は持てないため、確定前のファイルを公開せず、確定に失敗した孤立ファイルは起動時に清掃する。削除時はDBから参照を切った後に実体を隔離し、隔離ファイルは起動時に清掃する。
- プレビューとレンダーは同じコンパイラと信頼済みVisualTemplateを使い、Asset解決だけを `assetResolver` の注入で切り替えて生成する。render時は正本JSON、Rendition（無ければ原本）、テンプレート版、出力設定をJobスナップショットへ固定し、ワーカーはそのJSONを実行時にコンパイルする。実行ツールの版は診断用に記録するが、完全な再現性は保証しない。
- Job取得は単一workerを前提にPrismaだけで行う。最古のqueued Jobを検索し、`id` と `status=queued` を条件に `updateMany` して更新件数が1のときだけ実行する。これは偶発的な二重実行を減らすベストエフォートであり、複数workerを厳密に排他するための生SQL・分散ロック・専用キューは導入しない。cancelも `status=queued` を条件に同じ方式で更新する。
