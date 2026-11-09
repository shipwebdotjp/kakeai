import { Link } from "react-router-dom";
import { liveFormatRoute } from "../../lib/routes";
import type { LiveProgramSourceFormat } from "@kakeai/contracts";
import { formatDateTime } from "../duration";
import { metaTextClass } from "../../ui";

interface FormatProvenanceBannerProps {
  sourceFormat: LiveProgramSourceFormat | null;
  formatName?: string;
}

export function FormatProvenanceBanner({
  sourceFormat,
  formatName,
}: FormatProvenanceBannerProps) {
  if (sourceFormat === null) {
    return (
      <p className={`rounded border border-border bg-surface-muted px-3 py-2 ${metaTextClass}`}>
        このプログラムには作成元フォーマットの記録がありません。
      </p>
    );
  }
  const label = formatName ?? sourceFormat.formatId;
  return (
    <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <p className="m-0">
        このプログラムはフォーマット{" "}
        <Link
          className="font-semibold underline"
          to={liveFormatRoute(sourceFormat.formatId)}
        >
          {label}
        </Link>{" "}
        から作成。フォーマット変更は反映されません。
      </p>
      <p className="m-0 mt-1 text-xs opacity-80">
        作成時のフォーマット更新日時: {formatDateTime(sourceFormat.formatUpdatedAt)}
      </p>
    </div>
  );
}
