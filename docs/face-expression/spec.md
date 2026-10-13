# キャラクター表情 仕様

Status: Proposed（未実装）

## 目的と境界

表情を変えるためだけにSceneを分割せず、台詞ごとにキャラクターの表情を指定できるようにする。服装・外観（Character Appearance のベース画像）と表情素材を分離し、互換な外観では同じ顔素材を再利用する。

v1 は部位合成による表情切替を対象とし、瞬きと発話区間の簡易口パクを含む。いずれも `blinkLayerId` / `speakingLayerId` の任意対応で有効化し、素材形式の移行は不要とする。

台本の正本JSON契約は [../mvp/content-schema.md](../mvp/content-schema.md)、HTTP契約は [../mvp/api-contract.md](../mvp/api-contract.md) を正とする。立ち絵の左右配置と発話中バウンドは [../multi-standing/spec.md](../multi-standing/spec.md) を正とする。決定は [ADR-0045](../adr/0045-face-set-global-reference.md)・[ADR-0046](../adr/0046-character-standing-v3-face-composite.md)・[ADR-0047](../adr/0047-per-line-expression-id.md)・[ADR-0048](../adr/0048-deterministic-blink-and-speaking-mouth.md) を参照する。

## 用語とモデル

| 用語 | 定義 |
| --- | --- |
| Character | 人物としてのキャラクター。外観そのものではない。既存の `characters[]` に対応する。 |
| Character Appearance | 服装、髪型、ポーズを含む立ち絵。既存の `characters[].appearances[]` に対応し、任意で1つの Face Set を参照する。 |
| Face Set | 互換な外観で共有できる顔素材の**グローバルライブラリ**。顔の向き・位置・キャンバス規格が同じ素材だけを含める。 |
| Face Layer | 眉、目、口、任意の前景を描く同寸透過画像。`Asset.id`（`assetId`）で参照する。 |
| Expression Preset | 表情名と、眉・目・口の各 Face Layer の組合せ。台詞は表示名ではなく安定した `expressionId` を参照する。 |
| Narration Segment | 発話区間。既存の `scenes[].lines[]` に対応し、任意で `expressionId` を持つ。 |

```text
FaceSet (global library)
  ├─ FaceLayer (brow / eye / mouth / foreground)  ──> Asset
  └─ ExpressionPreset (brow / eye / mouth の組合せ)

CharacterAppearance ──> faceSetId?

NarrationSegment.speakerId ──> Speaker ──> Character
NarrationSegment.expressionId ──> ExpressionPreset (話者キャラの外観が参照する Face Set 内)
```

### 外観と Face Set

- Sceneは構図・背景・登場状態の単位であり、表情変更では分割しない。立ち絵は `character.standing@3` の左右1体ずつ最大2体という既存の制約を変えない。
- Character Appearance は任意で1つの Face Set を `faceSetId` で参照する。服装だけを変え、顔位置・向き・縮尺が同じなら同じ Face Set を共有できる。
- 横顔、顔の向き、顔位置、頭身が異なる外観は別 Face Set を使う。見た目だけ似ていても、互換性を推測して自動共有しない。
- Face Set はグローバルライブラリに置く。作品の ScriptVersion は Face Set を `faceSetId` で参照し、内容はコピーしない（[ADR-0045](../adr/0045-face-set-global-reference.md)）。ライブラリ側の変更は次回のプレビュー／レンダーへ反映され、保存済み作品の再レンダー結果が変わり得る。
- Face Set には `normal` の Expression Preset を必須にする。これは中立の眉・目・口レイヤーで構成し、表情を焼き込んだ別の全身 `normal` 画像は要求しない。

### 表情プリセット

- v1 は固定の表情語彙を持たない。Face Set ごとに任意の Expression Preset を追加でき、`normal` だけが必須である。
- `expressionId` は Face Set 内で一意かつ変更不能とする。表示名は後から変更できる。
- UI に出す候補は、話者の有効な Character Appearance が参照する Face Set の登録済み preset だけである。Face Set を参照しない外観では表情候補を出さない。
- `normal` は常に利用可能である。既存台詞などで表情が未指定、または `expressionId` が `null` なら `normal` と解釈する。
- `happy` / `angry` / `surprised` / `sad` などの共通語彙は、将来の AI 提案で使う表示上の慣習とし、v1 では素材登録も id の予約も強制しない。

## 素材契約と合成

### 素材形式

