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
  /** Spread of paper brightness between the brightest and darkest region. */
  maxShadowSpread: 90,
  /** Working size for the pixel checks — the long edge the luma is sampled at. */
  workEdge: 800,
  /** Block size (in working pixels) for the glare grid. */
  glareBlock: 16,
  /** Region grid for the shadow check. */
  shadowGrid: 6,
} as const;

/** One student-facing sentence per check. */
export const REASONS: Record<CheckId, string> = {
  resolution: "Move closer to the page",
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
 * A shadow is one part of the page being lit differently from another. The
 * page is cut into a grid of regions and each region's *paper* brightness is
 * taken as its 75th percentile — so a region dense with writing does not read
 * as a shadow — and the spread between the brightest and darkest region is
 * what fails.
 */
export function checkShadow(luma: Float32Array, w: number, h: number): CheckResult {
  const G = THRESHOLDS.shadowGrid;
  let lo = Infinity;
  let hi = -Infinity;
  for (let gy = 0; gy < G; gy++) {
    const y0 = Math.floor((gy * h) / G);
    const y1 = Math.floor(((gy + 1) * h) / G);
    for (let gx = 0; gx < G; gx++) {
      const x0 = Math.floor((gx * w) / G);
      const x1 = Math.floor(((gx + 1) * w) / G);
      const n = (y1 - y0) * (x1 - x0);
      if (n <= 0) continue;
      const region = new Float32Array(n);
      let k = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) region[k++] = luma[y * w + x];
      region.sort();
      const paper = percentile(region, 0.75);
      if (paper < lo) lo = paper;
      if (paper > hi) hi = paper;
    }
  }
  const value = hi === -Infinity ? 0 : hi - lo;
  const ok = value <= THRESHOLDS.maxShadowSpread;
  return { id: "shadow", ok, value, reason: ok ? "" : REASONS.shadow };
}

/**
 * Run every check and return the first failure as the reason.
 *
 * The order is the order a student can act on it: a photo that is too small
 * or too dark is retaken before anything about its sharpness is worth saying;
 * a blank page has no edges and almost no spread, so it would read as blurred
 * or faint if the ink check did not come before both.
 */
export function assessCapture(px: Pixels): CaptureVerdict {
  const { luma, width: w, height: h } = toLuma(px);
  const sorted = Float32Array.from(luma).sort();
  let mean = 0;
  for (let i = 0; i < luma.length; i++) mean += luma[i];
  mean /= luma.length || 1;

  const checks: CheckResult[] = [
    checkResolution(px.width, px.height),
    checkDark(mean),
    checkBright(mean),
    checkInk(luma, sorted),
    checkContrast(sorted),
    checkBlur(luma, w, h),
    checkGlare(luma, w, h),
    checkShadow(luma, w, h),
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
