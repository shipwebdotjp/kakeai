export const textFieldClass =
  "rounded border border-border bg-surface px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground";

const buttonBase =
  "inline-flex items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export const buttonPrimaryClass = `${buttonBase} bg-brand-600 text-white hover:bg-brand-700 dark:bg-brand-500 dark:text-brand-950 dark:hover:bg-brand-400`;

export const buttonNeutralClass = `${buttonBase} border border-border bg-surface-muted text-foreground hover:border-brand-400 hover:bg-surface`;

export const buttonDangerClass = `${buttonBase} border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-950`;

export const errorTextClass = "text-sm text-red-600 dark:text-red-400";

export const metaTextClass = "text-sm text-muted-foreground";

export const sectionCardClass = "my-4 rounded-lg border border-border bg-surface p-4";

export const sectionTitleClass = "mt-0 mb-1 text-base font-semibold text-foreground";

export const sectionSummaryClass = "mt-0 mb-2 text-sm text-muted-foreground";

const badgeBaseClass =
  "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold";

export const badgeNeutralClass = `${badgeBaseClass} bg-surface-muted text-muted-foreground`;

export const badgeInfoClass = `${badgeBaseClass} bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-200`;

export const badgeSuccessClass = `${badgeBaseClass} bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-200`;

export const badgeWarningClass = `${badgeBaseClass} bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200`;

export const badgeDangerClass = `${badgeBaseClass} bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200`;

export const detailsSummaryClass =
  "inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand-500";

export const iconButtonClass =
  "inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-muted px-1 text-sm text-foreground transition-colors hover:border-brand-400 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50";

export const PRESET_LABELS: Record<string, string> = {
  none: "なし",
  fade: "フェード",
  "slide-up": "上へスライド",
  "slide-down": "下へスライド",
  "slide-left": "左へスライド",
  "slide-right": "右へスライド",
  "scale-in": "拡大",
  pulse: "パルス",
};