Character Appearance のベース画像（`appearance.assetId`）と、その Face Set に属するすべての Face Layer は、同じピクセル寸法・原点を持つ。Face Layer は透過対応画像とし、顔だけを切り抜いた座標付き画像ではなく、立ち絵と同寸の透明キャンバスに可変部分だけを描く。

- ベース画像は、眉・目・口など差し替える領域を描かない。顔の肌、服、髪などは含む。ただし既存の顔込み立ち絵もベース画像として有効であり、その場合は Face Set を参照しない（表情は切り替わらない）。
- 眉・目・口は別レイヤーとする。Expression Preset は3レイヤーを選んで静的表情を作る。
- 前髪や顔の前を横切る装飾が眉・目・口より前に来るキャラクターだけ、任意の `foreground` レイヤーを登録する。`foreground` は Face Set 単位で常に描画し、preset では切り替えない。
- ベース画像と Face Layer の寸法が異なる場合、保存を拒否する。Scene側での顔アンカー指定、拡大率補正、手動位置合わせは持たない。
- 画像本体の正本はグローバルな素材ライブラリの `assetId` とする。Face Set はファイルパスや表示名を保存しない。

レンダリング順は次のとおりとする。

```text
ベース立ち絵 → 眉 → 目 → 口 → 任意の前景
```

立ち絵に適用する位置・拡大・発話中バウンド・ドロップシャドウは、すべての Face Layer に同じ変換を適用する。

### 瞬き・口パク

目レイヤーに `blinkLayerId` を登録すると、立ち絵の表示区間全体で決定的な瞬きを行う。口レイヤーに `speakingLayerId` を登録すると、話者の発話区間（発話中バウンドと同じ区間）だけで決定的な簡易口パクを行う。いずれも音素解析や台詞内容との対応は行わない。

- 瞬きでは現在の目レイヤーを、登録済みの閉眼レイヤーへ短時間だけ置換する。間隔と長さは固定シード由来の疑似乱数で決める。
- 口パクでは発話区間内の現在の口レイヤーを、登録済みの開口レイヤーへ不規則に短時間だけ置換する。発話区間外では閉じたままにする。
- 対応先がないレイヤーは静止のままとする。汎用の別表情、別キャラクター、または別 Face Set のレイヤーで代用しない。
- 同じ目・口レイヤーを複数の Expression preset が共有してよい。表情 × 目の開閉 × 口の開閉の全組合せを強制しない。
- 動作時刻は `cue.id` と `characterId` から導いた固定シードの疑似乱数で決定する。プレビュー・再レンダー・再試行で動きが変わらないことを必須とする。既存の発話中バウンドと同じ決定性の方針に従い、1回の Render Job 内ではスナップショットに固定した Face Set を使う（[ADR-0045](../adr/0045-face-set-global-reference.md)）。瞬き・口パクの間隔・長さなどの動作パラメータは内部定数とし、正本JSONに保存しない。
- 決定は [ADR-0048](../adr/0048-deterministic-blink-and-speaking-mouth.md) を参照する。

## 台詞、AI、編集

- 台詞（`NarrationSegment`）の話者紐付けの隣に `expressionId` を置く。`expressionId` は Character ID 単体ではなく、当該Sceneで有効な Character Appearance が参照する Face Set に対して検証する。
- 表情はその台詞の発話区間だけ適用し、発話外は `normal` に戻す。直前の台詞から暗黙に引き継がない。
- 話者のないナレーション等には `expressionId` を持たせない。`speakerId` が `null` のラインは `expressionId` を `null` に限る。
- AI に提案させる場合、AI は話者ごとの利用可能な `expressionId` と表示名の allowlist を入力として受け、構造化出力はその allowlist 内の ID または未指定だけを許す。AI が提案した表情は人が台詞一覧で変更できる。AI の台本・台詞生成 Job は v1 の対象外であり、この入力契約は将来接続する（[../mvp/roadmap.md](../mvp/roadmap.md) Phase 2/3）。
- 話者（`Speaker.characterId`）に対応する立ち絵がSceneに無い場合、その台詞の `expressionId` は描画に影響しない。
- 外観や Face Set の変更によって既存台詞の表情が無効になる場合、保存・レンダー時に暗黙の代替をしない。先に `normal` または有効な preset へ編集して解消する。

## schemaVersion と移行

