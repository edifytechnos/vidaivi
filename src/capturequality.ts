// A capture-quality gate for photographs of handwritten working.
//
// No model, no dependency: eight pass/fail checks in plain pixel maths over
// an ~800px copy of the canvas the uploader has already downscaled, so there
// is no second decode. It is the passport-booth model — every check must
// pass, and a failure names the one thing to fix — rather than a quality
// score nobody can act on.
//
// Why it exists: answer photos go to `/api/assess` for the AI's first-draft
// mark, and most of the AI's errors on handwritten maths are transcription
// failures, not rubric mistakes. A bad photo costs a credit and produces a
// wrong draft. Refusing it on the phone, before upload, costs nothing.
//
// Every threshold in `THRESHOLDS` is a FIRST GUESS. Real tuning needs about a
// hundred real captures from cheap and good phones, each labelled readable or
// not, and the numbers moved until the two sets separate. Until then
// `e2e/capturequality.cjs` holds a synthetic image per check — the floor each
// one must still catch — so a retuned number that switches a check off fails
// the suite rather than shipping silently. "Upload anyway" in the uploader is
// the other half of the same admission: a gate this rough must never be the
// thing that stops a student handing in.
//
// The whole module is pure — pixels in, verdict out — so the suite can drive
// it without a session, a row or a network.

export type CheckId =
  | "resolution"
  | "frame"
  | "dark"
  | "bright"
  | "ink"
  | "contrast"
  | "blur"
  | "glare"
  | "shadow";

export interface CheckResult {
  id: CheckId;
  ok: boolean;
  /** The number the threshold was compared against, for tuning. */
  value: number;
  /** Student-facing: what to do about it. Empty when the check passed. */
  reason: string;
}

export interface CaptureVerdict {
  ok: boolean;
  /** The first failing check's reason — the one thing the student is told. */
  reason: string;
  checks: CheckResult[];
}

/** Pixels as a canvas hands them over: RGBA, row-major, `width * height * 4`. */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * First guesses, every one of them. Tune on real captures, and when you move
 * one run `node e2e/capturequality.cjs` — the synthetic images there are the
 * floor each check must still catch.
 */
export const THRESHOLDS = {
  /** Shortest edge a page has to have to be readable at all. */
  minShortEdge: 480,
  /** Long edge, likewise. 1600 is where `downscale` caps it. */
  minLongEdge: 640,
  /** Mean luma below this is a page shot in the dark. */
  darkMean: 60,
  /**
   * Mean luma above this is a page blown out to white. High, because a page
   * is mostly paper and a well-lit sheet already sits near 240; only a sheet
   * with its writing washed into the paper goes past this.
   */
  brightMean: 248,
  /**
   * Writing present: the share of pixels darker than the paper by more than
   * `inkDepth`, where the cut adapts to how dark the darkest ink actually is
   * (halfway from the paper to the 1st percentile) and never sits closer to
   * the paper than `inkDepth`, so sensor noise on a blank page is not ink.
   */
  minInk: 0.003,
  inkDepth: 25,
  /**
   * How far the darkest ink sits below the paper (p90 − p1 of luma). Not a
   * standard deviation, which was the first idea: blur spreads ink and
   * collapses the deviation too, so a shaky photo was sent off to find better
   * light. Blurred strokes keep a dark core; faint ones never had one.
   */
  minContrast: 40,
  /** Variance of the Laplacian on the working image; lower is softer. */
  minSharpness: 60,
  /** Luma at or above which a pixel counts as saturated. */
  glareLevel: 250,
  /** A block is saturated when this fraction of its pixels are. */
  glareBlockFill: 0.9,
  /** Fail when the largest cluster of saturated blocks is this share of all. */
  maxGlareCluster: 0.02,
  /**
   * The largest step in paper brightness between two NEIGHBOURING regions.
   * A step, not the spread across the whole page: a page lit from a window
   * darkens smoothly from one edge to the other and reads perfectly well,
   * and the first real photo the gate met was refused for exactly that. A
   * shadow that hurts marking has an edge, and an edge is a step.
   */
  maxShadowStep: 60,
  /** Working size for the pixel checks — the long edge the luma is sampled at. */
  workEdge: 800,
  /** Block size (in working pixels) for the glare grid and the page mask. */
  glareBlock: 16,
  /**
   * A block is paper when its own paper level is at least this share of the
   * frame's. Low enough that a shadowed part of the page still counts as
   * page (so the shadow check can see it), high enough that a desk, a
   * keyboard or a dark cloth around the sheet does not.
   */
  pageLevel: 0.55,
  /** The page has to be at least this share of the frame to be judged at all. */
  minPageShare: 0.2,
  /** Region grid for the shadow check. */
  shadowGrid: 6,
} as const;

