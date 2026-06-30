const STORAGE_KEY = "ai-simulator-saves";

export interface SavedSession {
  id: string;
  name: string;
  savedAt: string;
  data: Record<string, unknown>;
}

export function listSessions(): SavedSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedSession[]) : [];
  } catch {
    return [];
  }
}

export function saveSession(name: string, data: Record<string, unknown>): SavedSession {
  const sessions = listSessions();
  const session: SavedSession = {
    id: Date.now().toString(),
    name,
    savedAt: new Date().toISOString(),
    data,
  };
  sessions.unshift(session);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  return session;
}

export function deleteSession(id: string): void {
  const sessions = listSessions().filter((s) => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function exportJson(name: string, data: Record<string, unknown>): void {
  const payload = { name, exportedAt: new Date().toISOString(), data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name || "simulator"}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importJson(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return reject(new Error("no file"));
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string);
          resolve(parsed.data ?? parsed);
        } catch {
          reject(new Error("invalid JSON"));
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });
}

export function encodeToUrl(data: Record<string, unknown>): string {
  const json = JSON.stringify(data);
  const encoded = btoa(encodeURIComponent(json));
  const url = new URL(window.location.href);
  url.searchParams.set("d", encoded);
  return url.toString();
}

export function decodeFromUrl(): Record<string, unknown> | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get("d");
    if (!encoded) return null;
    const json = decodeURIComponent(atob(encoded));
    return JSON.parse(json);
  } catch {
    return null;
  }
}
