import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import { detailsSummaryClass } from "../ui";

interface CollapsibleStore {
  get: (key: string) => boolean | undefined;
  set: (key: string, open: boolean) => void;
  subscribe: (key: string, listener: () => void) => () => void;
  reset: () => void;
}

const CollapsibleStoreContext = createContext<CollapsibleStore | null>(null);

function createCollapsibleStore(): CollapsibleStore {
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
  return {
    get: (key) => values.get(key),
    set: (key, open) => {
      if (values.get(key) === open) {
        return;
      }
      values.set(key, open);
      notify(key);
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
    reset: () => {
      if (values.size === 0) {
        return;
      }
      values.clear();
      notify();
    },
  };
}

export function CollapsibleStateProvider({
  resetKey,
  children,
}: {
  resetKey: string;
  children: ReactNode;
}) {
  const storeRef = useRef<CollapsibleStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createCollapsibleStore();
  }
  const store = storeRef.current;

  useEffect(() => {
    store.reset();
  }, [resetKey, store]);

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
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
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
      <div hidden={!open} className="mt-1">
        {children}
      </div>
    </div>
  );
}
