# 台本編集操作コア 仕様

## 目的と境界

この文書は、`ContentDocument` への編集を、Web UI・API・Agent Access（MCP / CLI）で共有する単一の操作コアとして定める。正本は引き続き不変の `ScriptVersion.contentJson` であり、操作コアは文書を入力に取り、新しい文書と派生情報を返すだけで、永続化・トランスポート・認証を持たない。

- 台本本文の契約は [../mvp/content-schema.md](../mvp/content-schema.md)、編集画面の構成は [../editor/spec.md](../editor/spec.md)、外部エージェント向けの入口は [../agent-access/spec.md](../agent-access/spec.md) を正とする。
- 型と Zod スキーマは `packages/contracts` に置く。操作の実装は `packages/script-edits` に置き、UI・API は同じ実装を呼ぶ。編集ロジックを束縛ごとに複製しない（[ADR 0076](../adr/0076-shared-script-operation-core.md)）。
- 操作コアは Node.js・ブラウザ・React・Prisma に依存しない。ファイルシステム、DB、時計、乱数（ID生成器を除く）へ直接触れない。
- 決定理由は [ADR 0076](../adr/0076-shared-script-operation-core.md) を参照する。

## 現状の課題

台本の保存は `ContentDocument` 全体の置換であり、それは維持する。一方、編集の意味論は現在 `apps/web/src/content/form.ts` のフォームモデル上にあり、HTTP API は「全体が届いた後の参照整合」しか知らない。この分離には次の問題がある。

- シーン分割・行削除・Cue 範囲変更は、参照の付け替え、効果トリガーの剪定、ID 採番、既定値の補完を伴う。全体置換を外部クライアントに任せると、Zod は通るが編集画面で扱えない文書が作れる。
- AI エージェントに同じ副作用を再実装させると、`form.ts` と意味論が二重化する。
- 構造操作は、利用者の入力途中の値ではなく、妥当な文書に対して決定的に適用する必要がある。

操作コアはこの副作用を一箇所に集約する。保存時の検証は最終ゲートとして残す。

## モデル

### ScriptContext

操作は文書だけでは決まらない情報を `ScriptContext` として受け取る。文脈は呼び出し側（UI は読み込み済みの一覧、API は DB）が組み立てる。

| 項目 | 内容 |
| --- | --- |
| `assets` | `assetId` から `kind`・`status`・`durationMs`・`hasAudio` を返す読み取り専用の参照。ready でない Asset は解決しない |
| `ids` | Scene・行・Cue・Audio Take の ID 生成器。テストでは連番に差し替える |

テンプレート定義・入力スキーマ・既定値は `packages/contracts` の静的なレジストリを使う。Face Set・Theme・Composition のグローバル整合は操作コアでは検証せず、保存時の検証に委ねる。操作コアが文書と `ScriptContext` から判定できる参照整合だけをここで守る。

### 操作の形

操作は `(document, operation, context) => ScriptOperationResult` の純粋関数とする。入力を変更せず、新しい文書を返す。

```ts
interface ScriptOperationResult {
  document: ContentDocument;
  created: {
    sceneIds: string[];
    lineIds: string[];
    cueIds: string[];
    audioCueIds: string[];
    audioTakeIds: string[];
  };
  warnings: Warning[];
}
```

- 同一の入力・文脈・ID生成器に対して同一の結果を返す。
- 操作対象でない Cue、未知の `template.id@version`、UI が解釈しない入力は保持する。削除・再生成しない。
- 操作は 1 件ずつ適用できる。複数操作の一括適用と原子性は束縛が担う（[../agent-access/spec.md](../agent-access/spec.md)）。

### 操作の識別子と一括適用

```ts
type ScriptOperation =
  | { op: "scene.add"; key?: string; /* ... */ }
  | { op: "line.add"; key?: string; /* ... */ }
  | { op: "cue.add"; key?: string; /* ... */ }
  | { op: "scene.splitAtLine"; /* ... */ }
  | { op: "cue.setRange"; /* ... */ };
```

- 作成操作は任意の `key` を持てる。同一呼び出し内の後続操作は、ID の代わりに `{ "key": "<key>" }` で作成物を参照できる。
- `key` は呼び出し内でのみ有効で、文書へ保存しない。
- 一括適用の途中で失敗した場合、束縛は新しい `ScriptVersion` を作らない。

## 操作一覧

入出力の Zod スキーマは `packages/contracts` に置く。ここでは意味と不変条件を定める。

### Scene

