"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type MagicLinkStatus = "idle" | "sending" | "sent" | "error";

const AUTH_CALLBACK_PATH = "/auth/callback";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.92l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.11C3.24 21.3 7.28 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28V6.61H1.26A11.97 11.97 0 0 0 0 12c0 1.93.46 3.76 1.26 5.39l4.01-3.11z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0 7.28 0 3.24 2.7 1.26 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M16.365 1.43c0 1.14-.462 2.208-1.213 3.005-.83.882-2.163 1.57-3.29 1.478-.14-1.1.44-2.256 1.19-3.02.83-.86 2.29-1.51 3.313-1.463zM20.9 17.24c-.55 1.27-.81 1.84-1.52 2.96-.99 1.56-2.39 3.5-4.12 3.52-1.54.02-1.94-1-4.03-1-2.1 0-2.55 1-4.03 1.02-1.68.02-2.96-1.68-3.95-3.24-2.71-4.24-2.99-9.21-1.32-11.86 1.18-1.87 3.05-2.97 4.81-2.97 1.79 0 2.91 1.02 4.4 1.02 1.44 0 2.31-1.02 4.39-1.02 1.57 0 3.24.86 4.42 2.34-3.89 2.13-3.26 7.68.43 9.23z" />
    </svg>
  );
}

export default function LoginView() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<MagicLinkStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleOAuthLogin = async (provider: "google" | "apple") => {
    setErrorMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}${AUTH_CALLBACK_PATH}`,
      },
    });
    if (error) {
      setErrorMessage(error.message);
    }
  };

  const handleMagicLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setStatus("sending");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}${AUTH_CALLBACK_PATH}`,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setStatus("sent");
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-neutral-50 to-neutral-100 px-5 py-16 dark:from-neutral-950 dark:to-neutral-900">
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-neutral-400 uppercase dark:text-neutral-600">
            YATTORU
          </p>
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl dark:text-white">
            ログイン
          </h1>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            今日のタスクを始めましょう。
          </p>
        </header>

        <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_40px_-20px_rgba(15,23,42,0.18)] sm:p-8 dark:border-white/10 dark:bg-neutral-900">
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => handleOAuthLogin("google")}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-full border border-neutral-200 bg-white text-sm font-semibold text-neutral-800 transition-colors hover:bg-neutral-50 dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
            >
              <GoogleIcon />
              Googleで続ける
            </button>

            <button
              type="button"
              onClick={() => handleOAuthLogin("apple")}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-neutral-900 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              <AppleIcon />
              Appleで続ける
            </button>
          </div>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-neutral-200 dark:bg-white/10" />
            <span className="text-xs text-neutral-400">または</span>
            <div className="h-px flex-1 bg-neutral-200 dark:bg-white/10" />
          </div>

          {status === "sent" ? (
            <p className="rounded-xl bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:bg-white/5 dark:text-neutral-300">
              {email} にログイン用のリンクを送信しました。メールをご確認ください。
            </p>
          ) : (
            <form onSubmit={handleMagicLink} className="space-y-3">
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="メールアドレス"
                className="h-11 w-full rounded-xl border border-neutral-200 bg-white px-4 text-sm text-neutral-900 outline-none focus:border-neutral-400 dark:border-white/15 dark:bg-white/5 dark:text-white"
              />
              <Button type="submit" size="lg" className="w-full" disabled={status === "sending"}>
                {status === "sending" ? "送信中..." : "ログインリンクを送信"}
              </Button>
            </form>
          )}

          {errorMessage && (
            <p className="mt-4 text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
          )}
        </section>
      </div>
    </main>
  );
}
