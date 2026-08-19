"use client";

import { useEffect } from "react";
import { applyTheme, type Theme } from "@/lib/theme";

/** After login, stamp the profile theme onto the document + cookie. */
export function ThemeSync({ theme }: { theme: Theme }) {
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return null;
}
