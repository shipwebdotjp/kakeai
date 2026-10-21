# エージェント向け静止画は原寸PNGをbase64で運び、MCPはimageブロック、CLIは--outでファイルに書く

Status: accepted

Amended by [ADR 0079](./0079-mcp-preview-frame-text-summary.md): `preview.frame` の MCP 成功結果に限り、`content[0].text` は画像バイトを省いた要約 JSON とする（`structuredContent` と image ブロックは全内容のまま）。

`preview.frame` は render 成果物（`role: "render"`、`format: "mp4"` の Artifact）から指定時刻のフレームを PNG で返す読み取り操作である。ローカル制御ソケットは NDJSON の JSON 専用でバイナリを運べないため、操作コアの出力は原寸 PNG を base64 文字列（`pngBase64`）と寸法・解決時刻のメタ情報で表す。原寸とするのは、エージェントの目視確認に縮小版では落ちる細部（テロップの文字化け・輪郭）が残るためであり、フルHD の PNG でも数MB 程度でソケットの 32MiB 上限に十分収まる。

## Considered Options

- 長辺 1280px 等へ縮小して返す。→ ペイロードは減るが、品質確認の用途で細部が落ちる。縮小は将来の任意パラメータとして残し、既定は原寸とする。不採用。
- ソケットにバイナリフレームを追加する。→ NDJSON のフレーム設計とペイロード上限・タイムアウトの前提を崩し、全束縛の受信実装を作り替える必要がある。不採用。
- 画像バイトを別途ファイルに書き、パスだけ返す。→ 同一ユーザー内のローカル配置をエージェントに推測させ、パスの寿命管理が増える。MCP の標準 image ブロックと CLI の `--out` で足りる。不採用。

## Consequences

- 操作コアの `preview.frame` 出力は `{ artifactId, requestedTimeMs, resolvedTimeMs, width, height, mimeType, pngBase64 }` とする。時刻の丸めは既存の `resolveStillFramePtsMs`（指定 ms 以下で最後のフレーム PTS）の規則を再利用し、キャッシュは `still-frame.ts` の `(sha256 + pts + extractorVersion)` キーを再利用する。新規のキャッシュ機構は作らない。
- MCP 束縛は成功結果に `{ type: "image", data: pngBase64, mimeType }` の標準コンテントブロックを1つ追加する。`text` と `structuredContent` は従来どおり全出力を含め、「同じ操作・同じ入力なら CLI の stdout JSON は MCP の `structuredContent` と一致する」不変条件を保つ。3重化によるペイロード増はフルHD 前提で許容範囲とする。
- CLI は `--out <path.png>` を受け付け、指定時は PNG バイトをそのファイルに書き、stdout JSON は `pngBase64` を省いて `path` を付す。`--out` なしの形は変えない。入出力スキーマの検証はファイル書込みの前に行う。
- `preview.frame` は版を追加せず Artifact も作らない読み取り操作であり、実体削除・外部公開・課金生成の禁止は侵さない。視覚品質の最終判断は人に残す原則は変えず、スキルは「所見の報告＋利用者の確認」の手順とする。
