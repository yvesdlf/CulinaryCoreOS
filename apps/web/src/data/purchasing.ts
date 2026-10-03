// ---------------------------------------------------------------------------
// Asking for it, ordering it, receiving it and paying for it
// ---------------------------------------------------------------------------
// One document under five names — requisition, purchase request, order, goods
// receipt, invoice — plus the suppliers it is sent to, the contracts that price
// it, the budgets it is charged against and the numbers printed on it.
//
// Split out of `repository.ts` in stage 1.4, which was 5.260 lines and 9% of
// the front end. Nothing here changed in the move: `repository.ts` re-exports
// all of it, so every caller imports exactly what it imported before.
// ---------------------------------------------------------------------------

import { requireSupabase } from "@/lib/supabase";
import { fail, fetchAllPages } from "./_shared";
import { createLot, recordMovements } from "./inventory";
import type { NewLot, NewMovement } from "./inventory";

// ── Suppliers ───────────────────────────────────────────────────────────────


export interface Supplier {
  id: string;
  name: string;
  legalName: string | null;
  vatNumber: string | null;
  approvalNumber: string | null;
  countryCode: string | null;
  address: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  paymentTermsDays: number | null;
  leadTimeDays: number | null;
  minimumOrderValue: string | null;
  status: "ACTIVE" | "BLOCKED" | "ARCHIVED";
  notes: string | null;
}

function supplierFromRow(r: any): Supplier {
  return {
    id: r.id,
    name: r.name,
    legalName: r.legal_name ?? null,
    vatNumber: r.vat_number ?? null,
    approvalNumber: r.approval_number ?? null,
    countryCode: r.country_code ?? null,
    address: r.address ?? null,
    contactName: r.contact_name ?? null,
    email: r.email ?? null,
    phone: r.phone ?? null,
    paymentTermsDays: r.payment_terms_days ?? null,
    leadTimeDays: r.lead_time_days ?? null,
    minimumOrderValue: r.minimum_order_value === null || r.minimum_order_value === undefined
      ? null
      : String(r.minimum_order_value),
    status: r.status,
    notes: r.notes ?? null,
  };
}

export async function fetchSuppliers(): Promise<Supplier[]> {
  const rows = await fetchAllPages<any>(
    (from, to) =>
      requireSupabase().from("suppliers").select("*").order("name").range(from, to),
    "fetchSuppliers",
  );
  return rows.map(supplierFromRow);
}

export async function upsertSupplier(
  supplier: Partial<Supplier> & { name: string },
): Promise<Supplier> {
  const row = {
    name: supplier.name,
    legal_name: supplier.legalName ?? null,
    vat_number: supplier.vatNumber ?? null,
    approval_number: supplier.approvalNumber ?? null,
    country_code: supplier.countryCode ?? null,
    address: supplier.address ?? null,
    contact_name: supplier.contactName ?? null,
    email: supplier.email ?? null,
    phone: supplier.phone ?? null,
    payment_terms_days: supplier.paymentTermsDays ?? null,
    lead_time_days: supplier.leadTimeDays ?? null,
    minimum_order_value: supplier.minimumOrderValue ?? null,
    status: supplier.status ?? "ACTIVE",
    notes: supplier.notes ?? null,
  };
  const db = requireSupabase();
  const { data, error } = supplier.id
    ? await db.from("suppliers").update(row).eq("id", supplier.id).select("*").single()
    : await db.from("suppliers").insert(row).select("*").single();
  if (error) fail("upsertSupplier", error);
  return supplierFromRow(data);
}

export interface SupplierCertificate {
  id: string;
  supplierId: string;
  kind: string;
  reference: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
}

export async function fetchSupplierCertificates(): Promise<SupplierCertificate[]> {
  const { data, error } = await requireSupabase()
    .from("supplier_certificates")
    .select("*")
    .order("expires_on");
  if (error) fail("fetchSupplierCertificates", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    supplierId: r.supplier_id,
    kind: r.kind,
    reference: r.reference ?? null,
    issuedOn: r.issued_on ?? null,
    expiresOn: r.expires_on ?? null,
  }));
}

// ── Purchasing ──────────────────────────────────────────────────────────────

import type {
  PurchaseStatus,
  ApprovalPolicy,
  OrgRole,
} from "@/engine/purchasing";

/**
 * A part of the venue: the thing that used to be a department on the HR
 * screens and a cost centre on the purchasing ones. Migration 0058 merged
 * them, and this is the one list both now read.
 */
export interface BusinessUnit {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  managerEmployeeId: string | null;
  /** Decimal string. Null means the organisation's approval policy alone. */
  approvalThreshold: string | null;
  active: boolean;
}

/**
 * Every unit, active or not.
 *
 * Inactive ones are included because a closed unit still has to be nameable
 * on last year's orders and on the record of somebody who worked in it. A
 * picker that is choosing where new spend or a new shift goes filters them
 * out itself.
 */
export async function fetchBusinessUnits(): Promise<BusinessUnit[]> {
  const { data, error } = await requireSupabase()
    .from("business_units")
    .select("*")
    .order("name");
  if (error) fail("fetchBusinessUnits", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    parentId: r.parent_id ?? null,
    managerEmployeeId: r.manager_employee_id ?? null,
    approvalThreshold: r.approval_threshold === null || r.approval_threshold === undefined
      ? null
      : String(r.approval_threshold),
    active: Boolean(r.active),
  }));
}

/**
 * Create a department.
 *
 * PLAN.md Part C says adding Security, a bakery or a second café should be
 * filling in a form. Everything underneath was in place — a unit is its own
 * cost centre, its own document prefix, the thing a rota and a budget and a
 * permission hang off — and there was no form. A department could only be
 * created by somebody with a SQL client, which makes the claim true about the
 * database and false about the platform.
 *
 * The code is refused rather than folded to upper case, which is what the
 * database does and what this therefore says before the round trip. A trigger
 * that quietly corrects what it did not refuse is one of the three false
 * passes the control suite is built around: the caller never learns their code
 * was not the code they asked for.
 */
