# v1のYouTubeコメント取得はlistポーリングを正規経路とし、streamListはスパイク後に判断する

Status: amends ADR-0121

v1のYouTubeコメント取得は、`liveChatMessages.list`のポーリングを正規経路とする。`liveChatMessages.streamList`はP0.5で実装可能性をスパイクし、REST/HTTP2またはgRPCの追加依存が妥当だと確認できた場合だけ、将来の改善として採用する。ポーリング間隔は`pollingIntervalMillis`を既定にし、5秒固定にしない。

## Context

- `streamList`はストリーミングAPIであり、単純なREST GETとして扱えない可能性が高い。Nodeで使うには、REST/HTTP2のストリーミングかgRPCクライアント、proto生成、再接続、`pageToken`継続の実装が必要になる。
- 30分の配信では、`liveChatMessages.list`のポーリングでもクォータに収まる。5秒間隔なら約1,800 units、1秒間隔なら約9,000 unitsで、既定10,000 units/日の範囲内だが余裕は減る。
- レスポンスの`pollingIntervalMillis`は、APIが推奨するポーリング間隔である。固定5秒はこれを無視する可能性がある。
- [ADR-0121](./0121-youtube-read-only-comment-source.md) は`streamList`を第一候補としていたが、実装依存の見積もりが未検証だった。
- テストモードのfixtureコメントソースは、YouTubeの接続方法に依存しない。

## 決定

- v1のYouTubeコメント取得は、`liveChatMessages.list`のポーリングを正規経路とする。
- ポーリング間隔は、レスポンスの`pollingIntervalMillis`を既定とする。設定でそれより長くできる。5秒固定にしない。
- クォータの概算をコンソールまたは設定に表示する。30分の配信で、選択した間隔が既定クォータに収まるかを確認できるようにする。
- `streamList`はP0.5でスパイクする。REST/HTTP2で扱えるか、gRPCの正式依存が必要かを確認する。実装が軽く、再接続と`pageToken`継続が安定する場合だけ、将来の改善として採用する。
- gRPCを正式依存にする場合は、別のADRで依存・ビルド・配布・再接続の契約を定める。v1のP1〜P6には入れない。
- コメントソースの境界は変えない。`youtube`の内部実装だけを差し替えられるようにする。

## Considered Options

- 最初からgRPC/HTTP2の`streamList`を正式依存にする。→ proto生成・gRPCクライアント・再接続の実装と配布の負担が大きく、v1の価値に対して過剰なため不採用。
- `streamList`を第一候補のまま、P6で試す。→ 試す時期が遅く、P4/P6の設計を作り直す可能性があるため不採用。P0.5でスパイクする。
- 5秒固定のポーリングにする。→ `pollingIntervalMillis`を無視し、クォータと遅延の調整ができないため不採用。
- ポーリング間隔を1秒固定にする。→ 30分で約9,000 unitsになり、他のAPI呼び出しの余裕がなくなるため不採用。APIの推奨値を既定にし、設定で調整する。

## Consequences

- v1のコメント取得は、追加のgRPC依存なしで実装できる。まず配信を成立させることを優先する。
- `streamList`の低遅延・低リクエストの利点は、P0.5のスパイク結果次第で後から追加する。
- `pollingIntervalMillis`を尊重することで、APIの推奨とクォータの両方に合わせやすい。
- 30分の配信では、1〜5秒の範囲でクォータと体感遅延の調整が必要になる。設定と概算表示を用意する。
- ADR-0121の「`streamList`を第一候補にする」部分は、この決定で置き換える。
