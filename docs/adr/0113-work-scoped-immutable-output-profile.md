# 出力形式をWorkの唯一の正とし、作成後は変更しない

Status: accepted

## Context

Kakeai は 1本の Work を 16:9（1920×1080）でレンダーしてきた。ショート動画（9:16）を派生作品として作る機能を追加したが、出力形式は作品一覧の表示用メタデータにとどまり、レンダー・プレビューは常に 16:9 で生成される。

出力形式を決める場所は複数あり得る。

- `Work.outputProfile`（作品単位のメタデータ）
- `LanguageEdition`（言語版単位）
- `ScriptVersion`（台本版単位）
- `CompositionVersion.manifest.canvasProfile`（挿入する Composition のキャンバス）
- レンダー開始時のリクエスト（都度指定）

同じ Work の台本・言語版・レンダー履歴が異なるアスペクトで混在すると、字幕・レイアウト・素材のクロップ・テンプレートの検証条件がすべて「どのアスペクトで見るか」に依存し、正が分裂する。プレビューは編集中の台本に対して行うため、台本ごとにアスペクトが変わると、同じシーンの見え方が版ごとに変わることになる。

## 決定

- 出力形式は `Work.outputProfile`（`landscape` / `portrait`）を唯一の正とする。Work に属する全 Language Edition・全 Script Version・全レンダー・全プレビューは同じ出力形式を使う。
- 出力形式は Work の作成時に決まり、**作成後は変更できない**。変更したい場合は複製（`POST /works/:workId/clone` の `outputProfile`）で新しい Work を作る。
- `LanguageEdition`・`ScriptVersion`・`Render Job` は出力形式を保持しない。レンダーとプレビューは Work から導出する。
- `CompositionVersion.manifest.canvasProfile` は Composition 自身の内部キャンバスであり、Work の出力形式とは独立する。Composition はシーン内の挿入要素として、その canvasProfile に応じた枠（`scene.device-frame@1` など）に収める。
- 既存 Work はすべて `landscape` として扱う。DB の既定値と移行で `landscape` を埋める。

## Considered Options

- Edition 単位で出力形式を持つ。→ 同じ Work の言語版で見た目が変わり、テーマ・字幕・素材の検証条件が言語版ごとに増えるため不採用。
- Script Version 単位で持つ。→ 版ごとにアスペクトが変わり得て、復元や複製の意味が壊れるため不採用。
- レンダー開始時に毎回指定する。→ 同じ台本から複数アスペクトを出せる柔軟性はあるが、字幕・セーフエリア・テンプレートの検証が実行時まで確定せず、レンダー履歴ごとに見た目が変わる。ショート版は派生 Work として独立させる方針（[work-history/spec.md](../work-history/spec.md)）と重複するため不採用。
- 作成後に変更可能にする。→ 既存のレンダー Artifact・サムネイル・プレビューと現在の出力形式が食い違い、過去の出力の意味が変わるため不採用。

## Consequences

- 出力形式の変更は複製でしか行えず、作品一覧に「出力形式」と「親作品」を表示する現行 UI の意味が確定する。
- レンダー・プレビューの寸法は Work から引くため、`RenderJobSnapshot.output` は Work の出力形式から導出した値を記録する（スナップショットは実行時の不変記録）。
- 既存作品を縦型にしたい場合は、台本ごと複製して新しい Work を作る。台本の編集内容は複製後に分岐する。
- 出力形式を増やす場合（1:1 など）は `workOutputProfileSchema` の値と、対応するレイアウト規則の追加になる。この決定自体は「Work が唯一の正・不変」であり、値の追加では覆らない。
