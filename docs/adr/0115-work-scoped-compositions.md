# Compositionの所属をWork単位にし、作成時に共通か作品専用かを必須にする

Status: accepted

Composition Library はアプリ全体で共有されており、台本の Composition 背景ピッカーには全 Work の CompositionVersion が平坦に並ぶ。作品ごとに Composition を作る運用が主流で、複数作品での使い回しはイントロ・アウトロ程度しかないため、Composition に「作品専用」か「全作品共通」かのスコープを持たせ、作成時に明示させる。

## Context

- 現状の `Composition` は Work との関係を持たず、`GET /compositions` は全件を返す。台本のピッカーは全 Composition の全 version を Canvas Profile で絞って並べるだけなので、作品と Composition が増えるほど選びにくくなる。
- 実際の制作では、作品の内容に合わせてその作品専用の Composition を作ることがほとんどで、複数作品で同じ Composition を使いたい場面は少ない。共通化の候補はイントロやアウトロの定型的な動きに限られる。
- `Asset` もアプリ全体で共有されているが、タグ・お気に入り・アーカイブで整理されており、Work との所属関係は持たない。Composition には同等の整理手段がない。
- 既存の CompositionVersion は不変であり、ScriptVersion は version ID だけを参照する。所属を後から変えても、保存済みの参照やレンダー結果を壊してはならない。

## 決定

- `Composition` にスコープを持たせる。値は `work`（作品専用）または `shared`（全作品共通）で、`work` は所有する Work の `workId` を1つ持つ。`shared` は `workId` を持たない。
- スコープは `Composition` の属性とし、`CompositionVersion` は所属を継承する。version は不変の成果物であり、所属を version 単位で動かさない。
- 新規作成時はスコープを必須にする。`scope` の省略、`work` なのに `workId` がない指定、`shared` なのに `workId` がある指定は拒否する。新規作成で未分類は作らない。
- 既存 Composition は移行時に `unclassified` とする。すべての ScriptVersion の `compositionVersionId` 参照と render Job の入力スナップショットを走査し、参照元の Work が1つなら `work`、複数なら `shared`、0なら `unclassified` にする。Job の Work は `Job.workId`、無ければ Language Edition の Work から解決する。
- `unclassified` は全 Work の候補に「未分類」と表示し、アーカイブで片付けられる。所属を付け替える操作はこの段階では提供しない。
- スコープは候補の発見範囲を決めるもので、参照の可否を決めない。ScriptVersion の保存・プレビュー・レンダーは、参照先が publish 済みで bundle が完全であることだけを検証し、スコープ一致は要求しない。候補外の version を参照する既存台本はそのまま有効とし、ピッカーは現在値を候補外として保持する。
- `Composition` に `archivedAt` を追加する。アーカイブは行と版を残したまま、既定の一覧とピッカーから隠す。台本の参照、Job の入力スナップショット、プレビュー、レンダーには影響しない。解除できる。
- 台本のピッカーは、対象 Work の `work`、`shared`、`unclassified` を候補とし、アーカイブ済みを既定で除く。Composition ごとに互換 Canvas Profile の最新 version だけを既定表示し、必要時に全 version を表示する。現在の Cue が参照する version は、候補外でも表示して保持する。
- `POST /compositions` は必須の `scope` と、`work` のときの `workId` を受け取る。`GET /compositions` は `workId`・`scope`・`archived` で絞れる。`PATCH /compositions/:compositionId` は `archived` を切り替える。Composition の単体削除は提供しない。
- Work の明示削除では、その Work が所有する Composition と draft・bundle を一緒に削除する。`shared` と `unclassified` は削除しない。他の Work の ScriptVersion または Job の入力スナップショットから参照されている作品専用 Composition がある場合は、参照を壊さないよう削除を拒否する。
- Agent Access の `composition.create` はスコープを必須にする。必須化は破壊的変更なので `AGENT_PROTOCOL_VERSION` を `2` へ上げ、`composition.list` に `workId`・`scope`・`archived` の絞り込みを加える。
- `Asset` の所属スコープはこの決定の対象外とし、後続フェーズで別に判断する。

## Considered Options

- 全体検索と並び替えだけで解決する。→ 作品専用と共通の意図をデータにできず、共通でない Composition が候補に残り続けるため不採用。
- タグやコレクションで多対多に整理する。→ 複数作品での使い回しがまれな現状では、所属の付け忘れと整理の運用負荷だけが増えるため不採用。
- 作品ごとにライブラリを完全分離し、共有はコピーで行う。→ Composition は version 込みで重く、コピーすると bundle が重複し版が分岐するため不採用。
- 新規作成のスコープを任意にし、未指定を共通または未分類にする。→ 渡し忘れが共通の山を作るか、作った Composition が候補から消えるため不採用。
- 初回参照時に所有 Work を自動で決める。→ Agent Access の契約を変えずに済むが、意図しない所属が固定され、共通で使いたい場合の扱いが不明瞭になるため不採用。
- スコープを CompositionVersion に持たせる。→ 不変版の所属が後から動かせず、publish のたびに所属が増えるため不採用。
- Work 削除時に作品専用 Composition を残して共通へ戻す。→ 削除した作品の Composition が全作品の候補に残り、今回の目的と逆行するため不採用。

## Consequences

- 既存 Composition の多くは参照走査で作品専用に寄る。参照のない没案は未分類として残るため、アーカイブで整理する運用が必要になる。
- Agent Access はプロトコル版 `2` となり、旧版の束縛は接続できない。MCP・CLI・アプリ・スキルを同じビルドで揃える必要がある。`operationDigest` と `schemaDigest` も変わる。
- 作品専用 Composition を別の作品でも使いたくなった場合は、共通へ昇格する操作が必要になる。この決定では保留し、需要が確認できた時点で追加する。
- Work 削除は、他作品から参照されている作品専用 Composition があると失敗する。参照を外すか、将来の昇格で共通へ移してから削除する。
- 候補外の CompositionVersion を参照する既存台本は壊れない。ピッカーでは現在値を候補外として表示する。
- `Asset` の整理は従来どおりタグ・お気に入り・アーカイブのままとし、Composition のスコープとは別の概念として扱う。
