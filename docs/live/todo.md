# ライブ配信 TODO

> **Status: legacy input.** ライブ台本は [ADR-0131](../adr/0131-live-program-owns-live-script.md) で Live Program へ移行する。新しい台本・カード・パッケージv2の作業は [../live-program/todo.md](../live-program/todo.md) を正とする。このファイルは、ステージ、プレイアウト、コメント、CutIn、TTSの既存実装の履歴として残す。

[spec.md](./spec.md) を正とする。Phase順に進め、完了したらチェックを付ける。コードを変更したPhaseでは、`npm run typecheck` と `npm test` を通す。

## P0. 文書・ADR・契約の骨格

- [x] `docs/live/spec.md`、`docs/live/todo.md`、`docs/live/roadmap.md` を追加する。
- [x] [ADR-0120](../adr/0120-live-runtime-separate-from-composition.md)（ライブはコンポジションと別の状態駆動ランタイム）を追加する。
- [x] [ADR-0121](../adr/0121-youtube-read-only-comment-source.md)（YouTubeは読み取り専用、コメントソースを差し替え）を追加する。
- [x] [ADR-0122](../adr/0122-live-comment-corner-human-pin.md)（コメントコーナー、人間ピン優先、承認遅延なし）を追加する。
- [x] `CONTEXT.md` にライブ用語を追加する。
- [x] `docs/mvp/spec.md` からライブ仕様への境界リンクを追加する。
- 完了条件: 文書のみの変更であり、型検査・テストは不要。

## P0.5. レビュー指摘の契約固め

### 決定

- [x] 実YouTubeはローカルLLMのみとする（[ADR-0123](../adr/0123-live-youtube-local-llm-only.md)）。
- [x] 実YouTubeは`llm.mode=local`を強制し、fixtureテストだけ外部LLMを許可する方針を決める。
- [x] YouTube APIデータの保持期間、`live purge`、OAuth失効時の消去、ユーザーガイドの記載方針を決める。
- [x] 台本の正本を1つにする。`scriptCues`（`lineId`参照）と`liveCues`（ライブ専用）に分け、通常キューはScriptVersionから導出する（[ADR-0124](../adr/0124-live-cues-derived-from-script.md)）。
- [x] 再生の所有者を1つにする。programステージのリース、previewのミュート・イベント非送信、`runId`/`sessionId`/`cueId`/`attempt`/`sequence`の冪等化を契約にする（[ADR-0125](../adr/0125-live-program-playback-lease.md)）。
- [x] 素材カードを静止PNG/HTMLまたは短い無音MP4に限定し、Asset Resolverでパッケージ相対URLを生成する。カードの無音を検証する（[ADR-0126](../adr/0126-live-material-cards-static-or-mp4.md)）。
- [x] TTSの参照音声をパッケージに含め、接続設定はライブ側に分離する。書き出し時にテスト合成する（[ADR-0127](../adr/0127-live-tts-voice-snapshot-boundary.md)）。
- [x] v1は`list`ポーリングを正規経路とし、`pollingIntervalMillis`を既定にして5秒固定をやめる。`streamList`はスパイク後に判断する（[ADR-0128](../adr/0128-live-comment-polling-primary.md)）。
- [x] 状態遷移表、`minBufferMs`/`maxThinkingMs`/退避キュー、manifestのハッシュ・メディア検証、`live_export` Job、OAuth方針を決める。
- 完了条件: レビューの1〜6のブロッカーを仕様・契約に反映し、P1のスキーマを確定した。P1に進める。

### P0.5b スパイク

- [ ] `streamList`がNode/RESTまたはgRPCから実用的に使えるかを確認する。使えない場合はlistポーリングを継続する。
- [ ] TTSの参照音声をパッケージに含め、短いテスト合成が通ることを確認する。
- [ ] 静止PNG・静的HTML・短い無音MP4の素材カードを書き出し、`img`/`video`/スクリプトなしsandbox iframeで表示できることを確認する。
- [ ] manifestのハッシュ・mediaType・無音フラグ・フォント診断を検証できることを確認する。
- 完了条件: スパイク結果をP1/P4の実装に反映する。失敗してもlistポーリング/静止カードに退避できる。

