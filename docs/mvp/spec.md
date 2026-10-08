# MVP仕様: ローカル動画制作

## 目的

個人利用者がMac上で、日本語の解説動画を作成、保存、プレビュー、MP4出力できるようにする。最初の制作フローは、手作業で用意した台本、画像・動画素材、セリフごとの音声、BGMを、固定テンプレートに当てはめるものとする。

このMVPはAI動画生成ツールではない。将来のTTS、画像生成、調査、台本下書き、多言語化、ショート動画生成を、保存済み作品の作り直しなしに追加できるデータ境界を用意する。

## 対象利用者と動作環境

- 利用者は単一の個人。認証、共有、共同編集、テナント分離は対象外。
- 開発者がMac上でローカル起動するWebアプリである。配布可能なデスクトップアプリ、インストーラ、自動更新、常駐起動はMVPの対象外とする。
- ネットワークや外部AIサービスなしで動画を作成・出力できる。
- 素材、BGM、音声の利用許諾は利用者が確認する。

## MVPでできること

1. 作品を新規作成し、名前を付けて保存・再編集する。
2. 日本語（`ja-JP`）の制作版を作る。
3. 固定5シーンのフォームを編集する。
   - 導入：タイトル、サブタイトル、背景素材
   - 要点1〜3：見出し、本文、背景素材、セリフ群
   - 結び：締めの文言、背景素材
4. 各シーンに画像または動画を指定し、アクセント色を設定する。要点シーンの表示尺は音声を主として自動計算し、必要なときだけ固定尺へ切り替える。
5. セリフごとに字幕用の文章、TTS用の読み方、任意の手元音声ファイルを指定する。
6. セリフに合わせた簡易な焼き込み字幕と、任意のBGMを指定する。
7. ブラウザで完成イメージをプレビューし、MP4レンダーを開始する。
8. レンダーの状態、失敗理由、過去の出力MP4を確認する。

## 対象外

- AIによる調査、台本生成、翻訳、TTS、画像・サムネイル・背景生成
- 字幕のタイミング・スタイルの自由編集、音声認識、波形編集、音声・動画のトリミング、自由なタイムライン編集
- シーンの追加・削除・順序変更、複数テンプレート、縦型出力
- クラウド保存、外部公開、共同編集、認証、通知

## 出力仕様と入力制約

| 項目 | MVPの仕様 |
| --- | --- |
| 映像 | 16:9、1920x1080、30fps、MP4 |
| テンプレート | 導入＋要点3つ＋結びの1種類 |
| 画像 | PNG / JPEG / WebP |
| 動画 | MP4 / WebM。原本を保持し、原則は原本をそのまま使う。原本をレンダーに直接使えない場合だけ、必要時にH.264/AAC・定フレームレートのRenditionを作成して使用する。先頭からシーン尺までを使用する |
| 音声 | MP3 / WAV。原本を保持し、原則は原本をそのまま使う。原本をレンダーに直接使えない場合だけ、必要時にWAV Renditionを作成してBGMまたはセリフ音声として使用する |
| セリフ音声 | 選択した音声をシーン内で登録順に配置する。音声なしのセリフも許可する。既定の自動尺では、音声尺と音声なしセリフの既定字幕尺からScene尺を算出する |
| 字幕 | セリフごとの `captionText` を、音声区間または音声なしセリフへ割り当てた区間に同期して焼き込む |
| 背景未指定時 | テンプレート既定の単色背景を使用する |
| 背景クロップ | `fit: cover` の素材は任意の正規化 `focalPoint` で位置を指定する。未指定時は中央 |
| テキスト量 | テンプレートごとの最大行数・最小フォントサイズを目安とする。超える場合も保存は通し、警告として返してプレビューで確認する |

アップロード時に、ファイル形式とサイズを検証する。動画・音声の長さは取り込み時に取得して保存する。原本はそのまま保持し、原則そのままプレビューとレンダーに使う。互換性が不安定なコーデック、可変フレームレート、回転メタデータなど原本を直接レンダーに渡せない入力に限り、必要時にRenditionへ正規化する。テキストの長さは、テンプレートごとの最大行数・最小フォントサイズに照らして台本保存時に検証し、収まらない場合は保存を通したうえで警告として返す。

