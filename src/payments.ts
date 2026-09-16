// The buying side of a ready-made subject.
//
// Every call here is one round trip and goes through `apiFetch`, so an expired
// session ends the session rather than looking like an empty wallet.
//
// `/api/purchase` answers 501 when no payee is configured, which is how the
// screens know to hide Buy entirely: `paymentsOff` is set by the first refusal
// and nothing asks again for the life of the page.

import { apiFetch, authHeader } from "./auth";

export interface Quote {
  shelfId: string;
  shelfTitle: string;
  listPaise: number;
  discountPaise: number;
  payablePaise: number;
  coupon: string;
  couponLabel?: string;
  couponMessage?: string;
}

export interface StartedOrder extends Quote {
  ref: string;
  upi: { vpa: string; payee: string; link: string; note: string };
}

export interface MyOrder {
  ref: string;
  shelfId: string;
  shelfTitle: string;
  listPaise: number;
  discountPaise: number;
  payablePaise: number;
  coupon: string;
  status: "open" | "claimed" | "paid" | "rejected" | "cancelled";
  createdAt: string;
  settledAt: string;
}

export interface PendingPayment {
  sub: string;
  ref: string;
  shelfId: string;
  shelfTitle: string;
  listPaise: number;
  discountPaise: number;
  payablePaise: number;
  coupon: string;
  buyerName: string;
  buyerEmail: string;
  payerRef: string;
  claimedAt: string;
}

export interface Coupon {
  code: string;
  percentOff: number;
  amountOffPaise: number;
  active: boolean;
  maxRedemptions: number;
  redeemed: number;
  expiresAt: string;
  note: string;
}

/** Set the first time the API says there is no payee. A Buy button that
 *  cannot work is worse than no Buy button. */
let paymentsOff = false;
export const paymentsAvailable = (): boolean => !paymentsOff;

/** Rupees, for a person to read. Paise are the stored truth — this is the one
 *  conversion on the client, exactly as `rupees()` is the one on the server. */
export function money(paise: number): string {
  const rupees = Math.round(paise) / 100;
  return `₹${rupees % 1 === 0 ? rupees : rupees.toFixed(2)}`;
}

async function post<T>(body: unknown): Promise<{ ok: boolean; data: T; message?: string }> {
  try {
    const res = await apiFetch("/api/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(body),
    });
    if (res.status === 501) paymentsOff = true;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, data: data as T, message: data.error || "Request failed" };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, data: {} as T, message: "Network error" };
  }
}

async function get<T>(query: string): Promise<T | null> {
  try {
    const res = await apiFetch(`/api/purchase${query}`, { headers: authHeader() });
    if (res.status === 501) paymentsOff = true;
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** What it costs, with a code applied. Writes nothing. */
export const quoteShelf = (shelfId: string, code?: string) =>
  post<Quote>({ action: "quote", shelfId, code: code || "" });

/** Opens an order and hands back the UPI link to pay it with. */
export const startOrder = (shelfId: string, code?: string) =>
  post<StartedOrder>({ action: "start", shelfId, code: code || "" });

/** The buyer says they have paid. This is what puts it in the admin's queue. */
export const claimOrder = (ref: string, payerRef?: string) =>
  post<{ ok: boolean }>({ action: "claim", ref, payerRef: payerRef || "" });

export const cancelOrder = (ref: string) => post<{ ok: boolean }>({ action: "cancel", ref });

export const myOrders = () => get<{ orders: MyOrder[] }>("");

export const pendingPayments = () => get<{ rows: PendingPayment[] }>("?pending=1");

export const listCoupons = () => get<{ rows: Coupon[] }>("?coupons=1");

export const confirmPayment = (sub: string, ref: string) =>
  post<{ ok: boolean }>({ action: "confirm", sub, ref });

export const rejectPayment = (sub: string, ref: string, note?: string) =>
  post<{ ok: boolean }>({ action: "reject", sub, ref, note: note || "" });

export const saveCoupon = (c: Partial<Coupon> & { code: string }) =>
  post<{ ok: boolean }>({ action: "coupon", ...c });

export const deleteCoupon = (code: string) => post<{ ok: boolean }>({ action: "couponDelete", code });