## P1. ライブ契約とパッケージ書き出し

実装の詳細、作業順、テスト、確認事項は [p1-plan.md](./p1-plan.md) を参照する。

実装済み（2026-11-07）。統合テストのサンプルWorkで、Job作成・Worker・manifest検証・CLIポーリングまで確認した。P0.5bの実環境スパイク（実TTS参照音声、Chrome/Producerでのカード書き出し）は未実施のため、実配信前のP6で確認する。

- [x] `packages/contracts` にライブ用スキーマを追加し、次のZodスキーマと型を定義する。
  - [x] `LivePackageManifest`（packageSchemaVersion、exporterVersion、packageId、source、files、fonts、voices、createdAt）
  - [x] `LiveShowProfile`（commentSource、show、segments、scriptCues、liveCues、materials、commentPolicy、safety、playout、test）
  - [x] `LivePackageShow`（解決済みの`PreparedCue`、素材カード、キャラクター、コメントポリシー）
  - [x] `PreparedCue`（origin、sourceLineId?、speaker、caption、speech、expression、audio）
  - [x] `LiveCue`（PreparedCue + source（prepared/generated/manual/fallback）、status、commentId?）
  - [x] `StageLease`（leaseId、runId、sessionId、role、expiresAt）
  - [x] `StageState`（phase、segment、characters、caption、material、comment、status、playback、clock）
  - [x] `StageEvent`（runId、sessionId、cueId、attempt、sequence、種別）
  - [x] `MaterialCard`（id、kind、file、hasAudio、focus）
  - [x] `CommentEvent`、`CommentCandidate`（safeSummary/safeQuestion）、`CommentAnalysis`
  - [x] `DirectorOutput`（cues、skip）
  - [x] `LiveRuntimeConfig`（llm.mode、tts.adapters、port、dataDir）
  - [x] `RunLogEvent`（フェーズ遷移、ピン、選択、生成、編集、削除、スキップ、停止、エラー）
- [x] Kakeai側に `live_export` JobとAPIを追加し、`live:export` CLIをAPIクライアントにする。
  - [x] `POST /api/v1/live-exports` でJobを作成し、CLIはJobをポーリングする。
  - [x] `--work`、`--script-version`、`--profile`、`--out` を受け取る。
  - [x] ScriptVersion、Theme Revision、Character、Appearance、Face Set、Voice Profile、Assetを解決する。
  - [x] `theme.css`、`characters.json`、`show.json`、`manifest.json` を出力する。
  - [x] `scriptCues`の`lineId`から字幕・読み上げ・話者・音声を解決し、`sourceLineId`付きの`PreparedCue`を出力する。
  - [x] `liveCues`はライブ専用キューとして解決し、`origin: "live"`を付ける。
  - [x] `media/` にキャラクター画像・顔レイヤー・素材カードのAsset・参照音声をコピーする。
  - [x] 素材カードを単一Sceneから静止PNG、静的HTML、または短い無音MP4として `materials/` に書き出す。nested Compositionと動画ゲートはv1では拒否する。Asset URLはAsset Resolverで相対化する。
  - [x] 準備済みキューの音声を `audio/prepared/` に出力する。既存Audio Takeを優先し、なければTTSする。
  - [x] 参照音声を使うVoice Profileの参照音声を `media/voice/` にコピーし、manifestに記録する。
  - [x] 各Voice Profileで短いテスト合成を行い、失敗したら書き出しを失敗させる。
  - [x] `manifest.json` に全ファイルのSHA-256・byteSize・mediaType・種別・尺・寸法・無音フラグ、フォント診断、エクスポーター版を記録する。
  - [x] `fixtures/comments.json` を出力する。
  - [x] パッケージ内に絶対パス・シンボリックリンクを残さない。
  - [x] DBを変更しない。
  - [x] `live_export` Jobの追加に伴い、`docs/mvp/spec.md` のJob種別と `docs/mvp/api-contract.md` を更新する。