export async function createBusinessUnit(input: {
  code: string;
  name: string;
  parentId?: string | null;
  managerEmployeeId?: string | null;
  /** Decimal string. Null means the organisation's approval policy alone. */
  approvalThreshold?: string | null;
}): Promise<BusinessUnit> {
  const { data, error } = await requireSupabase()
    .from("business_units")
    .insert({
      code: input.code,
      name: input.name,
      parent_id: input.parentId ?? null,
      manager_employee_id: input.managerEmployeeId ?? null,
      approval_threshold: input.approvalThreshold ?? null,
    })
    .select("*")
    .single();
  if (error) fail("createBusinessUnit", error);
  const r = data as any;
  return {
    id: r.id, code: r.code, name: r.name,
    parentId: r.parent_id ?? null,
    managerEmployeeId: r.manager_employee_id ?? null,
    approvalThreshold: r.approval_threshold === null || r.approval_threshold === undefined
      ? null : String(r.approval_threshold),
    active: Boolean(r.active),
  };
}

/**
 * Rename a department, move it in the tree, or close it.
 *
 * Closing rather than deleting is the only option offered: last year's orders
 * and the record of somebody who worked there still name it, and a delete would
 * either fail on those references or take them with it. `active = false` keeps
 * the name readable everywhere it is already written and keeps it out of the
 * pickers that choose where new work goes.
 */
export async function updateBusinessUnit(
  id: string,
  patch: {
    code?: string;
    name?: string;
    parentId?: string | null;
    managerEmployeeId?: string | null;
    approvalThreshold?: string | null;
    active?: boolean;
  },
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.code !== undefined) row.code = patch.code;
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.parentId !== undefined) row.parent_id = patch.parentId;
  if (patch.managerEmployeeId !== undefined) row.manager_employee_id = patch.managerEmployeeId;
  if (patch.approvalThreshold !== undefined) row.approval_threshold = patch.approvalThreshold;
  if (patch.active !== undefined) row.active = patch.active;

  const { error } = await requireSupabase()
    .from("business_units").update(row).eq("id", id);
  if (error) fail("updateBusinessUnit", error);
}

export async function fetchApprovalPolicies(): Promise<ApprovalPolicy[]> {
  const { data, error } = await requireSupabase()
    .from("approval_policies")
    .select("*")
    .order("min_amount");
  if (error) fail("fetchApprovalPolicies", error);
  return (data ?? []).map((r: any) => ({
    documentType: r.document_type,
    minAmount: String(r.min_amount),
    requiredRole: r.required_role as OrgRole,
  }));
}

export interface RequisitionLineRow {
  id: string;
  productId: string | null;
  description: string | null;
  quantity: number;
  unit: string;
  estimatedUnitPrice: string;
  lineTotal: string;
  suggestedSupplierId: string | null;
  lineNumber: number;
}

export interface Requisition {
  id: string;
  reference: string;
  businessUnitId: string | null;
  neededBy: string | null;
  justification: string | null;
  status: PurchaseStatus;
  totalAmount: string;
  requestedById: string | null;
  requestedByEmail: string | null;
  submittedAt: string | null;
  createdAt: string;
  lines: RequisitionLineRow[];
}

function requisitionFromRow(r: any): Requisition {
  return {
    id: r.id,
    reference: r.reference,
    businessUnitId: r.business_unit_id ?? null,
    neededBy: r.needed_by ?? null,
    justification: r.justification ?? null,
    status: r.status,
    totalAmount: String(r.total_amount ?? 0),
    requestedById: r.requested_by ?? null,
    requestedByEmail: r.requested_by_email ?? null,
    submittedAt: r.submitted_at ?? null,
    createdAt: r.created_at,
    lines: (r.requisition_lines ?? [])
      .map((l: any) => ({
        id: l.id,
        productId: l.product_id ?? null,
        description: l.description ?? null,
        quantity: Number(l.quantity),
        unit: l.unit,
        estimatedUnitPrice: String(l.estimated_unit_price ?? 0),
        lineTotal: String(l.line_total ?? 0),
        suggestedSupplierId: l.suggested_supplier_id ?? null,
        lineNumber: l.line_number ?? 1,
      }))
      .sort((a: RequisitionLineRow, b: RequisitionLineRow) => a.lineNumber - b.lineNumber),
  };
}

export async function fetchRequisitions(): Promise<Requisition[]> {
  const rows = await fetchAllPages<any>(
    (from, to) =>
      requireSupabase()
        .from("requisitions")
        .select("*, requisition_lines(*)")
        .order("created_at", { ascending: false })
        .range(from, to),
    "fetchRequisitions",
  );
  return rows.map(requisitionFromRow);
}

export async function createRequisition(input: {
  /** Optional. Left out, the database allocates a stem from the business unit. */
  reference?: string;
  referenceStem?: string;
  businessUnitId: string | null;
  /** The unit code for the reference, where the caller knows it. */
  unitCode?: string;
  neededBy: string | null;
  justification: string | null;
  lines: Omit<RequisitionLineRow, "id" | "lineTotal">[];
}): Promise<Requisition> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  /*
   * A stem, not a reference.
   *
   * The `reference` column is derived from it by trigger and renamed as the
   * document is approved, so what is sent here is only a starting value.
   * Allocated now rather than when the dialog opened, so a cancelled draft does
   * not burn a number and leave a gap somebody asks about.
   */
  const stem = input.referenceStem ?? (await allocateStem(input.unitCode ?? "GEN"));
  const reference = input.reference ?? `REQ-${stem}`;
  const { data, error } = await db
    .from("requisitions")
    .insert({
      reference,
      reference_stem: stem,
      business_unit_id: input.businessUnitId,
      needed_by: input.neededBy,
      justification: input.justification,
      status: "DRAFT",
      requested_by: auth.user?.id ?? null,
      requested_by_email: auth.user?.email ?? null,
    })
    .select("*")
    .single();
  if (error) fail("createRequisition", error);

  if (input.lines.length > 0) {
    const { error: lineError } = await db.from("requisition_lines").insert(
      input.lines.map((l, i) => ({
        requisition_id: data.id,
        product_id: l.productId,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        estimated_unit_price: l.estimatedUnitPrice,
        // The database keeps the header total; the line total is ours.
        line_total: Number(l.estimatedUnitPrice) * l.quantity,
        suggested_supplier_id: l.suggestedSupplierId,
        line_number: i + 1,
      })),
    );
    if (lineError) {
      await db.from("requisitions").delete().eq("id", data.id);
      fail("createRequisition(lines)", lineError);
    }
  }
  return fetchRequisition(data.id);
}

export async function fetchRequisition(id: string): Promise<Requisition> {
  const { data, error } = await requireSupabase()
    .from("requisitions")
    .select("*, requisition_lines(*)")
    .eq("id", id)
    .single();
  if (error) fail("fetchRequisition", error);
  return requisitionFromRow(data);
}

