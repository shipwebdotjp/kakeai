---
sidebar_position: 1
title: ライブ配信の準備
---

# ライブ配信の準備

Kakeai で作った台本・キャラクター・素材・声を使って、AI キャラクターが進行する YouTube ライブを実施できます。ライブの実行には **ライブパッケージ** と **ライブアプリ（`apps/live`）** を使います。

:::note[読み取り専用]
ライブアプリは YouTube のコメントを読むだけで、配信の作成・開始・終了、チャットへの投稿、モデレーションは行いません。配信操作とチャット投稿は人間が行います。
:::

## 全体の流れ

1. [ライブパッケージを書き出す](./export.md)
2. [ライブ設定と YouTube の OAuth を準備する](./setup.md)
3. [テストモードでリハーサルする](./test-mode.md)
4. [OBS にステージを設定する](./obs.md)
5. [当日のライブを操作する](./operations.md)
6. 問題が起きたら [トラブルシューティング](./troubleshooting.md) を確認する

## 必要なもの

- Kakeai で保存した ScriptVersion と、ライブ用の Show Profile
- ローカル LLM（実 YouTube のコメント分析・応答生成に使う。外部 LLM はテストモードのみ）
- TTS エンジン（VOICEVOX、AivisSpeech、または OpenAI 互換。生成レスと書き出しに使う）
- YouTube Data API v3 を有効にした Google Cloud プロジェクトの OAuth クライアント
- OBS Studio（ステージをブラウザソースとして取り込む）
- macOS と Node.js 22.20.0 以上

## 起動コマンド

```sh
npm run live -- \
  --package /tmp/live-package-10m \
  --config /path/to/live-config.json
```

| オプション | 内容 |
| --- | --- |
| `--package` | 書き出したライブパッケージのディレクトリ（必須） |
| `--config` | ライブ設定 JSON。省略時は既定値 |
| `--port` | 待受ポート（既定: `3010`） |
| `--test` | コメントソースを fixture に切り替える |

起動すると、次の URL が表示されます。

- ステージ: `http://127.0.0.1:3010/stage`（OBS に取り込む）
- コンソール: `http://127.0.0.1:3010/console`（操作・監視用。OBS に出さない）

## このセクションのページ

- [ライブパッケージを書き出す](./export.md)
- [ライブ設定と YouTube の OAuth](./setup.md)
- [テストモードでリハーサルする](./test-mode.md)
- [OBS にステージを設定する](./obs.md)
- [当日のライブを操作する](./operations.md)
- [トラブルシューティング](./troubleshooting.md)