- [x] サンプルのShow Profileとfixtureを追加する（10分版と30分版）。
- [x] `AGENTS.md` のコマンドに `npm run live:export` を追加する。
- [x] テスト: スキーマ検証、未知schemaVersionの拒否、`scriptCues`のlineId検証、マニフェストのハッシュ・メディア・フォント検証、相対URL、静止PNG/HTML/MP4の無音、静的HTMLのスクリプトなし、参照音声の存在、TTSテスト合成、DB非更新。
- 完了条件: サンプルWorkからライブパッケージを書き出し、manifest検証とステージ用の静止カード・音声を確認できる。

## P1.5. Show Profile の自動生成

最初の1本を手書きせずに始めるため、Work と ScriptVersion から Show Profile の下書きを生成する。詳細は [spec.md](./spec.md) の「Show Profile の自動生成」を正とする。

- [x] `POST /api/v1/live-profiles/auto` を追加し、WorkとScriptVersionからプロファイルを生成する。
- [x] 生成規則（intro / point / insert / outro、コメントコーナー、素材、placeholder、警告）を実装する。
- [x] CLI に `--auto-profile`、`--save-profile`、`--title`、`--no-comments`、`--dry-run`、`--force` を追加する。
- [x] API・生成・CLI のテストを追加する。
- [x] `docs/mvp/api-contract.md` とユーザーガイドを更新する。
- 完了条件: サンプルWorkから `--auto-profile` でプロファイルを生成し、保存して書き出せる。生成内容の summary と warnings を確認できる。

## P2. ライブアプリの骨格

- [x] `apps/live` を同一モノレポに追加する。ワークスペース設定、typecheck、テスト設定に加える。
- [x] `AGENTS.md` のコマンドに `npm run live` を追加する。
- [x] パッケージローダー: `manifest.json` と `show.json` を検証し、相対パスの脱出、ファイル欠落、SHA-256不一致、未対応mediaType、カードの音声混入、フォント不足を扱う。
- [x] 起動CLI: `npm run live -- --package <dir> [--test] [--port <port>] [--config <file>]`。Kakeaiの起動を要求しない。
- [x] ローカルサーバー: `/stage`、`/console`、パッケージ配信、`/ws`（stage/console）、Host/Origin検証。
- [x] 再生リース: `StageLease`を発行し、programは1つだけ、previewはミュート・イベント非送信にする。
- [x] 実行ディレクトリ `runs/<runId>/` とJSONLログの基盤。
- [x] ステージ: 1920x1080固定キャンバス、テーマCSS、`pre_show` / `post_show`、プレースホルダーのキャラクター・字幕・素材・コメント。
- [x] コンソール: 開始・終了、フェーズ表示、経過時間、ステージ接続状態、program/previewの区別、基本操作。
- [x] ステージ再接続: サーバが最新状態を送る。programの引き継ぎは明示操作にする。音声位置の復元はP3で実装する。
- [x] テスト: パッケージ検証、パストラバーサル拒否、manifestハッシュ、program/previewリース、previewのイベント非送信、フェーズ遷移、pre/post、WebSocket再接続。
- [x] 完了条件: サンプルパッケージでアプリを起動し、`pre_show`→開始→プレースホルダーのキュー→`post_show`まで動く。テスト用パッケージでHTTP/WS起動、programリース、開始・一時停止・再開・post_showを確認した。

## P3. プレイアウトとステージ描画

