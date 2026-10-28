# 視覚確認仕様

Agent Access の R3-4「視覚確認」を正とする。エージェントが指定時刻の静止画を取得し、目視確認の所見を利用者へ報告できるようにする。V1 は render 成果物からの抽出（`preview.frame`）、V2 はレンダー前の保存版・素材の確認（`preview.scriptFrame` / `preview.assetFrame`）である。判断は [ADR 0078](../adr/0078-agent-preview-frame-image-transport.md) を正とし、全体方針は [Agent Access 仕様](../agent-access/spec.md) に従う。V2 の実測は [spike.md](./spike.md) を参照する。

## 背景

- R3-4 以前、エージェントの自律確認は構文・保存検証（`script.validate` の警告と timeline）までであり、絵の確認はできなかった。
- サーバー側には既存の静止画抽出（`media/still-frame.ts`、ffmpeg＋キャッシュ）があり、render 成果物は `role: "render"`・`format: "mp4"` の Artifact として保存されている。
- Web UI のプレビューはブラウザで HTML を再生する方式であり、V1 時点ではサーバー側に render なしで任意時刻の絵を作る手段がなかった。V1 は render 成果物からの抽出に絞り、V2 で headless のシーク駆動を追加した。

## 操作

### `preview.frame`

- 種別は read、同期、Job を返さない（`longRunning: false`）。版の追加も Artifact の作成も行わない。
- 入力は `{ artifactId, timeMs }` とする。`artifactId` は `job.get` の `artifacts` で得た render Artifact を指す。
- 対象は `role: "render"` かつ `format: "mp4"` の Artifact に限る。それ以外（字幕・サムネイル等）は `VALIDATION_ERROR` とする。
- 時刻の上限は Artifact の `durationMs` で判定する。`durationMs` が null の版は判定を飛ばし、ffmpeg の解決結果に従う。範囲外の `timeMs` は `VALIDATION_ERROR`（issue path は `["timeMs"]`）とする。
- 存在しない `artifactId` と、実体ファイルが欠落した Artifact は `RESOURCE_NOT_FOUND` とする（HTTP の `resolveArtifactContent` と同じ規則）。
- 時刻の解決は `resolveStillFramePtsMs` の規則（指定 ms 以下で最後のフレーム PTS）を再利用し、応答の `resolvedTimeMs` で実際に抜いた時刻を返す。
- 出力は `{ artifactId, requestedTimeMs, resolvedTimeMs, width, height, mimeType: "image/png", pngBase64 }` とする。画像は原寸 PNG の base64 であり、縮小は行わない。
- キャッシュは `still-frame.ts` の `(sha256 + pts + extractorVersion)` キーを再利用し、新規のキャッシュ機構は作らない。
- 初回呼び出しは ffprobe の全フレーム走査が入るため、長尺の成果物では読み取りタイムアウト（30秒）に掛かる場合がある。その場合は同じ入力で再送する。2回目以降はプロセス内の PTS キャッシュと PNG ファイルキャッシュが効くため高速に返る。

### `preview.scriptFrame`（V2）

- 種別は read、同期、Job を返さない（`longRunning: false`）。版の追加も Artifact の作成も行わない。
- 入力は `{ scriptVersionId, timeMs }`（保存版）または `{ content, languageEditionId?, timeMs }`（未保存下書き）とする。`scriptVersionId` は `script.get` / `script.edit` が返す現行版を指す。未保存下書きは `ContentDocument` を直接渡し、版・Job・Artifact を作らずに PNG プレビューを得る（C15）。
- `getScriptVersionPreview` / `compilePreview` と同じコンパイラで `compositionHtml` と解決済み `timeline` を作り、`timeMs` の PNG を返す。新しいコンパイラや第二のプレビュー HTML は持たない。
- `timeMs` は `timeline.totalDurationMs` 以下とする。超える場合は `VALIDATION_ERROR`（issue path は `["timeMs"]`）。
- 出力は `{ scriptVersionId, requestedTimeMs, durationMs, width, height, mimeType: "image/png", imageBase64 }` とする。未保存下書きの場合 `scriptVersionId` は `null` となる。PNG は原寸で、縮小しない。
- 未知の `scriptVersionId` は `RESOURCE_NOT_FOUND`、コンパイル不能は `PREVIEW_INPUT_INVALID`、ブラウザ・描画の失敗は `INTERNAL_ERROR` とする。
- プレビューは構図・文字切れ・重なり・素材の欠落の確認用であり、render 成果物そのものではない。色・動き・音の最終判断は人に残す。

### `preview.assetFrame`（V2）

