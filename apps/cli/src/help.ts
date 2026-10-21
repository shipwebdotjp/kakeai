import { agentOperationCatalog, type AgentOperationName } from "@kakeai/contracts";
import {
  DEFAULT_JOB_WAIT_INTERVAL_MS,
  DEFAULT_JOB_WAIT_TIMEOUT_MS,
  MAX_JOB_WAIT_INTERVAL_MS,
  MAX_JOB_WAIT_TIMEOUT_MS,
  MIN_JOB_WAIT_INTERVAL_MS,
} from "@kakeai/agent-client";
import { JOB_WAIT_COMMAND } from "./commands.ts";

export function operationsCatalog(): {
  operations: typeof agentOperationCatalog;
} {
  return { operations: agentOperationCatalog };
}

function operationList(
  kind: "read" | "mutation",
): Array<{ name: AgentOperationName; longRunning: boolean }> {
  return agentOperationCatalog
    .filter((entry) => entry.kind === kind)
    .map((entry) => ({ name: entry.name, longRunning: entry.longRunning }));
}

export function helpText(): string {
  const lines: string[] = [
    "kakeai-agent — Kakeai Agent Access の CLI",
    "",
    "使い方:",
    "  kakeai-agent <operation> [options]",
    "  kakeai-agent job.wait <jobId> [--timeout-ms <ms>] [--interval-ms <ms>]",
    "  kakeai-agent operations [--pretty]",
    "",
    "操作（読み取り）:",
  ];
  for (const entry of operationList("read")) {
    lines.push(`  ${entry.name}`);
  }
  lines.push("", "操作（変更）:");
  for (const entry of operationList("mutation")) {
    lines.push(`  ${entry.name}${entry.longRunning ? "  (Job を返す)" : ""}`);
  }
  lines.push(
    "",
    "束縛の便宜コマンド:",
    `  ${JOB_WAIT_COMMAND}  job.get を有界にポーリングする（Agent 操作ではない）`,
    "",
    "options:",
    "  --input <json|path|->  操作の入力を JSON 文字列・ファイル・標準入力で指定する",
    "  --wait                 Job を返す操作の完了まで待ち、{ result, wait } を出力する",
    "  --out <path>           preview.frame の PNG をファイルに書き、stdout は画像なしの JSON にする",
    "  --pretty               出力 JSON をインデントする",
    "  --agent-id <id>        ハンドシェイクで送るエージェント識別子（既定: cli）",
    "  --data-dir <path>      Kakeai のデータディレクトリ（KAKEAI_DATA_DIR 相当）",
    "  --socket <path>        エージェントソケットの明示パス（KAKEAI_SOCKET 相当）",
    "  --timeout <ms>         1 要求のタイムアウト（読み取り・変更の両方）",
    `  --timeout-ms <ms>      job.wait の総予算（既定: ${DEFAULT_JOB_WAIT_TIMEOUT_MS}、最大: ${MAX_JOB_WAIT_TIMEOUT_MS}）`,
    `  --interval-ms <ms>     job.wait のポーリング間隔（既定: ${DEFAULT_JOB_WAIT_INTERVAL_MS}、${MIN_JOB_WAIT_INTERVAL_MS}〜${MAX_JOB_WAIT_INTERVAL_MS}）`,
    "  -h, --help             このヘルプを表示する",
    "  -V, --version          バージョンを表示する",
    "",
    "環境変数: KAKEAI_DATA_DIR / KAKEAI_SOCKET / KAKEAI_AGENT_ID",
    "成功時は JSON を stdout、失敗時は {\"code\",\"issues?\"} を stderr に出力する。",
    "終了コード: 0 成功、1 操作・検証・出力の失敗、2 使い方または入力の誤り。",
  );
  return lines.join("\n");
}