- [x] TTSアダプタ実装を `packages/tts` へ切り出し、`apps/api` と `apps/live` から使えるようにする。既存のTTS Jobの挙動を変えない。
- [x] プレイアウト: キュー状態（draft/preparing/ready/playing/done/skipped/failed）、`attempt`/`sequence`、先読み、`minBufferMs`、`maxThinkingMs`、退避キュー、`audio_ended`、ウォッチドッグ、音声エラー時のスキップ、一時停止・再開・停止フェード。サーバ側は完了（音声のフェードアウトはステージ側）。生成失敗時の退避キューの再生はP5で完成し、P5の30分通しで確認した。
- [x] ステージ: programだけが`<audio>`を再生する。previewはミュート・イベント非送信。次キュー音声のプリロード、`stage_ready`、`audio_ended`、`audio_error`、再接続時のシーク/再開。
  - [x] `/stage?preview=1` を明示previewとして接続する。programが不在でもpreviewになり、programにはならない。通常の `/stage` は最初の接続がprogramになる。
- [x] キャラクター描画: 外観画像、顔レイヤー、表情プリセット、瞬き、口パク、話者バウンド、左右の立ち位置。
- [x] 字幕: テーマのcaptionロール、話者名タブ、折返し、最大行数、フェード。
- [x] 素材カード: `img`/`video`/スクリプトなしsandbox iframeで静止PNG・無音MP4・静的HTMLを中央スロットに縮小、読み込み失敗時の非表示、フォーカス状態。無音を検証する。
- [x] セグメントラベル、`idle`/`thinking`/`speaking`の状態表現と`paused`フェーズ。
- [x] 状態遷移表の実装: `stop`/`pause`/`safe_mode`/`end`/`closingReserveMs`/`pin_overflow`。
  - [x] `stop`/`pause`/`safe_mode`/`end`/`closingReserveMs` をサーバ側に実装する。
  - [x] `pin_overflow` をP4のピン選択と合わせて実装する。
- [x] コンソール: 現在のキュー、キュー一覧、スキップ、一時停止、停止、安全モード、program/previewプレビュー。
- [x] テスト: キューの進行、`audio_ended`の重複・古い`attempt`の無視、タイムアウト、バッファ不足時の退避、音声エラー、停止フェード、再接続、状態遷移、previewのミュート。生成失敗時の退避キューの再生はP5で実装し、P5の30分通し（`p5-flow.test.ts`）で確認した。
- [x] 完了条件: 10分版の準備済みキューが音声途切れなく流れ、キャラクター・字幕・素材カードが切り替わる。手動で停止・再開できる。テスト用の10分設定パッケージで、音声イベントによるキュー進行、字幕・素材の切替、停止・再開、再起動後の状態復元を確認した。実パッケージの通しはP6で行う。

## P4. コメントソースとコメントコーナー

- [x] `CommentSource` 境界と `FixtureCommentSource` を実装する。`atMs`、速度、停止、リセットを持つ。
- [x] `YouTubeCommentSource` を実装する。
  - [x] ライブURL/動画IDから `liveChatId` を解決する。手動入力も許す。
  - [x] `liveChatMessages.list` のポーリングを正規経路にする。`pollingIntervalMillis`を既定にし、5秒固定にしない。設定で長くできる。
  - [ ] P0.5で`liveChatMessages.streamList`のスパイクを行い、実装が軽く安定する場合だけ将来の改善として追加する。gRPCの正式依存は別ADRとする。
  - [x] `nextPageToken`を扱い、クォータの概算をstatusに載せる。
  - [x] OAuthは `youtube.readonly` のみ。書き込みAPIを呼ばない。`live auth`再認証と7日失効の表示（OAuthフォールバックを使う場合）。
  - [x] クォータ・認証・接続エラーをコンソールに表示する。
- [x] ルールベースのコメント前処理（NG、URL、個人情報、スパム、連投、長文）を実装する。
- [x] コメント分析役（LLM）を実装する。バッチ入力、`score`/`safety`/`relevance`/`isQuestion`/`reason`/`suggestedAngle`/`safeSummary`/`safeQuestion`/`safeQuote`/`piiRedacted`/`urlsRemoved`の構造化出力、Zod検証、1回再試行。実YouTubeはローカルLLMのみ、fixtureテストは外部LLM可。
- [x] コメントコーナーの選択ポリシーを実装する。
  - [x] 人間ピンを確定枠として先に使う。
  - [x] AI候補で残り枠を埋める。
  - [x] ピンが枠を超えた場合の延長・次コーナー送り。
  - [x] コメント0件でスキップ、1〜2件で短縮。
  - [x] 安全ブロックは人間でも解除できない。
  - [x] 即時割り込みはしない。ピンは次のコーナーへ。
