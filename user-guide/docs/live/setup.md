---
sidebar_position: 3
title: ライブ設定と YouTube の接続
---

# ライブ設定と YouTube の接続

ライブアプリは、不変のライブパッケージとは別に、LLM・TTS・YouTube の接続設定をローカルの JSON ファイルから読みます。このページでは、設定ファイルの作り方と、YouTube のコメントを読むための API キー設定、任意の OAuth フォールバック設定を説明します。

## 設定ファイルの例

公開ライブチャットを読むだけなら、YouTube は API キーだけで動きます。

```json
{
  "llm": {
    "mode": "local",
    "baseUrl": "http://127.0.0.1:11434/v1",
    "model": "qwen2.5:7b-instruct",
    "timeoutMs": 15000
  },
  "tts": {
    "adapters": {
      "voicevox": {
        "baseUrl": "http://127.0.0.1:50021"
      }
    },
    "timeoutMs": 20000,
    "maxConcurrentTts": 2
  },
  "youtube": {
    "apiKey": "AIza...",
    "videoUrl": "https://www.youtube.com/watch?v=xxxxxxxxxxx",
    "pollingIntervalMs": 5000
  },
  "comments": {
    "ngWords": [],
    "maxLength": 300,
    "maxPerAuthorPerMinute": 3,
    "analysisBatchSize": 20,
    "analysisTimeoutMs": 15000
  },
  "port": 3010,
  "dataDir": "/Users/yourname/Library/Application Support/kakeai/live"
}
```

OAuth をフォールバックに使う場合は、`youtube` に `clientId` と `clientSecret` も加えます。

```json
{
  "youtube": {
    "apiKey": "AIza...",
    "clientId": "xxxxx.apps.googleusercontent.com",
    "clientSecret": "xxxxx",
    "videoUrl": "https://www.youtube.com/watch?v=xxxxxxxxxxx"
  }
}
```

:::note[パッケージには接続設定を入れない]
ライブパッケージには LLM・TTS・YouTube の接続設定を含めません。パッケージは声のスナップショットと参照音声だけを持ち、接続先はこの設定ファイルで指定します。
:::

## 設定項目

### `llm`

| 項目 | 内容 |
| --- | --- |
| `mode` | `local` または `external`。実 YouTube は `local` のみ |
| `baseUrl` | OpenAI 互換エンドポイント。`local` はループバックの HTTP、`external` は HTTPS |
| `model` | 使用するモデル名 |
| `apiKey` | 任意。OpenAI 互換サーバーが認証を要求する場合 |
| `timeoutMs` | 分析・応答生成のタイムアウト（既定: 15000） |

ローカル LLM の例（Ollama）:

```sh
ollama serve
ollama pull qwen2.5:7b-instruct
```

この場合の `baseUrl` は `http://127.0.0.1:11434/v1` です。モデル名は実際に導入したものに合わせてください。

実 YouTube のコメント本文・安全要約・生成結果を外部 LLM へ送ることはできません。`mode: "local"` とループバック URL の組み合わせだけが実 YouTube で許可されます。fixture のテストモードでは `mode: "external"` も使えます。API キー方式に変えても、この制約は変わりません。

### `tts`

| 項目 | 内容 |
| --- | --- |
| `adapters` | アダプター ID ごとの `baseUrl` と任意の `apiKey` |
| `timeoutMs` | 生成レス 1 件の TTS タイムアウト（既定: 20000） |
| `maxConcurrentTts` | 同時に実行する TTS の上限（既定: 2） |

指定できるアダプター ID は `voicevox`、`aivisspeech`、`openai-compatible` です。パッケージ内の話者が使うアダプターだけ設定すれば十分です。生成レスの TTS は、この設定にあるループバックの接続先だけを使います。

TTS の声・話速・参照音声はパッケージの `characters.json` / `show.json` に含まれます。参照音声を使う声は、パッケージ内の参照音声をライブアプリが解決して TTS エンジンへ渡します。

### `youtube`