## 正本データ

HyperFrames Composition HTML、出力MP4、開始・終了フレームは派生物であり、編集データの正本にはしない。正本はSQLiteに保存し、素材と出力ファイルはローカルディレクトリに保存する。

アプリ管理データの保存先は、OSが提供するアプリデータディレクトリ（macOSではApplication Support配下）をルートとし、特定OSの絶対パスをコードへ埋め込まない。開発時は環境変数 `KAKEAI_DATA_DIR` でルートを差し替える。SQLite、原本、Rendition、Artifactは同一ルート配下にサブディレクトリを分けて置き、絶対パスを正本データへ埋め込まない。

| 用語 | 意味 |
| --- | --- |
| `Work` | 作品の親単位。原本言語、作品名、任意の親作品を持つ。 |
| `LanguageEdition` | ある言語での制作版。MVPでは `ja-JP` のみ作成・出力できる。 |
| `ScriptVersion` | シーンとセリフを持つ台本の不変版。編集保存時に新しい版を作る。 |
| `NarrationSegment` | 読み上げる最小単位。字幕用文章、読み上げ用文章、話者、選択音声（または音声なし）を持つ。 |
| `Speaker` | 音声上の話者。画面に出ないナレーターも表せる。 |
| `Character` | 画面に出る人物・アバター。話者との対応は任意で、表情・ポーズを持つ立ち絵は `CharacterAppearance` として管理する。 |
| `VisualTemplate` | 素材または構造化データを描画する再利用可能な表現の契約。 |
| `VisualCue` | シーン内のどの区間（Scene全体／セリフ区間／オフセット）に、どの `VisualTemplate` をどの入力で表示するかという指示。 |
| `AudioCue` | BGMや効果音をどの区間にどの設定で配置するかという指示。 |
| `Asset` | アップロードまたは将来の生成で得る不変の原本画像、動画、音声ファイル。種類・保存先・来歴・利用可能状態を持つ。 |
| `AssetRendition` | Assetから導いた、プレビューまたはレンダーに安全に使える不変の正規化ファイル。 |
| `Job` | 非同期処理の実行記録。MVPでは `asset_ingest` と `render` を実行する。 |
| `Artifact` | あるJobが生成した出力ファイル。MVPではrender Jobが生成するMP4。Assetへ自動昇格せず、再利用は明示的なAsset化による。 |

`Work` の原本言語と `LanguageEdition.locale` はBCP 47形式で保存する。画面上は日本語だけを選択可能にし、未対応の言語版やジョブ種別は明示的に未対応として扱う。

`Asset` には `uploaded` / `generated` の作成元と、生成条件・モデル情報を格納できる来歴を持たせる。MVPで作成できるのは `uploaded` のみである。

`Job` は種別、状態（`queued` / `running` / `succeeded` / `failed` / `cancelled`）、入力スナップショット、成果物参照、エラー、開始・完了時刻を持つ。MVPの `asset_ingest` はアップロード原本を検査してメタデータを記録し、原本を直接レンダーに使えない場合にだけRenditionを作り、`render` はMP4を作る。将来のTTS、画像生成、調査、台本下書きも同じ枠組みに追加する。

## MVPのDBスキーマ

### 永続化の境界

SQLiteでリレーションとして管理するのは、作品の一覧・版の履歴・ファイルの実体・非同期処理・出力成果物である。固定テンプレートを編集するために常に一体で読み書きするScene、NarrationSegment、Speaker、Character、AudioTake、VisualCue、AudioCueは、MVPでは個別テーブルに分解しない。検証済みの正本JSONを `ScriptVersion.contentJson` に保存する。

この境界には次の利点がある。

