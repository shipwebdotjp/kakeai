# Live Program Versionは解決スナップショットと不変のパッケージbuildを持つ

Status: accepted

Live Program Versionは文書の不変スナップショットだけでなく、Theme、キャラクター、声、音声、CutIn、Live Materialの解決結果を固定した **resolutionSnapshot** を持つ。書き出しは版から新しい **package build** を作り、Live Runは版ではなく正確なpackage buildを参照する。これにより、同じ版から再書き出ししても、過去の配信で使ったパッケージをそのまま再生できる。

## Context

- Live Programの文書は、Theme、Character、Voice Profile、音声Asset、CutIn、Live MaterialをIDで参照する。これらの実体は可変で、削除・更新され得る。
- 版の文書が同じでも、再書き出しのたびにキャラクターの外観、声、音声、素材が変わると、「同じ版なら同じshow.json」という説明が成り立たない。
- パッケージ自体は不変だが、再書き出しで新しいパッケージができる。Live Runが版だけを参照すると、どのパッケージで配信したかを失う。
- 既存の `live_export` Jobは `packageId`、`manifestSha256`、`packagePath` を返す。これらはパッケージの同一性を示すのに十分で、別のbuildエンティティを追加する必要はない。
- 将来、同じ版から意図的に見た目を変えて再buildしたい場合がある。版を書き換えるのではなく、新しいbuildとして残す必要がある。

## 決定

- `LiveProgramVersion` は canonical JSON、`documentSha256`、作成日時、任意のメモを持つ。文書ハッシュは保存時に計算する。
- 版確定時に `resolutionSnapshot` を固定する。含めるもの:
  - Theme revision
  - Characterの外観、Face Set、各画像Assetのハッシュ
  - Voice Profileの解決済み設定、参照音声のハッシュ
  - `audioAssetId` のRendition、ハッシュ
  - CutInの入力Asset/Rendition、ハッシュ
  - Live MaterialのSceneスナップショット、依存Assetのハッシュ
- パッケージのv2 manifestは `programDocumentSha256` と `resolutionSnapshotSha256` を持つ。
- 書き出しは版から行い、新しいpackage buildを作る。package buildは `packageId`、`manifestSha256`、`packagePath` で識別する。別のbuildエンティティやbuild番号は追加しない。
- 同じ版から再書き出しすると、新しいpackage buildになる。過去のbuildは削除・上書きしない。
- `LiveRun` は `programVersionId` と正確なpackage buildを参照する。Runから版だけを辿って再buildしない。
- resolutionSnapshotには実体を複製せず、ハッシュと参照を保存する。実体はTheme、Asset、CutIn、Live Materialの側に置く。
- 版確定後に参照先が削除された場合、その版からの新規書き出しは失敗する。既存のpackage buildはそのまま再生できる。

## Considered Options

- 版の文書だけを保存し、書き出し時に毎回IDを解決する。→ 外部実体の変更で同じ版の出力が変わり、再現性がないため不採用。
- 版にTheme、キャラクター、音声、素材の実体をすべて複製する。→ 保存量が大きく、Assetの重複と更新漏れを招くため不採用。ハッシュと参照だけを固定する。
- パッケージだけを不変の正本とし、版は編集用とする。→ 版から再buildしたときに何が変わったかを説明できず、Runと版の対応も曖昧になるため不採用。
- 別のpackage buildエンティティを追加する。→ 既存のpackageIdとmanifestSha256で一意に参照でき、Job/Artifactと重複するため不採用。
- 同じ版の再書き出しで既存パッケージを上書きする。→ 過去の配信の再現性を失うため不採用。

## Consequences

- 同じ版から書き出したパッケージは、外部実体が変わっても再現できる。
- 版確定処理に、Theme、キャラクター、声、音声、CutIn、Live Materialの解決とハッシュ計算が増える。
- 参照先の削除・更新は、版確定後の新規書き出しで失敗する。過去のbuildは影響を受けない。
- Live Runはpackage buildを参照するため、配信履歴から正確なパッケージを辿れる。
- パッケージの保存量は、buildごとに増える。不要なbuildの削除方針は別途決める。
- manifestのv2 sourceに `resolutionSnapshotSha256` が増える。
