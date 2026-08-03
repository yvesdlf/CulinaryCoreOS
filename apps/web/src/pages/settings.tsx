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
  fetchApprovalPolicies,
  type OrgPerson, type Invitation,
} from "@/data/repository";
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