export async function setRequisitionStatus(
  id: string,
  status: PurchaseStatus,
): Promise<void> {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "SUBMITTED") patch.submitted_at = new Date().toISOString();
  const { error } = await requireSupabase().from("requisitions").update(patch).eq("id", id);
  if (error) fail("setRequisitionStatus", error);
}

export interface ApprovalEvent {
  id: string;
  documentType: string;
  documentId: string;
  action: "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED" | "REOPENED";
  actorEmail: string | null;
  actorRole: OrgRole | null;
  amount: string | null;
  comment: string | null;
  occurredAt: string;
}

export async function fetchApprovalEvents(
  documentId?: string,
): Promise<ApprovalEvent[]> {
  let q = requireSupabase()
    .from("approval_events")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (documentId) q = q.eq("document_id", documentId);
  const { data, error } = await q;
  if (error) fail("fetchApprovalEvents", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    documentType: r.document_type,
    documentId: r.document_id,
    action: r.action,
    actorEmail: r.actor_email ?? null,
    actorRole: r.actor_role ?? null,
    amount: r.amount === null || r.amount === undefined ? null : String(r.amount),
    comment: r.comment ?? null,
    occurredAt: r.occurred_at,
  }));
}

/**
 * Record a decision.
 *
 * The database refuses a self-approval or an approval above the actor's
 * authority, so a rejection here is the policy speaking, not a bug — the
 * message is worth showing verbatim.
 */
export async function recordApproval(
  documentType: "REQUISITION" | "PURCHASE_ORDER",
  documentId: string,
  action: ApprovalEvent["action"],
  comment: string | null,
): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("approval_events").insert({
    document_type: documentType,
    document_id: documentId,
    action,
    actor_id: auth.user?.id ?? null,
    actor_email: auth.user?.email ?? null,
    comment,
  });
  if (error) fail("recordApproval", error);
}

export interface PurchaseOrderLineRow {
  id: string;
  productId: string | null;
  description: string | null;
  quantity: number;
  unit: string;
  unitPrice: string;
  taxPercent: number;
  lineTotal: string;
  quantityReceived: number;
  lineNumber: number;
}

export interface PurchaseOrder {
  id: string;
  reference: string;
  supplierId: string;
  supplierName: string | null;
  requisitionId: string | null;
  businessUnitId: string | null;
  status: PurchaseStatus;
  orderedOn: string | null;
  expectedOn: string | null;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  createdById: string | null;
  createdByEmail: string | null;
  notes: string | null;
  lines: PurchaseOrderLineRow[];
}

function purchaseOrderFromRow(r: any): PurchaseOrder {
  return {
    id: r.id,
    reference: r.reference,
    supplierId: r.supplier_id,
    supplierName: r.suppliers?.name ?? null,
    requisitionId: r.requisition_id ?? null,
    businessUnitId: r.business_unit_id ?? null,
    status: r.status,
    orderedOn: r.ordered_on ?? null,
    expectedOn: r.expected_on ?? null,
    subtotal: String(r.subtotal ?? 0),
    taxAmount: String(r.tax_amount ?? 0),
    totalAmount: String(r.total_amount ?? 0),
    createdById: r.created_by ?? null,
    createdByEmail: r.created_by_email ?? null,
    notes: r.notes ?? null,
    lines: (r.purchase_order_lines ?? [])
      .map((l: any) => ({
        id: l.id,
        productId: l.product_id ?? null,
        description: l.description ?? null,
        quantity: Number(l.quantity),
        unit: l.unit,
        unitPrice: String(l.unit_price ?? 0),
        taxPercent: Number(l.tax_percent ?? 0),
        lineTotal: String(l.line_total ?? 0),
        quantityReceived: Number(l.quantity_received ?? 0),
        lineNumber: l.line_number ?? 1,
      }))
      .sort((a: PurchaseOrderLineRow, b: PurchaseOrderLineRow) => a.lineNumber - b.lineNumber),
  };
}

export async function fetchPurchaseOrders(): Promise<PurchaseOrder[]> {
  const rows = await fetchAllPages<any>(
    (from, to) =>
      requireSupabase()
        .from("purchase_orders")
        .select("*, suppliers(name), purchase_order_lines(*)")
        .order("created_at", { ascending: false })
        .range(from, to),
    "fetchPurchaseOrders",
  );
  return rows.map(purchaseOrderFromRow);
}

export async function createPurchaseOrder(input: {
  reference: string;
  supplierId: string;
  requisitionId: string | null;
  businessUnitId: string | null;
  expectedOn: string | null;
  taxPercent: number;
  lines: {
    productId: string | null;
    description: string | null;
    quantity: number;
    unit: string;
    unitPrice: string;
  }[];
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from("purchase_orders")
    .insert({
      reference: input.reference,
      supplier_id: input.supplierId,
      requisition_id: input.requisitionId,
      business_unit_id: input.businessUnitId,
      expected_on: input.expectedOn,
      status: "DRAFT",
      created_by: auth.user?.id ?? null,
      created_by_email: auth.user?.email ?? null,
    })
    .select("*")
    .single();
  if (error) fail("createPurchaseOrder", error);

  const { error: lineError } = await db.from("purchase_order_lines").insert(
    input.lines.map((l, i) => ({
      purchase_order_id: data.id,
      product_id: l.productId,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unit_price: l.unitPrice,
      tax_percent: input.taxPercent,
      line_total: Number(l.unitPrice) * l.quantity,
      line_number: i + 1,
    })),
  );
  if (lineError) {
    await db.from("purchase_orders").delete().eq("id", data.id);
    fail("createPurchaseOrder(lines)", lineError);
  }
}

export async function setPurchaseOrderStatus(
  id: string,
  status: PurchaseStatus,
): Promise<void> {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "ORDERED") patch.ordered_on = new Date().toISOString().slice(0, 10);
  const { error } = await requireSupabase().from("purchase_orders").update(patch).eq("id", id);
  if (error) fail("setPurchaseOrderStatus", error);
}

/**
 * The signed-in user's role in the organisation they write into.
 *
 * Scoped to that organisation rather than taking whichever membership comes
 * back first. A user can belong to more than one — the venue they were
 * invited to, and a personal one created when they signed up — and picking
 * arbitrarily would report a role from the wrong place.
 */