| 項目 | 内容 |
| --- | --- |
| `apiKey` | YouTube Data API v3 の API キー。公開ライブチャットの読み取りに使う第一候補 |
| `clientId` | Google Cloud の OAuth クライアント ID。OAuth フォールバックまたは OAuth のみの設定で使う |
| `clientSecret` | OAuth クライアントシークレット。`clientId` と両方必要 |
| `videoUrl` | ライブの YouTube URL。`liveChatId` を自動解決する |
| `liveChatId` | ライブチャット ID を直接指定する場合 |
| `pollingIntervalMs` | ポーリング間隔の下限。API が返す間隔の方が長ければ API の値を使う |

`videoUrl` と `liveChatId` はどちらか一方が必要です。`videoUrl` には `watch?v=`、`youtu.be/`、`live/`、`shorts/` の形式を指定できます。自動解決できない場合は、YouTube Studio などで確認した `liveChatId` を設定するか、コンソールの「liveChatId」欄から手動で設定してください。

認証設定は次のルールです。

- `apiKey` だけでもよい。
- `apiKey` が無い場合は、`clientId` と `clientSecret` の両方が必要。
- `apiKey` と OAuth クライアントの両方がある場合、OAuth はフォールバックとして使う。
- `clientId` と `clientSecret` の片方だけを指定すると設定エラーになる。

### `comments`

| 項目 | 内容 |
| --- | --- |
| `ngWords` | コメントの前処理でブロックする語 |
| `maxLength` | コメント本文の最大文字数（既定: 300） |
| `maxPerAuthorPerMinute` | 同じ投稿者の 1 分あたりの上限（既定: 3） |
| `analysisBatchSize` | 分析役へ渡す 1 バッチの最大件数（既定: 20） |
| `analysisTimeoutMs` | 分析役のタイムアウト（既定: 15000） |

URL・個人情報・スパム・攻撃的な表現は、設定に関係なくルールベースの前処理でブロックまたは確認対象になります。

### `port` と `dataDir`

- `port` はライブアプリの待受ポートです。OBS の URL とコンソールの URL に使います。
- `dataDir` は実行ディレクトリ・ログ・OAuth トークンの保存先です。省略時は `~/Library/Application Support/kakeai/live` です。環境変数 `KAKEAI_LIVE_DATA_DIR` で上書きできます。

## YouTube の API キー設定（推奨）

ライブアプリは YouTube のコメントを **読み取り専用** で取得します。公開ライブチャットを読むだけなら、OAuth の同意画面やトークン保存は不要です。

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成します。
2. 「API とサービス」→「ライブラリ」で **YouTube Data API v3** を有効にします。
3. 「API とサービス」→「認証情報」→「認証情報を作成」→「API キー」を選びます。
4. 作成したキーの「API の制限」で **YouTube Data API v3** だけを許可します。アプリケーションの制限は、利用環境に合わせて必要最小限にしてください。
5. 表示された API キーを設定ファイルの `youtube.apiKey` に貼り付けます。

```json
{
  "youtube": {
    "apiKey": "AIza...",
    "videoUrl": "https://www.youtube.com/watch?v=xxxxxxxxxxx"
  }
}
```

API キーだけで起動する場合、`live auth` は不要です。実行しても「APIキー方式では認証不要です」と表示され、トークンは保存されません。

:::note[API キーは公開データの読み取りだけ]
API キーには YouTube への書き込み権限がありません。配信の作成・開始・終了、チャット投稿、削除・ピン留め・モデレーションは行えません。API キーを他の人と共有したり、リポジトリにコミットしたりしないでください。
:::

メンバー限定チャット、非公開配信、権限エラーなど、API キーでは読めない場合は OAuth を使います。API キーが認証系のエラーで失敗し、OAuth の設定と有効なトークンがある場合、ライブアプリは同じリクエストを OAuth で 1 回だけ再試行します。配信終了・チャット無効・チャットが見つからない場合は、認証では解決しないため再試行しません。

## YouTube の OAuth フォールバック設定（任意）

次のような場合に OAuth を設定します。

- メンバー限定チャットや非公開配信を読む
- API キーでは権限エラーになる
- API キーを使わず、OAuth だけで運用したい

OAuth を使う場合も、スコープは次の 1 つだけです。

```text
https://www.googleapis.com/auth/youtube.readonly
```

