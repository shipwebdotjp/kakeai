# Agent Experience ロードマップ

## 今回の決定

外部 Agent の台本確認・引き継ぎ・接続復旧を、次の順に改善する。

1. 保存済み版の `preview.scriptFrame` に `lineId` と `offsetMs` を加える。
2. handshake の版範囲外だけを診断可能な `AGENT_PROTOCOL_MISMATCH` にする。
3. 同一 Language Edition の二版を構造比較する `script.diff` を追加する。

`script.edit.created` の replay 時の再構成・永続化は保留する。`script.diff` の `added` を
その代替にはしない。

## 実施順序

| フェーズ | 内容 | 前提 | 順序の理由 |
| --- | --- | --- | --- |
| E1 | 行基準 Script Preview | なし | 既存の解決済み timeline を利用する小さな入力拡張であり、分割後の時刻推測を直ちに除ける |
| E2 | handshake 診断 | なし | ソケットと binding のエラー伝達だけを扱い、台本契約から独立している |
| E3 | `script.diff` | E1、E2 の完了 | 新しい read operation として、要素差分の語彙・境界を固定してから導入する |
| E4 | 利用者向け説明とリリース確認 | E1〜E3 | MCP/CLI の使い方、エラー復旧、引き継ぎ手順が最終契約と一致することを確認する |

E1 と E2 は技術的には独立であり、別の変更・別のリリースとして完結できる。E3 は
E1/E2 の実装詳細には依存しないが、利用者体験の一連の改善として後続させる。

## 非ゴール

- 未保存 ContentDocument の lineId 解決
- protocol mismatch に特定の更新コマンド、推測した package version、未公開の release version を含めること
- `script.diff` での意味的同一性推定、JSON Patch、文字列差分、別 Edition 比較
- Audio Cue、Speaker、Character、Theme、文書設定の詳細 diff
- `script.edit.created` の replay 結果への復元、作成 manifest の DB 保存

## 成功の判断

- Agent は、旧版から計算した絶対秒数を再利用せず、対象 line の開始・途中・終端を
  保存版から解決してプレビューできる。
- protocol version の不一致では、Agent がアプリと binding を互換な release に揃えて
  再起動すべきことと、必要な protocol version 範囲をエラーだけから理解できる。
- 引き継ぐ Agent は `script.diff` で Scene、line、cue の構造変化と、対象外の文書変更の
  存在を確認してから必要な版を `script.get` で読む。
- どの変更でも Script Version、Job、Artifact を増やさず、既存の絶対時刻プレビューと
  `script.edit.created` の意味を壊さない。
