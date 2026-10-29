// What the widget keeps while the page runs, so a report carries the moments
// BEFORE the person pressed "Report a problem": the console, uncaught errors,
// every network call (method, address, status, time — never a body, except
// the first few hundred characters of one of our own API errors), and the
// pages visited. Small rings in memory, nothing sent until the person sends a
// report and has seen what is in it.
//
// Like a car's dashcam: always looping over the last few minutes, saved only
// when there is something to show.

export type ConsoleEntry = { t: number; level: "log" | "info" | "warn" | "error" | "uncaught"; msg: string };
export type NetEntry = { t: number; m: string; u: string; s: number; d: number; e?: string; r?: string };
export type TrailEntry = { t: number; u: string };
export type Traces = { startedAt: number; console: ConsoleEntry[]; network: NetEntry[]; trail: TrailEntry[] };

const MAX = { console: 150, network: 150, trail: 30 };
const started = Date.now();
const rings: Traces = { startedAt: started, console: [], network: [], trail: [] };
let installed = false;
let skip: (url: string) => boolean = () => false;

const push = <T>(list: T[], item: T, max: number) => { list.push(item); if (list.length > max) list.shift(); };

// A secret in an address or a message is replaced before it is ever kept:
// query values with telling names, bearer tokens, anything shaped like a JWT
// or one of our signed tokens (prefix.payload.mac).
const SECRET_PARAM = /([?&#;]|\b)(token|key|code|sig|signature|secret|password|pass|pin|otp|credential|auth|session|t)=([^&#\s"']+)/gi;
export function redact(s: string): string {
  return String(s)
    .replace(SECRET_PARAM, (_m, sep, name) => `${sep}${name}=…`)
    .replace(/\b(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1…")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "…jwt…")
    .replace(/\b[a-z]{3}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "…token…");
}
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function stringify(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? `\n${a.stack.split("\n").slice(1, 6).join("\n")}` : ""}`;
  try {
    const seen = new WeakSet();
    return JSON.stringify(a, (_k, v) => {
      if (typeof v === "object" && v) { if (seen.has(v)) return "[circular]"; seen.add(v); }
      if (v instanceof Node) return `<${(v as Element).tagName?.toLowerCase() || "node"}>`;
      return v;
    }) ?? String(a);
  } catch { return String(a); }
}

const pathOf = (u: string) => {
  try { const x = new URL(u, location.href); return x.origin === location.origin ? x.pathname + x.search : x.href; } catch { return u; }
};

/** Start keeping the rings. Call once, as early as the page can. `ignore` names addresses never to trace (the feedback API itself). */
export function installCapture(ignore?: (url: string) => boolean): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  if (ignore) skip = ignore;

  for (const level of ["log", "info", "warn", "error"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try { push(rings.console, { t: Date.now(), level, msg: short(redact(args.map(stringify).join(" ")), 600) }, MAX.console); } catch { /* never break the page's own logging */ }
      orig(...args);
    };
  }
  window.addEventListener("error", (e) => {
    const where = e.filename ? ` (${pathOf(e.filename)}:${e.lineno}:${e.colno})` : "";
    push(rings.console, { t: Date.now(), level: "uncaught", msg: short(redact(e.error ? stringify(e.error) : `${e.message}${where}`), 1200) }, MAX.console);
  });
  window.addEventListener("unhandledrejection", (e) => {
    push(rings.console, { t: Date.now(), level: "uncaught", msg: short(redact(`Unhandled rejection: ${stringify(e.reason)}`), 1200) }, MAX.console);
  });

  // fetch: method, address, status, how long. A failed call to our own API
  // keeps the start of its answer — that is where the error sentence is.
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (skip(url)) return origFetch(input, init);
    const t = Date.now();
    try {
      const res = await origFetch(input, init);
      const entry: NetEntry = { t, m: method, u: short(redact(pathOf(url)), 300), s: res.status, d: Date.now() - t };
      push(rings.network, entry, MAX.network);
      if (res.status >= 400 && new URL(url, location.href).origin === location.origin) {
        res.clone().text().then((txt) => { entry.r = short(redact(txt), 400); }).catch(() => {});
      }
      return res;
    } catch (e) {
      push(rings.network, { t, m: method, u: short(redact(pathOf(url)), 300), s: 0, d: Date.now() - t, e: short(String((e as Error)?.message || e), 120) }, MAX.network);
      throw e;
    }
  };
  // XMLHttpRequest, for the libraries that still use it.
  const XHR = window.XMLHttpRequest?.prototype;
  if (XHR) {
    const open = XHR.open, send = XHR.send;
    XHR.open = function (this: XMLHttpRequest & { __fb?: { m: string; u: string } }, method: string, url: string | URL, ...rest: unknown[]) {
      this.__fb = { m: String(method).toUpperCase(), u: String(url) };
      return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof XHR.open;
    XHR.send = function (this: XMLHttpRequest & { __fb?: { m: string; u: string } }, body?: Document | XMLHttpRequestBodyInit | null) {
      const info = this.__fb;
      if (info && !skip(info.u)) {
        const t = Date.now();
        this.addEventListener("loadend", () => push(rings.network, { t, m: info.m, u: short(redact(pathOf(info.u)), 300), s: this.status, d: Date.now() - t, ...(this.status ? {} : { e: "no answer" }) }, MAX.network));
      }
      return send.call(this, body);
    };
  }

  // The pages visited: every history move, and the first page.
  const note = () => {
    const u = short(redact(location.pathname + location.search), 200);
    if (rings.trail[rings.trail.length - 1]?.u !== u) push(rings.trail, { t: Date.now(), u }, MAX.trail);
  };
  note();
  for (const fn of ["pushState", "replaceState"] as const) {
    const orig = history[fn].bind(history);
    history[fn] = (...args: Parameters<History["pushState"]>) => { const out = orig(...args); note(); return out; };
  }
  window.addEventListener("popstate", note);
}

/** A copy of the rings as they are now. */
export const traces = (): Traces => structuredClone(rings);

/** The short lines the issue itself carries: the errors, the failed calls, the trail. */
export function digestOf(t: Traces): { errors: string[]; failed: string[]; trail: string[] } {
  const at = (ms: number) => `${Math.round((ms - Date.now()) / 1000)}s`;
  return {
    errors: t.console.filter((c) => c.level === "error" || c.level === "uncaught").slice(-12).map((c) => `${at(c.t)} ${c.msg.split("\n")[0]}`.slice(0, 300)),
    failed: t.network.filter((n) => n.s === 0 || n.s >= 400).slice(-12).map((n) => `${at(n.t)} ${n.m} ${n.u} → ${n.s || n.e || "failed"}${n.r ? ` ${n.r.replace(/\s+/g, " ").slice(0, 120)}` : ""}`.slice(0, 240)),
    trail: t.trail.slice(-12).map((p) => `${at(p.t)} ${p.u}`),
  };
}

/** The device and the page, as the issue's "Where" section. Nothing about the person. */
export function deviceContext(): Record<string, unknown> {
  const nav = navigator as Navigator & { connection?: { effectiveType?: string } };
  return {
    url: redact(location.href).slice(0, 400),
    ua: navigator.userAgent,
    viewport: `${innerWidth}x${innerHeight}`,
    dpr: devicePixelRatio,
    lang: navigator.language,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    referrer: document.referrer ? (() => { try { return new URL(document.referrer).origin; } catch { return ""; } })() : "",
    connection: nav.connection?.effectiveType || "",
    standalone: matchMedia("(display-mode: standalone)").matches,
    online: navigator.onLine,
  };
}
