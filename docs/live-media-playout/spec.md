# ライブのメディア挿入（CutIn）仕様

[ライブ配信仕様](../live/spec.md) のうち、Spineに挿入する短い動画（**CutIn**）の契約を定める。ライブ全体のフェーズ、スパイン、コメントコーナー、パッケージ構成は [../live/spec.md](../live/spec.md) を正とする。

CutInは、コーナーの区切り、スポンサー告知、オープニング映像などに使う全画面の短い動画である。素材カードの拡張ではなく、**Spine専用のセグメント**として扱う。判断の理由は [ADR-0130](../adr/0130-live-cut-in-separate-from-cues-and-materials.md) を正とする。

## 目的と境界

- 対象は、video Assetを参照する全画面のCutInである。音声は任意とする。
- CutInは `segments[]` の `kind: "cut_in"` として明示する。通常のLive Cueのキューには混ぜない。
- 入力はKakeaiのvideo Assetを参照し、書き出し後にパッケージ内の検証済みMP4へ解決する。
- 尺は入力しない。書き出し時のprobe結果を正本にする。
- 通常の素材カードは無音のままとする。CutInだけが `hasAudio: true` を許可される別のパッケージ種別を持つ。
- programステージだけがCutInの埋め込み音声を再生し、previewはミュートする。
- v1の1つの `cut_in` セグメントは1つの動画を参照する。トリム、ループ、複数動画の連結、トランジション、BGMの重ねは対象外とする。
- CutInの入力はShow ProfileのJSONまたはエージェント経由とする。Web編集UI、auto-profileによる自動挿入は対象外とする。

## 用語

| 用語 | 意味 |
| --- | --- |
| CutIn | Spineの区切りに挿入する、全画面の短い動画。専用のパッケージ種別と再生契約を持つ。 |
| CutInセグメント | `kind: "cut_in"` のスパインセグメント。`cutInId` でCutInを参照する。 |
| CutIn occurrence | 1回のCutIn再生。`segmentId`・`attempt`・`sequence` で識別する。同じCutInを複数箇所で再利用できる。 |
| CutIn Asset | CutInの元になるKakeaiのvideo Asset。書き出し時にMP4へ解決される。 |

用語の正は [../../CONTEXT.md](../../CONTEXT.md) とする。

## 入力 Show Profile

### `cutIns[]`

CutInの元になるAssetを、トップレベルの `cutIns[]` に定義する。

```jsonc
{
  "segments": [
    { "id": "seg-news", "kind": "script", "label": "ニュース", "targetDurationMs": 480000, "cues": ["cue-1"] },
    {
      "id": "cut-to-comments",
      "kind": "cut_in",
      "label": "コメントコーナーへ",
      "cutInId": "jingle-comments"
    },
    { "id": "seg-comments", "kind": "comment", "label": "コメント", "targetDurationMs": 300000 }
  ],
  "cutIns": [
    { "id": "jingle-comments", "assetId": "asset-video-jingle" }
  ]
}
```

- `cutIns[].id` はShow Profile内で一意とする。
- `cutIns[].assetId` はreadyな `video` Assetを参照する。音声トラックの有無は問わない。
- `cutIns[]` は任意で、既定は空配列とする。CutInを使わない既存Profileはそのまま読み込める。
- 参照されない `cutIns` は許容するが、書き出し対象にはしない。パッケージには `cut_in` セグメントから参照されたCutInだけを含める。
- 同じ `cutInId` を複数の `cut_in` セグメントから参照できる。CutInの発生は `segmentId`・`attempt`・`sequence` で区別する。

### `cut_in` セグメント

`cut_in` セグメントは、次の形だけを持つ。

```jsonc
{
  "id": "cut-to-comments",
  "kind": "cut_in",
  "label": "コメントコーナーへ",
  "cutInId": "jingle-comments"
}
```

- `targetDurationMs` を持たない。尺はCutInのprobe結果から導出する。
- `cues`、`material`、`commentPolicy` を持たない。
- `label` はコンソールとログに表示する。
- 先頭は `opening`、末尾は `closing`、`script` を1つ以上含む、という既存のスパイン検証は変えない。CutInはその間の任意の境界に置ける。
- `cutInId` は `cutIns[]` に存在しなければならない。
- 同じCutInを再利用しても、Cueのような「1回だけ再生」の制約は適用しない。CutInは再利用可能な素材である。

