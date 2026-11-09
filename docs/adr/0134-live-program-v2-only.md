# ライブはLive Programとパッケージv2だけを契約とする

Status: accepted

ライブ配信の正本は **Live Program** とその不変の **Live Program Version** だけとし、実行境界は `packageSchemaVersion: 2` の Live Package だけとする。旧 Show Profile JSON、`live-profiles/auto` API、`live:export` の `--profile` / `--auto-profile`、Work / Script Version 由来の v1 パッケージ書き出し・読み込みは削除する。移行期間や互換読み込みは設けない。

## Context

- [ADR-0131](./0131-live-program-owns-live-script.md) でライブ台本を Work から独立させたが、実装フェーズでは旧 Show Profile と v1 パッケージの経路が残っていた。
- 同じライブ機能に、Work / ScriptVersion / Show Profile を入力にする経路と、Live Program Version を入力にする経路が併存すると、検証・エラー・CLI・ドキュメントが二重になり、どちらが正本か分からなくなる。
- 既存のライブ用データはないものとして扱える。旧形式を読み続ける必要はない。
- v2 パッケージは `commentSource`、`test.fixture`、`startAt` を `show.json` に持たず、Live Run の run config が所有する。旧フィールドを受け入れる余地を残すと、実行時にどちらが優先か曖昧になる。

## 決定

- ライブの書き出し入力は `programVersionId`、任意の fixture、`outDir` だけとする。Work / Script Version / Show Profile は受け付けない。
- `manifest.json` の `packageSchemaVersion` は `2`、`source` は Live Program Version の情報だけとする。`show.json` の `schemaVersion` は `2` とし、カード、素材、CutIn、キャスト、コメント・安全・プレイアウトだけを持つ。
- `show.json` に `commentSource`、`test`、`show.startAt`、`materialId`、`segment.material` を書かない。strict schema はこれらを拒否する。
- `apps/live` は v1 パッケージを読み込まない。コメントソース、fixture、`startAt` は run config だけから取得する。
- CLI の `live:export` は `--program-version`、`--fixture`、`--out`、`--timeout-ms`、`--interval-ms`、`--help` だけを受け付ける。旧フラグは不明な引数として失敗させる。
- `POST /api/v1/live-profiles/auto` は提供しない。`POST /api/v1/live-exports` は program version の入力だけを受け付ける。
- Work からライブ台本へ内容を移す機能が必要になった場合は、版や参照を保持しない一度限りのインポータとして別途設計する。移行期間中の互換経路としては残さない。

## Considered Options

- 旧経路を一定期間残し、警告を出す。→ 正本が二重のまま検証とドキュメントの分岐が残り、P7 の完了条件を満たさないため不採用。
- v1 パッケージだけ読み込み互換を残す。→ カード・素材・コメントソースの扱いが v1/v2 で分岐し、run config との優先順位も曖昧になるため不採用。
- Show Profile をインポータで自動変換する。→ 既存データがなく、参照ずれと自動生成規則の保守だけが残るため不採用。必要なら別機能として作る。

## Consequences

- 旧 Show Profile と v1 パッケージのモジュール、API、CLI フラグ、テスト、ユーザーガイドを削除できる。
- ライブの入力・検証・エラー・実行時設定が Live Program Version と Live Run に一本化される。
- 旧形式のファイルは読み込めない。利用者には Live Program を作成し、版を確定して v2 パッケージを書き出す flow を案内する。
- 将来 v3 以降を作る場合も、版付きの契約として追加し、旧版の互換読み込みを暗黙に残さない。
