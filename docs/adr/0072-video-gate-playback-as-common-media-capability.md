# セリフゲート動画再生を共通メディア能力として扱う

動画をセリフに合わせて保持・通過させる編集意図は、全画面・カード・端末枠などのレイアウトとは独立している。そのため、専用VisualTemplateや親テンプレートごとの再生フラグではなく、直接メディア入力と `NestedVisual.kind = "media"` が共有するVideo Gate Playbackとして保存・解決する。GateはNarration Segment開始までsource時刻を通過させない一方向の上限とし、動画が遅いときにシーク・加速しない。

## Considered Options

- `media.gated-video` の専用VisualTemplateを追加する。→ 全画面以外の動画スロットに同じ機能を付けるために親テンプレートや入れ子を複製する必要があり、不採用。
- 親VisualTemplateごとに動画再生・音声フィールドを持たせる。→ 保存形式、UI、レンダリング、検証が分岐し、同じ動画編集意図を再利用できないため不採用。
- 再生中のvideo要素へ実時間の `pause()` / `play()` を送る。→ プレビューとフレームレンダーでタイミングが分岐し、決定性を失うため不採用。

## Consequences

- 通常の動画Cueは従来どおり無音であり、Gate Audioを明示したvideoだけが埋め込み音声を出す。これはInsert Sceneの会話停止・BGM抑制とは別の編集意図である。
- ゲート保持中はvideo音声も停止する。静止映像上の独立音声はAudioCueとして表す。
- [ADR-0067](0067-insert-scene-owns-embedded-video-audio.md) の「Insert Sceneだけが動画音声を自動再生する」判断を、明示的なGate Audioの例外を持つ形へamendする。
