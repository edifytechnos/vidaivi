// Photos of handwritten working for long-answer questions.
//
// The student photographs their page; the teacher marks from it. Images are
// downscaled in the browser before they leave the phone — a 12MP camera shot
// is ~4MB, which is slow on the cheap Android handsets this is built for and
// far more resolution than anyone needs to read pen on paper. 1600px on the
// longest edge keeps handwriting legible at roughly 250KB.

import { answerImageUrl, removeAnswerImage, uploadAnswerImage } from "./auth";
import { escapeHtml, ICONS } from "./dom";

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.72;
export const MAX_PHOTOS = 3;

/** File → base64 JPEG (no data: prefix), downscaled. */
export async function downscale(file: File): Promise<string> {
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
  const url = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return url.slice(url.indexOf(",") + 1);
}

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
          <div class="shot-img"><img alt="Your working, photo ${i + 1}" /></div>
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
      addBtn.textContent = "Uploading…";
      try {
        const image = await downscale(file);
        const res = await uploadAnswerImage({
          testId: opts.testId,
          testTitle: opts.testTitle,
          questionId: opts.questionId,
          questionIndex: opts.questionIndex,
          maxMarks: opts.maxMarks,
          image,
        });
        images = res.images;
        paint();
      } catch (e) {
        fail(e instanceof Error ? e.message : "Could not upload that photo");
        break;
      }
    }
    addBtn.textContent = original;
    addBtn.disabled = false;
    busy = false;
  });

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

/** Read-only strip of handed-in photos, for review and marking screens. */
export function photoStrip(images: string[], label: string): string {
  if (!images.length) return "";
  return `<div class="shots shots-read">
    ${images
      .map(
        (blob, i) => `<figure class="shot" data-blob="${escapeHtml(blob)}">
        <div class="shot-img"><img alt="${escapeHtml(label)}, photo ${i + 1}" /></div>
      </figure>`
      )
      .join("")}
  </div>`;
}
