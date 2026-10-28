// The widget's side of /api/feedback on seyali.app: the calls, the tickets
// this device holds keys for, the device id a vote is counted by, and
// gzip for the attachments. No framework, so Vidai carries the same file.

export type Kind = "issue" | "feature" | "review";
export type Status = "uploading" | "received" | "planned" | "in_progress" | "done" | "wont_do" | "duplicate";
export type Update = { at: string; status?: Status; note?: string; by?: string };
export type Triage = {
  title: string; summary: string; steps: string[]; expected: string; actual: string; area: string; suspect: string;
  evidence: string[]; questions: string[]; severity: "low" | "medium" | "high" | "blocker"; category: string; confidence: "low" | "medium" | "high"; at?: string;
};
export type TicketFile = { id: string; kind: string; name: string; type: string; size: number; encoding?: string; events?: number; ms?: number };
export type Ticket = {
  id: string; app: string; appName: string; kind: Kind; title: string; body: string; rating?: number;
  status: Status; updates: Update[]; votes: number; comments: number; createdAt: string; updatedAt?: string;
  files?: TicketFile[];
  triage?: Triage | null;
  element?: { tag: string; text: string; label: string; selector: string; rect: { x: number; y: number; w: number; h: number }; styles: Record<string, string> } | null;
};
export type BoardItem = { id: string; app: string; appName: string; title: string; summary: string; status: Status; votes: number; comments: number; createdAt: string; score?: number };
export type Comment = { id: string; name: string; text: string; at: string; team: boolean };
export type Upload = { id: string; kind: string; parts: number; partBytes: number };
export type Attachment = { kind: "replay" | "snapshot" | "traces" | "screenshot" | "upload"; name: string; type: string; bytes: Uint8Array; encoding?: "gzip"; events?: number; ms?: number };

export const STATUS_LABEL: Record<Status, string> = {
  uploading: "Sending", received: "Received", planned: "Planned", in_progress: "In progress",
  done: "Done", wont_do: "Not planned", duplicate: "Already asked",
};

// Where the platform is for this page: production's apps talk to seyali.app,
// everything else (QA hosts, localhost) to the platform's QA — a test report
// must never land in production's inbox or file a real issue.
const PLATFORM_QA = "https://black-pebble-0a1118300-qa.eastasia.1.azurestaticapps.net";
export function platformFor(host: string): string {
  if (host === "seyali.app" || host === "www.seyali.app") return "";
  if (/^[a-z0-9-]+\.seyali\.app$/.test(host)) return "https://seyali.app";
  if (host === new URL(PLATFORM_QA).hostname) return "";
  return PLATFORM_QA;
}
let base = "";
export const setBase = (b: string) => { base = b.replace(/\/+$/, ""); };
export const apiUrl = () => `${base}/api/feedback`;
/** The public pages (board, my tickets) live on the platform, wherever this page is. */
export const siteUrl = () => base || "";

// --- this device ------------------------------------------------------------
const K_TICKETS = "seyali:fb:tickets";
const K_DEVICE = "seyali:fb:device";
const K_VOTED = "seyali:fb:voted";
const read = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: works for this visit */ } };