| 操作 | 入力 | 不変条件 |
| --- | --- | --- |
| `scene.add` | `kind` (`point` / `insert`)、挿入位置、任意の `label`、`point` の任意の初期 `lines`、`insert` の `assetId`・`durationMs`・`embeddedAudio` | 導入は先頭、結びは末尾、`point`/`insert` はその間。挿入位置は文書全体の 0 始まり位置（導入の直後が 1、結びの直前が末尾）。`label` 省略時は連番。`accent` は `theme.primary`、`timing` は `point` が `auto`、`insert` が `fixed`、`transition` は `cut`。`point` は既定のテキスト Cue を持つ。`insert` は ready な `video` Asset を参照し、主動画 Cue を 1 件だけ持つ。音声のない Asset では `embeddedAudio: true` を拒否する |
| `scene.remove` | `sceneId` | 導入・結びは削除できない。参照する AudioCue も削除する |
| `scene.move` | `sceneId`、移動先 | 導入・結びの位置は変えられない。`point`/`insert` のみ移動できる |
| `scene.splitAtLine` | `sceneId`、分割する行、任意の `label` | 後述の解決規則に従う。`point` のみ |
| `scene.setTiming` | `sceneId`、`timing` | `auto` は `point` のみ。`fixed` は `A + G <= D` を満たす。`insert` は固定尺のみ |
| `scene.setTransition` | `sceneId`、`enter` | `cut` は尺 0、`fade`/`crossfade` は尺 > 0。`D <= min(先行Scene尺, 入場Scene尺)`。先頭 Scene は `cut` のみ |
| `scene.setLabel` / `scene.setAccent` | `sceneId`、値 | `label` は空白のみ不可。`accent` は `theme` token または `#RRGGBB` |

### Narration Segment

| 操作 | 入力 | 不変条件 |
| --- | --- | --- |
| `line.add` | `sceneId`、任意の挿入位置、任意の初期値 | `point` のみ。ID は `<sceneの短縮トークン>` を含む。`speakerId: null` なら `expressionId: null` |
| `line.remove` | `sceneId`、`lineId` | Cue 範囲の端点を詰め、単一行の Cue を削除し、効果トリガーと `videoPlayback.gates` から当該行への参照を外す。当該行の Audio Take を削除する |
| `line.move` | `sceneId`、`lineId`、移動先 | 同一 Scene 内。`range: lines` の開始・終了が逆転したら入れ替える |
| `line.split` | `sceneId`、`lineId`、前半と後半の `captionText`/`speechText` | 後述の解決規則に従う |
| `line.setText` | `sceneId`、`lineId`、`captionText` / `speechText` | 選択済み Audio Take は変更しない。空文字を許す |
| `line.setSpeaker` | `sceneId`、`lineId`、`speakerId` | `speakerId: null` は `expressionId` も `null` にする。存在しない Speaker は拒否する |
| `line.setExpression` | `sceneId`、`lineId`、`expressionId` | `speakerId: null` の行には `null` 以外を指定できない。Face Set 内の実在は保存時に検証する |
| `line.setGap` | `sceneId`、`lineId`、`gapBeforeMs` | 非負整数。0 は省略できる |
| `line.assignTake` | `sceneId`、`lineId`、`assetId`、`source` | ready な `audio` Asset。`durationMs` は Asset の尺。新しい Audio Take を作り、既定で選択する |
| `line.selectTake` | `sceneId`、`lineId`、`takeId` / `null` | Take は当該行に属する。`null` は字幕のみ |
| `line.removeTake` | `sceneId`、`lineId`、`takeId` | 選択中の Take を削除したら `selectedAudioTakeId` を `null` にする |

### VisualCue

| 操作 | 入力 | 不変条件 |
| --- | --- | --- |
| `cue.add` | `sceneId`、`template`、`range`、`layer`、任意の `order`・`transition`・`input` | テンプレートの `layers` と `inputFields` に適合する。`order` 省略時は同一 layer の末尾。`range: lines` は同一 Scene の行だけ。`offset` は非負で `startMs < endMs` |
| `cue.remove` | `sceneId`、`cueId` | 立ち絵 Cue は `character.standing` の配置として削除する（下記） |
| `cue.setRange` | `sceneId`、`cueId`、`range` | 表示窓の解決は保存・プレビューと同じ規則。`offset` が Scene 尺を超える場合は警告を返す |
| `cue.setInput` | `sceneId`、`cueId`、`input` の部分更新 | テンプレート入力スキーマに適合する。メディア参照は ready な Asset |
| `cue.setPlacement` | `sceneId`、`cueId`、`layer`、`order` | テンプレートが許可する layer。描画順は layer と order で決まる |
| `cue.setTransition` | `sceneId`、`cueId`、`enter` / `exit` | テンプレートの `transitionPolicy` に適合する。尺は実効表示窓内 |