### 検証

Profile検証で次を拒否する。

- `cutIns[].id` の重複。
- `cut_in` セグメントの `cutInId` が `cutIns[]` に存在しない。
- `cut_in` セグメントが `targetDurationMs`、`cues`、`material`、`commentPolicy` を持つ。
- 先頭・末尾・script必須の既存ルール違反。
- 素材カードの `materialId` とCutInの `assetId` を取り違えた参照。

Job作成時は、`cutIns[].assetId` がreadyな `video` Assetであることを検証する。Assetが存在しない場合は `ASSET_NOT_FOUND`、処理中の場合は `ASSET_PROCESSING`、失敗済みの場合は `ASSET_UNAVAILABLE`、video以外の場合は422 `VALIDATION_ERROR` とする。

## パッケージ出力

### `show.json`

書き出し後の `show.json` は、CutInの解決済み情報を `cutIns[]` に持つ。

```jsonc
{
  "segments": [
    {
      "id": "cut-to-comments",
      "kind": "cut_in",
      "label": "コメントコーナーへ",
      "cutInId": "jingle-comments"
    }
  ],
  "cutIns": [
    {
      "id": "jingle-comments",
      "file": "media/assets/<sha256>.mp4",
      "durationMs": 4200,
      "hasAudio": true,
      "width": 1920,
      "height": 1080
    }
  ]
}
```

- `file` はパッケージ相対のMP4パスである。既存の `PackageWriter.writeAsset` と同じcontent-addressedな `media/assets/<sha256>.mp4` を使う。
- `durationMs`、`width`、`height`、`hasAudio` は、パッケージに入れるMP4のprobe結果を正本とする。
- `cutIn` セグメントの実効尺は `cutIns[].durationMs` から導出する。`show.segments[].targetDurationMs` を重複して持たない。
- `LiveServerShowMeta.segments[].targetDurationMs` は、`cut_in` の場合は対応する `cutIns[].durationMs` を使う。
- CutInがない場合、`show.json` に `cutIns` を書かない。旧アプリがCutInを使わない新パッケージを読めるようにするためである。

### `manifest.json`

CutInのMP4は、素材カードとは別の `kind: "cut-in"` として記録する。

```jsonc
{
  "path": "media/assets/<sha256>.mp4",
  "sha256": "...",
  "byteSize": 1234567,
  "mediaType": "video/mp4",
  "kind": "cut-in",
  "durationMs": 4200,
  "width": 1920,
  "height": 1080,
  "hasAudio": true
}
```

- `kind: "cut-in"` の `mediaType` は `video/mp4` だけを許可する。
- `durationMs` は正の値でなければならない。
- `hasAudio` はprobe結果を記録する。音声なしCutInは `false`、音声ありCutInは `true` とする。
- 素材カードの `kind: "material"` と `hasAudio: false` の検証は一切緩めない。
- 同じAssetを複数のCutInが参照しても、content-addressedなパスによりファイルは1つにまとまる。

## 書き出し

### Assetの解決

- 入力 `cutIns[].assetId` を、Job作成時にvideo Assetとして解決する。
- 書き出しWorkerは、Jobスナップショットに固定されたAsset/Renditionのバイト列だけを使う。
- AssetのDB上の `hasAudio` や `durationMs` を正本にしない。パッケージに入れるMP4をprobeした結果を正本にする。

### MP4への正規化

- 元AssetがH.264/AACのMP4で、ブラウザで再生できる場合は、そのバイト列をコピーする。
- 元AssetがH.264/AAC以外、可変フレームレート、回転あり、またはMP4以外のコンテナの場合は、既存の `createRendition` でH.264/AACのMP4へ正規化する。
- 正規化後のMP4をprobeし、`durationMs`・`width`・`height`・`hasAudio` を確定する。
- probeで尺が取得できない、動画ストリームがない、正規化に失敗した場合は、書き出しを失敗させる。
- 元AssetのDB上の `durationMs` とprobe結果が50ms以上ずれる場合は警告を記録し、probe結果を採用する。

### 音声