- `faceSetId` と `expressionId` を含む ContentDocument は `schemaVersion: 7` とする（[ADR-0047](../adr/0047-per-line-expression-id.md)）。
- 読み出し時、v6 の各 appearance へ `faceSetId: null` を、各 line へ `expressionId: null` を補って v7 として解釈する。保存済みJSONは書き換えず、次回の保存で新しい v7 `ScriptVersion` を作る。v4 → v5 → v6 の既存の読出し移行は維持する。
- v7 の appearance は既存の `expression` / `pose` 文字列タグを引き続き持つ。これらは表示名（`label`）の補助であり、`expressionId` とは別物である。

## 参照整合性と削除

- Face Set に属する Face Layer の `assetId` は、グローバルな素材ライブラリの `Asset` を指す。アップロード後 `ready` な画像だけを登録できる。
- ベース画像と Face Layer の寸法一致は、保存時に `Asset.widthPx` / `Asset.heightPx` で検証する。判定できない場合は保存を拒否する。
- `DELETE /assets/:assetId` は既存の参照ガードに従う。Face Layer から参照中の Asset も `ASSET_IN_USE` とする（[../mvp/api-contract.md](../mvp/api-contract.md)）。
- Face Set が Character Appearance から参照されている間は、その Face Set の削除を拒否する。Face Layer が Expression Preset から参照されている間は、その Face Layer の削除を拒否する。参照を壊す置換は参照整合性を保つ transaction にする。

## v1 の対象外

- 1シーンへの3体目以降のキャラクター配置、表情のための場面分割、Live2D 等のメッシュ変形。
- 発話音声の音素解析や口形の同期。
- キャラクター横断で独自表情を一度に追加するグローバル語彙管理。
- 顔アンカーの手動調整や、互換でない画像への自動位置合わせ。
- AI による台詞・表情の自動生成（将来接続）。

## 操作シナリオ契約

表情素材の取り込みと関連付けは、メディアファイルと DB 状態を書き込む不可逆操作である。実装では次の契約を満たす。

| 段階 | 入力と正本 | 機械可読な識別子 | 永続化・次に読む主体 | 停止・失敗時 | 不可逆操作 |
| --- | --- | --- | --- | --- | --- |
| 素材取込 | 利用者が選んだベース／Face Layer のバイト列 | `assetId` | 素材ライブラリ。Face Set 編集画面 | 形式・寸法の検証失敗は関連付け前に停止 | メディアファイル・`Asset` 行の保存 |
| Face Set 保存 | 検証済み `assetId`、安定 ID、Expression Preset の部位参照 | `faceSetId`、`expressionId`、`faceLayerId` | Face Set ライブラリ。台詞編集・レンダラー | 未知 ID、部位参照の欠落、寸法不一致、`normal` 欠落は保存しない | DB 書込み |
| 台詞保存 | 話者の appearance、Face Set 内の `expressionId` | `lineId`、`appearanceId`、`expressionId` | `ScriptVersion.contentJson`。脚本編集・レンダラー | 話者なしでの表情指定、利用不能な表情 ID は保存しない | DB 書込み（新規 `ScriptVersion`） |
| レンダリング | 保存済み台本、appearance、Face Set、`assetId` | 安定 ID 群 | 出力動画。レンダラー | 参照メディア欠落・無効な組合せは出力を開始せず失敗する | 出力メディアの保存 |
| 素材削除 | `assetId` と Face Set／台本参照 | `assetId` | 素材削除経路 | Face Set または台本から参照中なら削除を拒否する | ファイル・`Asset` 行の削除 |

## 受入条件

1. 同じScene内の連続する台詞に異なる `expressionId` を指定でき、Sceneを増やさずに各発話中だけ表情が切り替わる。
2. `happy`、`angry` などの preset は眉・目・口の登録済みレイヤーを合成し、立ち絵への変換後もずれない。
3. 素材がない表情は、その Character Appearance の UI 選択肢に表示されない。
4. Face Set を共有する別衣装は同じ表情素材を使え、互換でない外観は別 Face Set にできる。
5. Face Set を参照しない既存の外観・台詞は、現在と同じ見た目で安全に表示される。`expressionId` 未指定の台詞は `normal` として解釈される。
6. Face Set を編集すると、次回のプレビュー／レンダーへ反映される（保存済み作品で再レンダー結果が変わり得ることは許容する）。
7. 閉眼・開口レイヤーを追加しても、既存の Expression Preset と台詞データを移行せずに利用できる。
8. 閉眼レイヤーを登録した目は立ち絵の表示区間全体で決定的に瞬き、開口レイヤーを登録した口は発話区間だけで決定的に開閉する。対応先のないレイヤーは静止する。
9. 同じ台本・同じ Face Set のプレビューと再レンダーは、瞬き・口パクの動きまで同一になる。