`character.standing@1` は 1 Scene に左右 1 体ずつ最大 2 件である。操作コアは立ち絵を通常の Cue として扱わず、次の操作で編集し、内部で Cue を生成する。UI の「左」「右」固定行と一致させる。

| 操作 | 入力 | 不変条件 |
| --- | --- | --- |
| `standing.set` | `sceneId`、`side`、`characterId`、`appearanceId`、任意の倍率 | 同一 `side` に 1 体だけ。`characterId` と `appearanceId` は `characters` に実在する |
| `standing.remove` | `sceneId`、`side` | 対応する `character.standing@1` Cue を削除する |

### AudioCue

| 操作 | 入力 | 不変条件 |
| --- | --- | --- |
| `audio.add` | `role`、`assetId`、`range`、任意の `gainDb`・`loop` | ready な `audio` Asset。作品全体の `bgm` は 1 件だけ。`range: work` は `bgm` のみ |
| `audio.set` | `audioCueId`、部分更新 | 同上 |
| `audio.remove` | `audioCueId` | 作品全体 BGM は削除できるが、UI では既定値へ戻す |

### 文書

| 操作 | 入力 | 不変条件 |
| --- | --- | --- |
| `document.setVisualTheme` | `id`、`version` | 既知のテーマ参照のみ。保存時に再検証する |

## 個別の意味論

### `scene.splitAtLine`

`point` Scene の指定行の直前で分割し、2 つの `point` Scene を作る。

- 前半は元の Scene ID・行 ID・Cue ID を維持する。後半は新しい Scene ID と、既定のテキスト Cue を持つ。
- 行 ID は移動しても変更しない。
- `range: scene` の Cue は前半に残す。`range: lines` の Cue は、範囲全体が前半なら前半、全体が後半なら後半へ移す。分割点をまたぐ場合は両方へ複製し、前半は分割直前の行まで、後半は分割行からに切り詰める。複製した後半の Cue には新しい Cue ID を振る。
- `range: offset` の Cue は、分割点の解決済みミリ秒で切る。分割点をまたぐ場合は両方へ複製し、後半の `startMs`/`endMs` を分割点からの相対値へ再基準化する。
- 効果トリガーと `videoPlayback.gates` が、移動先の Scene に存在しない行を参照する場合は、その参照だけを外す。参照先が存在する側では維持する。剪定の結果、テンプレートの必須入力を満たさなくなった Cue は、その Scene から削除し、`cue_removed_after_split` 警告を返す。
- 後半の `transition` は `cut`、`accent` は元 Scene を継承、`timing` は `auto` とする。ラベルは連番を既定とする。
- 分割点のミリ秒は `resolveTimeline(document)` の行開始位置から求める。プレビュー応答の値を要求しない。

### `line.split`

1 本のセリフを 2 本へ割る。呼び出し側が前半・後半の文章を渡し、操作コアが ID と参照を付け替える。

- 元の行 ID は前半に残す。後半は新しい行 ID を持つ。
- `speakerId` と `expressionId` は両方へ継承する。`gapBeforeMs` は前半に残し、後半は 0 とする。
- 元の行の Audio Take は削除し、両方の `selectedAudioTakeId` を `null` にする。分割前の音声はどちらの文章にも対応しないため再利用しない。
- `range: lines` の Cue は、開始行が元の行なら前半、終了行が元の行なら後半を指す。開始と終了がともに元の行なら、前半から後半までを指す。行順が逆転する範囲は、分割後の並び順に正規化する。
- 行トリガーの効果と `videoPlayback.gates` は前半に残す。後半へ複製しない。
- 前後の文章が空、または両方が元の文章と同じ場合は拒否する。前半・後半それぞれに字幕か読みを必須とし、両方が元の文章と同じ（複製）場合は拒否する。`speechText` は呼び出し側が指定する（読みの自動分割はしない）。

### 行の削除と Cue

`line.remove` は、削除する行を端点に含む `range: lines` の Cue を次のように扱う。

- 範囲がその行だけなら Cue を削除する。
- 範囲の端がその行なら、隣接する行へ端点を詰める。
- 範囲の内側なら、範囲を維持する（行 ID は変わらない）。
- 効果トリガーと `videoPlayback.gates` から当該行への参照を外す。

