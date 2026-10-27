# エージェントへの SRT 字幕と MP4 Artifact パスの公開

Status: accepted

## 背景

MP4 主線は、エージェントが `render` Job の `succeeded` と `role: "render"` / `format: "mp4"` の Artifact を確認するところまでを担い、最終ファイルの取得は人間に残してきた（[MP4 制作仕様](../agent-mp4-production/spec.md)）。SRT 字幕も Web UI のダウンロードだけだった。しかし投稿用の成果物を揃えるには、エージェントが字幕と最終ファイルを渡せる必要がある。

SRT は保存済み Script Version からオンデマンドで生成され、Artifact にならない（[字幕エクスポート仕様](../subtitle-export/spec.md)）。MP4 は `Artifact` としてデータルート配下に実ファイルで存在し、HTTP の `contentUrl` は media session Cookie を要求する。エージェントはブラウザではないため、その Cookie を取得できない。

MP4 をエージェントへ渡す方法は、大きく 3 つある。

1. データルート内の絶対パスを返す。
2. base64 のバイトを返す。
3. HTTP の `contentUrl` を返す。

### 比較

- パス — 転送量がゼロで、数百 MB の動画でもソケット、MCP、エージェントのコンテキストを圧迫しない。MCP / CLI は同じユーザー・同じマシンで動くため、エージェントはパスをそのままコピーしたり投稿ツールへ渡せる。データルートの位置はエージェントに既知であり（`KAKEAI_DATA_DIR`）、同一ユーザー信頼モデルの範囲である。
- バイト — 自己完結するが、base64 は約 33% 膨らみ、応答のサイズ上限も無い。数分の 1080p MP4 でメモリ・時間・コンテキストの負担が大きく、標準の読み取りタイムアウトにも収まらない。
- `contentUrl` — media session Cookie が HttpOnly で同一 origin に限定され、ブラウザ以外から取得できない。Agent Access は HTTP 接続を公開しない方針でもある。

## 決定

次の 2 操作を read として公開する。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く。

- `script.subtitles` — `{ scriptVersionId }` を受け、`{ scriptVersionId, filename, mimeType, byteSize, srt }` を返す。生成は HTTP の `GET /script-versions/:id/subtitles` と同じ `buildSrt` を使い、タイミングは焼き込み字幕と同じ `resolveTimeline` に従う。Artifact・Job・版を作らない。`byteSize` は `srt` の UTF-8 バイト長。
- `artifact.get` — `{ artifactId }` を受け、`{ artifact, filePath }` を返す。`filePath` は `resolveArtifactContent` が返す、データルート配下の実ファイルへの絶対パスである。同関数がファイルの実在と記録済み `byteSize` の一致を検証する。MP4 は `role: "render"` / `format: "mp4"` の Artifact で、ID は `job.get` / `job.list` から取得する。バイトは返さない。

`artifact.contentUrl` は DTO に残すが、ブラウザ用であり、エージェント向けの取得経路ではないことを仕様に明記する。`artifact.get` は MP4 に限らず、サムネイル PNG や caption の Artifact にも使える。

## Considered Options

- `artifact.get` が base64 を返す。→ 大きな MP4 で応答・メモリ・タイムアウトが破綻する。不採用。
- `artifact.content` を追加し、16 MiB 以下だけバイトを返す。→ サンドボックス化されたエージェントには効くが、操作・契約・上限判定が増える。まずローカルパスで主線を通し、必要になった時点で追加する。
- `contentUrl` を返す。→ media session Cookie が取得できない。不採用。
- SRT をファイルとして Artifact にする。→ 字幕は保存版からいつでも再生成でき、履歴を持つ必要がない（[ADR 0060](./0060-thumbnail-on-demand-png.md) と同じ判断）。テキスト応答に留める。
- SRT を `--out` で書き出す専用のバイナリ操作にする。→ 字幕は小さな UTF-8 テキストで、呼び出し側が `srt` をファイルへ書ける。画像系の `--out` 機構を広げる必要はない。

## Consequences

- Agent Access 仕様の MCP 操作表・操作詳細・エラー表、roadmap、todo、MP4 制作仕様・ロードマップ、制作スキル、ユーザーガイドを更新する。`operationDigest` と `schemaDigest` は変わり、束縛（MCP / CLI）とアプリは同じビルドで揃える。
- エージェントは `script.subtitles` で SRT を投稿用に保存し、`artifact.get` の `filePath` で MP4 を自分のワークスペースや投稿ツールへ渡せる。視聴・最終的な品質判断は人間に残す。
- `filePath` はデータルートを露出するが、MCP / CLI は同一ユーザーで動き、`asset.import` もローカルパスを受け付ける既存の信頼モデルの範囲である。データルート外のパスは `resolveStoragePath` が拒否する。
- サンドボックス化されたエージェントや、データルートをマウントしないエージェントは `filePath` を読めない。必要になった場合は、上限付きの `artifact.content` か、呼び出し側が指定したパスへの書き出しを別 ADR で検討する。