- CutInの音声は任意とする。音声トラックがない動画は `hasAudio: false` のCutInとして書き出す。
- 音声トラックがある動画は `hasAudio: true` のCutInとして書き出す。programステージだけが再生する。
- 素材カードの無音検証は維持する。CutIn以外の `kind: "material"` に `hasAudio: true` を許可しない。
- v1ではCutInの音量調整、BGMのダッキング、フェードイン／アウトを行わない。

### 書き出し結果

- `show.json` に、参照されたCutInだけを `cutIns[]` として含める。
- `manifest.json` の `files` に `kind: "cut-in"` のMP4を含める。
- 書き出し結果の `preparedCueCount` はCueだけを数え、CutInは含めない。CutInの件数が必要になった場合は別フィールドを追加する。
- CutInの音声・尺の不整合は、素材カードの検証とは別のエラーとして返す。

## パッケージ検証

起動時の検証で次を確認する。

- `show.cutIns[]` の `id` が一意である。
- `show.segments[]` の `cut_in` が参照する `cutInId` が `show.cutIns[]` に存在する。
- `cut_in` セグメントが `targetDurationMs`、`cues`、`material` を持たない。
- `show.cutIns[].file` がmanifestに存在し、`kind: "cut-in"`、`mediaType: "video/mp4"` である。
- manifestの `durationMs` が正で、`show.cutIns[].durationMs` と一致する。
- manifestの `hasAudio` が `show.cutIns[].hasAudio` と一致する。
- manifestの `width`・`height` が `show.cutIns[]` と一致する。
- 素材カードの `hasAudio: false` 検証は従来どおりで、CutInの追加によって緩めない。

`show.cutIns` を持たない既存パッケージは、`cutIns: []` として読み込む。`cut_in` セグメントを持たない既存パッケージは、従来どおり動作する。

## 実行時契約

### フェーズと状態

CutInの再生中は `phase: "cut_in"` とする。`StageState` は通常の `playback` とは別に `cutIn` を持つ。

```jsonc
{
  "phase": "cut_in",
  "segment": { "id": "cut-to-comments", "label": "コメントコーナーへ" },
  "characters": { "left": null, "right": null },
  "caption": null,
  "material": null,
  "comment": null,
  "status": "idle",
  "playback": null,
  "cutIn": {
    "cutInId": "jingle-comments",
    "segmentId": "cut-to-comments",
    "label": "コメントコーナーへ",
    "file": "media/assets/<sha256>.mp4",
    "durationMs": 4200,
    "hasAudio": true,
    "attempt": 1,
    "sequence": 1,
    "startedAt": "2026-11-07T12:00:00.000Z"
  },
  "clock": { "elapsedMs": 300000, "remainingMs": 1500000 }
}
```

- `cutIn` はCutIn再生中だけ非nullとし、それ以外はnullとする。旧サーバの状態に `cutIn` が存在しない場合はnullとして扱う。
- `playback` はCutIn中に使わない。通常のCue音声とCutInの音声を同じ再生契約に混ぜない。
- `characters`、`caption`、`material`、`comment` はCutIn中に表示しない。状態としてはnullを送る。
- `status` は `idle` とする。CutInはキャラクターの発話ではない。
- `clock` は通常どおり進む。
- `attempt` は同じoccurrenceを開始し直すたびに増やす。pauseからの再開、明示的な再試行で増える。再接続では増やさない。
- `sequence` は再生指示ごとに増えるサーバ側の単調値とする。再開、スキップ、再接続後の再指示で更新する。
- `startedAt` は現在の `attempt` の開始時刻である。再接続時はこの値から動画位置を求める。

### ステージイベント

CutIn専用のイベントを追加する。

- `cut_in_ended`: 現在のCutInの映像再生が完了した。
- `cut_in_error`: CutInの読み込み・再生に失敗した。

イベントは次を持つ。

- `runId`、`sessionId`。
- `cueId: null`。
- `cutInId`、`segmentId`。
- `attempt`、`sequence`。
- 任意の `positionMs`、`error`。

サーバは、現在の `cutInId`・`segmentId`・`attempt`・`sequence` に一致しないCutInイベントを無視する。古い終了イベントで次のスパイン要素へ進めない。previewはCutInイベントを送らない。