export async function fetchMyRole(): Promise<OrgRole | null> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;
  const { data: orgId, error: orgError } = await db.rpc("auth_default_org_id");
  if (orgError) fail("fetchMyRole(org)", orgError);
  if (!orgId) return null;
  const { data, error } = await db
    .from("organization_members")
    .select("role")
    .eq("user_id", auth.user.id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) fail("fetchMyRole", error);
  return (data?.role as OrgRole) ?? null;
}

// ── Receiving, invoices, budgets ────────────────────────────────────────────

import type { MatchException, Tolerances, BudgetPosition } from "@/engine/invoice-matching";

export interface GoodsReceiptLineInput {
  purchaseOrderLineId: string | null;
  productId: string | null;
  quantityReceived: number;
  unit: string;
  quantityRejected: number;
  rejectionReason: string | null;
  conditionNote: string | null;
  /** Delivery details, when the line creates a traceable lot. */
  lot: NewLot | null;
}

/**
 * Book in a delivery.
 *
 * One act creates the receipt, the lots, and the stock movements. Splitting
 * them would let a delivery exist with no stock behind it, or stock with no
 * delivery — and the second of those is what Article 18 forbids.
 */
export async function recordGoodsReceipt(input: {
  reference: string;
  purchaseOrderId: string | null;
  supplierId: string | null;
  deliveryNote: string | null;
  vehicleTemperatureC: number | null;
  lines: GoodsReceiptLineInput[];
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();

  const { data, error } = await db
    .from("goods_receipts")
    .insert({
      reference: input.reference,
      purchase_order_id: input.purchaseOrderId,
      supplier_id: input.supplierId,
      delivery_note: input.deliveryNote,
      vehicle_temperature_c: input.vehicleTemperatureC,
      received_by: auth.user?.id ?? null,
      received_by_email: auth.user?.email ?? null,
    })
    .select("*")
    .single();
  if (error) fail("recordGoodsReceipt", error);

  const movements: NewMovement[] = [];
  const lineRows: Record<string, unknown>[] = [];

  for (const [i, l] of input.lines.entries()) {
    let lotId: string | null = null;
    if (l.lot) {
      const lot = await createLot(l.lot);
      lotId = lot.id;
    }
    lineRows.push({
      goods_receipt_id: data.id,
      purchase_order_line_id: l.purchaseOrderLineId,
      product_id: l.productId,
      quantity_received: l.quantityReceived,
      unit: l.unit,
      lot_id: lotId,
      quantity_rejected: l.quantityRejected,
      rejection_reason: l.rejectionReason,
      condition_note: l.conditionNote,
      line_number: i + 1,
    });
    // Only what was accepted becomes stock. Rejected goods went back on the van.
    const accepted = l.quantityReceived - l.quantityRejected;
    if (l.productId && accepted > 0) {
      movements.push({
        productId: l.productId,
        kind: "RECEIPT",
        quantity: accepted,
        unit: l.unit,
        unitCost: l.lot ? null : null,
        reason: null,
        note: `Receipt ${input.reference}`,
        lotId,
      });
    }
  }

  const { error: lineError } = await db.from("goods_receipt_lines").insert(lineRows);
  if (lineError) {
    await db.from("goods_receipts").delete().eq("id", data.id);
    fail("recordGoodsReceipt(lines)", lineError);
  }
  if (movements.length > 0) await recordMovements(movements);
}

export interface GoodsReceiptRow {
  id: string;
  reference: string;
  purchaseOrderId: string | null;
  receivedOn: string;
  deliveryNote: string | null;
  receivedByEmail: string | null;
  lineCount: number;
  rejectedCount: number;
}

export async function fetchGoodsReceipts(): Promise<GoodsReceiptRow[]> {
  const { data, error } = await requireSupabase()
    .from("goods_receipts")
    .select("*, goods_receipt_lines(quantity_rejected)")
    .order("received_on", { ascending: false })
    .limit(500);
  if (error) fail("fetchGoodsReceipts", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    reference: r.reference,
    purchaseOrderId: r.purchase_order_id ?? null,
    receivedOn: r.received_on,
    deliveryNote: r.delivery_note ?? null,
    receivedByEmail: r.received_by_email ?? null,
    lineCount: (r.goods_receipt_lines ?? []).length,
    rejectedCount: (r.goods_receipt_lines ?? []).filter(
      (l: any) => Number(l.quantity_rejected) > 0,
    ).length,
  }));
}

export interface SupplierInvoice {
  id: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string | null;
  purchaseOrderId: string | null;
  invoiceDate: string;
  dueDate: string | null;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  status: string;
  exceptions: MatchException[];
}

export async function fetchSupplierInvoices(): Promise<SupplierInvoice[]> {
  const { data, error } = await requireSupabase()
    .from("supplier_invoices")
    .select("*, suppliers(name)")
    .order("invoice_date", { ascending: false })
    .limit(500);
  if (error) fail("fetchSupplierInvoices", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    supplierId: r.supplier_id,
    supplierName: r.suppliers?.name ?? null,
    purchaseOrderId: r.purchase_order_id ?? null,
    invoiceDate: r.invoice_date,
    dueDate: r.due_date ?? null,
    subtotal: String(r.subtotal ?? 0),
    taxAmount: String(r.tax_amount ?? 0),
    totalAmount: String(r.total_amount ?? 0),
    status: r.status,
    exceptions: (r.exceptions ?? []) as MatchException[],
  }));
}

