# YouTubeコメント取得はAPIキーを第一候補とし、OAuthをフォールバックにする

Status: accepted

v1のYouTubeコメント取得は、`youtube.apiKey` を第一候補にし、`youtube.clientId` と `youtube.clientSecret` によるOAuthをフォールバックとして残す。APIキーは公開ライブチャットの読み取りだけに使い、YouTube Data API v3に制限する。OAuthは、メンバー限定・非公開・権限エラーなどAPIキーで読めない場合、または利用者がOAuthを選んだ場合に使う。読み取り専用のまま、YouTubeの書き込みAPIは追加しない。

## Context

- ADR-0121でYouTube連携は読み取り専用にした。ADR-0123で実YouTubeのコメント処理をローカルLLMに限定し、ADR-0128で`liveChatMessages.list`のポーリングを正規経路にした。
- YouTube Data API v3の`videos.list`と`liveChatMessages.list`は、公開データの読み取りにAPIキーを使える。公開ライブチャットを見るだけなら、OAuthの同意画面・リフレッシュトークン・スコープ検証は必須ではない。
- OAuthアプリをTestingのまま使うとリフレッシュトークンが7日で失効する。配信のたびに`live auth`が必要になる運用負担が大きい。
- メンバー限定チャット、非公開配信、権限不足など、APIキーでは読めない場合がある。OAuthを完全に削除すると、これらの利用者がライブを実行できなくなる。
- APIキーはローカル設定ファイルに置く。コンソールのstatus、ログ、エラー本文には出さない。

## 決定

- `youtube.apiKey` がある場合、APIキーを第一候補にする。`videos.list`と`liveChatMessages.list`の両方で、`key=<apiKey>`を付けたGETを使う。Authorizationヘッダーは付けない。
- `youtube.apiKey` がない場合は、`youtube.clientId` と `youtube.clientSecret` を必須にし、OAuthトークンで読み取る。OAuthのみの既存設定はそのまま有効とする。
- APIキーとOAuthクライアントの両方がある場合、OAuthはフォールバック候補として扱う。APIキーのリクエストが401、403の`authError`/`forbidden`/`insufficientPermissions`/`keyInvalid`、または400の`keyInvalid`/`API_KEY_INVALID`で失敗し、有効なOAuthトークンがある場合に限り、同じリクエストをOAuthで1回だけ再試行する。再試行は1リクエストにつき1回までとし、無限に切り替えない。
- `liveChatDisabled`、`liveChatEnded`、`liveChatNotFound`は端末エラーとして扱い、OAuthへフォールバックしない。配信が終わった・チャットが無効という状態は認証で解決しないためである。
- OAuthスコープは引き続き`https://www.googleapis.com/auth/youtube.readonly`だけを使う。APIキーにも書き込み権限はなく、YouTubeの書き込みAPIは追加しない。
- 実YouTubeのコメント分析と応答生成はローカルLLMだけを使う。APIキーに変えても、コメント本文・安全要約・生成結果を外部LLMへ送らない制約は変えない。
- APIキーとOAuthトークンはログ・status・エラー本文に出さない。statusには認証方式（`apiKey`/`oauth`）とフォールバックの有無だけを出す。

## Considered Options

- OAuthだけを残す。→ Testingの7日失効と同意画面の設定が、公開チャットを読むだけの利用にも必要になるため不採用。OAuthはフォールバックに残す。
- APIキーだけにする。→ メンバー限定・非公開・権限エラーで読めなくなり、既存のOAuth利用者を切り捨てるため不採用。
- APIキーが失敗したら毎回OAuthへ切り替える。→ チャット終了などの端末エラーでも再試行して遅延とクォータを増やすため不採用。認証系の失敗だけに限る。
- OAuthアプリの公開・検証を必須にする。→ 公開チャットの読み取りだけならAPIキーで足りるため、v1の必須手順にはしない。OAuthを使う場合の任意手順として残す。

## Consequences

- 公開ライブチャットの読み取りは、Google CloudでAPIキーを作り、YouTube Data API v3に制限するだけで始められる。`live auth`は不要になる。
- OAuthの7日失効は、OAuthをフォールバックまたは主方式として使う場合だけの運用負担になる。APIキーのみの利用者は影響を受けない。
- メンバー限定・非公開・権限エラーに備えるため、OAuthの設定手順とトークン保存は残る。
- APIキーが漏えいした場合の影響は、YouTube Data API v3の読み取りクォータに限られる。キーは共有せず、リポジトリにコミットしない運用が必要になる。
- 認証方式が増えるため、コンソールとユーザーガイドに、現在の方式とフォールバックの有無を表示する。
- 公開チャットをAPIキーで読めるかは、実配信での確認を残す。失敗した場合はOAuthフォールバックまたはOAuthのみの設定で継続する。