export type Held = { id: string; key: string; at: string };
export const heldTickets = (): Held[] => read<Held[]>(K_TICKETS, []).filter((t) => t && t.id && t.key);
export function holdTicket(id: string, key: string): void {
  const list = heldTickets().filter((t) => t.id !== id);
  list.unshift({ id, key, at: new Date().toISOString() });
  write(K_TICKETS, list.slice(0, 60));
}
/** Keys handed over in a link's fragment (#k=id:key,…), merged into this device's. */
export function adoptKeys(fragment: string): number {
  const m = /(?:^|[#&])k=([^&]+)/.exec(fragment);
  if (!m) return 0;
  let n = 0;
  for (const pair of decodeURIComponent(m[1]).split(",")) {
    const [id, key] = pair.split(":");
    if (/^[a-z]+-[ifr][0-9a-z]+$/.test(id || "") && /^[A-Za-z0-9_-]{16,64}$/.test(key || "")) { holdTicket(id, key); n++; }
  }
  return n;
}
export const keysFragment = () => `#k=${encodeURIComponent(heldTickets().map((t) => `${t.id}:${t.key}`).join(","))}`;

export function deviceId(): string {
  let id = read<string>(K_DEVICE, "");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
    const b = crypto.getRandomValues(new Uint8Array(16));
    id = btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    write(K_DEVICE, id);
  }
  return id;
}
export const votedSet = () => new Set(read<string[]>(K_VOTED, []));
export function noteVoted(id: string, on: boolean): void {
  const s = votedSet(); if (on) s.add(id); else s.delete(id);
  write(K_VOTED, [...s].slice(-500));
}

// --- the calls ----------------------------------------------------------------
const headers = (extra: Record<string, string> = {}) => ({
  "content-type": "application/json", "x-seyali-csrf": "1",
  "x-seyali-tickets": heldTickets().slice(0, 60).map((t) => `${t.id}:${t.key}`).join(","),
  "x-seyali-voter": deviceId(), ...extra,
});
// Same-origin (seyali.app's own pages) sends the owner cookie so a signed-in
// owner's tickets are theirs; from any other app it is never sent.
const creds = (): RequestCredentials => (base ? "omit" : "same-origin");
async function call<T>(method: "GET" | "POST", query: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}${query}`, { method, headers: headers(), credentials: creds(), body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Error("Could not reach Seyali — check the connection and try again"); }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out.error || "Something went wrong — try again"), { status: res.status });
  return out as T;
}

export const fb = {
  submit: (b: Record<string, unknown>) => call<{ id: string; key: string; ticket: Ticket; uploads: Upload[] }>("POST", "", { action: "submit", voter: deviceId(), ...b }),
  attach: (id: string, key: string, file: string, part: number, data: string) => call<{ ok: true }>("POST", "", { action: "attach", id, key, file, part, data }),
  send: (id: string, key: string) => call<{ ticket: Ticket }>("POST", "", { action: "send", id, key }),
  mine: () => call<{ tickets: Ticket[] }>("GET", "?mine=1"),
  ticket: (id: string) => call<{ ticket: Ticket; comments: Comment[]; voted?: boolean; mine?: boolean }>("GET", `?id=${encodeURIComponent(id)}`),
  board: (app?: string) => call<{ open: BoardItem[]; shipped: BoardItem[] }>("GET", `?board=1${app ? `&app=${app}` : ""}`),
  similar: (text: string, body: string, app?: string) => call<{ similar: BoardItem[] }>("GET", `?similar=${encodeURIComponent(text)}&body=${encodeURIComponent(body.slice(0, 600))}${app ? `&app=${app}` : ""}`),
  vote: async (id: string, on: boolean) => { const out = await call<{ votes: number; voted: boolean }>("POST", "", { action: "vote", id, on, voter: deviceId() }); noteVoted(id, on); return out; },
  // Seyari reads the report's evidence and writes the steps into the ticket.
  triage: (id: string) => {
    const key = heldTickets().find((t) => t.id === id)?.key;
    return call<{ triage: Triage }>("POST", "", { action: "triage", id, key });
  },
  file: (id: string, fileId: string) => call<{ file: TicketFile & { data: string } }>("GET", `?id=${encodeURIComponent(id)}&file=${encodeURIComponent(fileId)}`),
  comment: (id: string, text: string, name?: string) => {
    const key = heldTickets().find((t) => t.id === id)?.key;
    return call<{ comment: Comment; comments: number }>("POST", "", { action: "comment", id, text, name, key, voter: deviceId() });
  },
};

// --- attachments ----------------------------------------------------------------
export async function gzip(text: string): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
/** JSON as an attachment: gzip where the browser can, plain where it cannot. */
export async function jsonAttachment(kind: Attachment["kind"], name: string, value: unknown, extra: Partial<Attachment> = {}): Promise<Attachment> {
  const text = JSON.stringify(value);
  const z = await gzip(text);
  return z ? { kind, name: `${name}.gz`, type: "application/json", bytes: z, encoding: "gzip", ...extra } : { kind, name, type: "application/json", bytes: new TextEncoder().encode(text), ...extra };
}
const b64 = (bytes: Uint8Array) => {
  let s = ""; const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(s);
};

/** The whole send: the ticket, then each attachment in parts, then "that is all". */
export async function sendReport(body: Record<string, unknown>, files: Attachment[], onProgress: (done: number, of: number) => void): Promise<Ticket> {
  const meta = files.map((f) => ({ kind: f.kind, name: f.name, type: f.type, size: f.bytes.length, encoding: f.encoding, events: f.events, ms: f.ms }));
  const { id, key, ticket, uploads } = await fb.submit({ ...body, files: meta });
  holdTicket(id, key);
  if (!uploads.length) return ticket;
  const total = uploads.reduce((n, u) => n + u.parts, 0);
  let done = 0;
  onProgress(0, total);
  for (let i = 0; i < uploads.length; i++) {
    const u = uploads[i], bytes = files[i].bytes;
    for (let p = 0; p < u.parts; p++) {
      // A part that fails once is tried again; a file that still fails is
      // left out — send() keeps the words and whatever did arrive.
      const data = b64(bytes.subarray(p * u.partBytes, (p + 1) * u.partBytes));
      try { await fb.attach(id, key, u.id, p, data); } catch { try { await fb.attach(id, key, u.id, p, data); } catch { /* left out */ } }
      onProgress(++done, total);
    }
  }
  return (await fb.send(id, key)).ticket;
}

/** A recording or snapshot from a ticket, decoded back to rrweb's events. */
export async function fileEvents(ticketId: string, f: TicketFile): Promise<{ type: number; timestamp: number }[]> {
  const { file } = await fb.file(ticketId, f.id);
  const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
  return JSON.parse(f.encoding === "gzip" ? await gunzip(bytes) : new TextDecoder().decode(bytes));
}
/** An image from a ticket, as an object URL (revoke it when done). */
export async function fileUrl(ticketId: string, f: TicketFile): Promise<string> {
  const { file } = await fb.file(ticketId, f.id);
  return URL.createObjectURL(new Blob([Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0))], { type: f.type }));
}
