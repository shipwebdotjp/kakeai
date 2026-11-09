# ライブプログラム台本 TODO

[spec.md](./spec.md) を正とする。Phase順に進め、完了したらチェックを付ける。コードを変更したPhaseでは、`npm run typecheck` と `npm test` を通す。

## P0. 契約と文書

- [x] Live Program、Live Program Version、Live Format、Live Card、Live Card State の用語を整理する。
- [x] [ADR-0131](../adr/0131-live-program-owns-live-script.md)（ライブ台本をWorkから独立させる）を追加し、[ADR-0124](../adr/0124-live-cues-derived-from-script.md) をsupersedeする。
- [x] [ADR-0132](../adr/0132-live-cards-typed-state-renderer.md)（型付き状態スナップショットとライブ専用DOMレンダラー）を追加する。
- [x] `packages/contracts` にライブカード、状態スナップショット、アニメーション、パッケージv2の契約を追加する。
- [x] カード契約のテストを追加する。
- [x] `CONTEXT.md` のライブ用語を更新する。
- [x] [docs/live/spec.md](../live/spec.md) に、Show Profile入力がこの仕様で置き換わることを示す。
- 完了条件: カード型、状態参照、アニメーション、パッケージv2の契約が型とテストで固定されている。

## P1. Live Program の永続化とAPI

- [ ] `LiveFormat`、`LiveProgram`、`LiveProgramVersion` をDBに追加する。
- [ ] 台本文書のZodスキーマを `packages/contracts` に追加する。`lineId` と Script Version 参照を持たない。
- [ ] Live Format の一覧・複製・作成・更新APIを追加する。
- [ ] Live Program の一覧・作成・下書き保存・版確定・版一覧APIを追加する。
- [ ] フォーマットをプログラム作成時にコピーする。既存プログラムへの自動反映はしない。
- [ ] 版確定時に、Cue、カード、カード状態、素材、CutIn、話者、フォールバックの参照を検証する。
- [ ] 下書きと版の差分表示、版からの複製編集を追加する。
- [ ] テスト: 版の不変性、参照検証、フォーマットのコピー、下書きと版の分離。
- 完了条件: GUIなしでLive Programを作成し、版を確定し、一覧できる。

## P2. ライブカードレンダラー

- [ ] `packages/live-cards` を追加し、エディタとライブステージで共有する。
- [ ] Shadow DOMへのカードCSS注入とテーマCSS変数の継承を実装する。
- [ ] `headline`、`image`、`list`、`chart`、`quote` の描画を実装する。
- [ ] 安定IDによるキー付き差分更新を実装する。
- [ ] `enter` / `update` のCSS/WAAPIアニメーションと `prefers-reduced-motion` を実装する。
- [ ] グラフの `grow` / `draw` を実装する。
- [ ] `resolveAsset` による画像解決と読み込み失敗時の非表示を実装する。
- [ ] エディタ用のプレビューと、ライブステージ用のマウントAPIを共有する。
- [ ] テスト: 状態差分、追加・削除・更新、アニメーションのライフサイクル、Shadow DOMのCSS隔離。
- 完了条件: 5型のカードを状態遷移させながらプレビューでき、同じレンダラーをステージでも使える。

## P3. Live Program エディタGUI

- [ ] プログラム一覧、フォーマット選択、作成ウィザードを追加する。
- [ ] スパイン中心のセグメント編集を追加する。動画のタイムラインにはしない。
- [ ] Cue一覧とCue編集（話者、字幕、読み上げ、表情、カード状態、素材）を追加する。
- [ ] カード一覧とカード型ごとの状態エディタを追加する。
- [ ] リストの項目表示・アクティブ項目、グラフの値・強調をCueごとに編集できるようにする。
- [ ] 版確定、版一覧、版からの複製編集を追加する。
- [ ] プレビューを `packages/live-cards` で描画する。
- [ ] フォーマットを編集しても既存プログラムに反映されないことをUIで明示する。
- [ ] テスト: エディタの状態モデル、参照検証、版確定。
- 完了条件: GUIで1本のライブ台本を作成し、版を確定できる。

## P4. パッケージv2の書き出し

- [ ] `live_export` の入力に `programVersionId` を追加する。Work / Script Version / Show Profile は使わない。
- [ ] 台本のCueから字幕・読み上げ・話者・音声を解決する。TTS準備は既存パイプラインを再利用する。
- [ ] ネイティブカードを `show.json` の `cards[]` に、画像を `cardAssets[]` と `kind: "card-asset"` に書き出す。
- [ ] 取り込んだLive Materialを既存のPNG/HTML/MP4素材カードとして書き出す。
- [ ] CutIn、話者、テーマ、フォント、参照音声、fixtureを既存契約に沿って書き出す。
- [ ] `manifest.json` を `packageSchemaVersion: 2`、`source`、`cardSchemaVersion` に対応させる。
- [ ] 書き出し時と読み込み時に、カード参照、カード画像、ハッシュ、スキーマ版を検証する。
- [ ] テスト: v2マニフェスト、カード参照、カード画像Asset、v1との区別、拒否ケース。
- 完了条件: サンプルのLive Program Versionからv2パッケージを書き出し、ハッシュ検証まで通る。

## P5. ライブ実行系

- [ ] `apps/live` でv2パッケージを読み込む。
- [ ] ステージの素材スロットで、ネイティブカードと既存素材カードを切り替える。
- [ ] Cueの `cardRef` とSegment既定から実効カード状態を解決する。
- [ ] カード状態の変更をキー付き差分で描画する。
- [ ] カードの読み込み失敗時に中央スロットを隠し、配信を止めない。
- [ ] プレビューはミュート・イベント非送信の既存契約を維持する。
- [ ] テスト: カード状態の解決、カード切替、差分更新、失敗時の継続。
- 完了条件: v2パッケージで、Cueごとにカードが切り替わり、リスト項目が順に表示される。

## P6. 起動と運用

- [ ] KakeaiからLive Program Versionを書き出し、ライブアプリをdetachedで起動する。
- [ ] `LiveRun` にプログラム版、パッケージ、ポート、状態、ログを記録する。
- [ ] コンソールを別タブで開き、OBS用ステージURLを表示する。
- [ ] 「アプリ起動」と「番組開始」を分ける。番組開始はコンソールで行う。
- [ ] 停止、異常終了、Kakeai再起動時の状態復元を扱う。
- 完了条件: GUIから書き出しと起動を行い、コンソールで番組を開始できる。

## P7. 移行と仕上げ

- [ ] Show Profile JSON、`live-profiles/auto`、`live:export --profile` を削除またはインポータへ置き換える。
- [ ] v1パッケージの読み込みを移行期間後に削除する。
- [ ] ユーザーガイドをLive Program中心に更新する。
- [ ] 既存のコメント、CutIn、プレイアウト、TTSの仕様と矛盾がないことを確認する。
- [ ] 1ファイル1責務・600行以下を守る。800行を超えるファイルを作らない。
- 完了条件: 旧Show Profileの導線がなくなり、ユーザーガイドが新しい流れに一致している。
