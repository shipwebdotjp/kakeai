# エージェントの素材検索への寸法条件

Status: accepted

## 背景

`asset.list` は `kind`・`status`・`filename`・`tags`・`favorite`・`archived`・`hasAudio`・`durationMinMs` / `durationMaxMs` と並び順・ページングを共有契約で公開している（[Agent Access 仕様](../agent-access/spec.md)）。`Asset` は `widthPx` / `heightPx` を DTO に含むが、検索条件には無く、エージェントは目的の寸法の素材を探すために全ページを読んで自分で絞り込む必要があった。

これは [C9 Face Set の作成](../agent-access/roadmap.md) の実用上の前提でもある。Face Set の顔レイヤーはベース画像と同寸でなければならない（[Face Set 仕様](../face-expression/spec.md)）が、エージェントは同じ寸法の画像を検索できず、候補を総当たりで取得して寸法を比較するしかなかった。

寸法は取り込み時に `probe` が記録する決定的な値であり、検索条件に加えても台本・Job・レンダーの意味論は変わらない。したがって追加は可逆な読み取りの拡張であり、[ADR 0074](./0074-agent-direct-reversible-operations.md) の範囲を変えない。

## 決定

`asset.list` に寸法の完全一致と範囲を追加する。`AGENT_PROTOCOL_VERSION` は `1` のまま据え置く（加算的変更）。

- 完全一致は `widthPx` / `heightPx`（正の整数）。範囲は `widthMinPx` / `widthMaxPx` / `heightMinPx` / `heightMaxPx`（正の整数）で、両端を含む。命名は同じ契約の `durationMinMs` / `durationMaxMs` に合わせる。
- 完全一致と範囲は併用でき、すべて AND で評価する。完全一致だけ、範囲の片側だけでもよい。
- `widthPx` / `heightPx` が null の素材（音声・寸法を取得できなかった素材）は、完全一致にも範囲にも一致しない。`durationMs` が null の素材を長さの範囲から外すのと同じ扱いで、追加の NULL 条件を持たない。
- 範囲の逆転（`widthMinPx > widthMaxPx` など）と、完全一致が指定範囲の外にある指定は「一致0件」ではなく矛盾として `VALIDATION_ERROR` にする。範囲を持つ他の条件（`durationMinMs` / `durationMaxMs`）と同じ規則である。
- 向き（landscape / portrait / square）は追加しない。正方形の境界と比率の丸めの意味づけが必要になり、寸法そのものは既に各 Asset の DTO で返るため、エージェントは必要なときに自分で判定できる。
- 新しい `sort`（寸法順など）と DB 索引・migration は追加しない。個人ライブラリの規模では、寸法条件は既存の検索と同じ走査で足りる（タグ索引化を保留した [roadmap の B4](../agent-access/roadmap.md) と同じ判断）。
- HTTP の `GET /assets`、ローカルソケット、MCP、CLI は同じ契約を使い続ける。HTTP のクエリと Web UI の対応は既存の検索条件と同じで、Web UI の絞り込み UI は変更しない。

## Considered Options

- 完全一致だけにする。→ Face Set の同寸探索には足りるが、「1920 以上の背景」のような用途で全件取得が必要になる。範囲は既存の期間条件と同じ形で足せるため、同時に公開する。
- 範囲だけにし、完全一致は `min = max` で表現する。→ 同寸探索が最も多い用途で、毎回2つの値を一致させる必要があり、指定漏れが起きやすい。完全一致を残す。
- 向きも追加する。→ 正方形の扱いと比率の閾値が必要になり、寸法の完全一致・範囲と二重の表現になる。DTO に寸法があるため、エージェント側で判定できる。
- 寸法で索引を張る。→ 個人ライブラリの規模では走査コストが支配的でない。必要になった時点で、タグのリレーション化と合わせて判断する。

## Consequences

- Agent Access 仕様の MCP 操作表・`asset.list` の説明、HTTP API 契約の `GET /assets` クエリ、roadmap、todo、制作スキル、ユーザーガイドを更新する。`operationDigest` と `schemaDigest` は変わり、束縛（MCP / CLI）とアプリは同じビルドで揃える。
- エージェントは `widthPx` / `heightPx` で同寸の画像を直接探せるようになり、Face Set のレイヤー候補や背景の選定で往復が減る。
- 寸法を持たない素材は寸法条件で除外されるため、音声素材を寸法付きで検索すると0件になる。これは意図した挙動である。
- この決定は恒久ではない。向き・寸法順の並べ替え・索引が必要になった場合は、利用状況を確認して新しい ADR で判断する。
