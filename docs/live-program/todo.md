# ライブプログラム台本 TODO

[spec.md](./spec.md) を正とする。Phase順に進め、完了したらチェックを付ける。コードを変更したPhaseでは、`npm run typecheck` と `npm test` を通す。

## P0. 契約と文書

- [x] Live Program、Live Program Version、Live Format、Live Card、Live Card State の用語を整理する。
- [x] [ADR-0131](../adr/0131-live-program-owns-live-script.md)（ライブ台本をWorkから独立させる）を追加し、[ADR-0124](../adr/0124-live-cues-derived-from-script.md) をsupersedeする。
- [x] [ADR-0132](../adr/0132-live-cards-typed-state-renderer.md)（型付き状態スナップショットとライブ専用DOMレンダラー）を追加する。
- [x] `packages/contracts` にライブカード、状態スナップショット、アニメーション、パッケージv2の契約を追加する。
- [x] `LiveProgramDocumentV1` を strict なZod正本として追加する。`schemaVersion` は1に固定する。
- [x] 草稿検証と版確定検証を分ける。草稿は空セグメント・未完成Cueを許容し、版確定はスパインと参照を必須にする。
- [x] 中央ビジュアルを `visual`（card / material / null）の単一参照に統一する。
- [x] パッケージv2のカード参照を `visual` に統一し、v1の `materialId` と混在させない。
- [x] [ADR-0133](../adr/0133-live-version-resolution-snapshot.md)（版の解決スナップショットとpackage build）を追加する。
- [x] 版確定時の解決スナップショットと `resolutionSnapshotSha256` を仕様に追加する。
- [x] スパイン検証（opening / closing / script / cut_in / 専用fallback / closingReserve）をv2パッケージと版確定に追加する。
- [x] カード契約のテストを追加する。
- [x] `CONTEXT.md` のライブ用語を更新する。
- [x] [docs/live/spec.md](../live/spec.md) に、Show Profile入力がこの仕様で置き換わることを示す。
- 完了条件: カード型、状態参照、アニメーション、Live Program文書、パッケージv2の契約が型とテストで固定されている。

## P1. Live Program の永続化とAPI

- [x] `LiveFormat`、`LiveProgram`、`LiveProgramVersion` をDBに追加する。
- [x] Live Format を Program とは別スキーマ `LiveFormatDocumentV1` にする。エピソード本文・Live Material・CutInを持たせない。
- [x] Live Format の一覧・複製・作成・更新APIを追加する。
- [x] Live Program の一覧・作成・下書き保存・版確定・版一覧APIを追加する。
- [x] 下書き保存に `draftRevision` の楽観ロックを入れ、不一致は409で現行文書とrevisionを返す。
- [x] 版確定を期待revision付きの単一トランザクションにし、canonical JSONと `documentSha256` を保存する。
- [x] 版確定時に resolutionSnapshot を固定する。Theme、Character外観、Face Set、Voice Profile、音声Asset、CutIn、Live Materialのハッシュを含める。
- [x] Live Material をWorkのScene参照ではなく、取り込み時のScene内容・依存Assetのスナップショットとして、Program所有のLive Materialエンティティに保存する。Program文書はID参照だけを持ち、Work ID / Scene IDはprovenanceにだけ残す。
- [x] フォーマットをプログラム作成時に深くコピーし、Segment / Card / State / CueのIDを新規採番する。既存プログラムへの自動反映はしない。
- [x] 版確定時に、Cue、カード、カード状態、素材、CutIn、話者、フォールバック、キャスト、音声Assetを検証する。
- [x] `collectLiveProgramAssetReferences` でカード画像・音声・CutInのAssetを列挙し、DBのAssetとRenditionを検証する。
- [x] `audioAssetId` があるCueは、そのAssetを使い、利用不可なら書き出しを失敗させる。TTSへ黙ってフォールバックしない。
- [x] 下書きと版の差分表示、版からの複製編集を追加する。
- [x] テスト: 版の不変性、canonical JSON、楽観ロック、参照検証、フォーマットのコピー、下書きと版の分離。
- 完了条件: GUIなしでLive Programを作成し、版を確定し、一覧できる。

## P2. ライブカードレンダラー

- [x] `packages/live-cards` を追加し、エディタとライブステージで共有する。
- [x] Shadow DOMへのカードCSS注入とテーマCSS変数の継承を実装する。
- [x] `headline`、`image`、`list`、`chart`、`quote` の描画を実装する。
- [x] 安定IDによるキー付き差分更新を実装する。
- [x] `enter` / `update` のCSS/WAAPIアニメーションと `prefers-reduced-motion` を実装する。
- [x] 初回マウント・preview・再接続ではアニメーションを再生せず、完成状態を即時描画する。
- [x] グラフの `grow` / `draw` を実装する。
- [x] `resolveAsset` による画像解決と読み込み失敗時の非表示を実装する。
- [x] エディタ用のプレビューと、ライブステージ用のマウントAPIを共有する。
- [x] テスト: 状態差分、追加・削除・更新、アニメーションのライフサイクル、Shadow DOMのCSS隔離。
- 完了条件: 5型のカードを状態遷移させながらプレビューでき、同じレンダラーをステージでも使える。

## P3. Live Program エディタGUI

