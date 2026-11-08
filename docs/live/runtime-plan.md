# ライブ実行アプリ実装計画（P2〜P5）

[spec.md](./spec.md) を正とし、P2〜P5を実装するための内部構成と、実装中に確定した判断を記録する。仕様と矛盾する場合は仕様を優先する。

## モジュール構成

```text
packages/contracts/src/live/
  server.ts          サーバ・ステージ・コンソール間のメッセージ契約

packages/tts/        TTSアダプタ（Voicevox互換、OpenAI互換、エラー型）

apps/live/
  src/
    bin.ts           起動CLI（live / live auth）
    config.ts        ローカル設定の読み込みと既定値
    package/         パッケージ検証と読み込み
    runtime/         ショー時計、リース、キュー、プレイアウト、コントローラ
    comments/        コメントソース、前処理、分析、選択ポリシー
    director/        LLM接続、プロンプト、生成と安全フィルター
    runs/            実行ディレクトリとJSONLログ
    server/          Express、WebSocket、Host/Origin検証
    testing/         テスト用のパッケージ・音声・LLM・TTSフィクスチャ
  web/
    stage/           フレームワーク非依存のステージ（1920x1080）
    console/         React製オペレーターコンソール
```

`apps/live` は `@kakeai/contracts` と `@kakeai/tts` だけに依存する。Kakeai APIのDB・サービスには依存しない。

## コメントソースと分析役

- `comments/source.ts` の `CommentSource` が YouTube と fixture の境界。`comments/factory.ts` が `--test`/`commentSource.kind` と `llm.mode` を検証し、実 YouTube は fixture を読まない。
- 前処理は `comments/filter.ts`、分析役は `llm/comment-analyst.ts`。実 YouTube は `createCommentAnalyst` がローカル LLM 以外を拒否し、プロンプトには commentId と本文だけを渡す（投稿者名は渡さない）。
- YouTube認証は `auth/youtube-auth.ts` の `YouTubeAuthProvider`。`youtube.apiKey` があればAPIキーを第一候補にし、OAuth設定とトークンがある場合だけ401/403の認証系エラーで同じリクエストを1回再試行する。
- OAuthは `auth/oauth.ts` と `auth/youtube-token.ts`。読み取り専用スコープだけを要求し、トークンは `dataDir/auth/youtube.json` に 0600 で保存、`invalid_grant` は `needsReauth` として status に出す。OAuthのみの設定も従来どおり動く。
- `comments/youtube-http.ts` が認証付きGETと認証エラー判定を持ち、`comments/youtube-source.ts` はポーリング・pageToken・バックオフ・クォータ・端末エラーに専念する。クォータは再試行を含む実リクエストごとに数える。

## コメントコーナーの実行境界

- `runtime/comment-corner.ts` が受信コメントのメモリ保持、`CommentFilter` と `CommentAnalyst` の呼び出し、選択、現在カード、コーナー状態を持つ。生コメント本文と投稿者名はログに書かず、`comments.jsonl` は投稿ID・redactedText・decision/reasons・score 程度に限る。
- 選択は `comments/selection.ts` の純粋関数に閉じる。人間ピン → AI候補の順、`maxExtraSlots` までの延長、`safety: block` の不可、`safety: review` はピン時だけ許可、鮮度はAI候補だけに適用する。
- コーナー開始時は鮮度内の accepted/review をバッチで分析役へ渡す。分析失敗時は空候補で続行し、ピンだけ `redactedText` から保守的な候補を作ってコーナーを成立させる。0件なら `corner_empty` を記録してスパインへ戻る。
- カード表示は `runtime/comment-responder.ts` の `CommentCornerResponder` 境界に分離する。P4 は `HoldCommentCornerResponder` が `cornerHoldMs`（既定4000ms）だけカードを表示する。P5 は同じ境界に生成レス＋TTSの responder を差し込み、選択・スパイン遷移・ピンの消費規則を変えない。
- コントローラは `comments.startCorner(segment)` を呼び、終了時は `finishCorner` から `spine.handleQueueFinished()` に戻る。`pause`/`resume`/`stop`/`safe_mode`/`end`/`skip_cue` はコントローラからコーナーへ伝播し、`safe_mode` はコーナーを終了して以後の `comment` セグメントも飛ばす。
- ステージは `StageState.comment` の `text` に `safeSummary`（または redactedText）だけを受け取る。生コメントはコンソールの人間だけが見る。

