# セリフゲート動画再生 ロードマップ

[仕様](./spec.md) と [TODO](./todo.md) を正とする。この文書は初期版で意図的に扱わないものと、実装後に検討する拡張を整理する。

## 現状

設計は確定しているが未実装である。通常の動画Cueは連続・無音、Insert Sceneは会話を止めた映像・音声の再生、CompositionVersionは音声なしの有限モーションという既存境界を維持する。

## 初期版で見送るもの

- **再生速度・逆再生・巻き戻し**: Video Gateはsource時刻を一方向に進める上限だけを持つ。映像の速度や過去位置へ戻る編集は別のtime-remapping契約にする。
- **ゲート再生中のloop**: source時刻の単調順と「次Gateまで待つ」意味を失わせるため、初期版では排他にする。
- **静止映像上の継続音声**: 動画の音はvideo playheadに従う。映像と独立して鳴らす音はAudioCueにする。
- **自動ダッキング**: Gate音声とナレーション／BGMの優先度は利用者がgainとfadeで決める。自動ミックス方針は別の機能として扱う。
- **単語・音素同期**: GateはNarration Segment開始だけを参照する。語句レベルの演出には強制アラインメントの導入が必要である。
- **CompositionVersionへの適用**: AI CompositionはCue開始から有限時間を連続再生する。Video Gateはvideo Assetのplayheadを扱う機能であり、Compositionのpause/resume契約を導入しない。

## 次に検討する拡張

### P5. Gate用のsourceプレビュー

- source動画のサムネイル列とGate時刻を並べ、Gateの追加・編集時に保持されるフレームを確認できるようにする。
- source波形は表示してもよいが、Gate Audioの編集意図と混同しない。音量オートメーション編集にはしない。

### P6. AudioCueとのミックス方針

- Gate Audio、Narration Audio Take、work BGM、Scene AudioCueの優先度とダッキング規則を定める。
- Insert Sceneの既存BGM抑制と二重フェードにならないよう、ミックス規則を一つのPlanへ統合する。

### P7. 高度なtime remapping

- 再生速度、逆再生、ジャンプ、反復を本当に必要とするなら、Video Gateを拡張せず、別の明示的なVideo Time Remapを設計する。
- source時刻が非単調になるため、音声の連続性・シーク可能性・フレーム決定性・プレビュー性能を別途検証する。

### P8. 音声アラインメント

- 台詞の語句や音素の時刻が必要になった時点で、Audio Takeから強制アラインメント結果を派生させる。
- アラインメント結果はAudio Takeとその生成条件へ帰属させ、Narration SegmentやVideo Gateの正本を任意秒指定へ変えない。
