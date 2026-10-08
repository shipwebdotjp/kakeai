# 無認証のローカルAPIを用途別の資格情報で保護する

Status: superseded by ADR-0015

認証を持たないローカル API をループバックへ束縛し、用途に応じて次の資格情報で保護する。

- JSON APIとアップロードは、厳密な `Origin`/`Host` 検証、独自ヘッダ（例 `X-Kakeai-Client`）、起動時トークンを要求する。
- 素材・Artifactのcontent配信は、同一オリジンの `HttpOnly; SameSite=Strict` メディアセッションCookie、またはJSON APIと同じ完全なヘッダ・トークン資格情報を受け入れる。前者によりブラウザの通常のメディア読み込みを可能にし、JSON APIはCookieだけでは認可しない。

理由は、任意のブラウザページが `http://localhost:PORT` を叩くと、素材の読み出しやレンダーの起動ができてしまうため（DNS リバインディング・CSRF）である。一方、`<img>`、`<audio>`、`<video>` とそのRange requestは独自ヘッダやJavaScript注入トークンを付けられない。content配信まで同じヘッダを必須にすると、プレビューとMP4再生が成立しない。認証・共有を対象外にしても、この保護は省略しない。

## Consequences

Web UIへ起動時トークンを注入する経路と、UIシェル応答でメディアセッションCookieを発行する経路が必要になる。UI、HyperFrames Player、content URLは同一オリジンで動かし、Playerを不透明originになるsandboxで実行しない。content URLはCookieにより通常のブラウザsubresourceおよびRange requestとして利用できる。