- [x] コンソール: コメント一覧、鮮度、フィルター状態、AIスコア・理由、ピン/解除、スキップ、コメント一時停止、投稿者・話題ブロック。
- [x] テスト: fixtureの時刻、空・急増・危険コメント、`pollingIntervalMillis`、`pageToken`、読み取り専用（書き込み呼び出しがないこと）、実YouTube経路で外部LLM未使用、`safeSummary`、選択ポリシー、0件スキップ、コメントコーナーの統合。`streamList`スパイク（任意）は未実施。
- [ ] 完了条件: fixtureの10分版でコメントコーナーが動き、人間ピンがAI候補より優先され、コメント0件でスキップする。実YouTubeの読み取りを手動で確認できる。
  - fixtureの統合テストは実施済み。実YouTubeの読み取りはP6の受け入れ時に手動確認する（未実施）。

## P5. ディレクターと生成レス

P5a（ディレクター生成、安全フィルター、生成レスTTS基盤、生成音声の配信契約）は実装済み。P5bのバックエンド（生成レスをコメントコーナーとプレイアウトへ接続、退避キュー、訂正、編集・再生成・削除のコマンド）も実装済み。P5b2でコンソールの生成UIと30分通しの最終確認まで実装した（2026-11-08）。

- [x] ショー時計とセグメント予算を実装する。経過時間、残り時間、目標尺をディレクターへ渡す。
- [x] ディレクターのループを実装する。準備済みキューは固定、コメント応答だけLLMで生成する。入力は`safeSummary`/`safeQuestion`だけとし、生コメントを渡さない。
  - [x] `DirectorContext`とプロンプトを実装し、生コメント本文・投稿者名・authorを渡さない。
- [x] LLM接続（OpenAI互換。実YouTubeはローカル固定、fixtureはローカル/外部可）と、`DirectorOutput`のZod検証、1回再試行、失敗時スキップ。
- [x] 安全フィルター: 禁止話題、最大文字数、最大キュー数、ペルソナ、実在人物・断定・個人情報の扱い。
- [x] 生成レスのTTSとキュー投入。`llmTimeoutMs`・`ttsTimeoutMs`・`maxConcurrentTts`・`minBufferMs`・`maxThinkingMs`を守り、間に合わなければ退避キューへ切り替える。
  - [x] 生成レスTTS（タイムアウト、同時実行セマフォ、参照音声、WAV/MP3の尺）と、`run:generated/...` の生成音声配信を実装する。
- [x] コンソール: 生成中の字幕・読み上げ・表情の表示、編集、キャンセル、再生成、準備完了後・再生開始前のキューの削除・並べ替え、再生中の停止・訂正。`GenerationPanel`で`snapshot.generation`と生成キューを表示し、`edit_cue`・`cancel_cue`・`regenerate_cue`・`delete_cue`・`move_cue`・`play_correction`を送る。訂正は現在のキューを止めず直後に差し込む。
- [x] 退避キュー、安全モード、訂正キュー、連続失敗時の通知。バックエンドに加え、`GenerationPanel`で退避・訂正を含む生成キューと失敗状態を表示する。
- [x] テスト: 正常出力、不正出力の再試行とスキップ、タイムアウト、禁止話題、長すぎる出力、プロンプトインジェクションfixture、TTS失敗、遅いローカルLLM/TTSでバッファと退避が働くこと、実YouTube経路で外部LLMが呼ばれないこと。30分版の通しは`p5-flow.test.ts`で、複数コメントコーナー、人間ピン優先、AI補充、TTS失敗時の退避、編集・削除ログ、生コメント非保存を確認した。
- [x] 完了条件: 30分版のfixtureで、人間ピン＋AI補充のコメント応答が流れ、生成失敗でも台本が止まらない。ログに生成・編集・削除が残る。
  - `p5-flow.test.ts`で30分相当（`targetDurationMs: 1,800,000`）、opening→script→comment→script→comment→closingの通しを確認した。

