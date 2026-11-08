# ライブのメディア挿入（CutIn）TODO

[spec.md](./spec.md) を正とする。Phase順に進め、完了したらチェックを付ける。コードを変更したPhaseでは、`npm run typecheck` と `npm test` を通す。

## P1. 契約と検証

- [x] `LiveShowProfile` に任意の `cutIns[]`（`id`・`assetId`）を追加する。既定は空配列とする。
- [x] `LivePackageShow` に `cutIns[]`（`id`・`file`・`durationMs`・`hasAudio`・`width`・`height`）を追加する。既定は空配列とし、空のときは `show.json` に書かない。
- [x] `LiveSegment` に `kind: "cut_in"` を追加する。`id`・`label`・`cutInId` だけを持ち、`targetDurationMs`・`cues`・`material`・`commentPolicy` を持たない。
- [x] `cut_in` セグメントは入力・出力とも `targetDurationMs` を持たず、`LiveServerShowMeta.segments[].targetDurationMs` は `show.cutIns[].durationMs` から導出する。
- [x] `StagePhase` に `cut_in` を追加する。
- [x] `StageState.cutIn` を追加する。`playback` とは別に扱い、CutIn中は `playback: null` とする。
- [x] `StageEvent` に `cut_in_ended` / `cut_in_error` と `cutInId`・`segmentId` を追加する。
- [x] `ConsoleSnapshot.cutIn` と `liveCommandSchema` の `skip_cut_in` を追加する。
- [x] `LiveFileKind` に `cut-in` を追加し、manifestで `video/mp4` と `hasAudio: true|false` を許可する。
- [x] `RunLogEvent` に `cut_in_started` / `cut_in_finished` / `cut_in_failed` と `cutInId` を追加する。
- [x] Profile検証で、`cutIns` のID重複、`cutInId` 不在、`cut_in` の余分なフィールド、既存のスパイン順序を検証する。
- [x] パッケージ検証で、`cut-in` のmediaType・尺・音声・寸法・参照を検証する。素材カードの `hasAudio: false` 検証は変更しない。
- [x] `cutIns` を持たない既存Profileと既存パッケージがそのまま読めることを契約テストで確認する。
- [x] CutInを使わない `show.json` に `cutIns` を書かないことを確認する。

完了条件: 契約テストが通り、素材カードの音声混入拒否が維持されている。

## P2. 書き出し

- [x] Job作成時に `cutIns[].assetId` を収集し、readyな `video` Assetだけを許可する。
- [x] スナップショットにCutInのvideo Assetを含め、Workerが固定済みバイト列だけを使うようにする。
- [x] `ResolvedLiveProfile` にCutInの解決結果を追加し、Job作成時とWorkerの両方で参照を検証する。
- [x] `prepareCutIns` を追加する。元Assetをprobeし、必要ならH.264/AACのMP4へ正規化し、最終MP4をprobeする。
- [x] `durationMs`・`width`・`height`・`hasAudio` をprobe結果から `show.cutIns[]` とmanifestへ反映する。
- [x] `cut_in` セグメントの尺を `cutIns[].durationMs` から導出し、`targetDurationMs` を重複保存しない。
- [x] 参照されたCutInだけをパッケージに含める。同じAssetを複数のCutInが参照してもファイルを重複させない。
- [x] `manifest.json` の `files` に `kind: "cut-in"` を記録する。
- [x] 素材カードの書き出し・無音検証を変更しない。
- [x] 書き出しテストで、音声あり・音声なし、正規化、尺のprobe反映、video以外のAsset拒否、参照されたCutInだけの出力を確認する。

完了条件: CutInを含むパッケージを書き出し、`show.json` とmanifestの検証が通る。

## P3. ランタイム

