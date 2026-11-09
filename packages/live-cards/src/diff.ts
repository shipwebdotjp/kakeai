export interface KeyedReconcileResult<T> {
  added: T[];
  updated: T[];
  removed: T[];
}

export interface KeyedReconcileOptions<T> {
  container: Element;
  /** Desired order. Keys must be unique (contracts enforce this). */
  keys: readonly string[];
  existing: Map<string, T>;
  create: (key: string) => T;
  /** Return true when the item's content actually changed. */
  update: (item: T, key: string) => boolean;
  /** The DOM node managed by the item. */
  elementOf: (item: T) => Element;
  /**
   * Called instead of detaching a stale node. The caller owns the node's
   * lifetime, for example to play an exit animation before removing it.
   * Without this hook stale nodes are detached immediately.
   */
  remove?: (item: T) => void;
}

/**
 * Reconciles a keyed child list without rebuilding the container. Existing
 * items keep their identity; only missing nodes are created, stale nodes are
 * removed, and changed items are reported so the caller can animate the delta.
 *
 * Reordering moves only the nodes that are out of order and treats nodes being
 * removed (still in the container when `remove` is supplied) as invisible, so
 * an exiting node keeps its position instead of jumping to an edge.
 */
export function reconcileKeyedChildren<T>(
  options: KeyedReconcileOptions<T>,
): KeyedReconcileResult<T> {
  const { container, keys, existing, create, update, elementOf, remove } = options;
  const desired = new Set(keys);
  if (desired.size !== keys.length) {
    throw new Error(`キーが重複しています: ${keys.join(", ")}`);
  }
  const result: KeyedReconcileResult<T> = { added: [], updated: [], removed: [] };

  for (const [key, item] of [...existing]) {
    if (!desired.has(key)) {
      existing.delete(key);
      result.removed.push(item);
      if (remove !== undefined) {
        remove(item);
      } else {
        const element = elementOf(item);
        if (element.parentNode !== null) {
          element.parentNode.removeChild(element);
        }
      }
    }
  }

  const ordered: T[] = [];
  for (const key of keys) {
    let item = existing.get(key);
    if (item === undefined) {
      item = create(key);
      existing.set(key, item);
      result.added.push(item);
    } else if (update(item, key)) {
      result.updated.push(item);
    }
    ordered.push(item);
  }

  placeOrdered(container, ordered, elementOf);
  return result;
}

/**
 * Puts desired elements in order with the fewest moves. Children that are not
 * desired (nodes playing an exit animation) are skipped when looking for the
 * next anchor, so they stay where they were.
 */
function placeOrdered<T>(
  container: Element,
  ordered: readonly T[],
  elementOf: (item: T) => Element,
): void {
  const desiredElements = new Set(ordered.map(elementOf));
  let previous: Element | null = null;
  for (const item of ordered) {
    const element = elementOf(item);
    let anchor: Node | null =
      previous === null ? container.firstChild : previous.nextSibling;
    while (anchor !== null && !desiredElements.has(anchor as Element)) {
      anchor = anchor.nextSibling;
    }
    if (anchor !== element) {
      container.insertBefore(element, anchor);
    }
    previous = element;
  }
}
