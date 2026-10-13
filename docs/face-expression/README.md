# キャラクター表情

シーン内でキャラクターの表情を台詞ごとに変え、将来の瞬き・簡易口パクへ拡張するための設計文書群です。

| 文書 | 内容 |
| --- | --- |
| [spec.md](spec.md) | v1 のドメインモデル、素材契約、台詞・AI・レンダリングの振る舞い、操作シナリオ |
| [todo.md](todo.md) | 実装順の ToDo と受入確認 |

Status: Proposed。現時点では設計のみで、動画／シーン実装、DB schema、公開 API は未実装です。
グローバル参照と再レンダー差異の許容は [ADR-0045](../adr/0045-face-set-global-reference.md)、立ち絵テンプレート版は [ADR-0046](../adr/0046-character-standing-v3-face-composite.md)、台詞属性と `schemaVersion: 7` は [ADR-0047](../adr/0047-per-line-expression-id.md) に記録します。
