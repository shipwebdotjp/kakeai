# エージェントとCLIは常駐アプリのローカルソケット経由で操作し、アプリを単一ライターに保つ

Status: amends ADR-0015

MCP サーバーや CLI はエージェントが起動する別プロセスである。これらが同じ SQLite を直接開くと、API とワーカーを単一プロセスで動かす前提（[ADR 0012](./0012-single-process-api-worker.md)）と、起動時に `running` の Job を掃除する前提（[ADR 0020](./0020-no-job-lease-startup-reap.md)）が壊れ、後から起動したプロセスが他プロセスの実行中 Job を誤って失敗させる。そこで、常駐するアプリがタスク指向の操作面をローカル OS ソケットで公開し、MCP stdio サーバーと CLI は同じ操作コアを呼ぶ薄いクライアントとする。ソケットはアプリデータ領域に置き、ファイル権限で保護する。ブラウザ向け HTTP API は Web UI 用に残し、エージェント向け入口には使わない。

## Considered Options

- 各プロセスが SQLite を共有し、サービス層を直接呼ぶ。→ 起動時の running Job 掃除が他プロセスの実行中 Job を誤って失敗させるため不採用。
- 既存 HTTP API をそのまま叩く。→ すべての操作を REST 資源として写し、非ブラウザ接続に `Host`/`Origin` 保護を課すことになるため不採用。

## Consequences

[ADR 0015](./0015-minimal-local-api-protection.md) の保護モデルに、ローカルソケットという第二の信頼境界を追加する。ソケットは利用者のファイル権限で保護し、起動トークンや独自ヘッダは持たない。HTTP API と MCP／CLI は単一の操作コア（サービス層）を共有する。
