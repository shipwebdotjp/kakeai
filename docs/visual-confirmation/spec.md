# 視覚確認（R3-4）仕様

Agent Access の R3-4「視覚確認」を正とする。エージェントが render 成果物の指定時刻の静止画を取得し、目視確認の所見を利用者へ報告できるようにする。判断は [ADR 0078](../adr/0078-agent-preview-frame-image-transport.md) を正とし、全体方針は [Agent Access 仕様](../agent-access/spec.md) に従う。

## 背景

- R3-4 以前、エージェントの自律確認は構文・保存検証（`script.validate` の警告と timeline）までであり、絵の確認はできなかった。
- サーバー側には既存の静止画抽出（`media/still-frame.ts`、ffmpeg＋キャッシュ）があり、render 成果物は `role: "render"`・`format: "mp4"` の Artifact として保存されている。
- Web UI のプレビューはブラウザで HTML を再生する方式であり、サーバー側に render なしで任意時刻の絵を作る手段はない。したがって V1 は render 成果物からの抽出に絞る。

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
- 初回呼び出しは ffprobe の全フレーム走査が入るため、長尺の成果物では読み取りタイムアウト（10秒）に掛かる場合がある。その場合は同じ入力で再送する。2回目以降はプロセス内の PTS キャッシュと PNG ファイルキャッシュが効くため高速に返る。

## 束縛

- MCP ツール名は `kakeai_preview_frame` とする。成功結果は、画像バイトを省いたメタ情報の要約 JSON を `text` に、契約どおりの全出力を `structuredContent` に、画像バイトを標準の image ブロックに含める。CLI の stdout（`--out` なし）と `structuredContent` の一致は保つ。
- CLI サブコマンドは `preview.frame` とする。`--out <path.png>` 指定時は PNG バイトをそのファイルに書き、stdout JSON は `pngBase64` を省いて `path` を付す。`--out` なしの形は変えない。
- ソケット・MCP・CLI は同じ操作コアを呼び、束縛側に抽出ロジックを持たない。

## スキルとガイド

- `kakeai-production` スキルに Visual QA の手順を追加する。render→待機→要点時刻の `preview.frame`→所見の報告→利用者の確認、の順とし、利用者が見ない絵の品質を断定しない。視覚品質の最終判断は人に残す。
- ユーザーガイドのツール表・CLI 例・`--out` の説明を同じ変更で更新する。

## 非ゴール

- render なしの確認（保存版・下書きのプレビューHTMLのラスタライズ）は V1 の対象外とする。headless でのシーク駆動が必要であり、別途スパイクで可否を判断する（V2）。
- 動画クリップの返却、複数時刻の一括取得、画像の縮小・形式指定パラメータは V1 に含めない。必要になった時点で本仕様を改訂する。
- プロトコル版は上げない。操作追加は「追加は自由」に該当し、`operationDigest`・`schemaDigest` の変化は想定内とする。