/** One student-facing sentence per check. */
export const REASONS: Record<CheckId, string> = {
  resolution: "Move closer to the page",
  frame: "Move closer so the page fills the photo",
  dark: "Too dark",
  bright: "Too bright",
  ink: "Page looks blank",
  contrast: "Faint writing, find better light",
  blur: "Too blurry, hold the phone steady",
  glare: "Glare on the page, move away from the light",
  shadow: "Shadow across the page",
};

/**
 * Greyscale at a working size. Box-averaged rather than sampled, so the
 * Laplacian sees the page and not the sampling grid, and so the thresholds
 * mean the same thing whatever a phone's camera produced.
 */
export function toLuma(px: Pixels): Pixels & { luma: Float32Array } {
  const { data, width, height } = px;
  const scale = Math.min(1, THRESHOLDS.workEdge / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const luma = new Float32Array(w * h);
  const bx = width / w;
  const by = height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * by);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * by));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * bx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * bx));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          // Rec. 601 luma — the eye weights green most, and so does pen on paper.
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          n++;
        }
      }
      luma[y * w + x] = sum / n;
    }
  }
  return { data, width: w, height: h, luma };
}

function percentile(sorted: Float32Array, p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

/** The page's own brightness: the 90th percentile, so ink cannot drag it. */
function paperLevel(sorted: Float32Array): number {
  return percentile(sorted, 0.9);
}

/**
 * Where the page is. The first real photo the gate met was refused for a
 * "shadow" that was the black cloth and the keyboard around a perfectly good
 * sheet: every check was reading the whole frame. So the frame is cut into
 * blocks, each block is paper or not by its own brightness against the
 * frame's paper level, and the largest connected patch of paper blocks is
 * the page. Everything after this is judged inside that patch only.
 */
export interface PageRegion {
  /** Block grid dimensions and the block size in working pixels. */
  bw: number;
  bh: number;
  block: number;
  /** 1 for a block that is part of the page. */
  mask: Uint8Array;
  /** Bounding box of the page, in working pixels. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Share of the frame's blocks the page covers. */
  share: number;
}

export function findPage(luma: Float32Array, w: number, h: number, sorted: Float32Array): PageRegion {
  const B = THRESHOLDS.glareBlock;
  const bw = Math.max(1, Math.floor(w / B));
  const bh = Math.max(1, Math.floor(h / B));
  const cut = paperLevel(sorted) * THRESHOLDS.pageLevel;
  const bright = new Uint8Array(bw * bh);
  const cell = new Float32Array(B * B);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let k = 0;
      for (let y = by * B; y < (by + 1) * B; y++) {
        const row = y * w;
        for (let x = bx * B; x < (bx + 1) * B; x++) cell[k++] = luma[row + x];
      }
      cell.sort();
      bright[by * bw + bx] = percentile(cell, 0.75) >= cut ? 1 : 0;
    }
  }
  const labels = new Int32Array(bw * bh).fill(-1);
  let best = -1;
  let bestSize = 0;
  const stack: number[] = [];
  let next = 0;
  for (let s = 0; s < bright.length; s++) {
    if (!bright[s] || labels[s] >= 0) continue;
    const id = next++;
    let size = 0;
    stack.push(s);
    labels[s] = id;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % bw;
      const y = (i - x) / bw;
      const nb = [x > 0 ? i - 1 : -1, x < bw - 1 ? i + 1 : -1, y > 0 ? i - bw : -1, y < bh - 1 ? i + bw : -1];
      for (const j of nb) {
        if (j >= 0 && bright[j] && labels[j] < 0) {
          labels[j] = id;
          stack.push(j);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = id;
    }
  }
  const whole = new Uint8Array(bw * bh);
  for (let i = 0; i < whole.length; i++) if (labels[i] === best) whole[i] = 1;
  // Erode by one block. A block on the sheet's edge is part paper and part
  // desk, and its paper level lands in between — which is exactly a step to
  // the block beside it. The edge of the sheet is not a shadow on it.
  const mask = new Uint8Array(bw * bh);
  let kept = 0;
  for (let i = 0; i < whole.length; i++) {
    if (!whole[i]) continue;
    const x = i % bw;
    const y = (i - x) / bw;
    const inner =
      x > 0 && whole[i - 1] && x < bw - 1 && whole[i + 1] && y > 0 && whole[i - bw] && y < bh - 1 && whole[i + bw];
    if (inner) {
      mask[i] = 1;
      kept++;
    }
  }
  // A sheet too small to survive erosion is judged whole rather than not at all.
  if (!kept) mask.set(whole);
  let minX = bw, minY = bh, maxX = -1, maxY = -1;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % bw;
    const y = (i - x) / bw;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX < 0) {
    // Nothing bright enough anywhere: judge the whole frame, and let the
    // dark check say why.
    mask.fill(1);
    return { bw, bh, block: B, mask, x0: 0, y0: 0, x1: bw * B, y1: bh * B, share: 1 };
  }
  return {
    bw, bh, block: B, mask,
    x0: minX * B, y0: minY * B, x1: (maxX + 1) * B, y1: (maxY + 1) * B,
    share: bestSize / (bw * bh),
  };
}

