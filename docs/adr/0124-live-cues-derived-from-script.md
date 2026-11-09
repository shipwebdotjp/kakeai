# ライブの準備済みキューはScriptVersionから導出し、ライブ専用キューだけを別に持つ

> superseded by [ADR-0131](./0131-live-program-owns-live-script.md): ライブ台本はWorkから独立したLive Programを正本とする。

Status: superseded

ライブの準備済みキューは、原則としてKakeaiの`NarrationSegment`を`lineId`で参照し、字幕・読み上げ・話者・表情・音声を書き出し時に解決する。オープニング・訂正・退避・臨時の一言など、ScriptVersionに存在しないキューだけを**ライブ専用キュー**として別に持つ。

## Context

- `NarrationSegment`は、字幕、読み上げ、話者、表情、選択済みAudio Takeの正本である。Show Profileのキューが同じ情報を`caption`・`speech`・`speaker`・`expression`として持つと、台本の修正、音声テイクの選択、VOD台本化で不整合が起きる。
- ライブには、オープニングの挨拶、訂正、退避、臨時の一言など、台本に存在しない、または台本とは別に管理したいキューがある。これらを通常の台本行と同じ扱いにすると、ScriptVersionに存在しない内容が台本の一部のように見える。
- ライブパッケージは不変のスナップショットである。書き出し時にScriptVersionから解決した結果を持つこと自体は問題ないが、入力のShow Profileが別の正本を持ってはならない。
- 将来、配信ログからVOD用の台本や字幕を作る場合、元の`lineId`との対応が必要になる。

## 決定

- 入力の`LiveShowProfile`は、`scriptCues`と`liveCues`を分ける。
  - `scriptCues`: `{ id, lineId, expressionId? }`。`lineId`は必須で、`NarrationSegment`を参照する。字幕・読み上げ・話者・音声は書き出し時に解決する。`expressionId`は任意の上書きとする。
  - `liveCues`: `{ id, speaker, caption, speech, expression, audio? }`。オープニング、訂正、退避、臨時の一言など、ScriptVersionに存在しないキューのみ。
- `segments.cues`は、`scriptCues`または`liveCues`のIDを参照する。
- 出力の`LivePackageShow`（`show.json`）の`PreparedCue`は、`origin: "script" | "live"`と`sourceLineId?`を持つ。`origin: "script"`のキューは`sourceLineId`を必須とし、`caption`・`speech`・`speaker`・`audio`を解決済みで持つ。
- 書き出し時に、`lineId`の実在、話者とキャラクターの対応、外観・表情の整合、Audio Takeの実在、`lineId`の重複を検証する。解決できない通常キューは書き出しを失敗させる。
- 通常の準備済みキューを、`caption`・`speech`の直接入力で作ることはできない。台本にない内容は`liveCues`として明示する。

## Considered Options

- 現状どおり、Show Profileのキューが`caption`・`speech`・`speaker`・`expression`を直接持ち、`sourceLineId`を任意にする。→ 台本の正本が二重化し、修正・音声選択・VOD化で不整合になるため不採用。
- `sourceLineId`を必須にするが、字幕・読み上げの上書きを許す。→ 上書きが常態化すると正本が曖昧になるため、v1では`expressionId`の上書きだけに限る。
- Show Profileを参照だけにし、ライブ専用キューもScriptVersionに含める。→ 訂正・退避・臨時の一言が台本の版履歴を汚すため不採用。ライブ専用キューは別に持つ。

## Consequences

- 「Kakeaiの台本からライブを作る」という前提が保たれる。台本の修正は書き出し直しで反映される。
- 書き出しは、`lineId`の解決、話者と左右キャラクターの対応、Audio Takeの選択を行う。解決できない参照は失敗として返す。
- ライブ専用キューは明示的に別管理されるため、台本の版履歴と混ざらない。
- 将来、配信ログからVOD用の台本・字幕を作るときに、元の`lineId`と対応づけられる。
- Show Profileの作成者は、Scene IDだけでなくLine IDも扱う必要がある。UIは将来追加する。
