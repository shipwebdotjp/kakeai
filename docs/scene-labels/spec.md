# Scene Label 仕様

## 目的と境界

`Scene.label` は、映像には描画しない・保存される編集用の名称である。見出しを映像に出す `heading` テキストCueとは完全に別物で、ナビゲーションや一覧でSceneを見分けるために使う。

- `label` は導入・要点・結びを含む全Sceneの必須フィールド。
- 空白のみは不可。重複は許可する。
- 左ペインの構成、中央ペインのScene見出し、右ペインのプレビューSceneジャンプに `label` を表示する。
- Sceneの並べ替えではラベルを変更・再採番しない。
- レンダー結果、タイムライン、Cue、字幕には影響しない。

関連: [../mvp/content-schema.md](../mvp/content-schema.md)（正本JSON）、[../editor/spec.md](../editor/spec.md)（編集画面）。

## 入力制約

- `label` は正本JSONの全Sceneに必須。前後の空白のみの値は拒否する（前後の空白は保存時に除去する）。
- `label` は識別子ではない。内部参照は従来どおりScene IDを使い、同名のSceneを許可する。
- 表示は `label` を優先し、空の場合はUIが種別名（導入／要点／結び）へフォールバックする。正本では空を許可しない。

## 初期生成・追加・複製・分割

- 新規作品の初期Sceneは3件: `導入` / `要点 1` / `結び`。
- 要点Sceneの追加は、挿入位置より前の要点Scene数 + 1 を序数とする `要点 N` を付ける。
- 複製は複製元の `label` をコピーせず、挿入位置に応じた新しい `要点 N` を付ける。
- 分割では元Sceneは `label` を保持し、新Sceneには挿入位置に応じた `要点 N` を付ける。
- 並べ替えでは `label` を変更しない。

## 台本インポート

`## 章タイトル` は、生成するpoint Sceneの `label` に設定する。`heading` テキストCueの `text` は変更しない。通常のpoint Sceneにある空の `heading` / `body` Cueはそのまま残し、映像に見出しを出すかは利用者がCueで明示的に決める。

## schemaVersion と移行

`label` は `schemaVersion: 1` の基準契約に含まれる（[ADR-0061](../adr/0061-template-version-as-reinterpretation-boundary.md) で v5 から `1` へ再基準化）。旧版の読出し移行は持たない。

- 保存済みJSONは書き換えない。次回の保存で新しい `ScriptVersion` を作る。

## 非ゴール

- ラベルの自動再採番、重複の禁止。
- ラベルを映像へ描画すること、`heading` Cueや本文の自動生成。
- Sceneの翻訳・派生Work間のラベル同期。
