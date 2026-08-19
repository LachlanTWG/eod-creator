"use client";

import { useState, useTransition } from "react";
import { applyTheme, type Theme } from "@/lib/theme";
import { saveTheme } from "./actions";

export function AppearancePicker({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function pick(next: Theme) {
    if (next === theme) return;
    setError(null);
    setTheme(next);
    applyTheme(next);
    startTransition(async () => {
      const res = await saveTheme(next);
      if (!res.ok) {
        setError(res.error);
        setTheme(initial);
        applyTheme(initial);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <ThemeCard
          label="Dark"
          hint="Original look — zinc and emerald."
          active={theme === "dark"}
          pending={pending}
          onClick={() => pick("dark")}
          preview="dark"
        />
        <ThemeCard
          label="Light"
          hint="White and blue."
          active={theme === "light"}
          pending={pending}
          onClick={() => pick("light")}
          preview="light"
        />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

function ThemeCard({
  label, hint, active, pending, onClick, preview,
}: {
  label: string;
  hint: string;
  active: boolean;
  pending: boolean;
  onClick: () => void;
  preview: Theme;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`rounded-lg border p-4 text-left transition-colors disabled:opacity-60 ${
        active
          ? "border-emerald-500/70 bg-zinc-900/40"
          : "border-zinc-800 bg-zinc-900/20 hover:border-zinc-700"
      }`}
    >
      <div className={`mb-3 h-16 overflow-hidden rounded border ${
        preview === "dark" ? "border-zinc-700 bg-zinc-950" : "border-slate-200 bg-slate-50"
      }`}>
        <div className={`h-full w-1/3 ${preview === "dark" ? "bg-zinc-900" : "bg-white"}`} />
      </div>
      <div className="text-sm font-medium text-zinc-100">{label}</div>
      <div className="mt-0.5 text-[11px] text-zinc-500">{hint}</div>
      {active && <div className="mt-2 text-[10px] uppercase tracking-wider text-emerald-400">Selected</div>}
    </button>
  );
}
