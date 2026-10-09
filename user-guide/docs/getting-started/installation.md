---
sidebar_position: 2
title: インストールと初期設定
---

# インストールと初期設定

Kakeai は、macOS 上でローカルに起動する動画制作アプリです。このページでは、Kakeai のインストール、初期設定、起動方法を説明します。

:::note[現在の状態]
Kakeai は開発中です。作品の作成・台本の編集・素材の取り込み・プレビューまでを実装しています。MP4 出力は今後の更新で追加されます。
:::

## 動作環境

| 項目 | 要件 |
| --- | --- |
| OS | macOS |
| Node.js | 22 以上 |
| npm | Node.js に同梱 |

バージョンを確認します。

```bash
node --version
npm --version
```

## インストール

### 1. リポジトリを取得する

```bash
git clone https://github.com/shipwebdotjp/kakeai.git
cd kakeai
```

### 2. 依存パッケージをインストールする

```bash
npm install
```

リポジトリのルートで実行します。`packages/*` と `apps/*` の依存がまとめてインストールされ、Prisma クライアントが自動生成されます。

## 初期設定

通常は設定不要です。初回起動時に、保存先ディレクトリとデータベースが自動で作成され、データベースのマイグレーションが適用されます。

保存先やポートを変えたい場合は、起動時に環境変数で指定します。

| 環境変数 | 既定値 | 説明 |
| --- | --- | --- |
| `KAKEAI_DATA_DIR` | `~/Library/Application Support/Kakeai` | データの保存先 |
| `KAKEAI_PORT` | `4317` | 待受ポート |

保存先には次のディレクトリが作られます。

| ディレクトリ | 内容 |
| --- | --- |
| `db/` | SQLite データベース |
| `assets/` | 素材の原本と正規化ファイル |
| `artifacts/` | 出力した動画などの成果物 |
| `tmp/` | 一時ファイル |

## 起動

### 通常起動

Web UI をビルドしてから API を起動します。API が Web UI も同じアドレスで配信します。

```bash
npm run build -w @kakeai/web
npm run start -w @kakeai/api
```

ブラウザで `http://127.0.0.1:4317` を開きます。停止するには `Ctrl+C` を押します。

### 開発時

API と Web UI の開発サーバーを別々に起動します。ターミナルを2つ使います。

```bash
# ターミナル1（API）
npm run dev -w @kakeai/api

# ターミナル2（Web UI）
npm run dev -w @kakeai/web
```

ブラウザで `http://localhost:5173` を開きます。Web UI の変更は自動で反映され、`/api` へのリクエストは API へ中継されます。

### 動作確認

API だけを確認する場合:

```bash
curl http://127.0.0.1:4317/api/v1/health
```

次のようなレスポンスが返れば起動しています。

```json
{
  "data": {
    "apiVersion": "v1",
    "worker": { "status": "notReady" },
    "capabilities": {
      "locales": ["ja-JP"],
      "jobKinds": ["asset_ingest", "render"],
      "assetKinds": ["image", "video", "audio"]
    },
    "storage": {
      "warningThresholdBytes": 85899345920,
      "status": "ok"
    }
  }
}
```

## 設定の変更例

保存先とポートを変えて起動します。

```bash
KAKEAI_PORT=5000 KAKEAI_DATA_DIR="$HOME/kakeai-data" npm run start -w @kakeai/api
```

## トラブルシューティング

- **ポートが使用中**: `KAKEAI_PORT` を別の値に変えて起動します。
- **Node.js のバージョンが古い**: Node.js 22 以上をインストールします。
- **データを初期化したい**: 保存先（既定では `~/Library/Application Support/Kakeai`）を削除して再起動します。作品・素材・出力がすべて消える点に注意してください。
