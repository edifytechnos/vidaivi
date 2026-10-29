// The replay player every surface shares: the report dialog (watch what you
// are about to send), My tickets (watch what you sent), and the team's ticket
// page. rrweb's Replayer draws the recorded page in a sandboxed frame; this
// wraps it in a stage that scales the frame to fit, a play/pause button, a
// scrubber and the time — plain DOM, so Vidai carries it too.
//
// rrweb is the same lazy chunk the recorder uses: nothing is downloaded until
// a recording is actually played.
import { ensureStyle } from "./style";

type RrEvent = { type: number; timestamp: number; data?: unknown };
type Replayer = {
  play(t?: number): void; pause(t?: number): void; getCurrentTime(): number;
  getMetaData(): { totalTime: number }; on(e: string, f: () => void): void; destroy?(): void;
};
export type Highlight = { x: number; y: number; w: number; h: number };
export type PlayerHandle = { destroy(): void };

const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const svg = (d: string) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">${d}</svg>`;
const PLAY = svg('<path d="M8 5v14l11-7z"/>'), PAUSE = svg('<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>');

/**
 * Play `events` inside `host`. `at: "end"` opens on the last frame (a page
 * snapshot, or "where it ended up"); `highlight` outlines a box in the
 * recorded page's own coordinates — the element the person pointed at.
 */
export async function mountPlayer(host: HTMLElement, events: RrEvent[], opts: { at?: "start" | "end"; highlight?: Highlight | null; maxHeight?: number } = {}): Promise<PlayerHandle> {
  ensureStyle();
  host.classList.add("fb-root");
  host.innerHTML = `<div class="fb-player"><div class="fb-stage"><p class="fb-stage-note">Loading the recording…</p></div><div class="fb-controls"></div></div>`;
  const stage = host.querySelector<HTMLDivElement>(".fb-stage")!;
  const controls = host.querySelector<HTMLDivElement>(".fb-controls")!;
  if (!Array.isArray(events) || events.length < 2) { stage.innerHTML = `<p class="fb-stage-note">Nothing was recorded.</p>`; return { destroy() {} }; }

  let replayer: Replayer;
  try {
    const rr = (await import("rrweb")) as unknown as { Replayer: new (e: RrEvent[], o: Record<string, unknown>) => Replayer };
    stage.replaceChildren();
    replayer = new rr.Replayer(events, { root: stage, skipInactive: true, showWarning: false, showDebug: false, mouseTail: false, UNSAFE_replayCanvas: false, triggerFocus: false,
      // The widget itself (its dim, the recording pill, the picker) is blocked
      // when recorded, which keeps its box and its look but not its insides —
      // a grey veil or a black blob over the page. It is not part of the page.
      insertStyleRules: [".fb-root { display: none !important; }"] });
  } catch (e) {
    stage.innerHTML = `<p class="fb-stage-note">This recording could not be played: ${String((e as Error)?.message || e).slice(0, 120)}</p>`;
    return { destroy() {} };
  }

  const box = document.createElement("div");
  box.className = "fb-highlight";
  box.hidden = true;

  // The recorded page keeps its own size; the stage scales it to fit the
  // width it has (and a height cap, so a tall phone page does not run off).
  const fit = () => {
    const wrap = stage.querySelector<HTMLElement>(".replayer-wrapper");
    const frame = stage.querySelector<HTMLIFrameElement>("iframe");
    if (!wrap || !frame) return;
    const w = Number(frame.width) || 1280, h = Number(frame.height) || 800;
    const maxH = opts.maxHeight ?? Math.round(window.innerHeight * 0.62);
    const s = Math.min(1, stage.clientWidth / w, maxH / h);
    wrap.style.transform = `scale(${s})`;
    wrap.style.transformOrigin = "0 0";
    stage.style.height = `${Math.round(h * s)}px`;
    stage.style.setProperty("--fb-left", `${Math.max(0, Math.round((stage.clientWidth - w * s) / 2))}px`);
    wrap.style.left = `var(--fb-left)`;
    if (opts.highlight) {
      const hl = opts.highlight;
      box.style.left = `${Math.max(0, Math.round((stage.clientWidth - w * s) / 2)) + hl.x * s - 3}px`;
      box.style.top = `${hl.y * s - 3}px`;
      box.style.width = `${hl.w * s + 6}px`;
      box.style.height = `${hl.h * s + 6}px`;
    }
  };
  replayer.on("resize", fit);
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
  ro?.observe(stage);

  const total = Math.max(0, replayer.getMetaData().totalTime);
  let playing = false, raf = 0;
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "fb-play";
  const range = document.createElement("input");
  range.type = "range"; range.min = "0"; range.max = String(total); range.className = "fb-scrub"; range.setAttribute("aria-label", "Position in the recording");
  const time = document.createElement("span");
  time.className = "fb-time";
  const paint = () => {
    const at = Math.min(total, replayer.getCurrentTime());
    range.value = String(at);
    time.textContent = `${mmss(at)} / ${mmss(total)}`;
    btn.innerHTML = playing ? PAUSE : PLAY;
    btn.setAttribute("aria-label", playing ? "Pause" : "Play");
    box.hidden = !opts.highlight || playing || at < total - 300;
  };
  const tick = () => { paint(); if (playing) raf = requestAnimationFrame(tick); };
  const seek = (ms: number) => { replayer.pause(Math.max(0, Math.min(total, ms))); playing = false; cancelAnimationFrame(raf); paint(); };
  btn.addEventListener("click", () => {
    if (playing) { replayer.pause(); playing = false; cancelAnimationFrame(raf); paint(); return; }
    replayer.play(replayer.getCurrentTime() >= total - 50 ? 0 : replayer.getCurrentTime());
    playing = true; tick();
  });
  range.addEventListener("input", () => seek(Number(range.value)));
  replayer.on("finish", () => { playing = false; cancelAnimationFrame(raf); paint(); });
  if (total >= 500) controls.append(btn, range, time);
  else controls.append(Object.assign(document.createElement("span"), { className: "fb-time", textContent: "One frame — the screen as it was" }));
  stage.appendChild(box);

  seek(opts.at === "end" ? total : 0);
  fit();
  requestAnimationFrame(fit);
  return {
    destroy() { cancelAnimationFrame(raf); ro?.disconnect(); try { replayer.pause(); replayer.destroy?.(); } catch { /* gone already */ } host.replaceChildren(); },
  };
}
