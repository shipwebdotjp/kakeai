# Jobのリースは持たず、起動時にrunningを掃除する

MVPは単一プロセス・単一ワーカーで自動再試行もしないため、Jobにリース（所有者・有効期限）を持たない。API起動時に `running` のまま残ったJobを `WORKER_INTERRUPTED` として failed に掃除し、永久に `running` で残るのを防ぐ。取得は `id` と `status=queued` を条件にした軽量な比較更新のままとし、複数ワーカーの厳密な排他は提供しない。

## Considered Options

- リース期限で失効検出する。→ 単一プロセスでは起動時掃除で足り、列とインデックスが不要なため不採用。
