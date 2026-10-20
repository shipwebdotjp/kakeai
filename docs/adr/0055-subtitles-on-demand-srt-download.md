# 字幕はオンデマンド同期生成とし、Artifactにしない

字幕（SRT）ファイルは、保存済み ScriptVersion からの同期ダウンロードとしてオンデマンド生成し、Job の出力（`Artifact`）として保存しない。ADR-0006 が将来の字幕・SRT 用に `role` / `format` の追加を想定していたが、字幕生成は正本と音声尺からの純粋なテキスト変換で、レンダーのような重い非同期処理を要しないため、独立した軽い導出とする。

理由は、字幕が欲しい利用者の大半は「YouTubeへ取り込むための今の版のファイル」であり、Jobのキュー・ポーリング・履歴・削除管理を持ち込むと取得までの手順と実装量だけが増えるため。タイミング解決はレンダーと同一の `resolveTimeline` を使うため、同じ版から作る限り映像と一致する。

## Considered Options

- `subtitle` kind の Job を新設し `role=caption` の Artifact として履歴に残す。→ 取得が重くなり、worker・job kind・health・polling の配管が増えるため不採用。
- 既存 render Job の追加 Artifact として生成する。→ 字幕だけが欲しいときにMP4レンダーが必須になり、「レンダリングとは別」の要求を満たさないため不採用。

## Consequences

- `GET /script-versions/:scriptVersionId/subtitles` はファイルだけを返し、DBへ何も書かない。詳細は [../subtitle-export/spec.md](../subtitle-export/spec.md)。
- 将来、字幕の版管理や履歴保持が必要になった場合は、この決定を反転させる新ADRを書く。