## 生成レスの先読みと退避

- コーナー開始時に選択済み候補のLLM生成とTTSを並行開始し、候補ごとに `gen-<commentId>-<index>` のキューを作る。LLMは最大2、TTSは `maxConcurrentTts` の共有セマフォに従う。
- `maxThinkingMs` 以内に ready にならない、LLM/TTSが失敗する、または再生待ちがタイムアウトした場合は、そのコーナーで1回だけ退避キューを再生して次の候補へ進む。
- 生成状態（thinking/preparing/ready/failed）はコンソールの `snapshot.generation` に出し、コーナー終了・`stop`・`safe_mode`・`end`・`post_show` で null に戻す。
- コメント応答のキュー再生中は `queue_finished` でスパインを進めず、応答キューが完了してからコーナーを終える。訂正キューは現在の直後、現在が無ければ応答キューとして再生する。
- コンソールの生成UIは `web/console/GenerationPanel.tsx`。`snapshot.generation` と生成キュー（generated/manual/fallback）を表示し、編集・キャンセル・再生成・削除・並べ替え・訂正を既存のコマンドで送る。コマンド結果は既存の notice 経路で表示する。
- 30分版の通しは `apps/live/src/runtime/p5-flow.test.ts` で、複数コメントコーナー、人間ピン優先、AI補充、TTS失敗時の退避、台本の継続、生成・編集・削除ログ、生コメント非保存を確認する。

## 通信契約

- HTTP: `/stage`、`/console`、`/package/*`、`/run/generated/*`、`/healthz`。
- WebSocket: `/ws?role=stage` と `/ws?role=console`。
- サーバからステージへ: `hello`、`state`、`preload`、`notice`、`lease`。
- サーバからコンソールへ: `hello`、`snapshot`、`event`、`notice`。
- ステージからサーバへ: `stage_event`（`StageEvent`）。
- コンソールからサーバへ: `command`（開始・終了・停止・再開・安全モード・program引き継ぎ・ピン等）。

サーバは接続時に最新状態を送る。programステージは実行中の再生位置を`playback.startedAt`から計算してシークする。previewはミュートし、`stage_event`を送らない（送られても無視する）。

- `/stage?preview=1` は `/ws?role=stage&preview=1` で明示的にpreviewを要求する。programが不在でもpreviewになり、programには昇格しない。通常の `/stage` は従来どおり最初の接続がprogramを取る。
- previewは`stage_event`を送らない。previewのリースはWebSocketのpongでサーバが更新し、コンソールの接続一覧から消えないようにする。
- 明示的なprogram引き継ぎやリース失効でロールが変わったとき、サーバは対象ステージへ `lease` を送る。ステージは再生を止めずにミュート状態だけを切り替える。
- ステージが読む音声URLはパッケージ相対パスを `/package/<path>` で解決する。生成音声は `run:generated/<file>.wav|mp3` と表し、現在の実行ディレクトリの `/run/generated/<file>` として配信する。`run:` は予約 prefix で、パッケージ相対パスとしては扱わない。
- 生成音声は `runs/<runId>/generated/` にだけ書き、`..`・絶対パス・シンボリックリンク・generated 外は配信しない。`Cache-Control: no-store` を付ける。

## 状態の所有者