export async function createSupplierInvoice(input: {
  invoiceNumber: string;
  supplierId: string;
  purchaseOrderId: string | null;
  invoiceDate: string;
  dueDate: string | null;
  paymentTermsDays: number | null;
  status: string;
  exceptions: MatchException[];
  lines: {
    purchaseOrderLineId: string | null;
    productId: string | null;
    description: string | null;
    quantity: number;
    unit: string;
    unitPrice: string;
    taxPercent: number;
  }[];
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from("supplier_invoices")
    .insert({
      invoice_number: input.invoiceNumber,
      supplier_id: input.supplierId,
      purchase_order_id: input.purchaseOrderId,
      invoice_date: input.invoiceDate,
      due_date: input.dueDate,
      payment_terms_days: input.paymentTermsDays,
      status: input.status,
      exceptions: input.exceptions,
      entered_by: auth.user?.id ?? null,
      entered_by_email: auth.user?.email ?? null,
    })
    .select("*")
    .single();
  if (error) fail("createSupplierInvoice", error);

  const { error: lineError } = await db.from("supplier_invoice_lines").insert(
    input.lines.map((l, i) => ({
      invoice_id: data.id,
      purchase_order_line_id: l.purchaseOrderLineId,
      product_id: l.productId,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unit_price: l.unitPrice,
      tax_percent: l.taxPercent,
      line_total: Number(l.unitPrice) * l.quantity,
      line_number: i + 1,
    })),
  );
  if (lineError) {
    await db.from("supplier_invoices").delete().eq("id", data.id);
    fail("createSupplierInvoice(lines)", lineError);
  }
}

export async function setInvoiceStatus(
  id: string,
  status: string,
  exceptions?: MatchException[],
): Promise<void> {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (exceptions) patch.exceptions = exceptions;
  const { error } = await requireSupabase()
    .from("supplier_invoices")
    .update(patch)
    .eq("id", id);
  if (error) fail("setInvoiceStatus", error);
}

export async function fetchTolerances(): Promise<Tolerances | null> {
  const { data, error } = await requireSupabase()
    .from("matching_tolerances")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) fail("fetchTolerances", error);
  if (!data) return null;
  return {
    pricePercent: Number(data.price_percent),
    priceAbsolute: String(data.price_absolute),
    quantityPercent: Number(data.quantity_percent),
    quantityAbsolute: Number(data.quantity_absolute),
  };
}

export async function fetchBudgetPositions(): Promise<BudgetPosition[]> {
  const { data, error } = await requireSupabase()
    .from("budget_positions")
    .select("*")
    .order("name");
  if (error) fail("fetchBudgetPositions", error);
  return (data ?? []).map((r: any) => ({
    budgetId: r.budget_id,
    businessUnitId: r.business_unit_id,
    name: r.name,
    amount: String(r.amount ?? 0),
    committed: String(r.committed ?? 0),
    actual: String(r.actual ?? 0),
    hardStop: Boolean(r.hard_stop),
  }));
}

// ── Contracts ───────────────────────────────────────────────────────────────

export interface Contract {
  id: string; supplierId: string; reference: string; title: string;
  status: string; startsOn: string; endsOn: string | null;
  noticeBy: string | null; autoRenews: boolean;
  minimumCommitment: string | null; leadTimeDays: number | null;
  deliveryDays: string | null; serviceTerms: string | null; notes: string | null;
}

export async function fetchContracts(): Promise<Contract[]> {
  const { data, error } = await requireSupabase()
    .from("contracts").select("*").order("ends_on", { nullsFirst: false });
  if (error) fail("fetchContracts", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, supplierId: r.supplier_id, reference: r.reference, title: r.title,
    status: r.status, startsOn: r.starts_on, endsOn: r.ends_on ?? null,
    noticeBy: r.notice_by ?? null, autoRenews: Boolean(r.auto_renews),
    minimumCommitment: r.minimum_commitment === null ? null : String(r.minimum_commitment),
    leadTimeDays: r.lead_time_days ?? null, deliveryDays: r.delivery_days ?? null,
    serviceTerms: r.service_terms ?? null, notes: r.notes ?? null,
  }));
}

export async function saveContract(input: Partial<Contract> & {
  supplierId: string; reference: string; title: string; startsOn: string;
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const row = {
    supplier_id: input.supplierId, reference: input.reference, title: input.title,
    starts_on: input.startsOn, ends_on: input.endsOn ?? null,
    notice_by: input.noticeBy ?? null, auto_renews: input.autoRenews ?? false,
    minimum_commitment: input.minimumCommitment ?? null,
    lead_time_days: input.leadTimeDays ?? null,
    delivery_days: input.deliveryDays ?? null,
    service_terms: input.serviceTerms ?? null, notes: input.notes ?? null,
    status: input.status ?? "ACTIVE",
    updated_at: new Date().toISOString(),
  };
  const { error } = input.id
    ? await db.from("contracts").update(row).eq("id", input.id)
    : await db.from("contracts").insert({ ...row, created_by_email: auth.user?.email ?? null });
  if (error) fail("saveContract", error);
}

export async function refreshContractStatuses(): Promise<void> {
  const { error } = await requireSupabase().rpc("refresh_contract_statuses");
  if (error) fail("refreshContractStatuses", error);
}

export async function fetchContractAttention(): Promise<
  { id: string; reference: string; title: string; supplierName: string;
    status: string; endsOn: string | null; noticeBy: string | null;
    daysToEnd: number | null; daysToNotice: number | null; autoRenews: boolean }[]
> {
  const { data, error } = await requireSupabase()
    .from("contract_attention").select("*").order("days_to_notice", { nullsFirst: false });
  if (error) fail("fetchContractAttention", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, reference: r.reference, title: r.title,
    supplierName: r.supplier_name, status: r.status,
    endsOn: r.ends_on ?? null, noticeBy: r.notice_by ?? null,
    daysToEnd: r.days_to_end ?? null, daysToNotice: r.days_to_notice ?? null,
    autoRenews: Boolean(r.auto_renews),
  }));
}

export interface ContractPrice {
  id: string; contractId: string; productId: string | null;
  description: string | null; unit: string; unitPrice: string;
  effectiveFrom: string; effectiveTo: string | null;
}

export async function fetchContractPrices(contractId: string): Promise<ContractPrice[]> {
  const { data, error } = await requireSupabase()
    .from("contract_prices").select("*")
    .eq("contract_id", contractId).order("effective_from", { ascending: false });
  if (error) fail("fetchContractPrices", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, contractId: r.contract_id, productId: r.product_id ?? null,
    description: r.description ?? null, unit: r.unit,
    unitPrice: String(r.unit_price), effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to ?? null,
  }));
}

export async function addContractPrice(input: {
  contractId: string; productId: string | null; description: string | null;
  unit: string; unitPrice: string; effectiveFrom: string; effectiveTo: string | null;
}): Promise<void> {
  const { error } = await requireSupabase().from("contract_prices").insert({
    contract_id: input.contractId, product_id: input.productId,
    description: input.description, unit: input.unit,
    unit_price: input.unitPrice, effective_from: input.effectiveFrom,
    effective_to: input.effectiveTo,
  });
  if (error) fail("addContractPrice", error);
}

/** The agreed price for a product from a supplier on a date, if any. */
export async function contractPriceFor(
  productId: string, supplierId: string, onDate: string,
): Promise<string | null> {
  const { data, error } = await requireSupabase().rpc("contract_price_for", {
    p_product: productId, p_supplier: supplierId, p_on: onDate,
  });
  if (error) fail("contractPriceFor", error);
  return data === null || data === undefined ? null : String(data);
}

