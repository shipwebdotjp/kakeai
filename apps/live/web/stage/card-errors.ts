export interface StageCardVisual {
  cardId: string;
  stateId: string;
  sequence: number;
}

export interface StageCardFailure {
  message: string;
  cardId: string | null;
  stateId: string | null;
  sequence: number | null;
  key: string;
}

export function cardErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0) {
      return message;
    }
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }
  return "カードの表示に失敗しました。";
}

/**
 * Deduplicates card display warnings per card/state/reason. The renderer
 * already hides the failed card; this policy only decides what reaches the
 * console and the server, and it never throws.
 */
export class CardErrorReporter {
  private readonly seen = new Set<string>();

  /** Forgets earlier reports, e.g. after a new show or reconnect snapshot. */
  reset(): void {
    this.seen.clear();
  }

  report(visual: StageCardVisual | null, error: unknown): StageCardFailure | null {
    const message = cardErrorMessage(error);
    const cardId = visual?.cardId ?? null;
    const stateId = visual?.stateId ?? null;
    const key = `${cardId ?? ""}:${stateId ?? ""}:${message}`;
    if (this.seen.has(key)) {
      return null;
    }
    this.seen.add(key);
    return {
      message,
      cardId,
      stateId,
      sequence: visual?.sequence ?? null,
      key,
    };
  }
}