- 編集保存は、JSON全体を不変の `ScriptVersion` として追加するだけで履歴を保てる。
- セリフやVisualTemplateの入力構造を将来増やしても、台本のテーブル移行を毎回必要としない。
- 素材、作品、Artifact、JobはJSON内だけでなく横断して扱うため、外部キーと通常カラムで管理できる。

`contentJson`、`provenanceJson`、`inputSnapshotJson`、`resultJson` は、SQLiteではJSON型ではなくJSON文字列として保存する。保存前と読出時に `packages/contracts` のZodスキーマで検証する。`contentSchemaVersion` は `contentJson.schemaVersion` と同じ値を重複して保持し、移行対象をJSON解析なしで特定できるようにする。

`contentJson` はキー順を安定させたJSON文字列として保存する。JCS正規化と `contentHash` は持たない。同一内容の検出や変更追跡は版IDと `sourceScriptVersionId` で行う。同一MP4バイト列を将来も再生成することはMVPの要件にしない。`ScriptVersion` は不変であり、`contentSchemaVersion` の移行は保存済みの版を書き換えずに新しい `ScriptVersion` を作って行う。MVPの保存済み版は `schemaVersion: 1` のみで、旧版の解釈コードは持たない。

Assetは作品に所属させず、ローカルアプリ全体で再利用できる素材ライブラリとする。ScriptVersionのJSONはAssetのIDだけを参照する。Assetの論理的なID・原本メタデータ・バイト列は取り込み後に不変とし、`status` とreadyなRendition由来の表示メタデータだけは取り込み処理により更新される。実体ファイルが欠損・改変された場合は、同じSHA-256の再アップロードで内容ハッシュ由来の同じパスへ上書きして取り込み直す。原本とは別に、レンダー入力として使う不変の `AssetRendition` を持てる。

履歴と実体を永久保持することはMVPの要件にしない。Workが存続する間は全ScriptVersionを保持し、個別の版削除・履歴圧縮は提供しない。不要になった作品はWorkの明示削除で、そのEdition、ScriptVersion、render Job、Artifactをまとめて削除する。Assetは残存するScriptVersionまたはキュー・実行中のrender Jobの入力スナップショットから参照されている間は削除できず、参照がない場合だけ明示削除または未参照データ清掃で実体と行を削除できる。Asset自身のasset_ingest JobはAssetとともに削除する。Artifactは個別に削除できる。削除された版やRenditionを必要とする過去Jobは、再プレビュー・再レンダーできないものとして扱い、履歴を偽って保持しない。

### テーブルと制約

Prismaモデル名は以下のとおりとする。IDはアプリ生成の文字列ID（Prismaでは `cuid()`）を用い、日時はUTCの `DateTime` とする。列名の物理的なsnake_case化はPrismaの `@map` で行ってよいが、ここではモデル上のcamelCaseで記す。