// ── Sourcing ────────────────────────────────────────────────────────────────

export interface Rfq {
  id: string; reference: string; title: string; status: string;
  neededBy: string | null; closesAt: string | null; notes: string | null;
}

export async function fetchRfqs(): Promise<Rfq[]> {
  const { data, error } = await requireSupabase()
    .from("rfqs").select("*").order("created_at", { ascending: false });
  if (error) fail("fetchRfqs", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, reference: r.reference, title: r.title, status: r.status,
    neededBy: r.needed_by ?? null, closesAt: r.closes_at ?? null, notes: r.notes ?? null,
  }));
}

export async function createRfq(input: {
  reference: string; title: string; neededBy: string | null; closesAt: string | null;
  lines: { productId: string | null; description: string | null; quantity: number; unit: string }[];
  supplierIds: string[];
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db.from("rfqs").insert({
    reference: input.reference, title: input.title,
    needed_by: input.neededBy, closes_at: input.closesAt,
    status: "DRAFT", created_by_email: auth.user?.email ?? null,
  }).select("*").single();
  if (error) fail("createRfq", error);

  const { error: le } = await db.from("rfq_lines").insert(
    input.lines.map((l, i) => ({
      rfq_id: data.id, product_id: l.productId, description: l.description,
      quantity: l.quantity, unit: l.unit, line_number: i + 1,
    })),
  );
  if (le) { await db.from("rfqs").delete().eq("id", data.id); fail("createRfq(lines)", le); }

  if (input.supplierIds.length > 0) {
    const { error: se } = await db.from("rfq_suppliers").insert(
      input.supplierIds.map((s) => ({ rfq_id: data.id, supplier_id: s })),
    );
    if (se) fail("createRfq(suppliers)", se);
  }
}

export async function sendRfq(id: string): Promise<void> {
  const { error } = await requireSupabase().from("rfqs")
    .update({ status: "SENT", sent_at: new Date().toISOString() }).eq("id", id);
  if (error) fail("sendRfq", error);
}

export interface QuoteRow {
  rfqLineId: string; lineNumber: number; description: string | null;
  quantity: number; unit: string; quoteId: string | null;
  supplierId: string | null; supplierName: string | null;
  unitPrice: string | null; lineTotal: string | null;
  leadTimeDays: number | null; isLate: boolean; awarded: boolean;
}

export async function fetchRfqComparison(rfqId: string): Promise<QuoteRow[]> {
  const { data, error } = await requireSupabase()
    .from("rfq_comparison").select("*").eq("rfq_id", rfqId).order("line_number");
  if (error) fail("fetchRfqComparison", error);
  return (data ?? []).map((r: any) => ({
    rfqLineId: r.rfq_line_id, lineNumber: r.line_number,
    description: r.description ?? null, quantity: Number(r.quantity), unit: r.unit,
    quoteId: r.quote_id ?? null, supplierId: r.supplier_id ?? null,
    supplierName: r.supplier_name ?? null,
    unitPrice: r.unit_price === null ? null : String(r.unit_price),
    lineTotal: r.line_total === null ? null : String(r.line_total),
    leadTimeDays: r.lead_time_days ?? null,
    isLate: Boolean(r.is_late), awarded: Boolean(r.awarded),
  }));
}

export async function awardQuote(input: {
  rfqId: string; rfqLineId: string; supplierId: string;
  quoteId: string | null; rationale: string;
}): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("rfq_awards").insert({
    rfq_id: input.rfqId, rfq_line_id: input.rfqLineId,
    supplier_id: input.supplierId, quote_id: input.quoteId,
    rationale: input.rationale, awarded_by_email: auth.user?.email ?? null,
  });
  if (error) fail("awardQuote", error);
}

export async function fetchPortalRfqs(): Promise<
  { id: string; reference: string; title: string; status: string;
    neededBy: string | null; closesAt: string | null; buyerName: string;
    respondedAt: string | null }[]
> {
  const { data, error } = await requireSupabase()
    .from("portal_rfqs").select("*").order("closes_at");
  if (error) fail("fetchPortalRfqs", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, reference: r.reference, title: r.title, status: r.status,
    neededBy: r.needed_by ?? null, closesAt: r.closes_at ?? null,
    buyerName: r.buyer_name, respondedAt: r.responded_at ?? null,
  }));
}

export async function fetchPortalRfqLines(rfqId: string): Promise<
  { id: string; lineNumber: number; description: string | null;
    quantity: number; unit: string; myUnitPrice: string | null;
    myLeadTimeDays: number | null; myNote: string | null }[]
> {
  const { data, error } = await requireSupabase()
    .from("portal_rfq_lines").select("*").eq("rfq_id", rfqId).order("line_number");
  if (error) fail("fetchPortalRfqLines", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, lineNumber: r.line_number, description: r.description ?? null,
    quantity: Number(r.quantity), unit: r.unit,
    myUnitPrice: r.my_unit_price === null ? null : String(r.my_unit_price),
    myLeadTimeDays: r.my_lead_time_days ?? null, myNote: r.my_note ?? null,
  }));
}

export async function submitQuote(
  lineId: string, unitPrice: number, leadTimeDays: number | null, note: string | null,
): Promise<void> {
  const { error } = await requireSupabase().rpc("submit_quote", {
    p_line: lineId, p_unit_price: unitPrice,
    p_lead_time_days: leadTimeDays, p_note: note,
  });
  if (error) fail("submitQuote", error);
}

// ── Vendor portal and notifications ─────────────────────────────────────────

export interface PortalOrder {
  id: string; reference: string; status: string; orderedOn: string | null;
  expectedOn: string | null; totalAmount: string; buyerName: string;
  acknowledgedAt: string | null; supplierPromisedOn: string | null;
  supplierNote: string | null;
}

/** Null when the signed-in person is not a supplier contact. */
export async function fetchMySupplierId(): Promise<string | null> {
  const { data, error } = await requireSupabase().rpc("auth_supplier_id");
  if (error) fail("fetchMySupplierId", error);
  return (data as string | null) ?? null;
}

export async function fetchPortalOrders(): Promise<PortalOrder[]> {
  const { data, error } = await requireSupabase()
    .from("portal_orders").select("*").order("ordered_on", { ascending: false });
  if (error) fail("fetchPortalOrders", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, reference: r.reference, status: r.status,
    orderedOn: r.ordered_on ?? null, expectedOn: r.expected_on ?? null,
    totalAmount: String(r.total_amount ?? 0), buyerName: r.buyer_name,
    acknowledgedAt: r.acknowledged_at ?? null,
    supplierPromisedOn: r.supplier_promised_on ?? null,
    supplierNote: r.supplier_note ?? null,
  }));
}

