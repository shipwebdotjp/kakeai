# MCP の preview.frame は text ブロックを画像なしの要約とし、全内容は structuredContent と image ブロックに持たせる

Status: accepted

Amends [ADR 0078](./0078-agent-preview-frame-image-transport.md): 成功結果の3要素が同じ内容を表す方針に、`preview.frame` の text ブロックだけ例外を設ける。

原寸 PNG の base64 はフルHD で数MB（数M文字）に達し、MCP 応答に3重化すると会話コンテキストを base64 で埋め尽くす。image ブロックは絵を見る経路、structuredContent は機械可読の全出力として残し、会話モデルが読む text ブロックだけ画像バイトを省いた要約 JSON とする。

## Considered Options

- 3要素とも全出力を保つ（ADR 0078 の原案）。→ CLI との一致不変条件は最も単純だが、text ブロックの base64 がエージェントのコンテキストを圧迫する。不採用。
- `structuredContent` からも `pngBase64` を省く。→ 「CLI の stdout JSON は MCP の `structuredContent` と一致する」不変条件が崩れ、束縛間の差異が増える。不採用。
- 画像バイトを別ファイルに書いてパスだけ返す。→ ADR 0078 で不採用とした理由（寿命管理・配置の推測）が残る。不採用。

## Consequences

- `kakeai_preview_frame` の成功結果は、`content[0].text` が `pngBase64` を除いたメタ情報の JSON、`structuredContent` が契約どおりの全出力（`pngBase64` を含む）、`content[1]` が標準の image ブロック（`{ type: "image", data, mimeType }`）となる。
- 「同じ操作・同じ入力なら CLI の stdout JSON（`--out` なし）は MCP の `structuredContent` と一致する」不変条件は保つ。text ブロックが要約であることはツール説明文に明記し、エージェントが JSON の base64 を転記しないよう促す。
- 例外は `preview.frame` に限る。他の操作の text／structuredContent の一致は変えない。