| モデル | 主な列 | 制約・用途 |
| --- | --- | --- |
| `Work` | `id`, `title`, `originalLocale`, `parentWorkId?`, `createdAt`, `updatedAt` | 親作品。`parentWorkId` は将来のショートなど派生Work用で、MVPでは通常NULL。子Workを持つWorkは削除できない。 |
| `LanguageEdition` | `id`, `workId`, `locale`, `currentScriptVersionId?`, `createdAt`, `updatedAt` | 作品の言語別制作版。`@@unique([workId, locale])`。循環参照を避けるため作成途中だけNULLを許し、同一トランザクション内で初期ScriptVersionを作成後に必ず設定する。`currentScriptVersionId` が編集画面の現在版を明示し、最大版番号から推測しない。参照先は同じEditionでなければならない。MVPでは作成可能なlocaleは `ja-JP` のみ。 |
| `ScriptVersion` | `id`, `languageEditionId`, `versionNumber`, `contentSchemaVersion`, `contentJson`, `sourceScriptVersionId?`, `createdAt` | 不変の編集データ。`@@unique([languageEditionId, versionNumber])`。版番号は表示・並び替えのため単調増加させる。`sourceScriptVersionId` は手動復元、翻訳、下書きなどの派生元を示す。 |
| `Asset` | `id`, `kind`, `origin`, `status`, `storageKey`, `originalFilename`, `mediaType`, `byteSize`, `sha256`, `durationMs?`, `widthPx?`, `heightPx?`, `provenanceJson?`, `generatedByJobId?`, `createdAt` | 再利用可能な原本ファイル。`status` は `processing` / `ready` / `failed`。`kind` は `image` / `video` / `audio`、`origin` は `uploaded` / `generated`。`storageKey` と `sha256` はそれぞれ一意にし、同一バイト列の重複保存を避ける。 |
| `AssetRendition` | `id`, `assetId`, `purpose`, `storageKey`, `mediaType`, `sha256`, `byteSize`, `durationMs?`, `widthPx?`, `heightPx?`, `codecJson?`, `createdAt` | 原本をレンダーに直接使えない場合に必要時だけ作る、レンダー用の正規化派生物。MVPの `purpose` は `render`。画像は適用済みの向き、動画はH.264/AAC・CFR、音声はWAVへ正規化する。`@@unique([assetId, purpose])`。 |
| `Job` | `id`, `kind`, `status`, `workId?`, `assetId?`, `languageEditionId?`, `scriptVersionId?`, `snapshotSchemaVersion`, `inputSnapshotJson`, `resultJson?`, `progressPercent`, `errorCode?`, `errorMessage?`, `createdAt`, `startedAt?`, `finishedAt?` | 非同期実行の記録。statusは `queued` / `running` / `succeeded` / `failed` / `cancelled`。MVPの `kind` は `asset_ingest` / `render`。renderは `workId` と `scriptVersionId` を必須、asset_ingestは `assetId` を必須とする。`inputSnapshotJson` はkindごとの判別unionで定義し、`snapshotSchemaVersion` で解釈版を特定する。`@@index([status, createdAt])`、`@@index([workId, createdAt])`、`@@index([assetId, createdAt])` を置く。 |
| `Artifact` | `id`, `jobId`, `role`, `format`, `storageKey`, `sha256`, `byteSize`, `durationMs?`, `widthPx?`, `heightPx?`, `fps?`, `createdAt` | Jobが生成した出力ファイル。`role` は `render` / `thumbnail` / `caption` などの用途、`format` は `mp4` などの形式。MVPはrender Jobが `role=render`、`format=mp4` のArtifactを1つ生成する。1 Jobは複数Artifactを持てる。`storageKey` は一意とし、`@@index([jobId])` を置く。 |

Jobの対象はkindで決める。renderは `workId`、`languageEditionId`、`scriptVersionId` を必須とし、asset_ingestは `assetId` を必須とする。TTSや画像生成はLanguageEditionまたはScriptVersionに結び、調査のように作品全体に対するJobは `workId` だけを持てる。`Asset.generatedByJobId` は将来の生成Assetの来歴を示す任意の外部キーである。

誤削除を防ぐため、通常の外部キーは `onDelete: Restrict` とする。Workの削除だけは、参照の有無を検査してからEdition、ScriptVersion、Job、Artifactを同一トランザクション／削除計画で明示的に消す。ファイル実体はDBの削除後に隔離し、失敗時は起動時の清掃処理で回収する。`Work.updatedAt` と `LanguageEdition.updatedAt` は、新しいScriptVersionの保存時にも同一トランザクションで更新し、作品一覧の並び順に使う。

```text
Work ──< LanguageEdition ──< ScriptVersion
  │             │                   │
  │             └── currentScriptVersionId ──> ScriptVersion
  │             └──< Job >───────────────────┘
  │                    │
  │                    └── 0..* Artifact
  └── parentWorkId ──> Work

Asset ──< AssetRendition
  └── generatedByJobId ──> Job
ScriptVersion.contentJson と Job.inputSnapshotJson は Asset.id を参照する
```

### JSONとリレーションの接続