- `LiveController` が唯一の状態所有者。フェーズ、セグメント、キュー、再生試行、リース、コメントコーナーを持つ。
- ステージは`StageState`を描画し、programだけが音声を再生する。
- `attempt`は再生試行ごとに増やし、`sequence`はサーバが送る再生指示ごとに増やす。`StagePlayback`に`sequence`を含め、ステージは受け取った値をそのまま`audio_ended`/`audio_error`に返す。サーバは現在の`cueId`・`attempt`・`sequence`に完全一致しないイベントを無視する。
- プレイアウトはタイマーではなくprogramステージの音声イベントで進む。タイマーは`attempt`単位のウォッチドッグと`maxThinkingMs`の待機にだけ使う。
- ウォッチドッグは`attempt`単位で、音声尺＋余裕で動く。古い試行のタイムアウトは現在の状態を進めない。

## フェーズと進行

- `pre_show` で開始操作を待つ。`start`でショー時計を開始し、先頭セグメントのキューを流す。
- セグメント種別とフェーズの対応は `opening`→`opening`、`script`→`script`（素材があれば`material`）、`comment`→`comment`、`closing`→`closing`。
- キューが尽きたら次のセグメントへ進む。スパインが尽きたら`post_show`。
- `pause`は現在のattemptを保持し、再開時に同じattemptの先頭から再生する。`stop`は生成キューを消し、準備済みキューを保持して`paused`へ移る。
- `safe_mode`は生成レスとコメントコーナーを止め、準備済みキューだけを流す。
- `end`は現在のキューを終えてから`closing`へ移る。残り時間が`closingReserveMs`未満なら新しいコメントコーナーを開始しない。
- `pre_show`/`post_show`はステージの状態であり、ページを切り替えない。

## パッケージローダー

- `manifest.json`、`show.json`、`characters.json`、`theme.css`をZodで検証する。
- パッケージ内の全ファイルを列挙し、`manifest.json`以外の過不足、シンボリックリンク、SHA-256、byteSize、拡張子とmediaTypeの一致を検証する。
- `show.json`が参照する音声・素材・キャラクター画像・顔レイヤー・参照音声がmanifestに存在することを検証する。
- 素材カードは`kind: material`かつ`hasAudio: false`を必須とする。MP4は`audio`トラックの混入をmanifestの`hasAudio`と、起動時の尺・種別で扱う。
- フォントは`required && !found`だけ停止し、それ以外の不足は警告にする。
- パスは常にパッケージルートからの解決結果がルート内に収まることを確認する。

## 設定

- `--config <file>` のJSONは`LiveRuntimeConfig`に従う。省略時は既定値を使う。
- `--port`、`--package`、`--test`、`KAKEAI_LIVE_DATA_DIR`で上書きする。
- 実YouTubeのコメントソースを使うときは`llm.mode`が`local`でなければ起動を拒否する。ディレクターも同じ境界を通し、fixtureでは`local`/`external`の両方を許す。
- 生成レスTTSは`tts.timeoutMs`（既定20000）で打ち切り、`tts.maxConcurrentTts`（既定2）の共有セマフォで同時実行を制限する。接続先はループバックのローカルTTSだけを許す。
- ディレクターの出力はZod検証に加え、禁止話題・最大文字数・最大キュー数・URL/HTML/Markdownリンク・個人情報・強い断定を安全フィルターで検査する。不正は1回だけ再生成し、タイムアウトは再試行しない。
- 生成音声・ログ・トークンは`dataDir`配下にだけ書く。パッケージは読み取り専用とする。

## テスト方針

- パッケージローダー、リース、キュー進行、イベント冪等化、タイムアウト、コメント選択、ディレクター検証は純粋な入力と偽の時計でテストする。
- HTTP/WebSocketは実サーバをループバックで起動し、本物のクライアントで接続する。
- TTS・LLM・YouTube APIはテスト用のローカルHTTPサーバに差し替える。
- 10分版のサンプルに相当する小さなテストパッケージをテスト内で生成し、実パッケージの書き出しには依存しない。