/** The luma of the page's own pixels — every block in the mask, nothing else. */
export function pagePixels(luma: Float32Array, w: number, page: PageRegion): Float32Array {
  const B = page.block;
  let n = 0;
  for (let i = 0; i < page.mask.length; i++) if (page.mask[i]) n++;
  const out = new Float32Array(n * B * B);
  let k = 0;
  for (let i = 0; i < page.mask.length; i++) {
    if (!page.mask[i]) continue;
    const bx = i % page.bw;
    const by = (i - bx) / page.bw;
    for (let y = by * B; y < (by + 1) * B; y++) {
      const row = y * w;
      for (let x = bx * B; x < (bx + 1) * B; x++) out[k++] = luma[row + x];
    }
  }
  return out;
}

/** A crop of the luma to the page's bounding box. */
export function cropLuma(luma: Float32Array, w: number, page: PageRegion): { luma: Float32Array; w: number; h: number } {
  const cw = page.x1 - page.x0;
  const ch = page.y1 - page.y0;
  const out = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    out.set(luma.subarray((page.y0 + y) * w + page.x0, (page.y0 + y) * w + page.x1), y * cw);
  }
  return { luma: out, w: cw, h: ch };
}

export function checkFrame(page: PageRegion): CheckResult {
  const ok = page.share >= THRESHOLDS.minPageShare;
  return { id: "frame", ok, value: page.share, reason: ok ? "" : REASONS.frame };
}

/**
 * Of the source bitmap. `downscaleToCanvas` never scales up, so a canvas
 * under the minimum is a source that was under it too.
 */
export function checkResolution(width: number, height: number): CheckResult {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const ok = short >= THRESHOLDS.minShortEdge && long >= THRESHOLDS.minLongEdge;
  return { id: "resolution", ok, value: short, reason: ok ? "" : REASONS.resolution };
}

export function checkDark(mean: number): CheckResult {
  const ok = mean >= THRESHOLDS.darkMean;
  return { id: "dark", ok, value: mean, reason: ok ? "" : REASONS.dark };
}

export function checkBright(mean: number): CheckResult {
  const ok = mean <= THRESHOLDS.brightMean;
  return { id: "bright", ok, value: mean, reason: ok ? "" : REASONS.bright };
}

/** Writing present: enough pixels sit well below the paper's own brightness. */
export function checkInk(luma: Float32Array, sorted: Float32Array): CheckResult {
  const paper = paperLevel(sorted);
  const darkest = percentile(sorted, 0.01);
  const cut = paper - Math.max(THRESHOLDS.inkDepth, (paper - darkest) / 2);
  let dark = 0;
  for (let i = 0; i < luma.length; i++) if (luma[i] < cut) dark++;
  const value = dark / luma.length;
  const ok = value >= THRESHOLDS.minInk;
  return { id: "ink", ok, value, reason: ok ? "" : REASONS.ink };
}

/** Ink depth: faint writing leaves the darkest ink close to the paper. */
export function checkContrast(sorted: Float32Array): CheckResult {
  const value = paperLevel(sorted) - percentile(sorted, 0.01);
  const ok = value >= THRESHOLDS.minContrast;
  return { id: "contrast", ok, value, reason: ok ? "" : REASONS.contrast };
}

/**
 * Variance of the Laplacian — the classic no-reference sharpness measure. A
 * sharp edge gives the 4-neighbour Laplacian a large response; blur spreads
 * the edge over pixels and the response collapses towards zero everywhere.
 */
export function laplacianVariance(luma: Float32Array, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - w] - luma[i + w];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export function checkBlur(luma: Float32Array, w: number, h: number): CheckResult {
  const value = laplacianVariance(luma, w, h);
  const ok = value >= THRESHOLDS.minSharpness;
  return { id: "blur", ok, value, reason: ok ? "" : REASONS.blur };
}

/**
 * Glare is a *cluster* of saturated pixels, not a count of them: a page in
 * good light has scattered white specks and no patch; a reflected window is
 * one contiguous blown-out region. Blocks are marked saturated when nearly
 * every pixel in them is, then the largest 4-connected group of such blocks
 * is measured against the whole grid.
 */
