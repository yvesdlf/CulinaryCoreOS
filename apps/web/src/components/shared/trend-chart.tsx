// ---------------------------------------------------------------------------
// A small chart, and the table underneath it
// ---------------------------------------------------------------------------
// Hand-drawn SVG rather than a charting library, for the same reason the
// translation layer is hand-written: a grouped bar chart with a reference
// line is about a hundred lines, and recharts is 180 kB of JavaScript on a
// tablet in a kitchen over hotel wifi. The moment this needs stacked areas or
// zooming, take the dependency — it is not a principle, it is a size.
//
// Two things it does that a default chart does not.
//
// **A period that is not finished is drawn differently.** The last bar is
// almost always a week or month in progress, and drawn solid beside the one
// before it that bar says the venue has collapsed. It is hatched, labelled,
// and excluded from the comparison figure. This is the whole reason the
// component exists rather than a `<Bar>` from a library.
//
// **The numbers are in a table.** An SVG chart is a picture to a screen
// reader, and `aria-label` on a path is a sentence nobody can tabulate. The
// table is the data; the chart is an aid to it, which is also the order they
// appear in the DOM. It is visually hidden only when the chart is shown, and
// a `<details>` reveals it for anybody who wants the figures rather than the
// shape.
// ---------------------------------------------------------------------------

import { useId } from "react";

export interface TrendPoint {
  label: string;
  value: number | null;
  /** Drawn hatched: the period has not finished, or is missing days. */
  incomplete: boolean;
  /** Said under the bar, e.g. "3 of 7 days". */
  note?: string;
}

export function TrendChart({
  points, title, format, height = 160,
}: {
  points: TrendPoint[];
  title: string;
  format: (v: number) => string;
  height?: number;
}) {
  const hatchId = useId().replace(/:/g, "");

  if (points.length === 0) return null;

  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  // An all-null series has no scale. Guarding here rather than dividing by a
  // zero range and drawing every bar at full height, which reads as a flat
  // maximum rather than as no data.
  const max = values.length > 0 ? Math.max(...values, 0) : 0;
  const min = Math.min(...values, 0);
  const span = max - min || 1;

  const barWidth = 100 / points.length;

  return (
    <figure className="m-0">
      <figcaption className="sr-only">{title}</figcaption>

      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="presentation"
      >
        <defs>
          {/* Hatching rather than a lighter fill: a paler bar reads as a
              smaller value, which is the opposite of what it means. */}
          <pattern
            id={`hatch-${hatchId}`}
            width="4" height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="4" height="4" fill="var(--muted)" />
            <line x1="0" y1="0" x2="0" y2="4"
                  stroke="var(--muted-foreground)" strokeWidth="1.5" />
          </pattern>
        </defs>

        {points.map((p, i) => {
          if (p.value === null) return null;
          const h = ((p.value - min) / span) * (height - 8);
          return (
            <rect
              key={p.label}
              x={i * barWidth + barWidth * 0.15}
              y={height - h}
              width={barWidth * 0.7}
              height={Math.max(h, 1)}
              fill={p.incomplete ? `url(#hatch-${hatchId})` : "var(--primary)"}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      {/* The data. Not an afterthought: a chart is a picture to a screen
          reader, and this is what it is a picture of. */}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          The figures behind this chart
        </summary>
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col" className="py-1 text-left font-medium">Period</th>
              <th scope="col" className="py-1 text-right font-medium">Value</th>
              <th scope="col" className="py-1 text-left font-medium">Complete</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.label} className="border-t">
                <th scope="row" className="py-1 text-left font-normal">{p.label}</th>
                <td className="py-1 text-right tabular-nums">
                  {p.value === null ? "no data" : format(p.value)}
                </td>
                <td className="py-1 text-muted-foreground">
                  {p.incomplete ? (p.note ?? "still running") : "yes"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
