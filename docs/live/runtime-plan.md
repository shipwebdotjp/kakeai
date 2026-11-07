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
- OAuth は `auth/oauth.ts` と `auth/youtube-token.ts`。読み取り専用スコープだけを要求し、トークンは `dataDir/auth/youtube.json` に 0600 で保存、`invalid_grant` は `needsReauth` として status に出す。

## 通信契約

- HTTP: `/stage`、`/console`、`/package/*`、`/healthz`。
- WebSocket: `/ws?role=stage` と `/ws?role=console`。
- サーバからステージへ: `hello`、`state`、`preload`、`notice`、`lease`。
- サーバからコンソールへ: `hello`、`snapshot`、`event`、`notice`。
- ステージからサーバへ: `stage_event`（`StageEvent`）。
- コンソールからサーバへ: `command`（開始・終了・停止・再開・安全モード・program引き継ぎ・ピン等）。

サーバは接続時に最新状態を送る。programステージは実行中の再生位置を`playback.startedAt`から計算してシークする。previewはミュートし、`stage_event`を送らない（送られても無視する）。

- `/stage?preview=1` は `/ws?role=stage&preview=1` で明示的にpreviewを要求する。programが不在でもpreviewになり、programには昇格しない。通常の `/stage` は従来どおり最初の接続がprogramを取る。
- previewは`stage_event`を送らない。previewのリースはWebSocketのpongでサーバが更新し、コンソールの接続一覧から消えないようにする。
- 明示的なprogram引き継ぎやリース失効でロールが変わったとき、サーバは対象ステージへ `lease` を送る。ステージは再生を止めずにミュート状態だけを切り替える。
- ステージが読む音声URLはパッケージ相対パスを `/package/<path>` で解決する。P5の生成音声は、実行ディレクトリ配信（例: `/run/<runId>/generated/...`）として拡張する。

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
- 実YouTubeのコメントソースを使うときは`llm.mode`が`local`でなければ起動を拒否する。fixtureでは`local`/`external`の両方を許す。
- 生成音声・ログ・トークンは`dataDir`配下にだけ書く。パッケージは読み取り専用とする。

## テスト方針

- パッケージローダー、リース、キュー進行、イベント冪等化、タイムアウト、コメント選択、ディレクター検証は純粋な入力と偽の時計でテストする。
- HTTP/WebSocketは実サーバをループバックで起動し、本物のクライアントで接続する。
- TTS・LLM・YouTube APIはテスト用のローカルHTTPサーバに差し替える。
- 10分版のサンプルに相当する小さなテストパッケージをテスト内で生成し、実パッケージの書き出しには依存しない。
