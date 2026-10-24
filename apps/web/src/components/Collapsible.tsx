import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import { detailsSummaryClass } from "../ui";
import {
  isPersistedFoldKey,
  loadFoldEntries,
  saveFoldEntries,
  type FoldStorage,
} from "../lib/collapseState";

export interface CollapsiblePersistence {
  storage: FoldStorage | null;
  storageKey: string;
}

interface CollapsibleStore {
  get: (key: string) => boolean | undefined;
  set: (key: string, open: boolean) => void;
  setMany: (keys: readonly string[], open: boolean) => void;
  subscribe: (key: string, listener: () => void) => () => void;
  replaceAll: (entries: Iterable<readonly [string, boolean]>) => void;
}

const CollapsibleStoreContext = createContext<CollapsibleStore | null>(null);

function createCollapsibleStore(
  persist?: () => CollapsiblePersistence | undefined,
): CollapsibleStore {
  const values = new Map<string, boolean>();
  const listeners = new Map<string, Set<() => void>>();
  const notify = (key?: string) => {
    if (key === undefined) {
      for (const group of listeners.values()) {
        for (const listener of group) {
          listener();
        }
      }
      return;
    }
    for (const listener of listeners.get(key) ?? []) {
      listener();
    }
  };
  const persistChanged = (changedKeys: readonly string[]) => {
    const persistence = persist?.();
    if (persistence === undefined) {
      return;
    }
    if (!changedKeys.some((key) => isPersistedFoldKey(key))) {
      return;
    }
    const persisted = new Map<string, boolean>();
    for (const [key, value] of values) {
      if (isPersistedFoldKey(key)) {
        persisted.set(key, value);
      }
    }
    saveFoldEntries(persistence.storage, persistence.storageKey, persisted);
  };
  return {
    get: (key) => values.get(key),
    set: (key, open) => {
      if (values.get(key) === open) {
        return;
      }
      values.set(key, open);
      persistChanged([key]);
      notify(key);
    },
    setMany: (keys, open) => {
      const changed: string[] = [];
      for (const key of keys) {
        if (values.get(key) !== open) {
          values.set(key, open);
          changed.push(key);
        }
      }
      if (changed.length === 0) {
        return;
      }
      persistChanged(changed);
      for (const key of changed) {
        notify(key);
      }
    },
    subscribe: (key, listener) => {
      let group = listeners.get(key);
      if (group === undefined) {
        group = new Set();
        listeners.set(key, group);
      }
      group.add(listener);
      return () => {
        group?.delete(listener);
      };
    },
    replaceAll: (entries) => {
      const next = new Map(entries);
      let same = next.size === values.size;
      if (same) {
        for (const [key, value] of next) {
          if (values.get(key) !== value) {
            same = false;
            break;
          }
        }
      }
      if (same) {
        return;
      }
      values.clear();
      for (const [key, value] of next) {
        values.set(key, value);
      }
      notify();
    },
  };
}

export function useCollapsibleStore(): CollapsibleStore | null {
  return useContext(CollapsibleStoreContext);
}

export function CollapsibleStateProvider({
  resetKey,
  persistence,
  children,
}: {
  resetKey: string;
  persistence?: CollapsiblePersistence;
  children: ReactNode;
}) {
  const persistenceRef = useRef(persistence);
  persistenceRef.current = persistence;
  const getPersistence = useCallback(
    () => persistenceRef.current,
    [],
  );
  const storeRef = useRef<CollapsibleStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createCollapsibleStore(getPersistence);
  }
  const store = storeRef.current;

  const storageKey = persistence?.storageKey;
  useEffect(() => {
    const current = persistenceRef.current;
    const initial =
      current === undefined
        ? new Map<string, boolean>()
        : loadFoldEntries(current.storage, current.storageKey);
    store.replaceAll(initial);
  }, [resetKey, storageKey, store]);

  return (
    <CollapsibleStoreContext.Provider value={store}>
      {children}
    </CollapsibleStoreContext.Provider>
  );
}

const noopSubscribe = () => () => {};

export function useStoredCollapsible(
  storageKey: string,
  defaultOpen = false,
): [boolean, (open: boolean) => void] {
  const store = useContext(CollapsibleStoreContext);
  const subscribe = useCallback(
    (notify: () => void) => store?.subscribe(storageKey, notify) ?? noopSubscribe(),
    [store, storageKey],
  );
  const getSnapshot = useCallback(
    () => store?.get(storageKey) ?? defaultOpen,
    [store, storageKey, defaultOpen],
  );
  const storedOpen = useSyncExternalStore(subscribe, getSnapshot);
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const set = useCallback(
    (open: boolean) => {
      if (store === null) {
        setLocalOpen(open);
      } else {
        store.set(storageKey, open);
      }
    },
    [store, storageKey],
  );
  return [store === null ? localOpen : storedOpen, set];
}

export function Collapsible({
  title,
  summary,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  storageKey,
  children,
  className = "mt-2",
}: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  storageKey?: string;
  children: ReactNode;
  className?: string;
}) {
  const store = useContext(CollapsibleStoreContext);
  const [storedOpen, setStoredOpen] = useStoredCollapsible(storageKey ?? "", defaultOpen);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled
    ? controlledOpen
    : storageKey !== undefined && store !== null
      ? storedOpen
      : internalOpen;
  const toggle = () => {
    const next = !open;
    if (!isControlled) {
      if (storageKey !== undefined && store !== null) {
        setStoredOpen(next);
      } else {
        setInternalOpen(next);
      }
    }
    onOpenChange?.(next);
  };
  const bodyId = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
        className={detailsSummaryClass}
      >
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <span>{title}</span>
        {summary !== undefined && (
          <span className="font-normal text-muted-foreground">{summary}</span>
        )}
      </button>
      <div id={bodyId} hidden={!open} className="mt-1">
        {children}
      </div>
    </div>
  );
}
