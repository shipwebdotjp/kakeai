# インサート動画のトリムとループは主動画Cueで持ち、映像と音声を同一使用区間で再生する

insert Sceneの主動画は、`media.full-bleed@1` 入力の任意の `trimStartMs` / `trimEndMs` でソース動画の使用区間を、`loop` で使用区間の繰り返しを指定する。トリムはSceneではなく主動画Cueを正本とし、既存の「映像指定はVisual Cue契約が正本」という原則を保つ。同じ入力が通常の `media.full-bleed` 動画Cueにも適用される（無音のまま）。

ソース尺を `S`、`trimStartMs = t0`（既定0）、`trimEndMs = t1`（既定`S`）、使用区間 `L = t1 - t0` とする。`0 ≤ t0 < t1 ≤ S` を保存・プレビュー・レンダーで検証する。Scene尺は、ループなしで `scene.durationMs === L`、ループありで `scene.durationMs >= L` とする。

映像は `data-media-start = t0` を指定し、ループ時は使用区間 `L` ごとの `<video>` セグメントを並べる。埋め込み音声は非ミュートの `<video>` からエンジンが `mediaStart` / 期間つきで抽出するため、映像と音声が同じ使用区間に揃う（[ADR-0068](0068-embedded-video-audio-rendering-and-asset-has-audio.md) の方式を維持）。

## Considered Options

- トリム/ループを insert Scene の専用フィールドに置く。→ 映像指定がSceneとCueに分裂し、正本が二重になるため不採用。
- ループ時に使用区間より短いScene尺も許可する。→ 「繰り返す」の意味が曖昧で、単なる短い抜粋と区別できないため不採用。`>= L` を要求する。
- 音声用に別途トリム済みRenditionを導出する。→ 派生物管理と同期ずれを持ち込むため不採用。映像と同じ属性から抽出する。
- `media.card@1` にもトリムを広げる。→ 今回の要求外で、カードの実効表示窓規則と交差するため見送り。`media.full-bleed@1` のみ。

## Consequences

- `mediaFullBleedInputSchema` に `trimStartMs` / `trimEndMs` を追加し、`t0 < t1` を検証する（加算的なので template version は据え置き）。`inputFields` に数値入力を追加し、Cue編集とinsert編集で往復する。
- `renderLoopVideoSegments` は `mediaStartMs` / `loopLengthMs` / `audible` を受け取るよう一般化し、ループ動画の各セグメントで使用区間頭出しと埋め込み音声を扱う。
- `assertInsertScenes` は主動画Assetの確定尺を基準に使用区間の範囲とScene尺の規則を保存・プレビュー・レンダー投入前に検証する。
- insert Sceneは主動画Cueの `loop` を禁止しなくなる。動画尺が不明なAssetは従来どおり主動画に選べない。
