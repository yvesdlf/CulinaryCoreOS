// ---------------------------------------------------------------------------
// The four ways a report leaves the screen
// ---------------------------------------------------------------------------
// CSV, Excel, Word and PDF, from one definition (`report-export.ts`). Four
// buttons rather than a menu: they are the point of the screen for anybody
// preparing a department-head meeting, and a format hidden behind a chevron
// is a format people ask whether the app has.
//
// The sheet is built lazily, when a format is clicked, so a report nobody
// exports costs nothing to assemble — and so the file always reflects what is
// on screen at the moment it is asked for rather than when the page loaded.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { writeReport, type ReportFormat, type ReportSheet } from "@/lib/report-export";

function said(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^\w+(\([^)]*\))? failed: /, "");
}

export function ExportMenu({
  build,
  disabled,
}: {
  /** Called when a format is chosen, so the file matches the screen now. */
  build: () => ReportSheet;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState<ReportFormat | null>(null);

  async function run(format: ReportFormat) {
    setBusy(format);
    try {
      await writeReport(build(), format);
    } catch (err) {
      /*
       * Said rather than swallowed. Excel and Word are fetched on demand, so
       * the failure people will actually hit is a network that dropped
       * between opening the page and asking for the file — and "nothing
       * happened" is the worst possible response to clicking Download.
       */
      toast.error("The file could not be produced", { description: said(err) });
    } finally {
      setBusy(null);
    }
  }

  const spin = (f: ReportFormat) =>
    busy === f ? <Loader2 className="animate-spin" aria-hidden="true" /> : null;

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button variant="outline" size="sm" disabled={disabled || busy !== null}
              onClick={() => void run("csv")}>
        {spin("csv") ?? <Download aria-hidden="true" />}
        CSV
      </Button>
      <Button variant="outline" size="sm" disabled={disabled || busy !== null}
              onClick={() => void run("xlsx")}>
        {spin("xlsx") ?? <FileSpreadsheet aria-hidden="true" />}
        Excel
      </Button>
      <Button variant="outline" size="sm" disabled={disabled || busy !== null}
              onClick={() => void run("docx")}>
        {spin("docx") ?? <FileText aria-hidden="true" />}
        Word
      </Button>
      <Button variant="outline" size="sm" disabled={disabled || busy !== null}
              onClick={() => void run("pdf")}>
        <Printer aria-hidden="true" />
        Print or PDF
      </Button>
    </div>
  );
}