- [x] `CutInRuntime` を追加し、現在のCutIn、`attempt`、`sequence`、`startedAt`、watchdogを所有させる。
- [x] `Spine.enterSegment` に `cut_in` の分岐を追加し、Cueキューに混ぜずにCutInを開始する。
- [x] `cut_in_ended` / `cut_in_error` をprogramステージから受け、現在の `cutInId`・`segmentId`・`attempt`・`sequence` に一致する場合だけ進める。
- [x] watchdogを尺＋短い猶予（既定1500ms、最低3000ms）で動かし、古い試行で進めない。
- [x] `pause` / `resume` / `stop` をCutInに対応させる。resumeは先頭から、新しい `attempt` と `sequence` を発行する。
- [x] `end` をCutInに対応させる。再生中なら最後まで再生してclosing、開始前に保留ならCutInを飛ばしてclosing。
- [x] `skip_cut_in` を追加し、現在のCutInを停止して次へ進む。`skip_cue` はCutInに流用しない。
- [x] `safe_mode` 中はCutInをスキップし、CutIn中に安全モードへ入った場合は停止して次へ進む。
- [x] programリース失効時はCutInをpauseし、明示的な引継ぎ後に再開できるようにする。
- [x] 再接続時に `startedAt` から位置を求め、尺を過ぎていれば `cut_in_ended` を送る。program引継ぎではミュート解除と必要ならseekを行う。
  - サーバ側は `StageState.cutIn.startedAt` / `durationMs` を再接続時に公開し、遅れて届いた `cut_in_ended` を受理して進むところまでP3で実装済み。位置計算・seek・program引継ぎ時のミュート解除・尺超過時の終了イベント送信はP4の `StageCutIn` で実装した。OBSでの実地確認はP4の手動確認項目で行う。
- [x] `ControllerView` の `StageState.cutIn` と `ConsoleSnapshot.cutIn` を組み立てる。
- [x] ランタイムテストで、遷移、古いイベントの無視、watchdog、pause/resume、skip、end、stop、safe mode、再接続を確認する。

完了条件: CutInがCueの再生状態に影響せず、失敗してもスパインが止まらない。

## P4. ステージ

- [x] `stage.html` にCutIn専用の全画面レイヤーと `<video>` を追加する。
- [x] CutIn中はキャラクター、字幕、素材カード、コメント、セグメントラベルを隠す。
- [x] `loop` なし、`playsInline`、`object-fit: contain`、黒背景で表示する。
- [x] programだけが `hasAudio: true` の埋め込み音声を再生し、previewは常にミュートする。
- [x] `startedAt` から位置を求めてseekし、尺を過ぎていれば `cut_in_ended` を送る。
- [x] pause中は映像と音声を停止し、resume時は先頭から再生する。
- [x] 読み込み失敗時にレイヤーを隠し、`cut_in_error` を送る。
- [x] 既存の素材カード動画のミュート・ループ・非再スタートを変更しない。
- [ ] 手動で、全画面表示、音声のprogram限定、previewミュート、ループなし、失敗時の非表示を確認する。

完了条件: OBSのprogramステージでCutInの映像と音声が同期し、previewでは音が出ない。

## P5. コンソール

- [x] 再生中のCutIn名、尺、経過を表示するパネルを追加する。
- [x] 専用の「CutInをスキップ」ボタンを追加し、`skip_cut_in` を送る。
- [x] フェーズ表示に `cut_in` を追加する。
- [x] CutInの開始・終了・失敗をイベント表示とログに出す。
- [x] `skip_cue` と `skip_cut_in` の操作対象が混ざらないことを確認する。

完了条件: オペレーターが再生中のCutInを識別し、通常キューとは別にスキップできる。

## P6. 文書と確認

- [x] `docs/live/spec.md` にCutInの概要、フェーズ、状態、イベント、失敗時の挙動を追加する。
- [x] `docs/live-cue-materials/spec.md` と `roadmap.md` から、CutInを別仕様として参照する。
- [x] `CONTEXT.md` にCutIn用語を追加する。
- [x] `docs/mvp/api-contract.md` のライブ書き出し入力検証に `cutIns[].assetId` を追加する。
- [x] ユーザーガイドの書き出し・操作・トラブルシューティングにCutInを追加する。
- [x] `npm run typecheck` と `npm test` を通す。
- [x] OCRレビューと修正後の再レビューを行い、コミットする。
