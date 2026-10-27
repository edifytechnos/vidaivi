// The session replay and the page snapshot, both from rrweb, which records
// the DOM itself (the page's elements and every change to them) rather than
// a video. A replay is a few hundred KB a minute instead of megabytes, the
// team can inspect any element in it, and the routine can read it as HTML.
//
// rrweb is imported only when it is needed — the first snapshot, or the
// first recording — so it is its own chunk and no page pays for it up front.
//
// What is never in it: anything typed (every input is masked), any text the
// app marks with data-clarity-mask or data-fb-mask (names, phone numbers,
// a child's handwriting), anything under data-fb-block, and the feedback
// dialog itself.

type RrEvent = { type: number; timestamp: number; data?: unknown };
type RecordFn = (opts: Record<string, unknown>) => (() => void) | undefined;

const OPTIONS = {
  maskAllInputs: true,
  maskTextSelector: "[data-clarity-mask], [data-fb-mask]",
  // A masked element that is a picture (answer photos) is blocked outright:
  // masking hides text, not images.
  blockSelector: "[data-fb-block], .fb-root, img[data-clarity-mask], [data-clarity-mask] img",
  inlineStylesheet: true,
  recordCanvas: false,
  collectFonts: false,
  slimDOMOptions: "all",
  sampling: { mousemove: 80, scroll: 150, media: 800, input: "last" },
};

let loader: Promise<RecordFn> | null = null;
const rrweb = () => (loader ??= import("rrweb").then((m) => m.record as unknown as RecordFn));

/** Start loading rrweb in the background, so the first snapshot is quick. */
export const preloadReplay = (): void => { void rrweb().catch(() => {}); };

// One recording at a time: rrweb observes the whole document.
let stop: (() => void) | null = null;
let segments: RrEvent[][] = [];
let mode: "buffer" | "manual" | null = null;
let startedAt = 0;

/** A one-frame recording of the page as it is now: rrweb's meta + full snapshot. */
export async function snapshot(): Promise<RrEvent[]> {
  // While a recording runs, its latest full snapshot and what followed is the
  // freshest picture there is — a second recorder cannot run beside it.
  if (stop) return segments.flat();
  const record = await rrweb();
  const events: RrEvent[] = [];
  const end = record({ ...OPTIONS, emit: (e: RrEvent) => events.push(e) });
  end?.();
  return events;
}

/**
 * The dashcam: always keep the last one to two minutes. rrweb takes a fresh
 * full snapshot every minute (a checkout); two segments are kept, so the
 * oldest falls away as a new one starts.
 */
export async function startBuffer(): Promise<void> {
  if (stop) return;
  const record = await rrweb();
  mode = "buffer"; startedAt = Date.now(); segments = [];
  stop = record({
    ...OPTIONS, checkoutEveryNms: 60_000,
    emit: (e: RrEvent, checkout?: boolean) => {
      if (checkout || !segments.length) { segments.push([]); if (segments.length > 2) segments.shift(); }
      segments[segments.length - 1].push(e);
    },
  }) || null;
}

/** "Record the problem": from now until stop, at most `maxMs`. */
export async function startManual(maxMs: number, onAutoStop: () => void): Promise<void> {
  stopAll();
  const record = await rrweb();
  mode = "manual"; startedAt = Date.now(); segments = [[]];
  stop = record({ ...OPTIONS, emit: (e: RrEvent) => segments[0].push(e) }) || null;
  setTimeout(() => { if (mode === "manual" && Date.now() - startedAt >= maxMs - 50) onAutoStop(); }, maxMs);
}

export type Recording = { events: RrEvent[]; ms: number };

/** What the buffer holds now, without stopping it. */
export function buffered(): Recording | null {
  if (mode !== "buffer") return null;
  const events = segments.flat();
  return events.length > 2 ? { events, ms: events[events.length - 1].timestamp - events[0].timestamp } : null;
}

/** End a manual recording and hand it over. A buffer starts again after. */
export function stopManual(): Recording | null {
  if (mode !== "manual") return null;
  const events = segments.flat();
  stopAll();
  return { events, ms: events.length ? events[events.length - 1].timestamp - events[0].timestamp : 0 };
}

export const recording = (): { mode: typeof mode; since: number } => ({ mode, since: startedAt });

export function stopAll(): void {
  stop?.(); stop = null; mode = null; segments = [];
}
