// ---------------------------------------------------------------------------
// Settings — who has access, and what the venue's rules are
// ---------------------------------------------------------------------------
// Membership is here because without it none of the separation-of-duties
// controls can be used. They need a second person, and until this page existed
// there was no way to add one: an owner was blocked from approving their own
// requisitions and had no means of inviting anybody who could approve them.
//
// Every rule shown is enforced by the database, not by this screen. An admin
// cannot appoint an owner, nobody changes their own role, and the last owner
// cannot be removed — whichever client is asking.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { UserPlus, ShieldCheck, Mail, X, Check, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fetchOrgPeople, fetchInvitations, fetchMyInvitations, inviteToOrg,
  revokeInvitation, acceptInvitation, setMemberRole, removeMember, fetchMyRole,
  fetchApprovalPolicies, fetchTaxRates, saveTaxRate, setDefaultTaxRate,
  fetchCategoryTaxRates, setCategoryTaxRate, fetchMessageChannels,
  saveMessageChannel, fetchDeliveryHealth,
  type OrgPerson, type Invitation, type TaxRate, type CategoryTaxRate,
  type MessageChannel,
} from "@/data/repository";
import { useRecipeStore } from "@/stores/recipe-store";
import { Percent, MessageSquare } from "lucide-react";
import type { OrgRole, ApprovalPolicy } from "@/engine/purchasing";
import { CurrencyDisplay } from "@/components/shared/currency-display";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const ROLES: { value: OrgRole; label: string; can: string }[] = [
  { value: "OWNER", label: "Owner", can: "Everything, including managing owners and the highest approvals." },
  { value: "ADMIN", label: "Administrator", can: "Everything except appointing owners. Approves larger spend." },
  { value: "CHEF", label: "Chef", can: "Creates and edits recipes, stock and requisitions. Approves smaller spend." },
  { value: "VIEWER", label: "Viewer", can: "Reads everything, changes nothing." },
];