export async function fetchPortalOrderLines(orderId: string): Promise<
  { id: string; description: string | null; quantity: number; unit: string;
    unitPrice: string; lineTotal: string; quantityReceived: number }[]
> {
  const { data, error } = await requireSupabase()
    .from("portal_order_lines").select("*")
    .eq("purchase_order_id", orderId).order("line_number");
  if (error) fail("fetchPortalOrderLines", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, description: r.description ?? null,
    quantity: Number(r.quantity), unit: r.unit,
    unitPrice: String(r.unit_price ?? 0), lineTotal: String(r.line_total ?? 0),
    quantityReceived: Number(r.quantity_received ?? 0),
  }));
}

export async function fetchPortalInvoices(): Promise<
  { id: string; invoiceNumber: string; invoiceDate: string; dueDate: string | null;
    totalAmount: string; status: string; hasQuery: boolean }[]
> {
  const { data, error } = await requireSupabase()
    .from("portal_invoices").select("*").order("invoice_date", { ascending: false });
  if (error) fail("fetchPortalInvoices", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, invoiceNumber: r.invoice_number, invoiceDate: r.invoice_date,
    dueDate: r.due_date ?? null, totalAmount: String(r.total_amount ?? 0),
    status: r.status, hasQuery: Boolean(r.has_query),
  }));
}

export async function acknowledgeOrder(
  orderId: string, promisedOn: string | null, note: string | null,
): Promise<void> {
  const { error } = await requireSupabase().rpc("acknowledge_purchase_order", {
    order_id: orderId, promised_on: promisedOn, note,
  });
  if (error) fail("acknowledgeOrder", error);
}

export interface Notification {
  id: string; kind: string; subject: string; body: string | null;
  entityType: string | null; entityId: string | null;
  createdAt: string; readAt: string | null; forSupplier: boolean;
}

export async function fetchNotifications(): Promise<Notification[]> {
  const { data, error } = await requireSupabase()
    .from("notifications").select("*")
    .order("created_at", { ascending: false }).limit(200);
  if (error) fail("fetchNotifications", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, kind: r.kind, subject: r.subject, body: r.body ?? null,
    entityType: r.entity_type ?? null, entityId: r.entity_id ?? null,
    createdAt: r.created_at, readAt: r.read_at ?? null,
    forSupplier: r.supplier_id !== null,
  }));
}

export async function markNotificationRead(id: string): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("notifications")
    .update({ read_at: new Date().toISOString(), read_by: auth.user?.id ?? null })
    .eq("id", id);
  if (error) fail("markNotificationRead", error);
}

export async function inviteSupplierContact(
  supplierId: string, email: string,
): Promise<void> {
  const db = requireSupabase();
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from("supplier_users").insert({
    supplier_id: supplierId,
    email: email.trim().toLowerCase(),
    invited_by_email: auth.user?.email ?? null,
  });
  if (error) fail("inviteSupplierContact", error);
}

// ── Tax rates and channels ──────────────────────────────────────────────────

export interface TaxRate {
  id: string; name: string; percent: number; isDefault: boolean; note: string | null;
}

export async function fetchTaxRates(): Promise<TaxRate[]> {
  const { data, error } = await requireSupabase()
    .from("tax_rates").select("*").order("is_default", { ascending: false }).order("name");
  if (error) fail("fetchTaxRates", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, name: r.name, percent: Number(r.percent),
    isDefault: Boolean(r.is_default), note: r.note ?? null,
  }));
}

export async function saveTaxRate(input: {
  id?: string; name: string; percent: number; note: string | null;
}): Promise<void> {
  const db = requireSupabase();
  const row = { name: input.name, percent: input.percent, note: input.note,
                updated_at: new Date().toISOString() };
  const { error } = input.id
    ? await db.from("tax_rates").update(row).eq("id", input.id)
    : await db.from("tax_rates").insert(row);
  if (error) fail("saveTaxRate", error);
}

/**
 * Make one rate the default.
 *
 * Two writes because a unique partial index enforces exactly one — clearing
 * the old one first is what keeps the constraint satisfiable.
 */
export async function setDefaultTaxRate(id: string): Promise<void> {
  const db = requireSupabase();
  const { error: clear } = await db.from("tax_rates")
    .update({ is_default: false }).eq("is_default", true);
  if (clear) fail("setDefaultTaxRate(clear)", clear);
  const { error } = await db.from("tax_rates").update({ is_default: true }).eq("id", id);
  if (error) fail("setDefaultTaxRate", error);
}

export async function deleteTaxRate(id: string): Promise<void> {
  const { error } = await requireSupabase().from("tax_rates").delete().eq("id", id);
  if (error) fail("deleteTaxRate", error);
}

export interface CategoryTaxRate { id: string; category: string; taxRateId: string }

export async function fetchCategoryTaxRates(): Promise<CategoryTaxRate[]> {
  const { data, error } = await requireSupabase()
    .from("category_tax_rates").select("*").order("category");
  if (error) fail("fetchCategoryTaxRates", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, category: r.category, taxRateId: r.tax_rate_id,
  }));
}

export async function setCategoryTaxRate(
  category: string, taxRateId: string | null,
): Promise<void> {
  const db = requireSupabase();
  if (taxRateId === null) {
    const { error } = await db.from("category_tax_rates").delete().eq("category", category);
    if (error) fail("setCategoryTaxRate(clear)", error);
    return;
  }
  const { error } = await db.from("category_tax_rates")
    .upsert({ category, tax_rate_id: taxRateId }, { onConflict: "org_id,category" });
  if (error) fail("setCategoryTaxRate", error);
}

export interface MessageChannel {
  id: string; kind: string; name: string; enabled: boolean;
  config: Record<string, unknown>;
}

export async function fetchMessageChannels(): Promise<MessageChannel[]> {
  const { data, error } = await requireSupabase()
    .from("message_channels").select("*").order("kind");
  if (error) fail("fetchMessageChannels", error);
  return (data ?? []).map((r: any) => ({
    id: r.id, kind: r.kind, name: r.name,
    enabled: Boolean(r.enabled), config: r.config ?? {},
  }));
}