- [x] プログラム一覧、フォーマット選択、作成ウィザードを追加する。
- [x] スパイン中心のセグメント編集を追加する。動画のタイムラインにはしない。
- [x] Cue一覧とCue編集（話者、字幕、読み上げ、表情、カード状態、素材）を追加する。
- [x] カード一覧とカード型ごとの状態エディタを追加する。
- [x] リストの項目表示・アクティブ項目、グラフの値・強調をCueごとに編集できるようにする。
- [x] 版確定、版一覧、版からの複製編集を追加する。
- [x] プレビューを `packages/live-cards` で描画する。
- [x] フォーマットを編集しても既存プログラムに反映されないことをUIで明示する。
- [x] テスト: エディタの状態モデル、参照検証、版確定。
- 完了条件: GUIで1本のライブ台本を作成し、版を確定できる。

## P4. パッケージv2の書き出し

- [x] `live_export` の入力に `programVersionId` を追加する。Work / Script Version / Show Profile は使わない。
- [x] 台本のCueから字幕・読み上げ・話者・音声を解決する。TTS準備は既存パイプラインを再利用する。
- [x] ネイティブカードを `show.json` の `cards[]` に、画像を `cardAssets[]` と `kind: "card-asset"` に書き出す。
- [x] 取り込んだLive Materialを既存のPNG/HTML/MP4素材カードとして書き出す。
- [x] CutIn、話者、テーマ、フォント、参照音声、fixtureを既存契約に沿って書き出す。
- [x] `manifest.json` を `packageSchemaVersion: 2`、`source`（`programDocumentSha256`、`resolutionSnapshotSha256`）、`cardSchemaVersion` に対応させる。
- [x] 書き出し時と読み込み時に、`visual` 参照、カード画像、ハッシュ、スキーマ版、スパイン構造を検証する。
- [x] 同じ版からの再書き出しを新しいpackage buildとして記録する。過去のbuildは再生可能なまま残す。
- [x] テスト: v2マニフェスト、`visual` 参照、カード画像Asset、v1との区別、スパイン拒否ケース。
- 完了条件: サンプルのLive Program Versionからv2パッケージを書き出し、ハッシュ検証まで通る。

## P5. ライブ実行系

- [x] `apps/live` でv2パッケージを読み込む。
- [x] ステージの素材スロットで、ネイティブカードと既存素材カードを切り替える。
- [x] `StageState.material` を `StageState.visual` に置き換える。カードと素材を両方持つ遷移状態を作らない。
- [x] Cueの `visual` とSegment既定から実効ビジュアルを解決する。解決はサーバー側で行う。
- [x] `visual.sequence` をビジュアル変更ごとに増やし、遅れた状態で古いカードへ戻らないようにする。
- [x] カード状態の変更をキー付き差分で描画する。初回マウント・preview・再接続では完成状態を即時描画する。
- [x] カードの読み込み失敗時に中央スロットを隠し、配信を止めない。警告は重複を抑えてRun logとコンソールに残す。
- [x] プレビューはミュート・イベント非送信の既存契約を維持する。
- [x] テスト: ビジュアル解決、sequence、カード切替、差分更新、再接続時の即時描画、失敗時の継続。
- 完了条件: v2パッケージで、Cueごとにカードが切り替わり、リスト項目が順に表示される。

## P6. 起動と運用

- [x] `LiveRun` をプログラム版、package build、source（youtube / fixture）、startAt、port、status、control、logDirを持つ運用スナップショットとして追加する。
- [x] fixtureはRun作成時にRunディレクトリへコピーし、SHA-256をRunへ固定する。Program/Packageを書き換えない。
- [x] 認証情報、LLM/TTS接続先はローカルLive設定に残し、Run/Packageへ保存しない。
- [x] KakeaiからLive Program Versionを書き出し、Run IDと一回限りのcontrol tokenを指定してライブアプリをdetachedで起動する。
- [x] Live appにloopback限定のhealth/control endpointを追加し、ready、URL、状態、終了、障害を返す。
- [x] Kakeai再起動時は既存のLive appへ再接続するだけにし、Live appが死んでいた場合は自動復元・自動再生をせずRunを失敗として明示する。
- [x] `show.json` v2から `commentSource`、`test.fixture`、`startAt` を外し、Live Runの設定へ移す。
- [x] コンソールを別タブで開き、OBS用ステージURLを表示する。
- [x] 「アプリ起動」と「番組開始」を分ける。番組開始はコンソールで行う。
- [x] 停止、異常終了、PID、control URL、token参照、package build、Run logの場所を記録する。
- 完了条件: GUIから書き出しと起動を行い、コンソールで番組を開始できる。

## P7. 移行と仕上げ

- [x] Show Profile JSON、`live-profiles/auto`、`live:export --profile` を削除する。
- [x] v1パッケージの読み込みを削除する。
- [x] ユーザーガイドをLive Program中心に更新する。
- [x] 既存のコメント、CutIn、プレイアウト、TTSの仕様と矛盾がないことを確認する。
- [x] 1ファイル1責務・600行以下を守る。800行を超えるファイルを作らない。
- 完了条件: 旧Show Profileの導線がなくなり、ユーザーガイドが新しい流れに一致している。
