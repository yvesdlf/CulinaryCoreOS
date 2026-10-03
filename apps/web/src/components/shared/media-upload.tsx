// ---------------------------------------------------------------------------
// Choosing photographs and short video
// ---------------------------------------------------------------------------
// Three decisions, all of them about staying honest with the person using it.
//
// **It stages, it does not upload.** The component hands the chosen files back
// to the dialog, which uploads them once the record is saved. Uploading on
// choice would be simpler and wrong: `attachments` is append-only, so a
// photograph attached and then abandoned by pressing Cancel could never be
// removed. Cancel has to mean cancel.
//
// **The limits come from the database.** `media_limits()` is the one list, and
// the bucket configuration and the insert trigger both read it. Hard-coding it
// here would make this screen a fourth opinion, and the opinion in the browser
// is always the one that goes stale. If the list cannot be fetched the picker
// still works — the database refuses what it must, and a screen that will not
// open because it could not load its advice is worse than a screen with no
// advice.
//
// **A file that will not do is named, with the reason.** The same rule as the
// imports: report what will not go, by name, and never silently drop it. "Some
// files were not accepted" tells somebody nothing about which photograph of
// the leak is missing.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Film, ImageIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  fetchMediaLimits, MAX_VIDEO_SECONDS,
  type MediaLimit, type StagedMedia,
} from "@/data/repository";

/** Megabytes to one decimal, which is how a phone describes a photograph. */
function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * How long a video runs, asked of the browser.
 *
 * Postgres cannot open an MP4 and count frames, so the duration in the
 * attachment row is whatever the client declares. Measuring it here is what
 * makes that declaration true, and the thirty-second refusal in the database
 * is what makes it matter. A file the browser cannot read metadata for comes
 * back null, which the database accepts — the byte cap is the backstop and it
 * is a tighter limit than thirty seconds for anything a phone records.
 */
function videoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    probe.onloadedmetadata = () =>
      done(Number.isFinite(probe.duration) ? Math.round(probe.duration) : null);
    probe.onerror = () => done(null);
    probe.src = url;
  });
}

interface Rejected {
  name: string;
  reason: string;
}

export function MediaUpload({
  value,
  onChange,
  disabled = false,
  label = "Photographs",
  id = "media-upload",
  hint,
}: {
  value: StagedMedia[];
  onChange: (items: StagedMedia[]) => void;
  disabled?: boolean;
  label?: string;
  id?: string;
  hint?: string;
}) {
  const [limits, setLimits] = useState<MediaLimit[] | null>(null);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [reading, setReading] = useState(false);
  /*
   * Bumped after every choice, and used as the input's key.
   *
   * A file input holds the last selection, so choosing the same photograph
   * twice fires no change event and the second attempt silently does nothing.
   * The obvious fix is a ref and `input.value = ""`, which is what
   * `staff-comms-tab.tsx` does — and on React 18 a ref passed to a function
   * component never arrives, so that line has always been a no-op. Remounting
   * the input works on both.
   */
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    void fetchMediaLimits()
      .then((rows) => { if (live) setLimits(rows); })
      // Deliberately silent. The advice is unavailable; the control is not.
      .catch(() => { if (live) setLimits([]); });
    return () => { live = false; };
  }, []);

  const accept = useMemo(
    () => (limits && limits.length > 0 ? limits.map((l) => l.mimeType).join(",") : undefined),
    [limits],
  );

  const imageCap = useMemo(
    () => limits?.find((l) => l.kind === "IMAGE")?.maxBytes ?? null,
    [limits],
  );
  const videoCap = useMemo(
    () => limits?.find((l) => l.kind === "VIDEO")?.maxBytes ?? null,
    [limits],
  );

  async function choose(files: FileList | null) {
    if (!files || files.length === 0) return;
    setReading(true);
    const kept: StagedMedia[] = [];
    const refused: Rejected[] = [];

    for (const file of Array.from(files)) {
      const limit = limits?.find((l) => l.mimeType === file.type);
      if (limits && limits.length > 0 && !limit) {
        refused.push({
          name: file.name,
          reason: file.type
            ? `${file.type} is not a photograph or a short clip`
            : "the browser could not say what kind of file this is",
        });
        continue;
      }
      if (limit && file.size > limit.maxBytes) {
        refused.push({
          name: file.name,
          reason: `${sizeText(file.size)}, over the ${sizeText(limit.maxBytes)} limit`,
        });
        continue;
      }

      let duration: number | null = null;
      if (file.type.startsWith("video/")) {
        duration = await videoDuration(file);
        if (duration !== null && duration > MAX_VIDEO_SECONDS) {
          refused.push({
            name: file.name,
            reason: `${duration} seconds, over the ${MAX_VIDEO_SECONDS}-second limit`,
          });
          continue;
        }
      }
      kept.push({ file, durationSeconds: duration, caption: null });
    }

    setRejected(refused);
    setReading(false);
    onChange([...value, ...kept]);
    setRound((n) => n + 1);
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        key={round}
        id={id}
        type="file"
        multiple
        accept={accept}
        capture="environment"
        disabled={disabled || reading}
        onChange={(e) => void choose(e.target.files)}
      />
      <p className="text-xs text-muted-foreground">
        {hint ??
          "A photograph of the fault saves the next person a journey. " +
          "Video is capped hard on purpose — a clip costs as much to keep as " +
          "four hundred photographs."}
        {imageCap !== null && videoCap !== null && (
          <>
            {" "}Up to {sizeText(imageCap)} a photograph, {sizeText(videoCap)} and{" "}
            {MAX_VIDEO_SECONDS} seconds a clip.
          </>
        )}
      </p>

      {rejected.length > 0 && (
        <ul className="space-y-1 text-xs text-destructive">
          {rejected.map((r) => (
            <li key={r.name}>
              <span className="font-medium">{r.name}</span> was not added: {r.reason}.
            </li>
          ))}
        </ul>
      )}

      {value.length > 0 && (
        <ul className="space-y-1">
          {value.map((item, index) => (
            <li
              key={`${item.file.name}-${index}`}
              className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
            >
              {item.file.type.startsWith("video/")
                ? <Film className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                : <ImageIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {sizeText(item.file.size)}
                {item.durationSeconds !== null && ` · ${item.durationSeconds}s`}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                disabled={disabled}
                aria-label={`Remove ${item.file.name}`}
                onClick={() => remove(index)}
              >
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
          <li className="text-xs text-muted-foreground">
            Attached when this is saved. Once attached they cannot be removed —
            a photograph somebody can quietly take down is not evidence.
          </li>
        </ul>
      )}
    </div>
  );
}
