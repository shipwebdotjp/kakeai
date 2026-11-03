# 立ち絵の切替はセリフ境界の状態リストで持つ

Status: accepted

## Context

シーン内で立ち絵の外観を変えるには、現在はSceneを分割するしかない。分割は見出し・本文・Cue・Scene遷移まで複製するため、立ち絵を変えるだけの分割が台本の見通しを悪くする。

契約上は `VisualCue.range` が `lines` を既にサポートしており、`character.standing` をセリフ区間のCueとして複数置くこともできる。コンパイラもCueの表示窓で発話中バウンドと表情をクリップしている。不足しているのは編集モデルで、現在のUIは `range: scene` の立ち絵Cueだけを左右2枠に投影し、`standing.upsert` も `range: scene` を強制している。

台詞ごとの表情は `NarrationSegment.expressionId` として行単位で持つ前例がある（[ADR-0047](./0047-per-line-expression-id.md)）。一方、外観は話者と台詞から導けないため、行の属性として暗黙に持たせると「声だけの話者」「ナレーション中の立ち絵」と噛み合わない。

## 決定

- `Scene.standingStates` を任意の配列で追加する。各要素は `{ side, fromLineId, characterId, appearanceId }` を持ち、`characterId` と `appearanceId` が両方nullなら非表示、両方非nullなら表示とする。
- 状態は対象セリフの先頭から、同じsideの次の状態またはScene末尾まで継続する。開始と終了の両方を書かせない。
- シーン開始時の状態は、従来の左右2枠（`range: scene` の `character.standing@1` Cue）をそのまま使う。行を持たない導入・結びでも立ち絵を出せるようにするため、状態リストだけには寄せない。
- 切替の粒度はセリフ先頭に限る。offset区間の状態は持たない。セリフ途中で切りたい場合はセリフを分割する。
- 状態は「誰のどの外観か」だけを持ち、倍率・端・高さは持たない。外観側の標準配置（[ADR-0117](./0117-standing-layout-on-appearance.md)）から解決する。
- 状態変更に個別の入場・退場は持たない。切替はカットとし、Scene開始時の入場と終了時の退場は開始時状態のCueが持つ。
- 正本は「開始時状態＋変更点」だけとし、各セリフの有効状態はセリフ一覧・Cueマップ・レンダーの投影で解決する。解決結果は保存しない。
- レンダー時は状態を既存の `character.standing@1` の区間へ展開し、テンプレートと描画ロジックを再利用する。変更点が無いSceneは既存のCueをそのまま描画し、出力を変えない。
- 行の削除では、状態の対象行が消えたら次の行へ移す（次の行に同じsideの状態があれば捨てる）。Scene分割では、分割点で有効な状態を新しいSceneの開始時状態へ引き継ぎ、以降の変更点を移す。
- 追加は任意項目で行い、`schemaVersion` は `1` のまま、テンプレート版も変えない。旧JSONは `standingStates` 無し＝変更なしとして読む。

## Considered Options

- `character.standing` を `range: lines` のCueとして複数持つ。→ コンパイラはそのまま使えるが、各切替に開始行と終了行の両方が必要で、行を追加するたびに終了行を直すことになる。開始行だけを指定する編集意図を保存できないため不採用。
- `NarrationSegment` に外観の上書き属性を追加する。→ 行の話者と立ち絵が一致しない場合（ナレーション中の立ち絵、声だけの話者）に意味が曖昧になり、行の属性としては説明できないため不採用。
- 状態を全項目のスナップショットとして持つ。→ 変更点ごとに倍率・端・高さ・入退場を複製し、開始時との整合規則が増える。外観の標準配置で足りるため不採用。
- Scene分割のコストだけを下げる（分割時に立ち絵をコピーする）。→ 設定し直す手間は減るが、立ち絵を変えるたびにSceneが増える問題は残るため不採用。
- 秒単位の状態も持つ。→ 切替はセリフの切れ目で足り、秒指定はセリフ分割で代替できる。まず行単位に絞る。

## Consequences

- `ContentDocument` のSceneに `standingStates` が増え、状態の行参照・キャラクター・外観・重複を検証する。
- `packages/script-edits` に `standing.state.upsert` / `standing.state.remove` を追加し、行削除・移動・分割とScene分割の規則を実装する。
- `packages/video` は、変更点があるSceneだけ状態をCue区間へ展開する。変更点が無いSceneの出力は変えない。
- セリフ一覧とCueマップは、解決した有効状態を表示する。Cueマップの立ち絵帯は変更点で分割される。
- 表情検証は「Scene内の全立ち絵外観」ではなく「そのセリフで有効な外観」に対して行う。
- Agent Accessは `standing.state.upsert` / `standing.state.remove` を公開する。`standing.upsert` は開始時状態の操作として残る。
- 旧ビルドは新しい `standingStates` を未知の項目として拒否する。旧作品を新アプリで開く後方互換だけを保証する（[ADR-0112](./0112-pre-1.0-in-place-v1-api-updates.md)）。
