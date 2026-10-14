import type { TableNumberFormat } from "@kakeai/contracts";

export function formatNumber(value: number, format: TableNumberFormat | undefined): string {
  switch (format) {
    case "currency":
      return new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
      }).format(value);
    case "percent":
      return new Intl.NumberFormat("ja-JP", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
    case "integer":
      return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value);
    case "decimal":
      return new Intl.NumberFormat("ja-JP", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 2,
      }).format(value);
    default:
      return String(value);
  }
}
