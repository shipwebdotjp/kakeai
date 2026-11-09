# ライブCue単位の中央ビジュアル

[ライブ配信仕様](../live/spec.md) のうち、Cueごとに中央スロットのカードまたは素材を切り替える契約を定める。ライブ全体のフェーズ、スパイン、コメントコーナー、パッケージ構成は [../live/spec.md](../live/spec.md) と [../live-program/spec.md](../live-program/spec.md) を正とする。

## 目的とスコープ

- 対象は、CueとSegmentが持つ単一の `visual` による中央スロットの表示である。
- `visual` は `{ kind: "card", cardId, stateId }`、`{ kind: "material", materialId }`、`null`、未指定のいずれかとする。
- カードと素材を同時に指定する表現は持たない。優先順位の問題を型で消す。
- 対象外は、音入り素材カード、全画面のCutIn、Visual Cueタイムラインからの自動変換、生成レスによる素材選択、素材の先読みキャッシュである。
- CutInは素材カードの拡張ではなく、Spine専用の `cut_in` セグメントとして [../live-media-playout/spec.md](../live-media-playout/spec.md) で定める。
- 1つのCueは1回の再生occurrenceとする。同じCue IDを複数のSegmentから参照しない。

## 契約

```jsonc
{
  "id": "cue-news-1-2",
  "visual": { "kind": "card", "cardId": "card-chart", "stateId": "state-chart-1" }
}
```

| 値 | 意味 |
| --- | --- |
| 未指定 | そのCueが属するSegmentの `visual` を継承する。Segmentにも無ければ中央スロットを隠す。 |
| `{ kind: "card", ... }` | 指定したカード状態を表示する。 |
| `{ kind: "material", ... }` | 指定した Live Material を表示する。 |
| `null` | Segment既定も無効にし、中央スロットを隠す。 |

`PreparedCue` と実行中の `LiveCue` にも同じ任意フィールドを保持する。書き出し時にSegment既定をCueへ焼き込まない。

`visual` がカードを指す場合、`cards[]` にカードと状態が存在しなければならない。素材を指す場合、`materials[]` に同じIDが存在しなければならない。Program検証時とパッケージ読込時の両方で検証する。

同じCue IDが複数のSegmentから参照されている場合、または同じSegment内でCue IDが重複している場合は、Program検証とパッケージ読込の両方で拒否する。

## 実行時の解決

実効ビジュアルはサーバー側で次の規則により解決する。

1. Cueの `visual` が `null` なら、中央スロットを隠す。
2. Cueの `visual` がカードまたは素材なら、その参照を表示する。
3. Cueの `visual` が未指定なら、Segmentの `visual` を使う。Segmentにも無ければ隠す。

`StageState.visual` は現在のCueとSegmentから毎回導出する。実効ビジュアルを別の状態として保持しない。

`visual.sequence` は実効ビジュアルの識別子（`cardId`/`stateId`、`materialId`/`focus`、非表示）が変わったときだけ増やす。ステージは非nullの `sequence` が直前に適用した値より小さい状態を無視し、古いカードへ戻らない。

## ステージ表示

- 同じカードの状態変更はキー付き差分で描画する。初回マウント、preview、再接続では完成状態を即時描画する。
- カードの読み込み・描画失敗は中央スロットを隠し、配信を止めない。programステージは `card_error` を送り、サーバーは重複を抑えてRun logとコンソールに残す。
- 素材の読み込みに失敗した場合も中央スロットを隠し、ナレーションとスパインは止めない。
- 字幕、立ち絵、コメントカードは通常どおり表示する。
- 明示的な先読み・デコード済みキャッシュは行わない。ブラウザの通常のHTTPキャッシュに任せる。

## 互換性

- パッケージは `schemaVersion: 2` だけを持つ。`materialId` と `segment.material` は使わず、strict schema が拒否する。
- v1 パッケージは読み込まない。

## 検証とテスト

- 契約テストで、未指定・`null`・カード・素材の受理、存在しないカード状態・素材IDの拒否、Cueの重複参照の拒否を確認する。
- 書き出しテストで、Cueの `visual` が `PreparedCue` に生値のまま保持されることを確認する。
- ランタイムテストで、Segment既定、Cueカード、Cue素材、Cue `null` の優先順位と、Cue開始時の切り替えを確認する。
- ステージのカード差し替え、状態差分、読み込み失敗時の非表示は自動テストと手動で確認する。
