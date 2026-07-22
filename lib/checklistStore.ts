export type ChecklistState = Record<string, boolean>;

const STORAGE_KEY = "yattoru.task.today.checklist";

function readFromStorage(): ChecklistState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ChecklistState) : {};
  } catch {
    return {};
  }
}

function writeToStorage(state: ChecklistState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // プライベートブラウジング等でlocalStorageが使えない場合は永続化をスキップする
  }
}

const EMPTY_STATE: ChecklistState = {};

let cachedState: ChecklistState | null = null;
const listeners = new Set<() => void>();

function getState(): ChecklistState {
  if (cachedState === null) {
    cachedState = readFromStorage();
  }
  return cachedState;
}

export function subscribeChecklist(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getChecklistSnapshot(): ChecklistState {
  return getState();
}

export function getChecklistServerSnapshot(): ChecklistState {
  return EMPTY_STATE;
}

export function toggleChecklistItem(id: string): void {
  const current = getState();
  const next = { ...current, [id]: !current[id] };
  cachedState = next;
  writeToStorage(next);
  listeners.forEach((listener) => listener());
}
