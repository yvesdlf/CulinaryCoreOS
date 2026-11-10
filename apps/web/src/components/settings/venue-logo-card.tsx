// ---------------------------------------------------------------------------
// Putting the venue's own mark on its documents
// ---------------------------------------------------------------------------
// The upload half of 0128. Deliberately small: one image, one place, no
// cropping, no colours, no theme. A venue that wants its documents to look
// like theirs needs its logo on them; everything beyond that is a design
// tool, and this is a costing system.
//
// The card says where the logo will appear, because that is the part nobody
// can guess. It goes on the documents that leave the building — printed
// sheets and the PDFs the reports save as — and not on the application's own
// chrome. A venue manager who uploads a logo and then cannot find it on any
// screen has been given a feature that looks broken.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchLogoUrl, uploadLogo, removeLogo, LOGO_MAX_BYTES, LOGO_TYPES,
} from "@/data/branding";

function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\w+(\([^)]*\))? failed: /, "");
}

export function VenueLogoCard({ disabled }: { disabled?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      setUrl(await fetchLogoUrl());
    } catch {
      setUrl(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function onPicked(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      await uploadLogo(file);
      await load();
      toast.success("Logo updated", {
        description: "It appears on printed sheets and saved PDFs.",
      });
    } catch (err) {
      /*
       * The refusal in the database's words, not "upload failed". The two
       * things that get refused are a file that is too big and a format the
       * bucket does not take, and both are things the person can fix if they
       * are told which.
       */
      toast.error("Logo not changed", { description: said(err) });
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Venue logo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Printed sheets and saved PDFs carry this instead of the venue's name
          on its own — the recipe cards, the collection packs and every report.
          It is not used anywhere inside the app.
        </p>

        <div className="flex items-center gap-4">
          <div className="flex h-16 w-40 items-center justify-center rounded-lg border border-dashed border-border">
            {loading ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
            ) : url ? (
              <img src={url} alt="The venue's logo"
                   className="max-h-14 max-w-36 object-contain" />
            ) : (
              <span className="text-xs text-muted-foreground">None set</span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <input
              ref={picker}
              type="file"
              accept={LOGO_TYPES.join(",")}
              className="sr-only"
              aria-label="Choose a logo image"
              onChange={(e) => void onPicked(e.target.files?.[0])}
            />
            <Button
              variant="outline" size="sm" disabled={disabled || busy}
              onClick={() => picker.current?.click()}
            >
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" />
                    : <ImageUp aria-hidden="true" />}
              {url ? "Replace" : "Upload"}
            </Button>
            {url && (
              <Button
                variant="ghost" size="sm" disabled={disabled || busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await removeLogo();
                    setUrl(null);
                    toast.success("Logo removed", {
                      description: "Documents go back to the venue's name in text.",
                    });
                  } catch (err) {
                    toast.error("Logo not removed", { description: said(err) });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Trash2 aria-hidden="true" />
                Remove
              </Button>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          PNG, JPEG or WebP, up to {LOGO_MAX_BYTES / 1024} KB. It prints about
          two centimetres wide, so a large photograph is only a large file.
          {" "}SVG is not accepted: it is a document rather than a picture, and
          these end up in PDFs sent outside the venue.
        </p>
      </CardContent>
    </Card>
  );
}