`ScriptVersion.contentJson` に含まれる `assetId` はAssetの外部キーにはできないため、版の保存前にすべての参照Assetが存在することをアプリケーション層で検証する。Assetの種類と用途の組み合わせもここで検証する。たとえば、背景用の `media.full-bleed` がaudio Assetを参照することは許可しない。

Render Jobを作る時点で、次を `inputSnapshotJson` に不変の値として記録する。

- `ScriptVersion` のID、版番号、検証済みの `contentJson`
- 参照した各Assetと、使用するレンダー入力（正規化Renditionがあればそれ、無ければ原本）のID、SHA-256、MIME type、サイズ・長さなどのレンダーに必要なメタデータ
- テンプレートID・バージョン、出力設定
- コンパイラとレンダラーの版（障害調査用）。Chrome build、フォント、FFmpegのバイト単位の固定は要求しない

これにより、保存後に新しい台本版を作っても、キュー済みJobが使う編集内容と素材選択は変わらない。ワーカーはこのスナップショットの正本JSONを、実行時にインストール済みの信頼済みテンプレートで再コンパイルする。同じJobを将来に再実行しても、ツール更新でMP4のバイト列・見た目が完全一致する保証はしない。実体ファイルが失われた、改変された、またはAssetが削除済みの場合は、プレビューまたはレンダーを `ASSET_UNAVAILABLE` として失敗させる。

`Artifact` はJobが生成した出力ファイルの管理情報だけを持つ。出力MP4を入力用の `Asset` として二重に登録しない。将来、レンダー結果を別作品の素材として再利用する要求が出た時点で、ArtifactからAssetを明示的に作成する操作を追加する。

### 書込みとJob状態遷移

1. **作品作成**：1つのWork、`ja-JP`のLanguageEdition、テンプレート既定の `accentColor` を設定した固定5シーンを持つ、`schemaVersion: 1` のScriptVersion（`versionNumber: 1`）を1トランザクションで作成する。3つの要点Sceneは音声主導の `timing.mode: "auto"`、導入と結びはテンプレート既定の固定尺にする。Editionの `currentScriptVersionId` をその版へ設定する。
2. **台本保存**：利用者は明示的に保存する（自動保存はしない）。フォーム値をZodで検証し、`ready` のAsset参照を確認して、新しいScriptVersionを追加する。過去の版は更新しない。テキスト量の目安を超える入力は保存を拒否せず、警告を返す。保存はlast-write-winsとし、クライアントは版番号を送らない。同一トランザクションで新しい版をcurrentへ進める。過去版の復元は、その内容を新しい版として保存し、復元元を `sourceScriptVersionId` に記録する。
3. **素材取り込み**：アップロードで原本Assetを作成し、`asset_ingest` Jobをキューへ追加する。Jobは形式・長さ・寸法を検査してメタデータを記録し、原本を直接レンダーに使えない場合にだけrender Renditionを作ってAssetを `ready` にする。失敗時は `failed` にし、台本保存・プレビュー・レンダーでそのAssetを使わせない。
4. **レンダー投入**：特定のScriptVersionとreadyなRenditionから、入力スナップショットを持つ `queued` Jobを追加する。MVPでは「現在版をレンダー」がUIの入口だが、Job自体は必ず版IDと素材Renditionを固定する。
5. **ワーカー取得**：MVPは単一プロセス起動とし、ワーカーはAPIプロセス内のバックグラウンドループとして動作する。単一ワーカーのみを正式にサポートする。ワーカーはPrismaで最古のqueued Jobを読み、`id` と `status=queued` を条件に `updateMany` して取得を試みる。更新件数が0なら取り直す。この軽量な比較更新は偶発的な二重取得を減らすためのベストエフォートであり、複数ワーカーの厳密な排他・分散キューは提供しない。リースは持たず、API起動時に `running` のまま残ったJobを `WORKER_INTERRUPTED` として failed に掃除する。renderワーカーはスナップショットJSONを信頼済みテンプレートで実行時にコンパイルする。
6. **完了または失敗**：出力MP4またはRenditionを確定保存できた場合に対応する行を作成してJobを `succeeded` にする。失敗時は `errorCode` と利用者向け `errorMessage` を記録して `failed` にする。異常終了で `running` のまま残ったJobは起動時に `WORKER_INTERRUPTED` として失敗扱いにし、自動再試行せず利用者が再実行する。