### 1. Google Cloud プロジェクトと OAuth 同意画面

1. API キーと同じ Google Cloud プロジェクトを使えます。「API とサービス」→「ライブラリ」で **YouTube Data API v3** を有効にします。
2. 「OAuth 同意画面」（または Google Auth Platform の設定）を開きます。
3. ユーザーの種類は、個人利用なら **External**、Google Workspace 内で使うなら **Internal** を選びます。
4. アプリ名・サポートメール・デベロッパー連絡先を入力します。
5. External の Testing のまま使う場合は、**テストユーザー** に自分の Google アカウントを追加します。

### 2. OAuth クライアントを作る

1. 「API とサービス」→「認証情報」→「認証情報を作成」→「OAuth クライアント ID」を選びます。
2. アプリケーションの種類は **デスクトップ アプリ** を選びます。
3. 作成後に表示される **クライアント ID** と **クライアントシークレット** を控えます。
4. 設定ファイルの `youtube.clientId` と `youtube.clientSecret` に貼り付けます。

ライブアプリは `127.0.0.1` のランダムなポートで認証コードを受け取ります。デスクトップ アプリのクライアントなら、ポートごとのリダイレクト URI 登録は不要です。

### 3. 初回認証

OAuth の設定を入れて、リポジトリのルートで次を実行します。

```sh
npm run live -- auth --config /path/to/live-config.json
```

ターミナルに認可 URL が表示されます。ブラウザで開き、使用する Google アカウントでログインして、**YouTube のデータの読み取り** を許可してください。認証が終わると、次の場所にトークンが保存されます。

```text
<dataDir>/auth/youtube.json
```

このファイルは利用者だけが読める権限（0600）で保存されます。他の人と共有したり、リポジトリにコミットしたりしないでください。

API キーと OAuth を併用する場合、このトークンはフォールバック用です。API キーだけで動く間は使われません。

### 4. 再認証と 7 日失効

OAuth 同意画面が **Testing** の External アプリの場合、リフレッシュトークンは通常 7 日で失効します。この制約は OAuth を使う場合だけのものです。API キーのみの運用では `live auth` も 7 日失効の警告も不要です。

OAuth を使う場合、コンソールの「コメントソース」に認証期限が表示されます。期限切れ、または `invalid_grant` が発生したときは、もう一度 `live auth` を実行してください。

```sh
npm run live -- auth --config /path/to/live-config.json
```

### 5. 公開・検証の判断

Weekly など継続的に OAuth で配信する場合は、Testing の 7 日失効が負担になります。次のどちらかを選んでください。

- **Testing のまま使う**: 初期の試用向け。7 日ごとに `live auth` で再認証します。
- **アプリを公開する**: OAuth 同意画面を Production に移行します。`youtube.readonly` は機密性の高いスコープのため、Google の検証が必要になる場合があります。検証の要否と手順は Google の案内に従ってください。

公開ライブチャットの読み取りだけなら、OAuth を公開せず API キーを使う選択もできます。

:::note[認証情報を消したいとき]
OAuth を取り消す場合は、Google アカウントの「サードパーティ アプリとサービス」からアクセスを取り消し、`<dataDir>/auth/youtube.json` を削除してください。OAuth を取り消したときは、コメント関連のキャッシュも残さないでください。API キーを失効させる場合は、Google Cloud の認証情報からキーを削除または再作成してください。
:::

## 起動前の確認

```sh
npm run live -- --package /tmp/live-package-10m --config /path/to/live-config.json
```

実 YouTube で起動するときは、次の条件を満たさないと起動が拒否されます。

- `llm.mode` が `local` で、`baseUrl` がループバック
- `youtube` に `apiKey`、または `clientId` と `clientSecret` がある
- `youtube` に `videoUrl` または `liveChatId` がある
- OAuth のみの設定の場合は、`live auth` でトークンが保存されている

起動後、コンソールの「コメントソース」に接続状態・認証方式（APIキー / OAuth）・OAuth フォールバックの有無・ポーリング間隔・クォータ概算・認証期限が表示されます。エラーがある場合は [トラブルシューティング](./troubleshooting.md) を確認してください。
