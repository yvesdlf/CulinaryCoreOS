// ---------------------------------------------------------------------------
// What people are paid
// ---------------------------------------------------------------------------
// The only tab in this application that most people with People access cannot
// see. `PAY` is its own grant in the access grid and nobody holds it by
// default — not even an administrator, who has WRITE on everything else. The
// tab is not drawn without it, and the database refuses the read anyway, which
// is the pair this codebase insists on: the screen is a courtesy and the
// policy is the control.
//
// Two things this screen will not let somebody do, both enforced underneath as
// well:
//
//   Change a rate that has already been in force. A rate is a period, and the
//   way to end one is to start the next. Editing a rate that costed March
//   rewrites March, quietly, in a figure somebody has already acted on.
//
//   See a cost for somebody with no rate. A blank is shown and said out loud,
//   rather than a zero — "nobody has set a rate" and "they cost nothing" are
//   different statements, and summing the second gives a labour figure that is
//   too good by exactly the wages of everybody nobody got round to entering.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Wallet } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { fullName, isWorking, type Employee } from "@/engine/people";
import {
  fetchPayRates, setPayRate, type PayRate, type PayBasis,
} from "@/data/repository";

/** Today, as the date input wants it. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PayTab({
  employees, canWrite,
}: {
  employees: Employee[];
  canWrite: boolean;
}) {
  const [rates, setRates] = useState<PayRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setRates(await fetchPayRates());
    } catch (err) {
      toast.error("Could not read the rates", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  /*
   * The rate in force today, per person. The list comes back newest first, so
   * the first row at or before today is the one in force — the same rule
   * `pay_rate_on` applies in the database, and it has to be the same rule or
   * the screen and the costing disagree.
   */
  const current = useMemo(() => {
    const today = todayISO();
    const out = new Map<string, PayRate>();
    for (const r of rates) {
      if (r.effectiveFrom > today) continue;
      if (!out.has(r.employeeId)) out.set(r.employeeId, r);
    }
    return out;
  }, [rates]);

  const pending = useMemo(() => {
    const today = todayISO();
    const out = new Map<string, PayRate>();
    for (const r of rates) {
      if (r.effectiveFrom <= today) continue;
      // Newest first, so the last future row seen is the soonest.
      out.set(r.employeeId, r);
    }
    return out;
  }, [rates]);

  const working = employees.filter(isWorking);
  const unrated = working.filter((e) => !current.has(e.id));

  if (loading) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      {unrated.length > 0 && (
        <Card className="border-amber-500/40">
          <CardContent className="py-4 text-sm">
            <p className="font-medium">
              {unrated.length} {unrated.length === 1 ? "person has" : "people have"} no rate
            </p>
            <p className="text-muted-foreground">
              Their work costs nothing in the labour figure, which makes it too
              good by exactly their wages. {unrated.map(fullName).join(", ")}.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Wallet aria-hidden="true" className="size-4" /> Rates
          </CardTitle>
          <p className="pt-1 text-xs text-muted-foreground">
            A rate runs from a date until the next one starts. A rate that has
            already been in force cannot be changed — set the next one instead,
            and both stay on the record.
          </p>
        </CardHeader>
        <CardContent>
          {working.length === 0 ? (
            <EmptyState icon={Wallet} title="Nobody on the books">
              A rate is set against an employee record, so somebody has to exist
              before they can be paid.
            </EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Basis</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead>Next</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {working.map((e) => {
                  const now = current.get(e.id);
                  const next = pending.get(e.id);
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{fullName(e)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {now ? (now.basis === "HOURLY" ? "Per hour" : "Per month") : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {now
                          ? <CurrencyDisplay value={now.amount} />
                          : <span className="text-muted-foreground">Not set</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {now?.effectiveFrom ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {next
                          ? <><CurrencyDisplay value={next.amount} /> from {next.effectiveFrom}</>
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canWrite}
                          onClick={() => setEditing(editing === e.id ? null : e.id)}
                        >
                          {editing === e.id ? "Cancel" : "Set a rate"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {editing && (
            <SetRateForm
              employee={working.find((e) => e.id === editing)!}
              onDone={() => { setEditing(null); void load(); }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SetRateForm({
  employee, onDone,
}: {
  employee: Employee;
  onDone: () => void;
}) {
  const [basis, setBasis] = useState<PayBasis>("HOURLY");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  const valid = amount.trim() !== "" && Number(amount) >= 0 && from !== "";

  async function save() {
    setBusy(true);
    try {
      await setPayRate({
        employeeId: employee.id,
        basis,
        amount: amount.trim(),
        effectiveFrom: from,
      });
      toast.success(`Rate set for ${fullName(employee)}`, {
        description: `From ${from}. Anything costed before that keeps its old rate.`,
      });
      onDone();
    } catch (err) {
      toast.error("Could not set the rate", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3 rounded-lg border p-3">
      <p className="text-sm font-medium">{fullName(employee)}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="rate-basis">Basis</Label>
          <select
            id="rate-basis"
            className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
            value={basis}
            onChange={(e) => setBasis(e.target.value as PayBasis)}
          >
            <option value="HOURLY">Per hour</option>
            <option value="MONTHLY">Per month</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="rate-amount">Amount</Label>
          <Input
            id="rate-amount"
            type="number"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="rate-from">From</Label>
          <Input
            id="rate-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {basis === "HOURLY"
          ? "Costs what is worked, so a day off costs nothing."
          : "Costs the same whether they work or not, spread over the days of each month."}
      </p>
      <div className="flex justify-end">
        <Button size="sm" disabled={!valid || busy} onClick={() => void save()}>
          Set it
        </Button>
      </div>
    </div>
  );
}