export function SettingsPage() {
  const [people, setPeople] = useState<OrgPerson[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [mine, setMine] = useState<(Invitation & { organizationName: string | null })[]>([]);
  const [myRole, setMyRole] = useState<OrgRole | null>(null);
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [policies, setPolicies] = useState<ApprovalPolicy[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [categoryRates, setCategoryRates] = useState<CategoryTaxRate[]>([]);
  const [channels, setChannels] = useState<MessageChannel[]>([]);
  const [health, setHealth] = useState<{ status: string; count: number }[]>([]);
  const recipes = useRecipeStore((s) => s.recipes);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);

  async function load() {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    try {
      const [p, i, m, r, pol] = await Promise.all([
        fetchOrgPeople(), fetchInvitations(), fetchMyInvitations(),
        fetchMyRole(), fetchApprovalPolicies(),
      ]);
      setPeople(p); setInvitations(i); setMine(m); setMyRole(r); setPolicies(pol);
      const [tr, cr, ch, dh] = await Promise.all([
        fetchTaxRates(), fetchCategoryTaxRates(), fetchMessageChannels(),
        fetchDeliveryHealth(),
      ]);
      setTaxRates(tr); setCategoryRates(cr); setChannels(ch); setHealth(dh);
      const { data } = await supabase!.auth.getUser();
      setMyEmail(data.user?.email ?? null);
    } catch (err) {
      toast.error("Could not load settings", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const canManage = myRole === "OWNER" || myRole === "ADMIN";
  const owners = people.filter((p) => p.role === "OWNER").length;
  const pending = invitations.filter((i) => !i.acceptedAt && !i.revokedAt);

  const reqPolicies = useMemo(
    () => policies.filter((p) => p.documentType === "REQUISITION")
                  .sort((a, b) => Number(a.minAmount) - Number(b.minAmount)),
    [policies],
  );

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Who has access to this kitchen, and the rules the system enforces."
      >
        {canManage && (
          <Button onClick={() => setInviting(true)}>
            <UserPlus />
            Invite someone
          </Button>
        )}
      </PageHeader>

      {mine.length > 0 && (
        <div className="mb-6 space-y-2">
          {mine.map((inv) => (
            <div key={inv.id}
              className="flex items-center justify-between rounded-lg border border-status-info bg-status-info-soft p-4">
              <span className="text-sm">
                <Mail className="mr-2 inline size-4" />
                You have been invited to join{" "}
                <span className="font-medium">{inv.organizationName ?? "an organisation"}</span>{" "}
                as {inv.role.toLowerCase()}.
              </span>
              <Button size="sm" onClick={async () => {
                try {
                  await acceptInvitation(inv.id);
                  toast.success("Joined", { description: "Reload to see their data." });
                  await load();
                } catch (err) {
                  toast.error("Could not accept", {
                    description: err instanceof Error ? err.message : String(err),
                  });
                }
              }}>Accept</Button>
            </div>
          ))}
        </div>
      )}

      {people.length === 1 && (
        <div className="mb-6 flex gap-2 rounded-lg border border-status-warning bg-status-warning-soft p-4 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-status-warning" />
          <span>
            <span className="font-medium">You are the only person here.</span>{" "}
            Approvals need a second person: nobody may approve their own
            requisition or their own leave, whatever their role. Invite a
            colleague before relying on those controls.
          </span>
        </div>
      )}

      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people">
            <ShieldCheck className="size-4" />People ({people.length})
          </TabsTrigger>
          <TabsTrigger value="invitations">Invitations ({pending.length})</TabsTrigger>
          <TabsTrigger value="tax"><Percent className="size-4" />Tax</TabsTrigger>
          <TabsTrigger value="messaging"><MessageSquare className="size-4" />Messaging</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
        </TabsList>

        <TabsContent value="people" className="mt-4">
          {loading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Since</TableHead>
                    <TableHead className="w-px" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {people.map((p) => {
                    const isMe = p.email?.toLowerCase() === myEmail?.toLowerCase();
                    const lastOwner = p.role === "OWNER" && owners <= 1;
                    // An admin cannot act on an owner; nobody acts on themself.
                    const editable = canManage && !isMe && !lastOwner
                      && !(myRole === "ADMIN" && p.role === "OWNER");
                    return (
                      <TableRow key={p.userId}>
                        <TableCell className="font-medium">
                          {p.email ?? "—"}
                          {isMe && <span className="ml-2 text-xs text-muted-foreground">you</span>}
                        </TableCell>
                        <TableCell>
                          {editable ? (
                            <select
                              className="h-8 rounded-md border bg-transparent px-2 text-sm"
                              aria-label={`Role for ${p.email}`}
                              value={p.role}
                              onChange={async (e) => {
                                try {
                                  await setMemberRole(p.userId, e.target.value as OrgRole);
                                  toast.success(`${p.email} is now ${e.target.value.toLowerCase()}`);
                                  await load();
                                } catch (err) {
                                  toast.error("Refused", {
                                    description: err instanceof Error ? err.message : String(err),
                                  });
                                }
                              }}>
                              {ROLES.filter((r) => myRole === "OWNER" || r.value !== "OWNER")
                                    .map((r) => (
                                <option key={r.value} value={r.value}>{r.label}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-sm">{p.role.toLowerCase()}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {p.joinedAt?.slice(0, 10)}
                        </TableCell>
                        <TableCell>
                          {editable && (
                            <Button size="sm" variant="ghost"
                              onClick={async () => {
                                try {
                                  await removeMember(p.userId);
                                  toast.success(`${p.email} removed`);
                                  await load();
                                } catch (err) {
                                  toast.error("Refused", {
                                    description: err instanceof Error ? err.message : String(err),
                                  });
                                }
                              }}>
                              <X className="size-4" />
                              <span className="sr-only">Remove {p.email}</span>
                            </Button>
                          )}
                          {lastOwner && (
                            <span className="text-xs text-muted-foreground">last owner</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="invitations" className="mt-4">
          {invitations.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nobody invited yet. An invitation is by email; the person accepts
              it themself after signing up.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Invited by</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="w-px" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">{i.email}</TableCell>
                      <TableCell className="text-sm">{i.role.toLowerCase()}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {i.invitedByEmail ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {i.expiresAt?.slice(0, 10)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {i.acceptedAt ? (
                          <span className="inline-flex items-center gap-1 text-status-success">
                            <Check className="size-3" />accepted
                          </span>
                        ) : i.revokedAt ? (
                          <span className="text-muted-foreground">revoked</span>
                        ) : new Date(i.expiresAt) < new Date() ? (
                          <span className="text-status-warning">expired</span>
                        ) : (
                          <span className="text-status-info">pending</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {canManage && !i.acceptedAt && !i.revokedAt && (
                          <Button size="sm" variant="ghost"
                            onClick={async () => {
                              await revokeInvitation(i.id);
                              toast.success("Invitation revoked");
                              await load();
                            }}>
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="tax" className="mt-4">
          <TaxTab rates={taxRates} categoryRates={categoryRates}
            categories={[...new Set(recipes.map((r) => r.category))].sort()}
            canManage={canManage} onDone={load} />
        </TabsContent>

        <TabsContent value="messaging" className="mt-4">
          <MessagingTab channels={channels} health={health}
            canManage={canManage} onDone={load} />
        </TabsContent>

        <TabsContent value="rules" className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {ROLES.map((r) => (
              <Card key={r.value}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">{r.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{r.can}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Approval thresholds</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {reqPolicies.map((p) => (
                <p key={p.minAmount} className="text-sm">
                  From <CurrencyDisplay value={p.minAmount} />: approver must be{" "}
                  <span className="font-medium">{p.requiredRole.toLowerCase()}</span> or above.
                </p>
              ))}
              <p className="pt-2 text-xs text-muted-foreground">
                These are starting values, not your finance policy. Changing
                them is a database change today.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Enforced regardless of screen</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>Nobody approves a requisition or leave they raised themselves.</li>
                <li>Nobody changes their own role.</li>
                <li>Only an owner appoints another owner.</li>
                <li>The last owner cannot be removed or demoted.</li>
                <li>An invoice with unresolved exceptions cannot be approved for payment.</li>
                <li>A recalled or blocked stock lot cannot be used or transferred.</li>
                <li>Personal and bank details are readable only by owners, administrators, and the person themself.</li>
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {inviting && (
        <InviteDialog myRole={myRole} onClose={() => setInviting(false)}
          onDone={async () => { setInviting(false); await load(); }} />
      )}
    </div>
  );
}

function InviteDialog({ myRole, onClose, onDone }: {
  myRole: OrgRole | null; onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("CHEF");
  const [busy, setBusy] = useState(false);
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite someone</DialogTitle>
          <DialogDescription>
            They sign up with this address and accept the invitation
            themselves. Signing up with a pending invitation joins them here
            rather than starting a new kitchen.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="inv-email">Email</Label>
            <Input id="inv-email" type="email" value={email} autoFocus
              onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inv-role">Role</Label>
            <select id="inv-role" className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
              {ROLES.filter((r) => myRole === "OWNER" || r.value !== "OWNER").map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {ROLES.find((r) => r.value === role)?.can}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            The invitation expires in 14 days. Sending them the link is not
            automated — tell them to sign up with this address.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={!valid || busy} onClick={async () => {
            setBusy(true);
            try {
              await inviteToOrg(email, role);
              toast.success(`${email.trim().toLowerCase()} invited`);
              await onDone();
            } catch (err) {
              toast.error("Could not invite", {
                description: err instanceof Error ? err.message : String(err),
              });
            } finally { setBusy(false); }
          }}>Invite</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Tax ─────────────────────────────────────────────────────────────────────

/**
 * VAT rates a venue charges.
 *
 * Nothing here assumes a country. A venue sets what its member state charges,
 * and a second venue elsewhere sets something else. Categories point at a
 * rate because that is how a menu divides — every cocktail standard-rated and
 * every starter perhaps not — and setting it per dish across a hundred is how
 * it ends up wrong on three.
 */
function TaxTab({ rates, categoryRates, categories, canManage, onDone }: {
  rates: TaxRate[]; categoryRates: CategoryTaxRate[]; categories: string[];
  canManage: boolean; onDone: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState<TaxRate | "new" | null>(null);
  const byCategory = useMemo(
    () => new Map(categoryRates.map((c) => [c.category, c.taxRateId])), [categoryRates],
  );
  const def = rates.find((r) => r.isDefault);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {rates.length} rate{rates.length === 1 ? "" : "s"}
          {def && `, defaulting to ${def.name} at ${def.percent}%`}
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setEditing("new")}>Add a rate</Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rate</TableHead>
              <TableHead className="text-right">Percent</TableHead>
              <TableHead>Note</TableHead>
              <TableHead>Default</TableHead>
              <TableHead className="w-px" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-right tabular-nums">{r.percent}%</TableCell>
                <TableCell className="max-w-md whitespace-normal text-sm text-muted-foreground">
                  {r.note ?? "—"}
                </TableCell>
                <TableCell>
                  {r.isDefault ? (
                    <span className="text-sm text-status-success">default</span>
                  ) : canManage ? (
                    <Button size="sm" variant="ghost" onClick={async () => {
                      await setDefaultTaxRate(r.id);
                      toast.success(`${r.name} is now the default`);
                      await onDone();
                    }}>Make default</Button>
                  ) : null}
                </TableCell>
                <TableCell>
                  {canManage && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                      Edit
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Which rate each menu category attracts</h2>
        <p className="mb-2 text-sm text-muted-foreground">
          Anything not set here uses the default. Most EU member states reduce
          restaurant food and keep alcohol at the standard rate.
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground">
                    No recipe categories yet.
                  </TableCell>
                </TableRow>
              ) : categories.map((c) => (
                <TableRow key={c}>
                  <TableCell className="font-medium">{c}</TableCell>
                  <TableCell>
                    <select className="h-8 rounded-md border bg-transparent px-2 text-sm"
                      aria-label={`Tax rate for ${c}`}
                      disabled={!canManage}
                      value={byCategory.get(c) ?? ""}
                      onChange={async (e) => {
                        await setCategoryTaxRate(c, e.target.value || null);
                        toast.success(`${c} updated`);
                        await onDone();
                      }}>
                      <option value="">Use the default</option>
                      {rates.map((r) => (
                        <option key={r.id} value={r.id}>{r.name} — {r.percent}%</option>
                      ))}
                    </select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {editing && (
        <TaxRateDialog rate={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={async () => { setEditing(null); await onDone(); }} />
      )}
    </div>
  );
}

function TaxRateDialog({ rate, onClose, onDone }: {
  rate: TaxRate | null; onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const [name, setName] = useState(rate?.name ?? "");
  const [percent, setPercent] = useState(String(rate?.percent ?? ""));
  const [note, setNote] = useState(rate?.note ?? "");
  const [busy, setBusy] = useState(false);
  const value = Number(percent);
  const valid = name.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 100;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rate ? `Edit ${rate.name}` : "New tax rate"}</DialogTitle>
          <DialogDescription>
            Set what your member state charges. Changing a rate affects prices
            calculated from now on; figures already recorded keep the rate they
            were worked out with.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tr-name">Name</Label>
            <Input id="tr-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Reduced" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tr-pct">Percent</Label>
            <Input id="tr-pct" type="number" min="0" max="100" step="0.001"
              value={percent} onChange={(e) => setPercent(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tr-note">Note</Label>
            <Input id="tr-note" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Restaurant services, Netherlands" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={!valid || busy} onClick={async () => {
            setBusy(true);
            try {
              await saveTaxRate({ id: rate?.id, name: name.trim(), percent: value,
                                  note: note.trim() || null });
              toast.success("Saved");
              await onDone();
            } catch (err) {
              toast.error("Could not save", {
                description: err instanceof Error ? err.message : String(err),
              });
            } finally { setBusy(false); }
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Messaging ───────────────────────────────────────────────────────────────

/**
 * Where notifications go besides the app.
 *
 * The access token is not entered here and is not stored in the database. It
 * belongs in the platform's secret store, read by the adapter process — a
 * secret in a table half the organisation can read would undo every access
 * control in the system.
 */
function MessagingTab({ channels, health, canManage, onDone }: {
  channels: MessageChannel[]; health: { status: string; count: number }[];
  canManage: boolean; onDone: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState<MessageChannel | null>(null);
  const failed = health.find((h) => h.status === "FAILED")?.count ?? 0;
  const pending = health.find((h) => h.status === "PENDING")?.count ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-6 text-sm text-muted-foreground">
        <span>{pending} queued</span>
        <span className={failed > 0 ? "text-status-danger" : ""}>{failed} failed</span>
        <span>{health.find((h) => h.status === "SENT")?.count ?? 0} sent</span>
        <span>{health.find((h) => h.status === "SKIPPED")?.count ?? 0} skipped</span>
      </div>

      <div className="space-y-3">
        {channels.map((c) => (
          <div key={c.id} className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">
                  {c.kind === "IN_APP"
                    ? "Always on. Nothing leaves the system."
                    : c.enabled
                      ? "Enabled. The adapter process sends these."
                      : "Not enabled."}
                </div>
              </div>
              {canManage && c.kind !== "IN_APP" && (
                <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                  Configure
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="rounded-lg border border-status-info bg-status-info-soft p-3 text-sm">
        Enabling a channel queues messages for it. They are sent by an adapter
        process run outside the app — see <code>scripts/whatsapp-adapter.mjs</code>.
        Nothing is sent until that is running.
      </p>

      {editing && (
        <ChannelDialog channel={editing} onClose={() => setEditing(null)}
          onDone={async () => { setEditing(null); await onDone(); }} />
      )}
    </div>
  );
}

function ChannelDialog({ channel, onClose, onDone }: {
  channel: MessageChannel; onClose: () => void; onDone: () => void | Promise<void>;
}) {
  const [enabled, setEnabled] = useState(channel.enabled);
  const [config, setConfig] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(channel.config).map(([k, v]) => [k, v == null ? "" : String(v)]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const isWhatsApp = channel.kind === "WHATSAPP";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{channel.name}</DialogTitle>
          <DialogDescription>
            {isWhatsApp
              ? "From your WhatsApp Business account. The access token is not entered here — the adapter reads it from the environment."
              : "Where messages come from and go to by default."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)} />
            Send notifications on this channel
          </label>
          {Object.keys(config).map((k) => (
            <div key={k} className="space-y-2">
              <Label htmlFor={`ch-${k}`}>{k.replace(/_/g, " ")}</Label>
              <Input id={`ch-${k}`} value={config[k]}
                onChange={(e) => setConfig({ ...config, [k]: e.target.value })} />
            </div>
          ))}
          {isWhatsApp && (
            <p className="rounded-lg border p-3 text-xs text-muted-foreground">
              Set <code>WHATSAPP_TOKEN</code> in the adapter's environment. It
              is deliberately not stored in the database.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              await saveMessageChannel(channel.id, enabled,
                Object.fromEntries(Object.entries(config).map(([k, v]) => [k, v || null])));
              toast.success("Saved");
              await onDone();
            } catch (err) {
              toast.error("Could not save", {
                description: err instanceof Error ? err.message : String(err),
              });
            } finally { setBusy(false); }
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