Jobの状態遷移は `queued → running → succeeded | failed` と `queued → cancelled` のみとする。実行中Jobの停止は行わない。画面上の進捗は `progressPercent`（0〜100）に保存するが、HyperFrames側から取得できない区間は概算値または0のままでよい。

## 視覚・音声の構成

`Asset` は実体ファイルだけを表す。画像、スクリーンショット、動画、生成済みのモーショングラフィックス、音声はいずれもAssetであり、BGMや背景はAssetの種類ではなく配置時の役割である。

`VisualCue` は実体ファイルを直接描く、または `VisualTemplate` に入力を渡して描く。たとえばスクリーンショットや背景画像は画像Assetを参照し、表・グラフ・フローチャートは行・列やノード・辺などの構造化データをテンプレートへ渡す。MVPで実装するテンプレートは、Sceneのスロットを描画するテキスト系、背景メディア、画像／動画カード、立ち絵に限定する。Sceneは `kind` ごとの型付きスロット（`intro`: title/subtitle、`point`: heading/body、`outro`: closing）と必須の `accentColor` を持ち、Sceneベーステンプレートが既定で描画する。

VisualCueの表示区間はフレーム番号ではなく判別union（Scene全体、セリフ区間、Scene先頭からのオフセット）で指定する。レンダー時に選択音声の尺から実時間とフレームを解決するため、将来TTSで音声尺が変わっても視覚演出がセリフに追従する。

背景メディアのクロップは、出力ピクセルではなく正規化した `focalPoint` で指定する。未指定時は中央とし、素材の重要な部分が端にある場合も編集画面で位置を調整できる。

詳細なJSON契約は [content-schema.md](./content-schema.md) を参照する。

## 画面と処理

- **作品一覧**：作品名、更新日時、最新レンダー状態を表示し、新規作品を作成する。
- **作品編集**：固定5シーン、セリフ、素材、BGM、色をフォームで編集し、明示保存で新しい版を作る（自動保存しない）。テキストがテンプレートの目安を超える場合は保存時に警告し、プレビューで実際のはみ出しを確認できる。要点シーンは音声から算出した尺と各字幕の解決済み区間を常に表示し、利用者は必要なときだけ固定尺へ切り替える。
- **プレビュー**：保存済みの編集内容を、プレビュー向けの `assetResolver`（Asset IDをHTTP content URLへ解決）を注入してHyperFrames Composition HTMLへ変換し、`<hyperframes-player>`で表示する。テキストのはみ出しはここで確認する。
- **レンダー履歴**：レンダー開始、進捗状態、失敗理由、完成MP4を表示する。
- **レンダーワーカー**：APIプロセス内のバックグラウンドループとして、キュー済みの `asset_ingest` / `render` Jobを取り出す。renderは開始時に保存した入力スナップショットの正本JSONとRenditionを使い、信頼済みコンパイラでHTMLを生成してMP4を出力する。

レンダーを開始すると、対象の `ScriptVersion`、`LanguageEdition`、素材Rendition参照、テンプレート設定を不変スナップショットとしてJobに保存する。以後の編集は、開始済み・完了済みレンダーの入力内容を変更しない。ただしツール・テンプレート更新後に同じ入力を再実行した出力の完全一致は要求しない。

## 技術スタック

- フロントエンド: Vite + React + TypeScript + Tailwind CSS。フォームは React Hook Form と Zod、データ取得・更新と Job 状態のポーリングは TanStack Query。
- API: Express + TypeScript。
- 永続化: SQLite + Prisma。
- 契約: Zod（`packages/contracts` が唯一の定義場所）。
- レンダー: HyperFrames（プレビューに `@hyperframes/player`、出力に `@hyperframes/producer`）。

## UIテーマ

