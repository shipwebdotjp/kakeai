# サムネイルPNGはオンデマンド生成とし、Job/Artifactにしない

サムネイルの PNG は、保存済み候補から要求のたびに生成し、Job の出力（`Artifact`）として保存しない。字幕（[ADR-0055](./0055-subtitles-on-demand-srt-download.md)）と同じく軽い導出として扱う。`Artifact.role="thumbnail"` の余地（[ADR-0006](./0006-job-output-artifact.md)）は残すが、MVP では使わない。

理由は、サムネイルが正本入力・テンプレート・Theme からの決定的な描画で、レンダーキュー・ポーリング・履歴・削除の配管を持ち込むと取得までの手順だけが増えるため。

## Considered Options

- render Job の追加 Artifact として生成する。→ サムネイルだけ欲しいときに MP4 レンダーが必須になるため不採用。
- `thumbnail` kind の Job を新設する。→ worker・job kind・polling・health の配管が増えるため不採用。

## Consequences

- PNG 生成は HTML のラスタライズを伴い、字幕（純粋なテキスト変換）より重い。プレビューはコンパイル済み HTML を配信し、PNG はダウンロード時に生成する。
- 生成は管理下の Chrome とフォントを使う。失敗時は JSON エラー契約で返す。詳細は [../thumbnail/spec.md](../thumbnail/spec.md)。
