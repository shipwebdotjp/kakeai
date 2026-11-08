# ライブのCutInはCueでも素材カードでもなく、専用のSpineセグメントとして扱う

Status: accepted

ライブのコーナー間などに挿入する短い動画（CutIn）は、通常のLive CueにもMaterial Cardにも混ぜず、Spine専用の `cut_in` セグメントと専用のパッケージ種別として扱う。CutInは全画面で再生し、埋め込み音声とprobe由来の尺を自身の契約として持つ。素材カードは従来どおり無音に固定し、CutInだけが `hasAudio: true` を許可される。

## Context

- [ADR-0124](./0124-live-cues-derived-from-script.md) で、ライブの準備済みキューはScriptVersionから導出し、ライブ専用キューだけを別に持つと決めた。Cueは話者・字幕・読み上げ・表情・音声を持つ最小出力単位である。
- [ADR-0126](./0126-live-material-cards-static-or-mp4.md) で、素材カードは静止PNG/HTMLまたは短い無音MP4に限定し、manifestの `hasAudio: false` で音声混入を拒否すると決めた。素材カードはステージ中央のスロットに表示する。
- コーナーの区切りには、ジングル、スポンサー告知、オープニング映像のような、全画面・短尺の動画を使いたいという需要がある。音声付きのジングルも、無音のバンパーもある。
- [../live-cue-materials/roadmap.md](../live-cue-materials/roadmap.md) ではCutInを将来候補にしていたが、素材カードを一時的に前面へ出す案は、音声所有者、尺の正本、全画面表示、再接続の扱いを曖昧にする。
- [../timeline-inserts/spec.md](../timeline-inserts/spec.md) のインサートSceneは、MP4の映像と埋め込み音声を同じ使用区間で再生し、尺をAssetから導出する先例である。ただしライブはコンポジションのタイムラインではなく、状態駆動の別ランタイムである（[ADR-0120](./0120-live-runtime-separate-from-composition.md)）。
- ライブのprogramステージは1つだけが音声を再生し、previewはミュート・イベント非送信である（[ADR-0125](./0125-live-program-playback-lease.md)）。CutInの音声も同じ所有者規則に従う必要がある。

## 決定

- CutInは `segments[]` の `kind: "cut_in"` として明示し、`cutInId` でトップレベルの `cutIns[]` を参照する。`cut_in` セグメントは `targetDurationMs`、`cues`、`material` を持たない。
- `cutIns[]` は `{ id, assetId }` を持ち、readyなvideo Assetを参照する。同じCutInを複数のセグメントから再利用できる。occurrenceは `segmentId`・`attempt`・`sequence` で識別する。
- 書き出し時にAssetをMP4へ解決し、probe結果の `durationMs`・`width`・`height`・`hasAudio` を正本にする。尺を手入力しない。必要ならH.264/AACのMP4へ正規化する。
- manifestのファイル種別は `kind: "cut-in"`、`mediaType: "video/mp4"` とし、`hasAudio` はprobe結果を記録する。素材カードの `kind: "material"` と `hasAudio: false` の検証は変更しない。
- CutInの音声は任意とする。音声ありCutInはprogramステージだけが再生し、previewはミュートする。音声なしCutInは無音で再生する。
- ステージ状態は `phase: "cut_in"` と専用の `StageState.cutIn` を持ち、通常のCue音声用 `playback` に流用しない。CutIn中はキャラクター、字幕、素材カード、コメント、セグメントラベルを隠し、全画面レイヤーで再生する。
- CutInはループしない。`cut_in_ended` を受けたら次のSpine要素へ進む。`cut_in_error` または尺＋短い猶予のwatchdogでは、警告を記録して次へ進み、配信を停止しない。
- pause後はCutInを先頭から再開する。再接続・program引継ぎ時は `startedAt` から位置を求めてシークし、尺を過ぎていれば終了を通知する。古い `attempt`・`sequence` のイベントでは進めない。
- `end` はCutIn再生中なら最後まで再生してからクロージングへ、開始前に保留済みならCutInを飛ばしてクロージングへ進む。`stop` は直ちに停止する。安全モード中はCutInをスキップする。
- コンソールには再生中のCutIn名と専用のスキップ操作を出し、`skip_cut_in` を追加する。`skip_cue` はCutInに流用しない。
- v1の入力はShow ProfileのJSONまたはエージェント経由とし、Web編集UIとauto-profileによる自動挿入は行わない。
- `packageSchemaVersion` は1のままとする。CutInを使わない場合は `show.json` に `cutIns` を書かず、旧アプリでもCutInを使わない新パッケージを読めるようにする。CutInを使うパッケージの旧アプリ互換性は保証しない。

## Considered Options

- Material Cardに `hasAudio: true` を許可し、全画面表示のフラグを足す。→ 素材カードの無音制約、中央スロット、尺、音声所有者、再接続が同じ型に混ざり、検証が曖昧になるため不採用。
- 通常のCue音声再生をCutInにも流用する。→ Cueは話者・字幕・読み上げを持つ最小出力単位であり、全画面映像・ループなし・probe尺・専用スキップの契約を押し込むと、Cueの状態機械と素材の意味が崩れるため不採用。
- CompositionのiframeやHyperFrames PlayerでCutInを再生する。→ ライブの状態駆動とプレイヤーのタイムラインが二重管理になり、ADR-0120とADR-0126の境界を破るため不採用。
- CutInをコーナーの前後に自動挿入する。→ どの動画をどの区切りに入れるかは編集意図であり、台本やコメントから自動推測できないため、v1では明示入力だけにする。
- 既存のMP4 Renditionだけを使い、正規化しない。→ 利用者が毎回ブラウザ再生可能なMP4を用意する必要があり、尺と音声の検証も不安定になるため不採用。書き出し時にprobeし、必要なら正規化する。
- 音声ありCutInを必須にする。→ サイレントのバンパーやスポンサー表記を作れなくなるため、音声は任意とし、CutIn種別だけ `hasAudio: true` を許可する。

## Consequences

- CutInはCueや素材カードの状態機械を汚さず、音声所有・尺・全画面・再接続を独立して扱える。
- パッケージ契約に `cutIns[]`、`cut_in` セグメント、`cut-in` ファイル種別、`StageState.cutIn`、`cut_in` フェーズ、専用イベント、`skip_cut_in` が増える。
- 書き出しにCutIn Assetの収集、probe、MP4正規化、manifest記録が増える。初回書き出しは再エンコードの分だけ遅くなる可能性がある。
- ステージにCutIn専用の全画面レイヤーと `<video>` の再生制御が増える。素材カードの動画コンポーネントとは分ける。
- コンソールにCutIn名と専用スキップが増える。通常キューのスキップと操作対象を混ぜない。
- CutInを使わないパッケージは従来の契約のままで、旧アプリでも読める。CutInを使うパッケージはCutIn対応版のライブアプリを必要とする。
- BGM、スポンサー告知、オープニング映像、複数動画、トランジションは [../live-media-playout/roadmap.md](../live-media-playout/roadmap.md) で別途仕様化する。