- 種別は read、同期、Job を返さない。
- 入力は `{ assetId, timeMs? }` とする。
- 画像 Asset は保存されている画像（正規化 rendition があればそれ）のバイトをそのまま返す。`mimeType` は実際の形式で、PNG への再エンコードはしない。`timeMs` は指定できない。
- 動画 Asset は `still-frame.ts` の `(sha256 + 解決PTS + extractorVersion)` キャッシュを使い、`timeMs`（既定 0）の PNG を返す。`timeMs` が確定尺を超える場合は `VALIDATION_ERROR`。
- 音声 Asset は `VALIDATION_ERROR`（issue path は `["assetId"]`）。未知の Asset は `RESOURCE_NOT_FOUND`、未 ready・欠損は既存の `ASSET_UNAVAILABLE` / `ASSET_PROCESSING` に従う。
- 出力は `{ assetId, kind: "image" | "video", requestedTimeMs, resolvedTimeMs, width, height, mimeType, imageBase64 }` とする。画像は `requestedTimeMs` / `resolvedTimeMs` が null、動画は解決後のミリ秒を返す。
- 画像の出力が大きすぎる場合は `VALIDATION_ERROR`（issue path は `["assetId"]`）とし、巨大な画像を socket / MCP へ流さない。

### V2 の描画方式

- 保存版・素材のラスタライズは `@hyperframes/engine` の headless Chrome と、`@hyperframes/core/runtime-script` の HyperFrames runtime を使う。Web UI のプレイヤーと同じ runtime であり、`window.__timelines` のシーク、`<video data-start>` の追従、入れ子 Composition の展開を runtime に任せる。
- runtime は composition の inline script より先に実行する必要がある。`page.setContent` の前に HTML の `<meta charset>` 直後へ注入する。
- ラスタライザはアプリの `/api/v1/preview-host` へ一度遷移し、same-origin の media session cookie を受け取る。この endpoint は空の `text/html` を返す内部用で、公開 API ではない。`/api/v1/health`（JSON）へ遷移してから `setContent` すると inline script が実行されないため使わない。
- アプリ origin 以外へのリクエストは拒否する。同時実行は 1 本に直列化し、ページは `finally` で閉じる。
- 実測では 1 フレーム 0.7〜1.0 秒（1920×1080 PNG、約300KB）で、通常は 10 秒の read timeout に収まる。長尺台本や多数の動画素材で `compilePreview` が伸びる場合に備え、画像プレビュー操作だけ read timeout を 30 秒へ延ばす（`AGENT_PREVIEW_READ_TIMEOUT_MS`）。Job 化はしない。

## 束縛

- MCP ツール名は `kakeai_preview_frame` / `kakeai_preview_script_frame` / `kakeai_preview_asset_frame` とする。成功結果は、画像バイトを省いたメタ情報の要約 JSON を `text` に、契約どおりの全出力を `structuredContent` に、画像バイトを標準の image ブロックに含める。CLI の stdout（`--out` なし）と `structuredContent` の一致は保つ。
- 画像を返す操作の集合は `packages/contracts` の `agentImagePreviewOperationNames` を正とする。束縛側に第二の一覧を持たない。
- MCP の image ブロックは、クライアントが描画を必須とされている PNG / JPEG に限る。WebP / GIF / BMP / AVIF の素材画像は `structuredContent` と CLI `--out` で取得する。
- CLI の `--out <path>` は画像を返す操作で使える。指定時は画像バイトをファイルに書き、stdout JSON から `pngBase64` / `imageBase64` を除いて `path` を付す。`--out` なしの形は変えない。
- ソケット・MCP・CLI は同じ操作コアを呼び、束縛側に抽出ロジックを持たない。

## スキルとガイド

- `kakeai-production` スキルに Visual QA の手順を追加する。render 前は `preview.scriptFrame` / `preview.assetFrame`、render 後は `preview.frame` で要点時刻を見て、所見を報告し、利用者の確認につなぐ。利用者が見ない絵の品質を断定しない。視覚品質の最終判断は人に残す。
- ユーザーガイドのツール表・CLI 例・`--out` の説明を同じ変更で更新する。

## 非ゴール

- 下書き（未保存 ContentDocument）のプレビューは C15 で実装済み。
- 動画クリップの返却、複数時刻の一括取得、画像の縮小・形式指定パラメータは V2 に含めない。単一フレームの利用実績を見てから改訂する。
- プロトコル版は上げない。操作追加は「追加は自由」に該当し、`operationDigest`・`schemaDigest` の変化は想定内とする。