export function checkGlare(luma: Float32Array, w: number, h: number): CheckResult {
  const B = THRESHOLDS.glareBlock;
  const bw = Math.max(1, Math.floor(w / B));
  const bh = Math.max(1, Math.floor(h / B));
  const sat = new Uint8Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let hot = 0;
      for (let y = by * B; y < (by + 1) * B; y++) {
        const row = y * w;
        for (let x = bx * B; x < (bx + 1) * B; x++) {
          if (luma[row + x] >= THRESHOLDS.glareLevel) hot++;
        }
      }
      sat[by * bw + bx] = hot / (B * B) >= THRESHOLDS.glareBlockFill ? 1 : 0;
    }
  }
  // Largest connected component, iterative flood fill.
  const seen = new Uint8Array(bw * bh);
  let largest = 0;
  const stack: number[] = [];
  for (let s = 0; s < sat.length; s++) {
    if (!sat[s] || seen[s]) continue;
    let size = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % bw;
      const y = (i - x) / bw;
      const nb = [
        x > 0 ? i - 1 : -1,
        x < bw - 1 ? i + 1 : -1,
        y > 0 ? i - bw : -1,
        y < bh - 1 ? i + bw : -1,
      ];
      for (const j of nb) {
        if (j >= 0 && sat[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (size > largest) largest = size;
  }
  const value = largest / (bw * bh);
  const ok = value <= THRESHOLDS.maxGlareCluster;
  return { id: "glare", ok, value, reason: ok ? "" : REASONS.glare };
}

/**
 * A shadow is a hard edge in the light across the page. Each block of the
 * page takes its *paper* brightness as its 75th percentile — so a block dense
 * with writing does not read as a shadow — and what fails is the largest step
 * between two neighbouring blocks that are BOTH on the page. A smooth
 * gradient from a window spreads its darkening over every step and passes; a
 * hand or a lamp casting a shadow puts the whole drop in one. The edge of the
 * sheet itself is never measured: the desk beside it is not on the page.
 */
export function checkShadow(luma: Float32Array, w: number, page: PageRegion): CheckResult {
  const { bw, bh, block: B, mask } = page;
  const paper = new Float32Array(bw * bh);
  const cell = new Float32Array(B * B);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const bx = i % bw;
    const by = (i - bx) / bw;
    let k = 0;
    for (let y = by * B; y < (by + 1) * B; y++) {
      const row = y * w;
      for (let x = bx * B; x < (bx + 1) * B; x++) cell[k++] = luma[row + x];
    }
    cell.sort();
    paper[i] = percentile(cell, 0.75);
  }
  let value = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % bw;
    if (x < bw - 1 && mask[i + 1]) value = Math.max(value, Math.abs(paper[i] - paper[i + 1]));
    if (i + bw < mask.length && mask[i + bw]) value = Math.max(value, Math.abs(paper[i] - paper[i + bw]));
  }
  const ok = value <= THRESHOLDS.maxShadowStep;
  return { id: "shadow", ok, value, reason: ok ? "" : REASONS.shadow };
}

/**
 * Run every check and return the first failure as the reason.
 *
 * The order is the order a student can act on it: a photo that is too small,
 * too far away or too dark is retaken before anything about its sharpness is
 * worth saying;
 * a blank page has no edges and almost no spread, so it would read as blurred
 * or faint if the ink check did not come before both.
 */
export function assessCapture(px: Pixels): CaptureVerdict {
  const { luma, width: w, height: h } = toLuma(px);
  const frameSorted = Float32Array.from(luma).sort();
  const page = findPage(luma, w, h, frameSorted);
  // Every judgement from here on is about the page, not the desk around it.
  const onPage = pagePixels(luma, w, page);
  const sorted = Float32Array.from(onPage).sort();
  let mean = 0;
  for (let i = 0; i < onPage.length; i++) mean += onPage[i];
  mean /= onPage.length || 1;
  const crop = cropLuma(luma, w, page);

  const checks: CheckResult[] = [
    checkResolution(px.width, px.height),
    checkFrame(page),
    checkDark(mean),
    checkBright(mean),
    checkInk(onPage, sorted),
    checkContrast(sorted),
    checkBlur(crop.luma, crop.w, crop.h),
    checkGlare(crop.luma, crop.w, crop.h),
    checkShadow(luma, w, page),
  ];
  const first = checks.find((c) => !c.ok);
  return { ok: !first, reason: first ? first.reason : "", checks };
}

/** Pixels off a canvas, for `assessCapture`. Throws if the browser cannot read them. */
export function pixelsOf(canvas: HTMLCanvasElement): Pixels {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot read the photo");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: img.data, width: img.width, height: img.height };
}
