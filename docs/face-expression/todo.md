# キャラクター表情 ToDo

仕様の正本は [spec.md](spec.md)。チェック済み項目は設計文書化だけであり、機能は未実装である。上から順に進める。

## 設計・記録

- [x] 表情をSceneではなく台詞の発話区間に属させる（`NarrationSegment.expressionId`）。
- [x] Character Appearance と Face Set を分け、表情を眉・目・口の同寸透過レイヤーから合成する。
- [x] Face Set をグローバルライブラリ参照とし、再レンダー差異を許容する（[ADR-0045](../adr/0045-face-set-global-reference.md)）。
- [x] 立ち絵の表情合成を `character.standing@1` に統合する（[ADR-0046](../adr/0046-character-standing-v3-face-composite.md)、[ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md) で `@3` から `@1` へ再基準化）。
- [x] 台詞属性 `expressionId` を `schemaVersion: 1` の基準契約に含める（[ADR-0047](../adr/0047-per-line-expression-id.md)、[ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md)）。
- [x] 素材保存、台詞保存、レンダー、削除の操作シナリオ契約を記録する。

## 契約 (packages/contracts)

- [x] `faceSet` / `faceLayer` / `expressionPreset` の形を定義し、`FaceSet`・`FaceLayer` の CRUD リクエスト DTO を追加する。`normal` preset を必須とする。
- [x] `characterAppearanceSchema` に `faceSetId: idSchema.nullable()` を追加する。
- [x] `narrationSegmentSchema` に `expressionId: idSchema.nullable()` を追加し、`speakerId` が `null` なら `expressionId` も `null` であることを検証する。
- [x] 表情合成を含む `character.standing@1`（`side`、`scale`）を唯一の立ち絵版とする。
- [x] `faceSetId` / `expressionId` を `schemaVersion: 1` の基準契約に含め、旧版の読出し移行を削除する（[ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md)）。
- 完了条件: `npm run typecheck` と契約テストが通り、v6 の保存済みJSONが v7 として読め、未知参照を拒否する。

## 永続化とサービス (apps/api)

- [x] Prisma に `FaceSet` / `FaceLayer` / `ExpressionPreset` を追加する migration と、`/face-sets` の CRUD サービスを実装する。
- [x] `CharacterAppearance` の作成・更新リクエストに `faceSetId` を追加し、参照先 Face Set の存在を検証する。
- [x] 素材登録時に `ready` な画像であること、およびベース画像と Face Layer の `widthPx` / `heightPx` が一致することを検証する。
- [x] 保存時に、参照 Face Set を解決し、`expressionId` の実在（Face Set 内）と話者キャラの立ち絵との対応を検証する。`contentJson` のスキーマで検証できない分を担保する。
- [x] 参照中の `Asset` / Face Layer / Expression Preset / Face Set の削除を拒否し、置換は参照整合性を保つ transaction にする。
- [x] Render Job の入力スナップショットへ解決済み Face Set を固定する。プレビューは実行時に解決する。
- 完了条件: DB を隔離した結合テストで、Face Set 保存→外観割当→台詞保存→解決が通り、不正参照・寸法不一致・削除競合で書き込み前に止まる。

## レンダリング (packages/video)

- [x] `faceSetResolver` を `CompileDocumentOptions` に追加し、コンパイラは解決済み Face Set だけを描画に使う。
- [x] `character.standing@1` の描画で、ベース＋眉＋目＋口＋前景を単一 wrapper に合成し、位置写像・ドロップシャドウ・発話中バウンドを wrapper に共有適用する。
- [x] 台詞区間ごとに Expression Preset を切り替え、区間外・未指定は `normal` を描画する。話者に対応する立ち絵が無い場合は影響させない。
- [x] 無効な appearance / Face Set / preset / `assetId` 参照は、出力ファイルを作る前にエラーとして停止する。
- 完了条件: 同じScene内の連続台詞で表情が切り替わり、Face Set を持たない外観の描画が変わらない。

## 素材登録と編集 (apps/web)

- [x] Face Set エディタ（ベース・眉・目・口・前景の登録、寸法の確認）を作る。合成の確認は作品編集のドラフト・プレビューで行う。
- [x] Expression Preset の作成・編集・名称変更を作れるようにする。`normal` は必須で削除不可とする。
- [x] Character Appearance に Face Set を割り当てる UI を追加する（ライブラリと作品編集の共通コンポーネント）。
- [x] 台詞ごとに、話者の外観が参照する Face Set の利用可能 preset だけを選べるセレクタを追加する。
- [ ] 将来の AI 台詞生成入力へ、話者別の表情 allowlist を接続する（v1 外。入力契約として実装時に接続できる形にしておく）。
- 完了条件: Face Set 登録→外観割当→台詞で表情選択→保存→プレビュー・レンダーが成立する。

## 検証と運用

- [x] 契約テスト：`schemaVersion: 1`、`character.standing@1`、`expressionId` と話者なしの制約、未知参照の拒否。
- [x] コンパイラテスト：ベース＋部位の合成、台詞区間ごとの切替、決定性。
- [x] API・結合テスト：Face Set CRUD、外観割当、保存検証（寸法一致・表情実在）、削除ガード、Render Job スナップショットの Face Set 固定。
- [ ] 影響画面を手動確認する。ブラウザ E2E は追加しない。
- [x] 実装時は `npm run typecheck` と `npm test` を通し、OCR review には本仕様の操作シナリオ、素材書込み、`assetId` / `faceSetId` 境界、無効参照時の停止条件を渡す。

## 瞬き・口パク

- [x] `blinkLayerId`（目）と `speakingLayerId`（口）の任意対応を Face Layer の描画に接続する。対応先のないレイヤーを別表情や別 Face Set のレイヤーで代用しない。
- [x] 目は表示区間全体で閉眼レイヤーへ、口は発話区間だけで開口レイヤーへ決定的に置換する。音素同期は行わない。
- [x] 動作時刻は `cue.id` と `characterId` から導いた固定シードの疑似乱数で決め、プレビュー・再レンダー・再試行で同じ動画になることを確認する（[ADR-0045](../adr/0045-face-set-global-reference.md) のジョブ内一貫性に従う）。
