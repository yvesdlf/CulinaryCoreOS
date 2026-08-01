// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
// The toggle used to write nothing but a class on <html>, so the choice lasted
// exactly as long as the page did: switch to dark, reload, back to light. A
// preference that has to be re-stated every visit is not a preference.
//
// Applied before React renders, so the first paint is already the right theme
// rather than a flash of light followed by a correction.
// ---------------------------------------------------------------------------

export type Theme = "light" | "dark";

const KEY = "ccos-theme";

/** The stored choice, or the operating system's if none has been made. */
export function preferredTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  // Tells the browser which scrollbar and form-control palette to use; without
  // it the native controls stay light on a dark page.
  document.documentElement.style.colorScheme = theme;
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

export function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Call once, before render. */
export function initTheme(): void {
  applyTheme(preferredTheme());
}
