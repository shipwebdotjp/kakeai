# Assetにユーザー編集可能なタグを持たせ、不変原則の例外とする

再利用可能な素材ライブラリで素材を見つけやすくするため、Assetにユーザーが編集できるタグを持たせる。タグは素材の原本メタデータやバイト列ではなく、ユーザーが後から追加・削除できるメタデータとし、取り込み後の不変原則（[spec.md](../mvp/spec.md) の「Assetは取り込み後に不変」）に対する唯一の例外とする。

保存は `Asset.tagsJson`（JSON文字列のタグ配列）で行い、SQLiteでは独立した `Tag` / `AssetTag` テーブルを作らない。読み書きは `packages/contracts` のZodスキーマで検証する。更新は `PATCH /assets/:assetId` でタグ配列を丸ごと置き換える。

理由は、タグが原本の同一性（`sha256`・`storageKey`・`kind`・寸法・長さ）と無関係な表示用メタデータであり、リレーションを切るほどの横断クエリ要件がMVPに無いため。素材一覧はページングせず全件取得しており、絞り込みはクライアント側で足りる。既存の `provenanceJson` と同じ「JSON文字列＋Zod検証」の境界に揃え、テーブル移行を増やさない。

## Considered Options

- `Tag` / `AssetTag` のリレーションテーブルを切る。→ タグの一覧・絞り込みをSQLで行えるが、MVPは全件取得・クライアント絞り込みで足り、横断クエリ要件も無いため過剰。将来必要になれば版を上げて移行する。
- Assetを完全に不変のまま保ち、タグを持たない。→ 素材が増えると目的の素材を探せず、ファイル名検索だけでは足りない。
- タグを原本メタデータの一部として取り込み時に固定する。→ 後から分類を直せず、ユーザー編集の用途に合わない。

## Consequences

- `apps/api/prisma/schema.prisma` の `Asset` に `tagsJson String?` を追加し、マイグレーションを1つ追加する。`status` と併せ、`tagsJson` だけが取り込み後に更新されうる列になる。
- `docs/mvp/spec.md` の不変原則の記述を「`status`・ready Rendition由来の表示メタデータ・ユーザー編集のタグのみ更新されうる」へ改める。
- API契約（[api-contract.md](../mvp/api-contract.md)）に `tags` フィールドと `PATCH /assets/:assetId` を追加する。
- タグは重複排除・件数／長さ上限をZodで制約する。空配列は `tagsJson = NULL` として保存する。
- Web UI（素材ライブラリ画面・素材ピッカー）でタグの編集と絞り込みを提供する。
