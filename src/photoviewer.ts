// Reading a photograph of a child's handwriting, full screen.
//
// The strip shows a 132–160px thumbnail, which is enough to see that a page was
// handed in and nowhere near enough to READ it. A teacher awarding marks has to
// make out a minus sign in pencil; a parent wants to see what their child
// actually wrote; a student wants to check the page they photographed is not
// blurred. One viewer serves all three, because it is the same question.
//
// It is deliberately NOT the shared modal (`src/modal.ts`): that one is a
// dialog of form fields in a centred card, and this is a black full-bleed
// surface whose whole job is that the image is as large as the screen allows.
// What it does borrow is the modal's manners — Escape closes, focus is trapped
// and restored, and the body is locked behind `modal-open`.
//
// **No new bytes.** The photos are already capped at 1600px on upload, so the
// thumbnail and the "full size" image are the same file: the viewer reuses the
// exact URL the strip already resolved, and the browser serves it from cache.
// A SAS is only good for 15 minutes, so a page left open long enough will have
// a stale one — that is the single case where this re-signs, on the image's own
// error event, and it is one request made because a person asked for it.

import { answerImageUrl } from "./auth";
import { escapeHtml } from "./dom";

/** One page of working: the blob it lives in, and a URL if we already have one. */
export interface ViewerPhoto {
  blob: string;
  src?: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const STEP = 1.4;

let open = false;

/**
 * Open the viewer on `photos[index]`.
 *
 * Safe to call from any screen and for any role — it reads nothing about who is
 * looking, because a photo is readable by whoever could already see the strip.
 */
export function openPhotoViewer(photos: ViewerPhoto[], index: number, label: string): void {
  if (open || !photos.length) return;
  open = true;

  const returnTo = document.activeElement as HTMLElement | null;
  let at = Math.max(0, Math.min(photos.length - 1, index));
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let turn = 0;

  const root = document.createElement("div");
  root.className = "pv";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", `${label} — full screen`);
  root.innerHTML = `
    <div class="pv-bar">
      <span class="pv-count" id="pv-count"></span>
      <div class="pv-spacer"></div>
      <button type="button" class="pv-btn" id="pv-out" aria-label="Zoom out">−</button>
      <button type="button" class="pv-btn pv-zoom" id="pv-reset" aria-label="Reset zoom">100%</button>
      <button type="button" class="pv-btn" id="pv-in" aria-label="Zoom in">+</button>
      <button type="button" class="pv-btn" id="pv-turn" aria-label="Rotate">${ROTATE}</button>
      <button type="button" class="pv-btn pv-close" id="pv-close" aria-label="Close">✕</button>
    </div>
    <div class="pv-stage" id="pv-stage">
      <img class="pv-img" id="pv-img" alt="${escapeHtml(label)}" draggable="false" />
      <p class="pv-missing" id="pv-missing" hidden>That photo could not be loaded.</p>
    </div>
    <div class="pv-foot"${photos.length > 1 ? "" : " hidden"}>
      <button type="button" class="btn btn-ghost pv-step" id="pv-prev">‹ Previous</button>
      <span class="pv-hint">Pinch, scroll or double-tap to zoom</span>
      <button type="button" class="btn btn-ghost pv-step" id="pv-next">Next ›</button>
    </div>`;
  document.body.appendChild(root);
  document.body.classList.add("modal-open");

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const img = $<HTMLImageElement>("pv-img");
  const stage = $("pv-stage");
  const missing = $("pv-missing");
  const count = $("pv-count");
  const zoomLabel = $("pv-reset");
  const prev = $<HTMLButtonElement>("pv-prev");
  const next = $<HTMLButtonElement>("pv-next");

  /** The transform is the whole of the zoom: one write, no layout thrash. */
  function apply(): void {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale}) rotate(${turn}deg)`;
    img.classList.toggle("pv-zoomed", scale > 1);
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  }

  /** Zoom about a point on the screen, so what is under the finger stays put. */
  function zoomTo(nextScale: number, cx?: number, cy?: number): void {
    const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));
    const box = stage.getBoundingClientRect();
    const ax = (cx ?? box.left + box.width / 2) - (box.left + box.width / 2);
    const ay = (cy ?? box.top + box.height / 2) - (box.top + box.height / 2);
    const ratio = clamped / scale;
    tx = ax - (ax - tx) * ratio;
    ty = ay - (ay - ty) * ratio;
    scale = clamped;
    // Back at fit, centre it again: a pan left over from a zoom would otherwise
    // leave the whole page sitting off to one side with nothing to drag back.
    if (scale === 1) {
      tx = 0;
      ty = 0;
    }
    apply();
  }

  /** Point the <img> at the page we are on, reusing a URL we already hold. */
  async function show(): Promise<void> {
    scale = 1;
    tx = 0;
    ty = 0;
    turn = 0;
    apply();
    count.textContent = photos.length > 1 ? `Page ${at + 1} of ${photos.length}` : label;
    prev.disabled = at === 0;
    next.disabled = at === photos.length - 1;
    missing.hidden = true;
    const photo = photos[at];
    const url = photo.src || (await answerImageUrl(photo.blob));
    if (!url) {
      img.removeAttribute("src");
      missing.hidden = false;
      return;
    }
    img.src = url;
  }

  // A 15-minute SAS outlives most sittings and not all of them. Re-sign once,
  // and only here: a viewer that re-signed on open would spend a request every
  // time on a URL that was almost always still good.
  let retried = "";
  img.addEventListener("error", async () => {
    const photo = photos[at];
    if (retried === photo.blob) {
      missing.hidden = false;
      return;
    }
    retried = photo.blob;
    const fresh = await answerImageUrl(photo.blob);
    if (fresh) {
      photo.src = fresh;
      img.src = fresh;
    } else {
      missing.hidden = false;
    }
  });

  function go(step: number): void {
    const to = at + step;
    if (to < 0 || to >= photos.length) return;
    at = to;
    void show();
  }

  function close(): void {
    if (!open) return;
    open = false;
    document.removeEventListener("keydown", onKey);
    root.remove();
    document.body.classList.remove("modal-open");
    returnTo?.focus?.();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowRight") {
      go(1);
    } else if (e.key === "ArrowLeft") {
      go(-1);
    } else if (e.key === "+" || e.key === "=") {
      zoomTo(scale * STEP);
    } else if (e.key === "-") {
      zoomTo(scale / STEP);
    } else if (e.key === "0") {
      zoomTo(1);
    } else if (e.key === "r" || e.key === "R") {
      turn = (turn + 90) % 360;
      apply();
    } else if (e.key === "Tab") {
      // Trapped: the page behind is inert, and tabbing out to it would leave a
      // keyboard user pressing Enter on things they cannot see.
      const focusable = Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
  document.addEventListener("keydown", onKey);

  $("pv-close").addEventListener("click", close);
  $("pv-in").addEventListener("click", () => zoomTo(scale * STEP));
  $("pv-out").addEventListener("click", () => zoomTo(scale / STEP));
  $("pv-reset").addEventListener("click", () => zoomTo(1));
  $("pv-turn").addEventListener("click", () => {
    turn = (turn + 90) % 360;
    apply();
  });
  prev.addEventListener("click", () => go(-1));
  next.addEventListener("click", () => go(1));

  // Tapping the backdrop closes; tapping the photo does not, or every attempt
  // to drag a zoomed page would shut the viewer.
  stage.addEventListener("click", (e) => {
    if (e.target === stage && !moved) close();
  });

  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomTo(scale * (e.deltaY < 0 ? STEP : 1 / STEP), e.clientX, e.clientY);
    },
    { passive: false }
  );

  // Double-tap and double-click both toggle between fit and a readable 2.5x —
  // the gesture everyone already knows from their photo gallery.
  let lastTap = 0;
  stage.addEventListener("dblclick", (e) => zoomTo(scale > 1 ? 1 : 2.5, e.clientX, e.clientY));

  // --- Pointer handling: drag to pan, two fingers to pinch -----------------
  const points = new Map<number, { x: number; y: number }>();
  let startScale = 1;
  let startSpread = 0;
  let from = { x: 0, y: 0, tx: 0, ty: 0 };
  let moved = false;

  const spread = () => {
    const [a, b] = [...points.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  stage.addEventListener("pointerdown", (e) => {
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (points.size === 2) {
      startSpread = spread();
      startScale = scale;
    } else if (points.size === 1) {
      from = { x: e.clientX, y: e.clientY, tx, ty };
      const now = Date.now();
      if (now - lastTap < 300 && e.pointerType === "touch") {
        zoomTo(scale > 1 ? 1 : 2.5, e.clientX, e.clientY);
        lastTap = 0;
      } else {
        lastTap = now;
      }
      if (scale > 1) stage.setPointerCapture(e.pointerId);
    }
  });

  stage.addEventListener("pointermove", (e) => {
    if (!points.has(e.pointerId)) return;
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (points.size === 2 && startSpread > 0) {
      const [a, b] = [...points.values()];
      moved = true;
      zoomTo((startScale * spread()) / startSpread, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (points.size !== 1 || scale <= 1) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    tx = from.tx + dx;
    ty = from.ty + dy;
    apply();
  });

  const release = (e: PointerEvent) => {
    points.delete(e.pointerId);
    if (points.size < 2) startSpread = 0;
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);

  void show();
  $("pv-close").focus();
}

const ROTATE = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>`;

/**
 * Make every photo inside `root` open the viewer. One binding serves the
 * student's uploader and the read-only strip a teacher, parent or student sees,
 * because they render the same `[data-blob]` figures.
 */
export function bindPhotoViewer(root: HTMLElement): void {
  root.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    // The uploader's ✕ lives inside the same figure and removes the photo.
    if (target.closest("[data-remove]")) return;
    const fig = target.closest<HTMLElement>("[data-blob]");
    if (!fig || !fig.closest(".shots")) return;
    const strip = fig.closest(".shots")!;
    const figures = Array.from(strip.querySelectorAll<HTMLElement>("[data-blob]"));
    const photos: ViewerPhoto[] = figures.map((f) => ({
      blob: f.dataset.blob!,
      src: f.querySelector("img")?.getAttribute("src") || undefined,
    }));
    const label = fig.querySelector("img")?.getAttribute("alt") || "Handed-in working";
    openPhotoViewer(photos, figures.indexOf(fig), label);
  });
}
