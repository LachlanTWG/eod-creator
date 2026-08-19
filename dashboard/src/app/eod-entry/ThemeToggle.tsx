"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const EOD_THEME_KEY = "tsd-eod-theme";

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
  }, []);

  if (!mounted) {
    // Render a placeholder that takes up the same space to avoid layout shift.
    return <span className="inline-block h-4 w-4" aria-hidden />;
  }

  function toggle() {
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.style.colorScheme = next ? "dark" : "light";
    try {
      localStorage.setItem(EOD_THEME_KEY, next ? "dark" : "light");
    } catch {
      /* storage unavailable */
    }
    setIsDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="text-zinc-400 hover:text-zinc-200"
    >
      {isDark ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </button>
  );
}
