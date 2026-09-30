// Photos of handwritten working for long-answer questions.
//
// The student photographs their page; the teacher marks from it. Images are
// downscaled in the browser before they leave the phone — a 12MP camera shot
// is ~4MB, which is slow on the cheap Android handsets this is built for and
// far more resolution than anyone needs to read pen on paper. 1600px on the
// longest edge keeps handwriting legible at roughly 250KB.

import { answerImageUrl, removeAnswerImage, uploadAnswerImage } from "./auth";
import { assessCapture, pixelsOf } from "./capturequality";
import { escapeHtml, ICONS } from "./dom";
import { bindPhotoViewer } from "./photoviewer";

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.72;
export const MAX_PHOTOS = 3;
/**
 * How many refused captures of one question before "Upload anyway" is offered.
 * The gate's thresholds are first guesses, and a student whose phone or light
 * it keeps refusing must still be able to hand something in — flagged, so the
 * teacher knows it was sent against advice.
 */
export const OVERRIDE_AFTER = 3;

/** File → the downscaled canvas, white under the drawing. */
export async function downscaleToCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot resize the photo");
  // White under the drawing: a transparent PNG would flatten to black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas;
}

/** Canvas → base64 JPEG (no data: prefix). */
export function encodeJpeg(canvas: HTMLCanvasElement): string {
  const url = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return url.slice(url.indexOf(",") + 1);
}

/** File → base64 JPEG (no data: prefix), downscaled. */
export async function downscale(file: File): Promise<string> {
  return encodeJpeg(await downscaleToCanvas(file));
}

// Refused captures per question, for the session. Keyed by question rather
// than by uploader instance because the student navigates away and back —
// the uploader is re-mounted on every visit, and "three tries" must mean
// three tries at this question, not three since the last repaint.
const refusals = new Map<string, number>();

export interface UploaderOpts {
  testId: string;
  testTitle: string;
  questionId: string;
  questionIndex: number;
  maxMarks: number;
  initial: string[];
  onChange: (images: string[]) => void;
}

/**
 * Render the "add a photo" control into `host` and keep it in sync. Returns
 * the current list of blob names at any time.
 */