export async function saveMessageChannel(
  id: string, enabled: boolean, config: Record<string, unknown>,
): Promise<void> {
  const { error } = await requireSupabase().from("message_channels")
    .update({ enabled, config, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) fail("saveMessageChannel", error);
}

export async function fetchDeliveryHealth(): Promise<
  { status: string; count: number }[]
> {
  const { data, error } = await requireSupabase()
    .from("message_deliveries").select("status").limit(1000);
  if (error) fail("fetchDeliveryHealth", error);
  const counts = new Map<string, number>();
  for (const r of data ?? []) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  return [...counts.entries()].map(([status, count]) => ({ status, count }));
}

// ── Document references ─────────────────────────────────────────────────────

/**
 * Allocate the next reference for a document type and business unit.
 *
 * The number comes from the database, which holds a lock for the duration of
 * the statement. Computing it in the browser — reading every existing
 * reference and adding one — gives two people raising a requisition in the
 * same second the same number, and the unique index refuses the second one at
 * the moment they are trying to place an order.
 *
 * Called at save time, not when a dialog opens. A reference allocated on open
 * is burnt if the person changes their mind, which leaves gaps a buyer will
 * ask about.
 */
/**
 * Allocate the stem a document keeps for its whole life.
 *
 * KIT-260809-001. The prefix is not part of it: the same document is called
 * REQ-KIT-260809-001 while it is being asked for, PR-KIT-260809-001 once it is
 * approved, and PO-KIT-260809-001 once it is ordered — and it is the stem
 * staying put that ties those three together.
 */
export async function allocateStem(unit: string): Promise<string> {
  const { data, error } = await requireSupabase().rpc("next_reference_stem", {
    p_unit: unit,
  });
  if (error) fail("allocateStem", error);
  return data as string;
}

export async function allocateReference(
  type: string,
  unit: string,
): Promise<string> {
  const { data, error } = await requireSupabase().rpc("next_document_reference", {
    p_type: type,
    p_unit: unit,
  });
  if (error) fail("allocateReference", error);
  return data as string;
}

// ── Revenue ─────────────────────────────────────────────────────────────────
/*
 * What came in, as against everything else in this module, which is what went
 * out.
 *
 * Here rather than in a module of its own because the questions are the same
 * questions — a department's budget, its spend and its takings are read by the
 * same screens and compared with each other — and a seventh module holding one
 * table would be a directory entry rather than a boundary.
 *
 * Gross and net are both carried and neither is called "the revenue". The
 * customer paid the gross; the venue banked the net; a delivery platform kept
 * the difference. Which one a report means decides whether a menu looks
 * profitable, so the screen has to say which it is showing.
 */

export type RevenueChannelKind =
  "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "EVENT" | "OTHER";

export interface RevenueChannel {
  id: string;
  code: string;
  name: string;
  kind: RevenueChannelKind;
  /** Decimal string, or null where nobody has said. A default, never the figure of record. */
  typicalCommissionPercent: string | null;
  active: boolean;
}

export async function fetchRevenueChannels(): Promise<RevenueChannel[]> {
  const { data, error } = await requireSupabase()
    .from("revenue_channels").select("*").order("code");
  if (error) fail("fetchRevenueChannels", error);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    kind: r.kind,
    typicalCommissionPercent:
      r.typical_commission_percent === null || r.typical_commission_percent === undefined
        ? null : String(r.typical_commission_percent),
    active: Boolean(r.active),
  }));
}

export interface TakingsRow {
  id: string;
  businessUnitId: string;
  businessUnitName: string;
  onDate: string;
  channelId: string;
  channelCode: string;
  channelName: string;
  channelKind: RevenueChannelKind;
  /** Decimal strings. What the customer paid, what was withheld, what was kept. */
  grossAmount: string;
  commissionAmount: string | null;
  netAmount: string;
  covers: number | null;
  /** Null where nobody counted the covers. Never a figure invented from a blank. */
  spendPerCover: string | null;
  source: string;
  recordedByEmail: string | null;
  updatedAt: string;
}

export async function fetchTakings(
  fromDate: string,
  toDate: string,
): Promise<TakingsRow[]> {
  const { data, error } = await requireSupabase()
    .from("revenue_daily").select("*")
    .gte("on_date", fromDate).lte("on_date", toDate)
    .order("on_date", { ascending: false });
  if (error) fail("fetchTakings", error);
  return (data ?? []).map((r: any) => ({
    id: r.channel_id + ":" + r.business_unit_id + ":" + r.on_date,
    businessUnitId: r.business_unit_id,
    businessUnitName: r.business_unit_name,
    onDate: r.on_date,
    channelId: r.channel_id,
    channelCode: r.channel_code,
    channelName: r.channel_name,
    channelKind: r.channel_kind,
    grossAmount: String(r.gross_amount),
    commissionAmount:
      r.commission_amount === null || r.commission_amount === undefined
        ? null : String(r.commission_amount),
    netAmount: String(r.net_amount),
    covers: r.covers === null || r.covers === undefined ? null : Number(r.covers),
    spendPerCover:
      r.spend_per_cover === null || r.spend_per_cover === undefined
        ? null : String(r.spend_per_cover),
    source: r.source,
    recordedByEmail: r.recorded_by_email ?? null,
    updatedAt: r.updated_at,
  }));
}

/**
 * Record or correct a day's takings for one unit through one channel.
 *
 * An upsert on (unit, channel, day), because that triple is what the venue
 * means by "Tuesday's bar takings through the till" and there is exactly one
 * of them. A correction is the same write with a different figure, and the
 * database keeps what it was in `takings_changes` — unlike a pay rate, which
 * cannot be corrected once it has been in force, because a rate costed a month
 * and a day's takings only ever described themselves.
 *
 * Nothing here says who typed it. That comes from the caller's JWT by trigger.
 */
export async function recordTakings(input: {
  businessUnitId: string;
  channelId: string;
  onDate: string;
  grossAmount: string;
  commissionAmount?: string | null;
  covers?: number | null;
  note?: string | null;
}): Promise<void> {
  const { error } = await requireSupabase()
    .from("daily_takings")
    .upsert(
      {
        business_unit_id: input.businessUnitId,
        channel_id: input.channelId,
        on_date: input.onDate,
        gross_amount: input.grossAmount,
        commission_amount: input.commissionAmount ?? null,
        covers: input.covers ?? null,
        note: input.note ?? null,
      },
      { onConflict: "business_unit_id,channel_id,on_date" },
    );
  if (error) fail("recordTakings", error);
}
