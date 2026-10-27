# Agent Access への Character 外観の差分操作（addAppearance / updateAppearance）の追加

Status: accepted

## 背景

[ADR 0099](./0099-agent-character-library-writes.md) でエージェントに Character ライブラリの作成（`character.create`）と部分更新（`character.update`）を公開した。しかし、外観（`appearances`）の編集は配列全体を置換する契約しか提供していなかったため、エージェントが 1 件だけ外観を直したい・追加したい場合でも、`character.get` で現在値をすべて読み取り、配列を組み立て直して送る read-modify-write パターンが強制されていた。

この方式には以下の課題があった：
1. **作品コピーのリンク切断**: 配列置換で要素の `id` を送り忘れたり再生成したりすると、`character.addFromLibrary`（[ADR 0026](./0026-character-library-copy-semantics.md)）で既存の台本作品へコピーされた外観の参照キー（`libraryAppearanceId`）が一致しなくなり、作品ローカルの外観リンクが壊れる。
2. **意図しない解除フットガン**: 配列要素の入力スキーマで `faceSetId` の省略が `.default(null)` になっていたため、`faceSetId` を含めずに更新すると Face Set 参照が暗黙に解除される事故が生じやすかった。

ライブラリ外観の追加・更新は台本への直接コピーを書き換えず、可逆な編集（[ADR 0074](./0074-agent-direct-reversible-operations.md)）である。したがって、1 件単位の追加および差分更新（部分更新）操作を提供することで、read-modify-write を解消しリンク維持の安全性を向上させる。

## 決定

次の 2 操作を Agent Access に追加する。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く（加算的変更）。

- `character.addAppearance`（mutation）: `{ characterId, assetId, expression, pose, label?, faceSetId? }` を受け、`{ character }` を返す。ID はサーバー側で自動採番し（`newCharacterAppearanceId()`）、配列の末尾（position 順）に追加する。
- `character.updateAppearance`（mutation）: `{ characterId, appearanceId, assetId?, expression?, pose?, label?: string | null, faceSetId?: string | null }` を受け、`{ character }` を返す。**省略した項目は変更せず、`null` は参照解除（NULL化）**とする。

既存の `character.update`（配列置換）は互換性維持のためそのまま残す。

### 細部およびQ1〜Q4の判断

1. **削除操作（`removeAppearance` / `character.delete`）は非公開のまま（Q1）**: C14 の価値は read-modify-write の解消にあり、外観の削除は影響範囲の復旧が困難なため、人専用のまま残す。
2. **外観上限 50 件の維持（Q2）**: `addAppearance` においても 50 件上限を維持し、追加後件数が 51 件以上となる場合は同一トランザクション内の件数チェックで `VALIDATION_ERROR` を返す。
3. **既存 `character.update` の挙動維持とロードマップ保留（Q3）**: 既存 `character.update` の `appearances` 配列要素における `faceSetId: .default(null)` は今回変更せず、MCP 説明文で「省略時解除」の警告を明記する。将来的な修正はロードマップの保留リストに積む。
4. **`expression` / `pose` の空文字許容（Q4）**: 現行契約に合わせ、`expression` と `pose` の空文字は許容し、`null` は型不一致として `VALIDATION_ERROR` とする。
5. **0 項目指定**: `updateAppearance` で更新項目を 1 つも指定しない（省略のみ）場合は `VALIDATION_ERROR` とする。
6. **存在確認とエラー**: 未知の `characterId` は `RESOURCE_NOT_FOUND`（`character`）、未知の `appearanceId` は `RESOURCE_NOT_FOUND`（`appearance`）、マージ後の `assetId` と `faceSetId` の寸法不一致は `VALIDATION_ERROR` とする。
7. **更新順序**: 同一トランザクション内で「現在値読み取り → マージ → 検証（寸法不一致チェック含む） → 書き込み」の順に行い、`Character` の `updatedAt` も確実に更新する。

## Considered Options

- **`character.update` による配列置換のみ（現状維持）**: read-modify-write が発生し、`id` の送り忘れや `faceSetId` の暗黙クリアを防げない。不採用。
- **全項目置換の `setAppearance`**: 1 件置換であっても `assetId` や既存値が必須となり、結局 `character.get` が必要になる。また `faceSetId` / `label` の暗黙クリアも残るため不採用。操作名も `character.setVoices`（全置換）との平仄から、部分更新を意味する `updateAppearance` にした。
- **`removeAppearance` も一緒に公開する**: 削除は不可逆性が高く、人専用に残す方針を維持するため不採用。

## Consequences

- ADR 0099 の Considered Options（3 操作分割の不採用理由）を本 ADR で部分的に反転する。ADR 0099 ヘッダに `Amended by [ADR 0105]` を追記する。
- `operationDigest` および `schemaDigest` が変化する。アプリと MCP / CLI バインディングは同一ビルドで揃える。
- DB migration や Prisma スキーマ、HTTP API（`PUT /characters/:id`）への変更は行わない。