### コンソール

`ConsoleSnapshot` に現在のCutInを追加する。

- `cutIn`: 再生中のCutInの `cutInId`・`segmentId`・`label`・`durationMs`・`startedAt`・`attempt`・`sequence`。再生していなければnull。
- コンソールは再生中のCutIn名と、専用の「CutInをスキップ」操作を表示する。
- 専用コマンド `skip_cut_in` を追加する。`skip_cue` はCutInに流用しない。
- フェーズ表示に `cut_in` を追加する。
- 実行ログに `cut_in_started`、`cut_in_finished`、`cut_in_failed` を追加し、`cutInId`・`segmentId`・理由を記録する。

## 進行

### 開始

- `Spine.enterSegment` が `cut_in` セグメントに到達したら、現在のセグメントを設定し、`phase: "cut_in"` にしてCutIn再生を開始する。
- CutIn再生は通常のCueキューに追加しない。Cueの `attempt` や `sequence` と混ぜない。
- 同じCutInを複数箇所で使う場合も、セグメントごとに新しいoccurrenceとして開始する。
- `cut_in_ended` を受けたら、次のスパイン要素へ進む。次が `closing` ならクロージングへ進む。
- ループしない。動画の最後で必ず終了する。

### 終了・停止・一時停止

- `end` をCutIn再生中に押した場合は、そのCutInを最後まで再生してからクロージングへ進む。
- `end` がCutIn開始前に保留されている場合は、そのCutInを飛ばしてクロージングへ進む。
- `stop` はCutInを直ちに停止し、`paused` へ移る。準備済みキューは保持する。
- `pause` はCutInの映像と音声を停止し、状態を保持する。`resume` はCutInを先頭から再生する。途中から再開しない。
- `resume` では新しい `attempt` と `sequence` を発行し、`startedAt` を現在時刻にする。ステージは先頭から再生する。
- `skip_cut_in` は現在のCutInを停止し、次のスパイン要素へ進む。`skip_cue` はCutIn中には使わない。
- `safe_mode` 中はCutInを再生しない。CutIn中に安全モードへ入った場合は、そのCutInを停止して次の準備済みセグメントへ進む。

### 再接続・program引継ぎ

- サーバはステージ接続時に最新の `StageState` を送る。CutIn中なら `cutIn` と `startedAt` を含める。
- 再接続したprogramステージは、`startedAt` から現在位置を求め、その位置へシークして再生する。
- 現在位置が `durationMs` 以上なら、先頭から再生せず `cut_in_ended` を送る。
- シークできない場合は先頭から再生し、二重再生を避ける。終了イベントは `attempt`・`sequence` で照合する。
- previewからprogramへ引き継いだ場合は、再生中のCutInを止めずにミュートを解除する。必要なら `startedAt` に合わせてシークする。
- 古いprogramのイベントは、`cutInId`・`segmentId`・`attempt`・`sequence` の不一致で無視する。

### 失敗時

- CutInの読み込み・再生に失敗した場合は、警告をログとコンソールに記録し、次のスパイン要素へ進む。
- `cut_in_ended` が届かない場合は、尺に短い猶予を加えたwatchdogで打ち切る。既定は尺＋1500ms、最低3000msとする。
- watchdogは `attempt` と `sequence` の単位で動かす。古い試行のタイムアウトで現在のCutInを進めない。
- CutInの連続失敗で番組を一時停止しない。映像トラブルで配信を止めないことを優先する。
- 失敗したCutInのoccurrenceはログに残し、次のCutInや通常キューへ影響させない。

## ステージ表示

- CutInはステージの全画面レイヤーで表示する。キャラクター、字幕、中央の素材カード、コメントカード、セグメントラベルを隠す。
- 映像は `<video>` で再生し、`loop` はfalse、`playsInline` を有効にする。autoplayは状態駆動で開始する。
- `object-fit: contain` と黒背景を既定とする。16:9以外の動画は書き出し時に警告する。
- programステージは `hasAudio: true` のCutInだけ埋め込み音声を再生する。`hasAudio: false` のCutInは無音で再生する。
- previewステージは常にミュートする。映像だけを表示し、再生イベントを送らない。
- pause中は映像と音声を停止する。resume時は先頭から再生する。
- 読み込み失敗時はCutInレイヤーを隠し、`cut_in_error` をprogramから送る。
- 素材カードの動画のようにループ・ミュート固定にはしない。CutIn専用の再生コンポーネントで扱う。
- v1ではCutInの明示的な先読み・デコード済みキャッシュを行わない。ブラウザの通常のHTTPキャッシュに任せる。

