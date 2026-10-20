# Face Set はグローバル参照とし、顔素材の変更で再レンダー結果が変わることを許容する

キャラクターの表情を構成する Face Set（眉・目・口・前景の Face Layer と Expression Preset）は、作品の `ScriptVersion.contentJson` にコピーせず、アプリ共通の**グローバルライブラリ**に置く。作品の `CharacterAppearance` は `faceSetId` で参照し、Face Layer は既存どおりグローバルな `Asset` を `assetId` で参照する。

理由は、作品ごとに表情セットを作り直す負担を避け、複数作品・複数キャラクターで同じ顔素材を再利用するため。これは、既にグローバルな `Asset` を不変な `ScriptVersion` から `assetId` で参照している既存モデルと同じ参照の形である。異なるのは Face Set が**可変**である点だけである。

## 決定性の明示的な緩和

[ADR-0001](./0001-canonical-json-over-derived-media.md)・[ADR-0003](./0003-render-determinism-frozen-html.md)・[ADR-0011](./0011-render-snapshot-recompile.md) は、保存済み台本の正本から再現可能な派生を導くことを求める。しかしグローバル参照では、Face Set の編集が保存済み作品の次回プレビュー／レンダーへ反映され、**再レンダー結果が変わり得る**。この差異を、本決定に限って明示的に許容する。

- 1回の Render Job 内では、投入時に解決した Face Set を入力スナップショットへ固定し、ジョブ実行中は一貫させる。ドリフトはジョブをまたいだ場合にだけ生じる。
- 「同じ入力から常に同じMP4」という再現性の対象は、Render Job のスナップショットに固定された内容までとする。ジョブをまたいだ再現性は要件にしない。

## Considered Options

- Face Set を `ContentDocument` 内に持つ。→ 作品をまたぐ再利用のたびに作り直す必要があり、利用負担が大きいため不採用。
- ライブラリで定義し作品へコピーする（Character と同じ扱い）。→ 既存作品がライブラリ更新の影響を受けない一方、作品ごとの顔素材の二重管理が生じ、共有の利点が薄れるため不採用。
- Face Set を不変にして版を付ける。→ 顔素材の試行錯誤のたびに版と移行が必要になり、表現の探索コストが過大なため不採用。

## Consequences

- Prisma に `FaceSet` / `FaceLayer` / `ExpressionPreset` を追加し、`/face-sets` の CRUD を公開する。`CharacterAppearance`（ライブラリ・台本コピーとも）に任意の `faceSetId` を追加する。
- `packages/video` は Face Set を直接知らない。コンパイラは `faceSetResolver` を受け取り、解決済み Face Set を描画に使う。API サービスが保存済み台本の appearance から参照 Face Set を解決して渡す。
- 参照中の Face Set・Face Layer・`Asset` の削除は拒否する。参照を壊す置換は整合性を保つ transaction にする。
- 既存作品は `faceSetId` を持たないため、見た目・再レンダー結果は変わらない。
- 正式リリース前に限らず、Face Set の可変参照は維持する。見た目の厳密な再現が必要になった場合は、この決定を新ADRで見直す。
