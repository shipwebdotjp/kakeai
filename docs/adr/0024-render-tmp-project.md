# レンダーはtmpプロジェクトに素材を集約してproducerへ渡す

renderワーカーは、スナップショットの正本JSONを `packages/video` のコンパイラで
`tmp/render-<jobId>/index.html` へ展開し、参照素材の実体を `assets/` 配下へ
シンボリックリンクで集約してから `@hyperframes/producer` の
`executeRenderJob(job, projectDir, outputPath)` を呼ぶ。Composition内の素材参照は
相対パス（`assets/<assetId>.<ext>`）とし、絶対パスやfile URLを埋め込まない。

理由は、producerがHTMLをローカルfileサーバーで配信してキャプチャするため、
サーバー配下の相対参照が最も確実で、オフラインでも動作するため。
シンボリックリンクで原本・Renditionを複写せずに参照し、ディスク二重化を避ける。
出力MP4は `artifacts/<sha256>.mp4` へ確定し、tmpプロジェクトは成功・失敗にかかわらず削除する。

## Considered Options

- 素材の絶対パスをCompositionへ埋め込む。→ fileサーバーの配信範囲外になる可能性があり不採用。
- 素材実体をtmpへ複写する。→ 大容量動画の複写コストが無駄なため不採用。

## Consequences

- 素材ファイル名の拡張子は `mediaType` から決める。fileサーバーがContent-Typeを付与できるようにする。
- 進捗はproducerの `progress` コールバックを `Job.progressPercent` へ反映する（概算）。
