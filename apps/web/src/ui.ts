export const focusRingClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500";

export const textFieldClass = `rounded border border-border bg-surface px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground ${focusRingClass}`;

export const colorFieldClass = `h-8 w-12 cursor-pointer rounded border border-border ${focusRingClass}`;

const neutralSurfaceClass =
  "border border-muted-foreground/40 bg-surface hover:border-brand-500 hover:bg-brand-50 dark:hover:bg-brand-950/40";

const buttonPaddingYClass = "py-1.5";

// text-sm の行高20px + 上下パディング12px + 枠2px。アイコンだけのボタンも同じ高さにする。
const controlMinHeightClass = "min-h-[34px]";

const buttonBase = `inline-flex items-center justify-center gap-1 rounded-md px-3 ${buttonPaddingYClass} ${controlMinHeightClass} text-sm font-medium shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focusRingClass}`;

export const buttonPrimaryClass = `${buttonBase} bg-brand-600 text-white hover:bg-brand-700 dark:bg-brand-500 dark:text-brand-950 dark:hover:bg-brand-400`;

export const buttonNeutralClass = `${buttonBase} ${neutralSurfaceClass} text-foreground hover:text-brand-900 dark:hover:text-brand-100`;

export const buttonDangerClass = `${buttonBase} border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-950`;

export const buttonDangerOutlineClass =
  "rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950";

export const errorTextClass = "text-sm text-red-600 dark:text-red-400";

export const warningTextClass = "text-sm text-amber-700 dark:text-amber-300";

export const metaTextClass = "text-sm text-muted-foreground";

// 通常のフォームラベル。単位・補助説明・メタデータはこのサイズに揃えない。
export const formLabelClass = "inline-flex items-center gap-1.5 text-sm text-foreground";

export const formLabelSpacedClass = `my-2 ${formLabelClass}`;

export const formLabelTightClass = `my-1 ${formLabelClass}`;

export const formLabelBlockClass = "my-2 block text-sm text-foreground";

export const formLabelTextClass = "text-sm text-foreground";

// 淡色面: Scene や作品設定など、外側の区画。
export const sectionCardClass = "my-4 rounded-lg border border-border bg-surface-muted p-4";

// 白地の編集領域: 映像演出・立ち絵・セリフ・シーン音声。
export const editAreaClass = "mt-3 rounded-md border border-border bg-surface p-3";

// 淡色の個別項目: 各Cue・セリフ・立ち絵・シーン音声の枠。
export const itemCardClass = "mt-2 rounded-md border border-border bg-surface-muted p-2";

export const sectionTitleClass = "mt-0 mb-1 text-base font-semibold text-foreground";

export const sectionSummaryClass = "mt-0 mb-2 text-sm text-muted-foreground";

const badgeBaseClass =
  "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold";

export const badgeNeutralClass = `${badgeBaseClass} border border-border bg-surface text-muted-foreground`;

export const badgeInfoClass = `${badgeBaseClass} bg-brand-100 text-brand-800 dark:bg-brand-950 dark:text-brand-200`;

export const badgeSuccessClass = `${badgeBaseClass} bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-200`;

export const badgeWarningClass = `${badgeBaseClass} bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200`;

export const badgeDangerClass = `${badgeBaseClass} bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200`;

export const detailsSummaryClass = `inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground select-none hover:text-foreground ${focusRingClass}`;

const iconButtonBase = `inline-flex shrink-0 items-center justify-center rounded-md ${neutralSurfaceClass} text-sm text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focusRingClass}`;

export const iconButtonClass = `${iconButtonBase} h-7 min-w-7 px-1`;

// テキスト付きボタンと同じ高さにして、同じ行に並べるアイコン操作向け。
export const iconButtonLargeClass = `${iconButtonBase} min-w-8 px-2 ${buttonPaddingYClass} ${controlMinHeightClass}`;

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