export function mountUploader(host: HTMLElement, opts: UploaderOpts): () => string[] {
  let images = opts.initial.slice();
  let busy = false;

  host.innerHTML = `
    <div class="shots" id="ap-shots"></div>
    <div class="drop" id="ap-drop">
      ${ICONS.camera}
      <span class="drop-title">Take a photo of your working</span>
      <span class="drop-hint">Opens the camera on your phone · JPEG or PNG · up to ${MAX_PHOTOS} photos</span>
      <button type="button" class="btn btn-primary" id="ap-add">Add photo</button>
      <input id="ap-file" class="visually-hidden" type="file" accept="image/*" capture="environment" multiple />
    </div>
    <p class="login-error" id="ap-error" hidden></p>`;

  const shots = host.querySelector<HTMLElement>("#ap-shots")!;
  const drop = host.querySelector<HTMLElement>("#ap-drop")!;
  const input = host.querySelector<HTMLInputElement>("#ap-file")!;
  const addBtn = host.querySelector<HTMLButtonElement>("#ap-add")!;
  const error = host.querySelector<HTMLElement>("#ap-error")!;

  const refusalKey = `${opts.testId}~${opts.questionId}`;

  function fail(message: string) {
    error.textContent = message;
    error.hidden = false;
  }

  function paint() {
    error.hidden = true;
    drop.hidden = images.length >= MAX_PHOTOS;
    shots.innerHTML = images
      .map(
        (blob, i) => `
        <figure class="shot" data-blob="${escapeHtml(blob)}">
          <button type="button" class="shot-img shot-open"
                  aria-label="Open photo ${i + 1} full screen"><img alt="Your working, photo ${i + 1}" /></button>
          <figcaption class="shot-foot">
            <span>Page ${i + 1}</span>
            <button type="button" class="shot-x" data-remove="${escapeHtml(blob)}"
                    aria-label="Remove photo ${i + 1}">✕</button>
          </figcaption>
        </figure>`
      )
      .join("");
    void hydrateThumbs(shots);
    opts.onChange(images.slice());
  }

  addBtn.addEventListener("click", () => input.click());

  input.addEventListener("change", async () => {
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length || busy) return;
    busy = true;
    addBtn.disabled = true;
    const original = addBtn.textContent;
    for (const file of files) {
      if (images.length >= MAX_PHOTOS) break;
      addBtn.textContent = "Checking…";
      try {
        const canvas = await downscaleToCanvas(file);
        // The gate runs on the pixels that would be uploaded, before any
        // bytes leave the phone: a refused photo costs nothing but the retake.
        const verdict = assessCapture(pixelsOf(canvas));
        if (!verdict.ok) {
          const image = encodeJpeg(canvas);
          const tries = (refusals.get(refusalKey) ?? 0) + 1;
          refusals.set(refusalKey, tries);
          // The student sees the photo they took beside the reason, so the
          // refusal is about something on the screen and not a bare sentence.
          showRefusal({
            image,
            reason: verdict.reason,
            allowAnyway: tries >= OVERRIDE_AFTER,
            onRetake: () => input.click(),
            onAnyway: () => void sendAnyway(image, verdict.reason),
          });
          fail(`Photo not clear enough to mark — ${verdict.reason.toLowerCase()}. Tap Add photo to take it again.`);
          break;
        }
        addBtn.textContent = "Uploading…";
        await send(encodeJpeg(canvas));
      } catch (e) {
        fail(e instanceof Error ? e.message : "Could not upload that photo");
        break;
      }
    }
    addBtn.textContent = original;
    addBtn.disabled = false;
    busy = false;
  });

  async function send(image: string, lowQuality?: string) {
    const res = await uploadAnswerImage({
      testId: opts.testId,
      testTitle: opts.testTitle,
      questionId: opts.questionId,
      questionIndex: opts.questionIndex,
      maxMarks: opts.maxMarks,
      image,
      ...(lowQuality ? { lowQuality } : {}),
    });
    images = res.images;
    paint();
  }

  // After OVERRIDE_AFTER refusals the student may send the refused capture
  // anyway. It goes up flagged with the reason it was refused, so the teacher
  // reads it knowing the student was told, and a clearer retake is still
  // welcome beside it.
  async function sendAnyway(image: string, reason: string) {
    if (busy || images.length >= MAX_PHOTOS) return;
    busy = true;
    addBtn.disabled = true;
    const original = addBtn.textContent;
    addBtn.textContent = "Uploading…";
    try {
      await send(image, reason);
    } catch (e) {
      fail(e instanceof Error ? e.message : "Could not upload that photo");
    }
    addBtn.textContent = original;
    addBtn.disabled = false;
    busy = false;
  }

  shots.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-remove]");
    if (!btn || busy) return;
    busy = true;
    try {
      images = await removeAnswerImage(opts.testId, opts.questionId, btn.dataset.remove!);
      paint();
    } catch (err) {
      fail(err instanceof Error ? err.message : "Could not remove that photo");
    }
    busy = false;
  });

  // A student checks their own photo is readable before handing it in — the
  // same viewer their teacher will mark from.
  bindPhotoViewer(shots);

  paint();
  return () => images.slice();
}

/** Point every `.shot img` inside `root` at a freshly signed URL. */
export async function hydrateThumbs(root: HTMLElement): Promise<void> {
  const figures = Array.from(root.querySelectorAll<HTMLElement>("[data-blob]"));
  await Promise.all(
    figures.map(async (fig) => {
      const img = fig.querySelector("img");
      if (!img || img.getAttribute("src")) return;
      const url = await answerImageUrl(fig.dataset.blob!);
      if (url) img.setAttribute("src", url);
      else fig.classList.add("shot-missing");
    })
  );
}

