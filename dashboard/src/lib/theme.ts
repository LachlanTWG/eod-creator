export type Theme = "dark" | "light";

export const THEME_KEY = "tsd-theme";
export const THEME_COOKIE = "tsd-theme";

export function parseTheme(raw: string | null | undefined): Theme {
  return raw === "light" ? "light" : "dark";
}

export const THEME_COOKIE_OPTS = {
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  sameSite: "lax" as const,
};

// First-paint script. /eod-entry is always dark (GHL iframe, no login).
// Dashboard: query → cookie (set on login / Settings) → dark.
// Do not read the old localStorage default ("light") — that is what made
// the app and popup flash white.
export const THEME_BOOT = `(function(){try{var t=null;if(location.pathname.indexOf("/eod-entry")===0){t="dark";}else{var q=new URLSearchParams(location.search).get("theme");if(q==="dark"||q==="light")t=q;if(!t){var m=document.cookie.match(/(?:^|; )tsd-theme=(dark|light)/);if(m)t=m[1];}}if(t!=="dark"&&t!=="light")t="dark";var r=document.documentElement;r.classList.toggle("dark",t==="dark");r.style.colorScheme=t;}catch(e){}})();`;

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
  try {
    document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_COOKIE_OPTS.maxAge}; SameSite=Lax`;
  } catch { /* ignore */ }
}
