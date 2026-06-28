import type { OrderStatus } from "@/lib/orders/types";

/** Display order of statuses (lifecycle order), used for filter tabs. */
export const ORDER_STATUSES: OrderStatus[] = [
  "placed",
  "submitted",
  "pending_approval",
  "proposed",
  "confirmed",
  "rejected",
  "cancelled",
];

/** Human label per status. */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  placed: "Placed",
  submitted: "Submitted",
  pending_approval: "Pending approval",
  proposed: "Proposed",
  confirmed: "Confirmed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/**
 * Status chip colors come from CSS custom properties in tokens.css
 * (`--status-<key>` text, `--status-<key>-bg` background). Returning the var
 * names keeps the brand palette the single source of truth.
 */
export function statusVars(status: OrderStatus): {
  color: string;
  background: string;
} {
  return {
    color: `var(--status-${status})`,
    background: `var(--status-${status}-bg)`,
  };
}

// ── Lifecycle transitions (mirrors the real Orders.gs flow) ──────────────────
// approve -> proposed, confirm proposed -> confirmed, reject, cancel (pre-confirm
// only), edit (set prices, pre-confirm only).

const APPROVABLE: OrderStatus[] = ["placed", "submitted", "pending_approval"];
const REJECTABLE: OrderStatus[] = [
  "placed",
  "submitted",
  "pending_approval",
  "proposed",
];
/** Anything before the order is locked in (confirmed). */
export const PRE_CONFIRM: OrderStatus[] = [
  "placed",
  "submitted",
  "pending_approval",
  "proposed",
];

export const canApprove = (s: OrderStatus) => APPROVABLE.includes(s);
export const canConfirm = (s: OrderStatus) => s === "proposed";
export const canReject = (s: OrderStatus) => REJECTABLE.includes(s);
export const canCancel = (s: OrderStatus) => PRE_CONFIRM.includes(s);
export const canEdit = (s: OrderStatus) => PRE_CONFIRM.includes(s);

export type OrderAction =
  | "approve"
  | "confirm"
  | "reject"
  | "cancel"
  | "edit";

/** The status an action transitions an order INTO (null for edit). */
export const ACTION_TARGET: Record<OrderAction, OrderStatus | null> = {
  approve: "proposed",
  confirm: "confirmed",
  reject: "rejected",
  cancel: "cancelled",
  edit: null,
};
