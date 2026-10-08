# ローカルAPI保護はHost・Origin・SameSite Cookieを必須とし、独自ヘッダと起動トークンを省く

Status: supersedes ADR-0005

無認証のローカルAPIの保護は、JSON／アップロードAPIに対する厳密な `Host` と `Origin` の検証、および素材・Artifactのcontent配信に対する同一originの `HttpOnly; SameSite=Strict` メディアセッションCookieに限定する。`Host` 検証でDNSリバインディングを、`Origin` 検証と `SameSite=Strict` CookieでCSRFと素材漏洩を防ぐ。独自ヘッダ `X-Kakeai-Client` と起動時トークンは、同じ脅威に対する冗長な追加層のため省く。

## Considered Options

- 独自ヘッダと起動時トークンも要求する（旧 ADR-0005）。→ 防御が重複し、UIへのトークン注入経路を余分に保守するため不採用。

## Consequences

UIシェルが発行するメディアセッションCookieの経路は残る。認証・共有を対象外にしても、この保護は省略しない。
