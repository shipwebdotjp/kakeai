# エージェントへの Face Set 作成・部分更新・合成プレビューの公開

Status: accepted

## 背景

Face Set は読み取り（`faceSet.list` / `faceSet.get`）だけを公開してきた（[ADR 0074](./0074-agent-direct-reversible-operations.md)、[agent-access ロードマップ](../agent-access/roadmap.md) の C9〜C11）。そのため顔素材の無い作品では、エージェントは表情付きの立ち絵を作れず、人間に Face Set の作成・編集を依頼するしかなかった。`preview.thumbnail`・`preview.theme` と同じく、エージェントは画像を見て品質を確認できないため、書き込みだけを開いても反復できない。

Face Set は台本の外側にある共有ライブラリで、編集は既存の改訂版を書き換えず新しい改訂版を追加する（[ADR 0102](./0102-face-set-revisions-and-pinned-works.md)）。作品の外観は `faceSetId` と `faceSetVersion` を固定して参照するため、ライブラリの編集で保存済み台本・既存レンダーは変わらない。ライブラリ Character は最新版へ即時追従するが、外観の ID と参照は維持される。すなわち [ADR 0074](./0074-agent-direct-reversible-operations.md) の意味で可逆であり、Character・Voice Profile・Theme の書き込みを公開した判断と平仄が合う（[ADR 0088](./0088-agent-voice-profile-writes.md)、[ADR 0099](./0099-agent-character-library-writes.md)、[ADR 0101](./0101-agent-theme-authoring-and-preview.md)）。

## 決定

次の 4 操作を Agent Access に公開する。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く（加算的変更）。

- `faceSet.create`（mutation）: HTTP と同じ `{ name, layers, expressions }` を受け、`{ faceSet }` を返す。既存の `createFaceSet` をそのまま呼ぶ。`layers` の `assetId` は同寸で `ready` な画像 Asset、`expressions` は `normal` を必須とする。`requestId` は持たず、冪等台帳に載せない（`character.create`・`voiceProfile.create` と同じ扱い）。タイムアウト後は `faceSet.list` で確認してから再実行する。
- `faceSet.update`（mutation）: `{ faceSetId, name?, layers?, expressions? }` を受け、`{ faceSet }` を返す。**省略した項目は変更しない**。指定した配列はその全体を置き換える。現在値の読み取りとマージは書き込みと同じトランザクション内で行う。
  - `layers` または `expressions` が渡され、内容が最新改訂版と異なるときだけ新しい改訂版を作る。名前だけの変更・同一内容では版を増やさない。
  - マージ後の内容を検証する。レイヤーを削除して既存の preset が参照先を失う場合や、ライブラリ外観のベース画像と寸法が合わない内容は `VALIDATION_ERROR` とし、改訂版を作らない。
  - 存在しない `faceSetId` は `RESOURCE_NOT_FOUND`、1 項目も指定しない呼び出しは `VALIDATION_ERROR`。タイムアウト後は `faceSet.get` で最新版を確認してから再実行する。
- `faceSet.usages`（read）: `{ faceSetId }` を受け、`{ usages }` を返す。既存の `getFaceSetUsages` をそのまま呼び、Face Set を参照するライブラリ外観とベース画像の寸法を返す。改訂版を作る前の影響確認に使う。
- `preview.faceSet`（read / 画像）: 未保存の下書き `{ layers, expressions, expressionId?, baseAssetId }` を、`baseAssetId` の寸法で合成した PNG にして返す。`expressionId` は既定 `normal`。眉・目・口と `foreground` をこの順に重ねる。DB・Face Set・改訂版・Job・Artifact は作らない。既存の `Rasterizer` と、サムネイルと同じ data URL のインライン化を使う。画像系操作として MCP の image ブロック、CLI の `--out`、30 秒の読み取りタイムアウトに対応する。

`faceSet.delete` と改訂版の削除は公開せず、人専用のまま残す。ライブラリの削除は取り消し手段が無く、復旧は再作成しかない。Face Set を参照するライブラリ外観がある間は削除できず（既存の `FACE_SET_IN_USE`）、[ADR 0088](./0088-agent-voice-profile-writes.md) と同じく実体削除は可逆性の基準を満たさない。

## Considered Options

- HTTP と同じ全項目必須の更新だけを公開する。→ 空配列は正当な値なので、「表情を変えないつもりで `expressions: []` を送って全消し」が型では防げない。省略＝不変にすれば事故を契約で防げる。Character の部分更新（ADR 0099）と同じ方針を採る。
- レイヤー追加・preset 追加・名前変更を個別操作に分ける。→ 取りこぼしには強いが、操作数が増え、追加は再送で重複し得る。既存サービスは配列を受け取る全置換と差分の比較を既に持つため、1 操作の部分更新に寄せる。
- 改訂版の作成を人専用に残し、新規作成だけを公開する。→ 新規作成した Face Set を直せず、表情の追加・修正のたびに人間待ちになる。ライブラリ Character の最新追従は既存の仕様（ADR 0102）で、作品は固定版を使い続けるため、公開しても保存済みの見た目は変わらない。
- `faceSet.update` に `requestId` を付けて冪等台帳に載せる。→ 台帳は高コスト操作（Job・Version を増やす操作）の重複防止が目的であり、ライブラリの改訂版追加は `faceSet.get` の読み直しで確認できる。ADR 0088 / 0099 と同じ理由で不採用。
- 保存済み Face Set の PNG を返す `faceSet.image` も用意する。→ 既存の `faceSet.get` と `preview.faceSet` で素材の確認は足りる。必要になった時点で追加する。

## Consequences

- Agent Access 仕様の操作表・操作詳細・画像操作の一覧を改め、Face Set の作成・部分更新・合成プレビューの公開と削除の人専用維持を明記する。`operationDigest` と `schemaDigest` は変わり、束縛（MCP / CLI）とアプリは同じビルドで揃える。
- 制作スキルに、`faceSet.create` → `preview.faceSet` → `faceSet.update` の反復と、`faceSet.usages` による影響確認を追記する。
- `preview.faceSet` はベース画像の寸法で描く。ベースとレイヤーの寸法が合わない下書きは見た目がずれるが、生成自体は成功する。保存時の寸法検証は `faceSet.create` / `faceSet.update` が担う。
- Face Set の編集はライブラリの Character に即時反映されるが、既存作品の固定版・レンダー済み MP4 は変わらない。人の最終判断は残る。
- この決定は恒久ではない。削除や改訂版の整理が必要になった場合は、参照崩れの回復手順と合わせて新しい ADR で再検討する。
