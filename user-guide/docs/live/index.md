---
sidebar_position: 1
title: ライブ配信の準備
---

# ライブ配信の準備

Kakeai で作った **Live Program** から、AI キャラクターが進行する YouTube ライブを実施できます。ライブの実行には **Live Program Version** から書き出した **ライブパッケージ**、**ライブ Run**、**ライブアプリ（`apps/live`）** を使います。Work や Script Version は使いません。

:::note[読み取り専用]
ライブアプリは YouTube のコメントを読むだけで、配信の作成・開始・終了、チャットへの投稿、モデレーションは行いません。配信操作とチャット投稿は人間が行います。
:::

## 全体の流れ

1. Kakeai で Live Format を選び、Live Program を作成して編集する
2. 版を確定し、[ライブパッケージを書き出す](./export.md)
3. [ライブ設定と YouTube の接続を準備する](./setup.md)
4. [ライブ Run を書き出して起動する](./runs.md)
5. [テストモードでリハーサルする](./test-mode.md)
6. [OBS にステージを設定する](./obs.md)
7. [当日のライブを操作する](./operations.md)
8. 問題が起きたら [トラブルシューティング](./troubleshooting.md) を確認する

## 必要なもの

- Kakeai で作成した Live Program と、確定済みの Live Program Version
- ローカル LLM（実 YouTube のコメント分析・応答生成に使う。外部 LLM は fixture の Run のみ）
- TTS エンジン（VOICEVOX、AivisSpeech、または OpenAI 互換。生成レスと書き出しに使う）
- YouTube Data API v3 を有効にした Google Cloud プロジェクトの API キー（OAuth を使う場合は OAuth クライアント）
- OBS Studio（ステージをブラウザソースとして取り込む）
- macOS と Node.js 22.20.0 以上

## 起動コマンド

通常は Kakeai のライブ Run 画面から起動します。手動で起動する場合は、Run 設定 JSON が必要です。

```sh
npm run live -- \
  --package /tmp/live-package-v2 \
  --run-config /tmp/live-run/run-config.json \
  --config /path/to/live-config.json
```

| オプション | 内容 |
| --- | --- |
| `--package` | 書き出したライブパッケージのディレクトリ（必須） |
| `--run-config` | Live Run が書いた Run 設定 JSON（必須） |
| `--config` | ライブ設定 JSON。省略時は既定値 |
| `--port` | 待受ポート（既定: Run 設定の値） |
| `--control-token-file` | Kakeai が発行した control token（Run 起動時） |

起動すると、次の URL が表示されます。

- ステージ: `http://127.0.0.1:3010/stage`（OBS に取り込む）
- コンソール: `http://127.0.0.1:3010/console`（操作・監視用。OBS に出さない）

## このセクションのページ

- [ライブパッケージを書き出す](./export.md)
- [ライブ設定と YouTube の接続](./setup.md)
- [ライブ Run を書き出して起動する](./runs.md)
- [テストモードでリハーサルする](./test-mode.md)
- [OBS にステージを設定する](./obs.md)
- [当日のライブを操作する](./operations.md)
- [トラブルシューティング](./troubleshooting.md)