- Web UI はライト/ダークの両モードに対応する。既定はOS設定に従い、利用者がシステム/ライト/ダークを切り替えられる。
- アクセントは緑系のブランドカラー `brand-50`〜`brand-950`。面・境界・文字は用途別のセマンティックトークン（`surface` / `surface-muted` / `border` / `foreground` / `muted-foreground`）で表現し、コンポーネントはブランドとセマンティックトークンだけを使う。
- 配色は `apps/web` の Tailwind `@theme` に定義し、ライト/ダークの切替は `html` の `dark` クラスで行う。

## 実装方針

- リポジトリは `apps/web`、`apps/api`、`packages/contracts`、`packages/video` に分ける。ワーカーはMVPでは `apps/api` 内のモジュールとして実装し、将来の別プロセス分離に備えてコード境界は分けておく。`packages/video` はHyperFrames Compositionのコンパイラと、信頼済みのVisualTemplateを持つ。
- フロントエンド：Vite + React + TypeScript + Tailwind CSS。フォームはReact Hook FormとZod、APIデータ取得・更新とJob状態のポーリングはTanStack Queryを使う。
- API：Express + TypeScript。REST APIと素材アップロードを担当し、MP4レンダーをHTTPリクエスト処理内では実行しない。エンドポイント、DTO、エラーの契約は [api-contract.md](./api-contract.md) に従う。
- 起動構成：通常起動ではExpressが `apps/web` のVite build成果物を同一originで配信する。開発時だけVite dev serverを起動し、`/api` と素材・Artifact content URLをExpressへループバックproxyする。proxyはHostとOriginをExpressの期待する値へ書き換え、Cookieを透過する。ブラウザからAPIポートを直接利用しない。
- ワーカー：MVPでは `apps/api` のプロセス内で動くTypeScriptモジュール（バックグラウンドループ）とし、SQLiteからキュー済みJobを取得する。`asset_ingest` は原本を検査し、必要時にFFmpeg/画像処理でrender Renditionを作り、`render` は開始時の入力スナップショットのJSONとRenditionを一時的なHyperFramesプロジェクトへ展開して `@hyperframes/producer` でMP4を出力する。MVPでは単一ワーカーだけを起動し、将来は別プロセスへ分離できるようコード境界を分けておく。
- 永続化：SQLite + Prisma。`Work`、`LanguageEdition`、`ScriptVersion`、`Asset`、`AssetRendition`、`Job`、`Artifact`をPrismaモデルとして保存する。各モデルの列・制約・書込み規則は「MVPのDBスキーマ」に従う。SQLiteはWALモードとbusy timeoutを設定する。
- 共有契約：`packages/contracts` をZodスキーマの唯一の定義場所とする。API入出力、フォーム、可変JSONの復元、HyperFrames Composition生成前の検証で同じスキーマを使い、TypeScript型は原則 `z.infer` から導く。
- VisualTemplateごとに入力用のZodスキーマを登録する。VisualCueの `template.id` と `template.version` から対応するスキーマを選び、任意形状の入力を無検証でレンダーへ渡さない。
- 可変構造のComposition入力や生成設定は、Zodで検証したJSON文字列として保存する。検索・結合に使う値は通常のカラムとリレーションで管理する。
- 保存先：素材・出力はローカルファイルシステムに保存する。ルートはOS提供のアプリデータディレクトリとし、`db/`、`assets/`、`artifacts/`、`tmp/` を分ける。環境変数 `KAKEAI_DATA_DIR` があればそれをルートに使う。`storageKey` はルート相対のキーとして解決し、絶対パスを保存しない。管理領域の使用量はこのルートから算出する。
- テンプレート版の不変性：`template.id@version` の意味とレイアウト規約を不変に保ち、見た目や制約を変える場合は同じ版を書き換えず新しい版（`@2`）を追加する。過去の版の描画コードは原則削除しない。ただし、どの保存済みScriptVersionからも参照されていない版は削除してよい（参照ゼロで削除可）。
- プレビュー・映像出力：HyperFrames。編集データをComposition HTMLの正本にせず、検証済みJSONからHTML/CSS/JavaScriptを派生させる。`@hyperframes/player`をプレビューに、`@hyperframes/producer`をMP4出力に使う。
- HyperFramesの採用は、実装開始前の別PoCを通過条件にしない。最初の縦切り実装で実素材の取り込み・プレビュー・レンダーを継続的に検証し、問題が出た場合も正本JSONとコンパイラ境界を保って対処または差し替える。
- 実行環境：Node.js 22以上、FFmpeg、HyperFramesで指定したChrome、明示的に管理した日本語フォントを必要とする。依存バージョンは通常のlockfileで管理し、Jobには障害調査用の実行版を記録する。バイト単位の出力再現性は要件にせず、更新時は代表素材でレンダー回帰テストを実行する。
- リソース上限：サーバー設定の既定値を、アップロード1ファイルあたり4GiB、動画・音声の最大長30分、入力映像の最大寸法3840x2160、管理領域の警告しきい値80GiBとする。出力は常に1920x1080である。上限値は環境設定で変更可能にし、80GiB到達は新規書込みを止めずUIとhealthで警告する。
- 安全性：無認証のローカルAPIをループバックに束縛し、JSON／アップロードAPIには厳密な `Host` と `Origin` の検証を要求する。素材・Artifactのcontent URLは、同一オリジンかつ `HttpOnly; SameSite=Strict` のメディアセッションCookieで認可し、JSON APIではCookieだけによる認可を許可しない。DNSリバインディングは `Host` 検証で、CSRFと素材漏洩は `Origin` 検証と `SameSite=Strict` Cookieで防ぐ。素材やArtifactの保存パスは内容ハッシュ由来とし、利用者入力のファイル名をパス生成に使わない。利用者または将来のAIが任意のHTML/JavaScriptをCompositionへ直接書き込むことは許可しない。Zodで検証したVisualTemplate入力だけから、アプリが管理するHTMLを生成する。

