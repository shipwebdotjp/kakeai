# 素材にお気に入りとアーカイブの可変メタデータを追加する

素材ライブラリが増えると、頻繁に使う素材と一度しか使わない素材が同じ一覧に並び、目的の素材を探しにくくなる。タグによる分類だけでは「よく使うものを先に見る」「普段は隠す」といった運用を表現できない。

そこで `Asset` に `favoritedAt` と `archivedAt`（いずれも nullable な `DateTime`）を追加し、[ADR-0039](./0039-asset-tags-mutable-metadata.md) の「取り込み後に編集できるのは `tagsJson` だけ」という不変原則の例外を、この2つへ広げる。ユーザーは `PATCH /assets/:assetId` に `favorited` / `archived` の boolean を渡してトグルする。アーカイブは表示用フィルタであり、既定では素材ライブラリと素材ピッカーに出さない。お気に入りは並び替え（お気に入り優先）と絞り込みに使う。どちらも原本の同一性（`sha256`・`storageKey`・`kind`・寸法・長さ）には影響しない。

使用頻度順は採用しない。素材の参照は `ScriptVersion.contentJson` の中だけにあり、使用回数を出すには全版の走査か集計テーブルが要る。集計を持つと保存時の更新フックとドリフト管理が増え、不変原則の例外をさらに広げる割に、単一利用者では効果が薄い。よく使う素材を上に出す用途は「お気に入り」で足りる。同じ理由で「最近使った順」も持たない。

## Considered Options

- 予約タグ（例 `_archived`）でアーカイブとお気に入りを表す。→ スキーマ変更なしで済むが、タグの名前空間を汚し、誤操作・重複・上限（30件）消費の温床になるため不採用。表示状態は明示フィールドにする。
- 使用頻度カウンタや参照インデックステーブルを持つ。→ 保存のたびに全参照を再計算するかトリガを持つ必要があり、ドリフトと不変原則の例外が増える。MVPではお気に入りで代替する。
- アーカイブを物理削除で表す。→ 復元できず、参照中の素材を消せない削除制約とも衝突するため不採用。ソフトな表示フィルタにする。

## Consequences

- `apps/api/prisma/schema.prisma` の `Asset` に `favoritedAt DateTime?` と `archivedAt DateTime?` を追加し、マイグレーションを1つ追加する。`status`・ready Rendition由来の表示メタデータ・`tagsJson`・`favoritedAt`・`archivedAt` が、取り込み後に更新されうる列になる。
- contracts の `assetSchema` に `favoritedAt` / `archivedAt`（nullable）を追加する。`updateAssetRequestSchema` を `{ tags?, favorited?, archived? }` の部分更新へ広げ、いずれか1つ以上を必須とする。
- API サービスは `updateAssetTags` を `updateAsset`（部分更新）へ統合し、`dto/mappers.ts` の `toAsset` に2フィールドを写す。
- 素材一覧は引き続きページングせず全件取得し、絞り込みはクライアント側で行う（[ADR-0039](./0039-asset-tags-mutable-metadata.md) を維持）。
- Web の素材ライブラリと素材ピッカーに、種類・タグ絞り込み、ファイル名検索、並び替え（追加が新しい順 / 名前順 / お気に入り優先）、お気に入りトグル、アーカイブの表示トグルとトグル、カード / リスト表示切替を追加する。ピッカーのカードは種類ラベルとタグを1行目、ファイル名を2行目に分けて表示する。
- アーカイブは表示フィルタであり、「未参照素材を清掃」はアーカイブ済みでも未参照なら削除対象に含める（利用者の明示的な破壊操作のため）。
- `docs/mvp/spec.md` の不変原則の記述、`docs/mvp/api-contract.md` の Asset DTO とタグ更新の節、`CONTEXT.md` の `Asset` を更新する。
