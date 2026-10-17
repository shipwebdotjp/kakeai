# セリフ間・Scene音声・インサートScene 実装TODO

[仕様](./spec.md)を正とする。R1 → R2 → R3の順に実装し、各段階でプレビューとレンダーを通す。

## [x] D1 方針と用語

- [x] `docs/timeline-inserts/spec.md` と本TODOを追加する。
- [x] `CONTEXT.md` にNarration Gap、Insert Scene、Embedded Video Audioを追加する。
- [x] 動画埋め込み音声を通常の動画Cueではなくinsert Sceneだけで自動再生する決定をADRに記録する。

## [x] R1 セリフ前の間

- [x] `NarrationSegment` に任意の `gapBeforeMs` を追加し、省略時を0として検証・正規化する。
- [x] タイムライン解決器を、auto/fixedの両方でgapを予約する規則へ変更する。
- [x] プレビューDTO・Cue Map・セリフジャンプが、gapとSegment本体を混同しないようにする。
- [x] `LinesEditor` に「このセリフの前の間（ms）」を追加する。
- [x] contracts/video/web/APIの境界テストを追加する。少なくとも先頭gap、音声あり・なし、fixed尺超過、line rangeがgapを含まないことを確認する。
- [x] ユーザーガイドに操作と制約を追加する。
- [x] `npm run typecheck`、`npm test`、OCRレビュー、コミットを行う。

完了条件: 指定したgapが字幕・発話音声・発話演出を伴わず、プレビューとMP4で同じ位置・同じ長さになる。

## [ ] R2 Scene AudioCue編集

- [ ] `AudioCue.role` に `program` を追加し、既存の`bgm`/`sfx`を維持する。
- [ ] `SceneEditor` にScene AudioCueの一覧、追加、削除、素材選択、role、gain、loopを追加する。
- [ ] 作品全体BGMフォームとScene AudioCueフォームが、対象外のCueを削除・変更しないことを確認する。
- [ ] API保存・プレビュー・レンダーで、Scene開始・停止・loop・複数Cueミックスを検証する。
- [ ] UIとユーザーガイドで、Scene AudioCueには開始オフセット／フェード／ダッキングがないことを明示する。
- [ ] `npm run typecheck`、`npm test`、OCRレビュー、コミットを行う。

完了条件: 任意のreadyなaudio AssetをNarration Segmentへ紐付けず、Scene全体の音声として編集・保存・プレビュー・レンダーできる。

## [ ] R3 インサートScene

- [ ] contractsに`insert` Scene、主動画Cue参照、`embeddedAudio`を追加し、Scene順序・主動画Cue・尺の制約を検証する。
- [ ] 作品新規作成、保存、復元、複製、Scene並べ替え、Cue Map、プレビューDTOがinsert Sceneを扱えるようにする。
- [ ] 動画Assetの埋め込み音声を、insert Sceneで映像と同期してプレビュー・MP4へ出力する。必要なRenditionの導出・利用をasset/render境界に置く。
- [ ] 作品全体BGMをinsert Scene区間で200msフェード付きに抑制する。
- [ ] Webに「動画を挿入」操作、動画選択、音声有無・有効状態・BGM抑制の表示、埋め込み音声のオン／オフを追加する。
- [ ] 音声なし動画、音声無効、BGMあり、Scene AudioCue併用、Scene Transition、削除・差し替えの契約テストを追加する。
- [ ] ユーザーガイドにインサートSceneの作成、音声規則、初期版のトリム／ループ非対応を追加する。
- [ ] `npm run typecheck`、`npm test`、OCRレビュー、コミットを行う。

完了条件: 動画の挿入だけで映像と埋め込み音声を同期して再生でき、会話と通常の背景動画の既存挙動を変えずにMP4出力できる。