## P6. 本番YouTubeと運用

- [ ] 実際のYouTubeライブで、`liveChatMessages.list`のポーリングを正規経路として実行する。P0.5の`streamList`スパイク結果を反映し、実用化できる場合だけ追加する。
- [ ] 実YouTubeのコメント分析・応答生成がローカルLLMだけで動き、外部LLMが呼ばれないことを確認する。
- [x] YouTubeコメント取得をAPIキー優先・OAuthフォールバックにする。`youtube.apiKey`だけで起動でき、認証系エラー時だけOAuth設定とトークンがある場合に1回再試行する（[ADR-0129](../adr/0129-youtube-api-key-first-auth.md)）。
- [x] OAuth フォールバックの設定手順（Google Cloudプロジェクト、OAuthクライアント、`youtube.readonly`、リフレッシュトークン保存、`live auth`再認証、Testingの7日失効、公開・検証の判断）を整備する。`user-guide/docs/live/setup.md` に記載した。
- [x] OBSの設定手順（ブラウザソース、1920x1080、音声経路、ステージURL、コンソールを出さない）を整備する。`user-guide/docs/live/obs.md` に記載した。
- [ ] `pre_show` のカウントダウン、`post_show` のお礼・次回予告を仕上げる。
- [x] ユーザーガイド `user-guide/docs/live/` を追加し、サイドバーに載せる（セットアップ、書き出し、テストモード、OBS、当日の操作、トラブル時）。`index`・`export`・`setup`・`test-mode`・`obs`・`operations`・`troubleshooting` を追加し、サイドバーと目次に載せた。
- [x] READMEは概要のままにし、ユーザーガイドへのリンクだけを確認する。README の「使い方」から `https://kakeai.shipweb.jp` へリンクされていることを確認した。
- [ ] 30分の非公開YouTubeライブで受け入れテストを行う。読み取り専用、配信操作とチャット投稿は人間が行う。
- [ ] テスト: 10分版の通し、実YouTubeの読み取り（ローカルLLMのみ）、YouTube切断、TTS停止、LLMタイムアウト、ステージリロード。実YouTubeの経路で外部LLMが呼ばれないことを確認する。
- 完了条件: 30分の非公開ライブで、音声途切れ、コメントコーナー、人間ピン、生成レス、開幕・終了画面、ログが確認できる。

## P7. CutIn（区切り動画）

実装の詳細、作業順、テストは [../live-media-playout/todo.md](../live-media-playout/todo.md) を参照する。CutInは素材カードの拡張ではなく、Spine専用の `cut_in` セグメントとする（[ADR-0130](../adr/0130-live-cut-in-separate-from-cues-and-materials.md)）。

- [ ] `docs/live-media-playout/` のP1〜P6を完了する。
- [ ] 素材カードの無音検証を維持したまま、CutInの `hasAudio: true` を別種別として許可する。
- 完了条件: CutInを使うパッケージを書き出し、OBSのprogramステージで音声あり／なしの全画面再生ができ、失敗しても配信が止まらない。

## P8. 仕上げ

- [ ] 新規ファイルを1ファイル1責務・600行以下に保つ。800行を超えるファイルを作らない。
- [ ] パッケージ書き出しのエラーメッセージと、コンソールの障害表示を整理する。
- [ ] 実行ディレクトリの容量と生成音声の後片付けを確認する。
- [ ] ロードマップの項目を、必要になった時点で個別に仕様化する。
- 完了条件: 受け入れ条件を満たし、既知の制約がユーザーガイドに記載されている。
