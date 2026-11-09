import type {
  LiveProgramServerIssue,
} from "../model/version-actions";
import type { LiveProgramValidationIssue } from "../model/validation";
import { validationPathLabel } from "../model/validation";
import { badgeDangerClass, badgeWarningClass, metaTextClass } from "../../ui";

interface ValidationIssuesProps {
  issues: readonly (LiveProgramValidationIssue | LiveProgramServerIssue)[];
  emptyMessage?: string;
}

function isUiIssue(
  issue: LiveProgramValidationIssue | LiveProgramServerIssue,
): issue is LiveProgramValidationIssue {
  return "severity" in issue;
}

export function ValidationIssues({ issues, emptyMessage }: ValidationIssuesProps) {
  if (issues.length === 0) {
    return emptyMessage === undefined ? null : <p className={metaTextClass}>{emptyMessage}</p>;
  }
  return (
    <ul className="m-0 list-none space-y-1 p-0">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`} className="flex flex-wrap items-start gap-2 text-sm">
          {isUiIssue(issue) ? (
            <span className={issue.severity === "warning" ? badgeWarningClass : badgeDangerClass}>
              {issue.severity === "warning" ? "警告" : "エラー"}
            </span>
          ) : (
            <span className={badgeDangerClass}>エラー</span>
          )}
          <span className="min-w-0">
            {issue.path.length > 0 && (
              <span className="mr-2 text-xs text-muted-foreground">
                {validationPathLabel(issue.path)}
              </span>
            )}
            <span className="break-words">{issue.message}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
