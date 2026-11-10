// ---------------------------------------------------------------------------
// The venue's logo, where there is one
// ---------------------------------------------------------------------------
// Renders nothing at all when the venue has not set one. Not a placeholder,
// not a box with initials in it, nothing — because every surface this appears
// on is a document, and a grey rectangle where a logo belongs reads as a file
// that failed to load. A venue with no logo should look like a venue that
// never wanted one.
//
// The same reasoning covers an image that fails: `onError` clears it rather
// than leaving the browser's broken-image mark on a sheet somebody is about
// to send to their accountant.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";

import { fetchLogoUrl } from "@/data/branding";
import { isSupabaseConfigured } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export function VenueLogo({
  venueName,
  className,
}: {
  /** Used as the alternative text: on paper the name is already beside it. */
  venueName?: string | null;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!isSupabaseConfigured) return;
    fetchLogoUrl()
      .then((found) => { if (live) setUrl(found); })
      .catch(() => { if (live) setUrl(null); });
    return () => { live = false; };
  }, []);

  if (!url) return null;

  return (
    <img
      src={url}
      alt={venueName ? `${venueName} logo` : "Venue logo"}
      onError={() => setUrl(null)}
      className={cn("h-10 w-auto max-w-[180px] object-contain", className)}
    />
  );
}