HyperFramesはApache-2.0で公開されているが、導入するCatalogブロック、フォント、素材、外部サービスは個別に利用条件を確認する。OSS候補の比較と導入上の注意は [oss-research.md](./oss-research.md) を参照する。

## 受け入れ条件

- ネットワーク接続なしで、APIとレンダーワーカーを単一プロセスで起動し、作品作成からMP4出力まで完了する。
- 日本語作品を保存し、アプリ再起動後も再編集できる。編集は明示保存で、保存のたびに新しい不変版が作られる。
- テキストがテンプレートの目安を超える場合、保存は成功し警告が返り、プレビューで実際のはみ出しを確認できる。
- セリフ音声がある場合、登録順に動画内へ配置される。
- 既定の自動尺で、音声の合計尺、音声なしセリフの既定字幕尺、前後パディングからScene尺と字幕区間が決定的に算出され、編集画面で確認できる。
- 固定尺を選んだ場合、音声合計尺がScene尺を超えるとレンダー前に理由を表示する。音声なしのセリフを含むときの均等配分と末尾無音区間も編集画面で確認できる。
- レンダー中または完了後に編集しても、既存出力は開始時の内容を維持する。
- テスト素材を使い、作成→保存→再読込→プレビュー→レンダー→`<video>`でのMP4再生・シークを自動確認できる。
- MP4/WebM/MP3/WAVの原本を取り込み、そのまま使える素材は正規化せずに、必要時だけRenditionを作って使用できる。取り込み中は状態を表示する。対応外コーデック、可変フレームレート、回転メタデータを含む入力も、必要時に作られるRendition経由でプレビューとレンダーができる。
- 参照されていないAsset、個別Artifact、Work全体を明示削除できる。参照中のAssetは409で拒否され、削除後の履歴が再プレビュー・再レンダー不可であることをUIに表示する。
- queued状態のrender Jobまたはasset_ingest Jobをキャンセルできる。実行中Jobはキャンセルできず、アプリまたはワーカーの中断時は従来どおり `WORKER_INTERRUPTED` で失敗する。
