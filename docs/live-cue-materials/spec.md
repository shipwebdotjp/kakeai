# ライブCue単位の素材カード

[ライブ配信仕様](../live/spec.md) のうち、`scriptCues` ごとに中央の素材カードを切り替える契約を定める。ライブ全体のフェーズ、スパイン、コメントコーナー、パッケージ構成は [../live/spec.md](../live/spec.md) を正とする。

## 目的とスコープ

- 対象は `scriptCues` の行単位で指定する画像・静的HTML・無音短尺MP4の素材カードである。
- 素材指定は当面、Show ProfileのJSONまたはエージェント経由で行う。Web編集UIは対象外とする。
- `Segment.material` は既存Profileのための既定素材として残す。
- 対象外は、音入り動画、全画面表示、CutIn、Visual Cueタイムラインからの自動変換、生成レスの素材選択、素材の先読みキャッシュである。
- 1つのCueは1回の再生occurrenceとする。同じCue IDを複数のSegmentから参照しない。

## 契約

`scriptCues[]` に任意の `materialId` を追加する。

```jsonc
{
  "id": "cue-news-1-2",
  "lineId": "line-news-1-2",
  "materialId": "material-chart"
}
```

`materialId` は `string | null | 未指定` の3値とする。

| 値 | 意味 |
| --- | --- |
| 未指定 | そのCueが属するSegmentの `material` を継承する。Segmentにも無ければ中央素材を隠す。 |
| 文字列 | そのCueだけ指定のMaterial Cardを表示する。 |
| `null` | Segment既定も無効にし、中央素材を隠す。 |

`PreparedCue` と実行中の `LiveCue` にも同じ任意フィールドを保持する。いずれも入力された生値を保持し、実効素材はSegment文脈で実行時に解決する。書き出し時にSegment既定を `PreparedCue` へ焼き込まない。

`materialId` が文字列のときは、`materials[]` に同じIDが存在しなければならない。Profile検証時とパッケージ読込時の両方で検証する。

同じCue IDが複数のSegmentから参照されている場合、または同じSegment内でCue IDが重複している場合は、Profile検証とパッケージ読込の両方で拒否する。

## 実行時の解決

素材解決は次の純粋な規則に集約する。

1. Cueの `materialId` が文字列なら、そのMaterial Cardを表示する。
2. Cueの `materialId` が `null` なら、中央素材を隠す。
3. Cueの `materialId` が未指定なら、Segmentの `material` を使う。Segmentにも無ければ隠す。

`StageState.material` は現在のCueと現在のSegmentから毎回導出する。実効素材を別の状態として保持しない。`material` の値は `{ id, focus }` または `null` である。

通常の本編は常に `script` フェーズとする。素材の有無は `StageState.material` だけで表し、`material` フェーズは持たない。CutIn用の実フェーズはフェーズ2まで追加しない。

## ステージ表示

- 同じ素材が連続する場合、動画要素を作り直さず再生を続ける。
- 異なる動画カードへ切り替わる場合は先頭から再生し、ミュート・ループする。
- 字幕、立ち絵、コメントカードは通常どおり表示する。
- 素材の読み込みに失敗した場合は、前の素材を残さず中央枠を隠す。ナレーションとスパインは止めない。
- 素材の読み込み失敗はコンソールへ通知しない。失敗時はステージ内で隠すだけとする。
- 素材カードの明示的な先読み・デコード済みキャッシュは行わない。ブラウザの通常のHTTPキャッシュに任せ、切り替え時の一瞬の空白は許容する。

## 互換性

`materialId` は任意フィールドなので、既存のShow Profileと既存のライブパッケージはそのまま読み込める。新しいパッケージを旧バージョンのライブアプリで読む互換性は保証しない。

## 検証とテスト

- 契約テストで、未指定・`null`・文字列の受理、存在しない素材IDの拒否、Cueの重複参照の拒否を確認する。
- 書き出しテストで、`scriptCues[].materialId` が `PreparedCue` に生値のまま保持されることを確認する。
- ランタイムテストで、Segment既定、Cue文字列、Cue `null` の優先順位と、Cue開始時の切り替えを確認する。
- ステージの素材差し替え、動画の非再スタート、ミュート・ループ、読み込み失敗時の非表示は手動で確認する。