### 変更しないもの

操作コアは、Scene の `label` の重複、行の話速、テキストの自動改行、フォントの実測を行わない。テキスト量の警告は保存と同じ近似規則で返す。Face Set・CompositionVersion・Asset のグローバル整合は保存時に検証する。

## タイミングの解決

操作コアは `@kakeai/video/timeline` の `resolveTimeline(document)` を使う。この関数は `ContentDocument` だけで完結し、Node.js 固有の依存を持たない。Web UI も同じ関数を直接呼び、プレビュー応答の解決結果に依存しない。

- Asset の尺は `content.audioTakes[].durationMs` と、insert Scene の使用区間から決まる。
- `scene.add`（insert）と `cue.setInput`（動画の trim / loop）は `ScriptContext.assets` で Asset の種別・尺・ready を確認する。
- 解決できない参照がある場合、操作は適用せずエラーを返す。

## 保存との関係

- 操作コアは保存しない。UI は操作後の文書を既存の全体保存へ渡し、Agent Access は `script.edit` の中で「基準版の読出し → 操作の一括適用 → 保存検証 → 新しい ScriptVersion」を行う。
- 操作結果は必ず保存検証を通ることを不変条件とする。保存検証は引き続き最終ゲートであり、操作コアの検証を緩めない。
- 操作コアが返す `warnings` は保存時と同じ形（JSON Pointer とコード）とし、UI とエージェントが同じ警告を扱えるようにする。

## エラー

| code | 発生条件 |
| --- | --- |
| `EDIT_TARGET_NOT_FOUND` | 指定した Scene・行・Cue・AudioCue・Audio Take が存在しない |
| `EDIT_PRECONDITION_FAILED` | 尺の不足、固定尺の等式違反、Scene 順序、layer 制約など、文書の状態が操作を許さない |
| `EDIT_INVALID_INPUT` | 入力が操作の Zod スキーマに適合しない、または ID 参照 `key` が解決できない |
| `EDIT_UNSUPPORTED_TEMPLATE` | 指定した VisualTemplate の版が存在しない、または操作が未対応 |
| `EDIT_ID_GENERATION_FAILED` | 衝突を避けて ID を生成できなかった（通常は発生しない） |

束縛はこれらを安定したコードのまま返し、保存検証の `VALIDATION_ERROR` と区別する。

## UI の移行

- 最終状態では、編集画面の文書状態は `ContentDocument` とし、構造操作は操作コアを呼ぶ。フォームモデルは入力欄のローカル状態と表示のためのアダプタへ縮小する。
- 移行は構造操作から始める（Scene の追加・削除・移動・分割、行の追加・削除・移動、Cue の追加・削除・範囲変更）。フィールド編集は最後に移す。
- 入力途中の不正値（空のラベル、未確定の数値、編集中の文字列）はコンポーネントのローカル状態に留める。妥当な値になった時点で型付きの操作へコミットする。不正なローカル値が構造操作を妨げない。
- 移行中はフォームモデルと文書が一時的に併存する。構造操作は、最後に妥当に構築できた文書へ適用し、結果をフォームへ戻す。
- キーストロークごとに文書全体を作り直さない。

## テスト

- 各操作の代表例（ゴールデン）と、不変条件の property test を置く。Scene 順序、ID の一意性と安定性、`range: lines` の整合、固定尺の等式、insert の主動画、遷移尺の上限、参照されない Cue の温存を検証する。
- 操作結果が保存検証を通ることを、代表的な文書で検証する。
- UI 移行中は、同じ初期文書と同じ操作に対して、旧フォーム経路と操作コアが同じ文書を返すことを確認する。移行完了後はこのテストを削除する。
- 文言・プロンプト・UI 表示のテストは書かない。

## 非ゴール

- 操作の永続化、HTTP 公開、MCP / CLI のトランスポート、認証。
- アンドゥ・リドゥの UI。操作が純粋関数であるため将来追加できるが、v1 の対象外とする。
- Asset の取り込み、TTS、レンダー、Composition の authoring。
- 自由な字幕タイミング編集、波形編集、タイムラインの直接操作。
- テンプレートの追加・変更。操作コアは既存のレジストリを使う。

## 将来

- 操作ログを単位にしたアンドゥ・リドゥ。
- フィールド編集の操作化と、フォームモデルの完全な廃止。
- 翻訳・派生 Work 向けに、同じ操作を別の `ContentDocument` へ適用する差分操作。