/**
 * Read-only strip of handed-in photos, for review and marking screens.
 *
 * Each thumbnail is a BUTTON, not a bare image: 132px of a page of working says
 * a page was handed in and cannot be read, so opening it full screen has to be
 * reachable by keyboard and announced as an action. `bindPhotoViewer` on any
 * ancestor does the rest.
 */
export function photoStrip(images: string[], label: string): string {
  if (!images.length) return "";
  return `<div class="shots shots-read">
    ${images
      .map(
        (blob, i) => `<figure class="shot" data-blob="${escapeHtml(blob)}">
        <button type="button" class="shot-img shot-open"
                aria-label="Open ${escapeHtml(label)}, photo ${i + 1}, full screen"><img
          alt="${escapeHtml(label)}, photo ${i + 1}" /></button>
      </figure>`
      )
      .join("")}
  </div>`;
}

interface RefusalOpts {
  /** The refused capture, base64 JPEG without the data: prefix. */
  image: string;
  reason: string;
  allowAnyway: boolean;
  onRetake: () => void;
  onAnyway: () => void;
}

/**
 * The capture-quality gate's refusal: the photo the student just took, the
 * one thing wrong with it, and Retake. After `OVERRIDE_AFTER` refusals of the
 * same question, Upload anyway as well.
 *
 * It is not `openModal` — that is a form of fields — and not the photo
 * viewer, whose whole job is a black surface as large as the screen. What it
 * borrows is the modal's manners: the scrim, Escape, a focus trap, the body
 * locked behind `modal-open`, and the action row that ends at the right with
 * the primary on top on a phone.
 */
export function showRefusal(o: RefusalOpts): void {
  const opener = document.activeElement as HTMLElement | null;
  const root = document.createElement("div");
  root.className = "modal-scrim ap-refused";
  root.innerHTML = `
    <div class="modal ap-refused-card" role="dialog" aria-modal="true" aria-labelledby="ap-refused-title">
      <div class="modal-head">
        <h2 class="modal-title" id="ap-refused-title">This photo may be hard to mark</h2>
        <button type="button" class="modal-x" id="ap-refused-close" aria-label="Close">✕</button>
      </div>
      <img class="ap-refused-img" id="ap-refused-img" alt="The photo you just took"
           src="data:image/jpeg;base64,${o.image}" />
      <p class="ap-refused-reason" id="ap-refused-reason">${escapeHtml(o.reason)}</p>
      <p class="hint ap-refused-hint">${
        o.allowAnyway
          ? "Still not working? You can send it as it is. Your teacher will see that the photo was flagged, so add a clearer one if you can."
          : "Fix that and take the photo again — it has not been uploaded."
      }</p>
      <div class="modal-actions">
        ${o.allowAnyway ? `<button type="button" class="btn btn-ghost" id="ap-anyway">Upload anyway</button>` : ""}
        <span class="modal-actions-gap"></span>
        <button type="button" class="btn btn-ghost" id="ap-refused-cancel">Cancel</button>
        <button type="button" class="btn btn-primary modal-submit" id="ap-retake">${ICONS.camera} Retake</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  document.body.classList.add("modal-open");

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const focusables = () =>
    Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled])"));

  function close(): void {
    document.removeEventListener("keydown", onKey);
    root.remove();
    document.body.classList.remove("modal-open");
    opener?.focus?.();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  document.addEventListener("keydown", onKey);
  root.addEventListener("click", (e) => {
    if (e.target === root) close();
  });
  $("ap-refused-close").addEventListener("click", close);
  $("ap-refused-cancel").addEventListener("click", close);
  // Retake reopens the camera from inside this click, which is the user
  // gesture a file input needs; closing first would lose it.
  $("ap-retake").addEventListener("click", () => {
    close();
    o.onRetake();
  });
  if (o.allowAnyway) {
    $("ap-anyway").addEventListener("click", () => {
      close();
      o.onAnyway();
    });
  }
  $("ap-retake").focus();
}
