"use client";

import { useEffect, useState } from "react";

interface ConnectionStatus {
  configured: boolean;
  connection: {
    provider: string;
    status: string;
    connectedEmail: string | null;
    scopes: string[];
  } | null;
}

const STATUS_LABEL: Record<string, string> = {
  connected: "接続済み",
  not_connected: "未接続",
  needs_reauth: "再認証が必要",
  permission_error: "権限エラー",
  expired: "期限切れ",
  disabled: "無効化",
};

/**
 * Integrations settings (spec §5-9): shows the ACTING user's own Google
 * connection status and lets them Connect/Disconnect. "Connect" is a plain
 * top-level navigation to /api/integrations/google/start (never a fetch —
 * the browser must actually leave for Google's consent screen), so this
 * component never itself calls Google or touches a token.
 */
export default function IntegrationsPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/integrations");
    if (res.ok) setStatus(await res.json());
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/integrations").then(async (res) => {
      if (res.ok && !cancelled) setStatus(await res.json());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function disconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch("/api/integrations/google/disconnect", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(body.error ?? "連携解除に失敗しました");
        return;
      }
      await load();
    } finally {
      setDisconnecting(false);
    }
  }

  const connection = status?.connection ?? null;
  const isConnected = connection?.status === "connected";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="閉じる" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative z-10 flex h-full w-full max-w-[480px] flex-col overflow-y-auto border-l p-5 shadow-2xl"
        style={{ borderColor: "var(--office-border)", background: "var(--office-bg-secondary)", color: "var(--office-text-primary)" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">連携設定</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm hover:bg-white/10" style={{ color: "var(--office-text-secondary)" }}>
            閉じる
          </button>
        </div>

        {toast && (
          <p className="mt-2 text-[12px]" style={{ color: "var(--office-status-failed)" }}>
            {toast}
          </p>
        )}

        <section className="mt-4 rounded-lg border p-3" style={{ borderColor: "var(--office-border)", background: "var(--office-surface)" }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Google (Gmail / Calendar)</span>
            {status && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ color: isConnected ? "var(--office-status-success)" : "var(--office-text-muted)" }}
              >
                {STATUS_LABEL[connection?.status ?? "not_connected"]}
              </span>
            )}
          </div>

          {status === null ? (
            <p className="mt-2 text-[12px]" style={{ color: "var(--office-text-muted)" }}>
              読み込み中...
            </p>
          ) : !status.configured ? (
            <p className="mt-2 text-[12px]" style={{ color: "var(--office-text-muted)" }}>
              この環境ではGoogle連携が未設定です（GOOGLE_OAUTH_CLIENT_ID未設定）。営業メール・商談カレンダーはSimulatedモードで動作します。
            </p>
          ) : (
            <>
              {isConnected && connection?.connectedEmail && (
                <p className="mt-2 text-[12px]" style={{ color: "var(--office-text-secondary)" }}>
                  接続アカウント: {connection.connectedEmail}
                </p>
              )}
              {connection?.status === "needs_reauth" && (
                <p className="mt-2 text-[12px]" style={{ color: "var(--office-status-warning)" }}>
                  トークンの有効期限が切れました。再接続してください。
                </p>
              )}
              <p className="mt-2 text-[11px]" style={{ color: "var(--office-text-muted)" }}>
                未接続または再認証が必要な間は、営業メール送信・商談カレンダー登録はSimulatedモード（外部に一切送信されない安全な代替実装）で動作します。
              </p>
              <div className="mt-3 flex gap-2">
                {!isConnected && (
                  <a
                    href="/api/integrations/google/start"
                    className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
                    style={{ background: "var(--office-ai-accent)" }}
                  >
                    {connection ? "再接続する" : "Googleを接続する"}
                  </a>
                )}
                {isConnected && (
                  <button
                    disabled={disconnecting}
                    onClick={disconnect}
                    className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
                    style={{ background: "var(--office-status-failed)" }}
                  >
                    連携を解除する
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
