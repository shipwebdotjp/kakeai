# ライブ台本はWorkから独立したLive Programを正本とする

> amended by [ADR-0133](./0133-live-version-resolution-snapshot.md): 版は解決スナップショットと不変のpackage buildを持つ。
>
> amended by [ADR-0134](./0134-live-program-v2-only.md): Show Profile と v1 パッケージの経路を削除し、Live Program とパッケージv2だけを契約とする。

Status: accepted

ライブ配信の台本は、動画用の Work / Script Version から行を参照する Show Profile ではなく、ライブ専用の **Live Program** を正本とする。Live Program はCue、カード、素材、CutIn、コメント・安全・プレイアウトのポリシーを所有し、Work の `lineId` を参照しない。ライブの実行は引き続き、Live Program Version から書き出した不変の **Live Package** を境界とする。

この決定は [ADR-0124](./0124-live-cues-derived-from-script.md) の「ライブの準備済みキューはScriptVersionから導出する」という前提を置き換える。

## Context

- 現行の Show Profile は、`scriptCues` が `lineId` で Script Version の行を参照し、`liveCues` だけが字幕・読み上げを直接持つ。台本の行を削除・分割すると参照がずれ、GUI編集のたびに再解決が必要になる。
- 動画の Work は Scene、Narration Segment、Visual Cue、音声テイク、コンポジションを前提にする。ライブはスパイン、コメントコーナー、CutIn、カード状態、コメントポリシーを前提にし、使えるCueとパターンが異なる。
- 動画用の編集画面にライブモードを追加して制限する案は、両方の概念が同じ文書に混ざり、各機能にモード分岐を生む。
- ライブには、オープニングの挨拶、訂正、退避、臨時の一言など、動画台本に存在しない、または動画台本とは別に管理したい内容がある。`lineId` 参照を外せば、これらの内容を通常のCueとして自然に扱える。
- ライブの番組フォーマット（セグメント構成、キャスト、テーマ、コメント・安全・プレイアウトの既定値）は、エピソードごとに作り直すものではなく、繰り返し使うプリセットである。
- 既存のライブ用データはない。Show Profile JSON と Work 由来のライブ書き出しの互換性を保つ必要はない。

## 決定

- **Live Program** をライブ台本の正本とする。Cueは `speaker`、`caption`、`speech`、`expression`、任意の音声Asset、任意のカード参照、任意の素材参照を持つ。`lineId` と `scriptCues` / `liveCues` の区別を持たない。
- **Live Format** を再利用可能なプリセットとする。セグメントの骨格、キャスト、ステージ、テーマ、コメント・安全・プレイアウトの既定値、任意の定型カードを持つ。Live Program の作成時に内容をコピーし、以後のフォーマット編集を既存プログラムへ自動反映しない。
- **Live Program Version** を不変の版とする。下書きとは別に版を確定し、書き出しと配信開始は必ず版を指定する。版の文書、テーマ、声、キャラクター、素材の解決結果はパッケージに固定する。
- Live Program は、Cue、ネイティブカード、取り込んだLive Material、CutIn、コメント・安全・プレイアウトのポリシーを所有する。素材はWorkのSceneを参照し続けず、取り込み時にライブ側のスナップショットにする。
- 動画用の `ContentDocument`、`VisualTemplateDefinition`、`RenderContext`、コンポジションコンパイラをライブの正本文書として共有しない。共有するのはテーマトークン、純粋なヘルパー、表示用の部品に限る。
- パッケージは `packageSchemaVersion: 2` とし、`source` に `programId`、`programVersionId`、`programVersionNumber`、文書ハッシュを持つ。
- Work からライブ台本を作る機能は、必要なら一度だけ内容をコピーするインポータとして残す。参照を保持しない。
- 既存の Show Profile、`live-profiles/auto`、`live:export --profile` は移行フェーズで削除またはインポータへ置き換える。

## Considered Options

- 現行の Show Profile を維持し、`lineId` 参照をGUIで解決する。→ 台本変更のたびに参照ずれと再解決が必要で、ライブ専用の内容も二等公民のままになるため不採用。
- Script Version をライブの正本にし、ライブ専用の構造だけを別文書にする。→ 動画のScene・行・音声テイクの制約がライブに残り、Workの複製や版管理に縛られるため不採用。
- 動画用の Work 編集画面にライブモードを追加する。→ Scene、Visual Cue、タイムラインと、スパイン、コメントコーナー、カード状態が同じ文書に混ざり、各機能にモード分岐が必要になるため不採用。
- 動画とライブで同じ `ContentDocument` を使い、コンパイラだけを分ける。→ ライブの状態駆動と動画のタイムライン駆動が文書レベルで結合し、片方の変更が他方を壊すため不採用。
- Live Program をファイルJSONのまま運用する。→ 一覧、版、参照検証、GUI編集、配信履歴を持てないため不採用。DBに永続化する。
- フォーマットを参照し、既存プログラムへ自動反映する。→ フォーマット変更が過去の版を壊し、差分マージUIが必要になるため、v1はコピーとする。

## Consequences

- ライブ台本はWorkから独立し、`lineId` の参照ずれがなくなる。動画とライブで同じ内容を使う場合は、インポータでコピーした後に別々に編集する。
- Live Program、Live Program Version、Live Format のDB、API、GUI、およびv2パッケージの書き出しが必要になる。
- 動画とライブで台本が二重管理になる。共通化するのはテーマ、素材、キャラクター、声、純粋な表示部品に限る。
- ライブ側のCueは字幕・読み上げを直接持つため、TTS準備と音声テイクの解決をライブの書き出しで行う。
- フォーマットの改善は将来のプログラムにだけ効く。既存プログラムへ反映したい場合は、差分適用を別途設計する。
- Show Profile、Work由来のライブ書き出し、既存のライブ用CLIは移行フェーズで置き換える。
- ライブのパッケージv2は `programId` / `programVersionId` を持ち、どの台本のどの版から配信したかを追跡できる。
