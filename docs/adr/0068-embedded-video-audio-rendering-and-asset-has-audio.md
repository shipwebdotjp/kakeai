# 埋め込み動画音声は非ミュートvideoから抽出し、音声有無はAssetに永続化する

insert Sceneの埋め込み音声は、主動画Cueが参照するvideo Assetから直接再生する。コンパイラはinsert Sceneの主動画Cueだけ `muted` を外して `data-has-audio="true"` を付け、レンダーエンジンが動画ファイルから音声ストリームを抽出して映像と同じ時間軸でミックスする。プレビューではブラウザの `<video>` がそのまま音声を再生する。別のAudio Assetや音声専用Renditionの抽出・管理を利用者にも実装にも要求しない。動画に音声ストリームが存在するかは素材取り込み時のffprobe結果（`audioCodec`）を `Asset.hasAudio` として永続化し、編集画面と保存時警告に使う。

作品全体BGM（`range: work` のAudioCue）は、`embeddedAudio: true` のinsert Scene区間で自動的にミュートする。区間分割で前後を切り、境界に200msの `data-fade-in` / `data-fade-out` を付け、`data-media-start` で楽曲位相を保つ。ボリューム自動化laneではなく、エンジンが文書化済みのクリップ属性だけで実現する。

## Considered Options

- 動画から音声専用のRenditionを導出して `<audio>` で配置する。→ 動画の音声を出すたびに派生物を管理し、同期ずれと再現差分を持ち込むため不採用。エンジンの抽出に一本化する。
- `media.full-bleed@1` の入力を非ミュート切替可能にする。→ 背景動画の無音意図と混ざり、BGM抑制境界も曖昧になるため不採用（[ADR-0067](0067-insert-scene-owns-embedded-video-audio.md) の判断を維持）。
- BGM抑制を音量自動化laneで行う。→ loop展開された複数 `<audio>` とlaneの整合が複雑で、プレビューとレンダーでの対応差も生みやすいため不採用。
- 音声ストリームの有無を読み出し時に毎回probeする。→ 一覧・ピッカーのたびにffprobeが必要になり重いため不採用。取り込み時に永続化する。

## Consequences

- `packages/contracts` の `Asset` DTOに `hasAudio` を追加する。Prisma `Asset` にカラムを追加し、既存行は `false` を既定とする（レンダーは実ファイルを読むため正しさに影響しない。必要なら再probeでbackfillする）。
- `packages/video` は `RenderContext.embeddedAudio` を通じてinsert主動画Cueだけを非ミュートで描画し、work範囲AudioCueを挿入区間で分割して200msフェードを付ける。通常の `media.full-bleed` / `media.card` はミュートのまま。
- APIはinsert主動画がreadyなvideo Assetを参照し、確定尺がScene尺と一致することを保存・プレビュー・レンダー投入前に検証する。`embeddedAudio: true` で `hasAudio: false` の動画には保存時警告を返す。
- 埋め込み音声はエンジンが動画ファイルから抽出するため、レンダー入力は既存のvideo用render Rendition（元音声を保持）または原本で足りる。新しいRendition種別は追加しない。
