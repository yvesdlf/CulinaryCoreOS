// ---------------------------------------------------------------------------
// Which language this screen is in
// ---------------------------------------------------------------------------
// Each language is named in itself — "Bahasa Indonesia", not "Indonesian" —
// because a list written in the reader's current language is no use to the
// person who cannot read it. That is the whole reason somebody opens this.
//
// A plain select rather than a styled menu: it is the control most likely to
// be used by somebody who cannot read the screen around it, and a native
// select is the one thing every assistive technology and every cheap Android
// tablet already handles.
// ---------------------------------------------------------------------------

import { Languages } from "lucide-react";

import { LOCALES, LOCALE_NAMES, isLocale } from "@/lib/i18n/core";
import { useLocaleStore } from "@/stores/locale-store";

export function LanguagePicker({ className }: { className?: string }) {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const t = useLocaleStore((s) => s.t);

  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <Languages className="size-4 text-muted-foreground" aria-hidden="true" />
      <select
        aria-label={t("lang.label")}
        className="h-9 rounded-md border bg-transparent px-2 text-sm"
        value={locale}
        onChange={(e) => {
          if (isLocale(e.target.value)) setLocale(e.target.value);
        }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>{LOCALE_NAMES[l]}</option>
        ))}
      </select>
    </span>
  );
}