## 状態遷移

| 操作・イベント | 現在 | 次 | アクション |
| --- | --- | --- | --- |
| `cut_in_ended` | `cut_in` | 次のセグメント / `closing` | 現在のoccurrenceと一致するイベントだけを受け付ける。 |
| `cut_in_error` / watchdog | `cut_in` | 次のセグメント / `closing` | 警告を記録して進む。配信は停止しない。 |
| `skip_cut_in` | `cut_in` | 次のセグメント | 現在のCutInを停止して次へ進む。 |
| `end` | `cut_in` | `closing` | 現在のCutInを最後まで再生してからクロージングへ。 |
| `pause` | `cut_in` | `paused` | 映像と音声を停止し、状態を保持する。 |
| `resume` | `paused`（元が`cut_in`） | `cut_in` | 先頭から再生する。新しい`attempt`と`sequence`を発行する。 |
| `stop` | `cut_in` | `paused` | 直ちに停止する。再開時は先頭から。 |
| `safe_mode` | `cut_in` | `safe_mode` | CutInを停止し、次の準備済みセグメントへ進む。以後のCutInもスキップする。 |
| `lease_lost` | `cut_in` | `paused` | programのリース失効。コンソールから明示的に引き継ぐ。 |

## 互換性

- `packageSchemaVersion` は1のままとする。CutInは任意の `cutIns[]` と新しい `cut_in` セグメント種別の追加であり、既存パッケージの意味を変えない。
- CutInを使わない場合、`show.json` に `cutIns` を書かない。これにより、旧アプリでもCutInを使わない新パッケージを読み込める。
- CutInを使うパッケージを旧アプリで読む互換性は保証しない。旧アプリは `cut_in` セグメントまたは `cut-in` ファイル種別を解釈できない。
- 新しいライブアプリは、`cutIns` を持たない旧パッケージを `cutIns: []` として読み込む。
- Show Profileの `schemaVersion` は1のままとする。`cutIns` は任意フィールドである。
- `cut_in` セグメントは `targetDurationMs` を持たないため、旧来の「全セグメントが目標尺を持つ」前提を置かない。

## 検証とテスト

- 契約テスト: `cutIns` の受理、ID重複の拒否、`cutInId` 不在の拒否、`cut_in` セグメントの余分なフィールド拒否、`cutIns` 省略時の既定値、旧パッケージの読み込み。
- 書き出しテスト: video Assetの解決、MP4への正規化、probe結果の `durationMs`・`hasAudio`・寸法の反映、`manifest.kind: "cut-in"` の生成、素材カードの音声混入拒否が維持されること。
- パッケージ検証テスト: `cut-in` のmediaType、尺、音声、参照の不一致拒否。
- ランタイムテスト: `cut_in` フェーズへの遷移、`cut_in_ended` で次へ進む、古いイベントの無視、watchdog、pause/resumeの先頭再開、skip、end、stop、safe mode、再接続のseekと終了通知。
- ステージの手動確認: 全画面表示、キャラクター・字幕・素材・コメントの非表示、programのみ音声、previewミュート、ループなし、読み込み失敗時の非表示。
- コンソールの手動確認: 再生中のCutIn名、専用スキップ、フェーズ表示、失敗警告。
- 素材カードの既存テストが、CutIn追加後も無音検証を維持していること。

## 非目標

- CutInのBGM、効果音、音量調整、ダッキング。
- 1つのCutInに複数動画をつなぐこと、トリム、ループ、速度変更、逆再生。
- CutIn間のトランジション、ワイプ、フェード。
- CutInのWeb編集UI、auto-profileによる自動挿入。
- CutInの明示的な先読み、デコード済みキャッシュ。
- HTML、PNG、CompositionをCutInとして再生すること。
- CutIn中の字幕、キャラクター、テロップのオーバーレイ。
- VOD用のCutInログ活用。
