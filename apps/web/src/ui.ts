export const textFieldClass =
  "rounded border border-border bg-surface px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground";

const buttonBase =
  "inline-flex items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export const buttonPrimaryClass = `${buttonBase} bg-brand-600 text-white hover:bg-brand-700 dark:bg-brand-500 dark:text-brand-950 dark:hover:bg-brand-400`;

export const buttonNeutralClass = `${buttonBase} border border-border bg-surface-muted text-foreground hover:border-brand-400 hover:bg-surface`;

export const buttonDangerClass = `${buttonBase} border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-950`;

export const errorTextClass = "text-sm text-red-600 dark:text-red-400";

export const metaTextClass = "text-sm text-muted-foreground";
