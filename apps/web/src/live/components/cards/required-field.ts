/** Ring cue for text that the contract requires but the draft is missing. */
export const requiredFieldClass = "ring-1 ring-red-500";

export const requiredMessageClass = "mt-1 text-xs text-red-600 dark:text-red-400";

export function isBlankText(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}
