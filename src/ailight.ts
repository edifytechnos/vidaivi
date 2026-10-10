// The two buttons every AI action wears, and the light that runs round them.
//
// The rule, from J: a button that CALLS the AI (and spends a credit) is
// filled violet with a white light running round it — "the AI's" (`.ai-go`:
// Assess with AI, Mark N & release, Ask Seyari AI). A button that ACTS ON
// what the AI produced is the reverse, white with violet text and a violet
// light — "yours to take" (`.ai-take`: Use this mark, Add to test, Add all).
// One pair of components, so every AI button in the app is the same button.

import { ICONS } from "./dom";

/**
 * The light that runs round an edge (`.mk-trace` in style.css): the two AI
 * buttons' and the card holding the AI's proposal.
 *
 * A stroke cannot carry a gradient along its own length, so the streak is
 * built from layers of the same outline, each with one faint dash placed by
 * its dasharray. Where many overlap the light is bright; where few do, it is
 * faint. The layers are sized so the result is shaped like a drawn gradient,
 * not stepped:
 *
 *   - behind the brightest point, the light eases away to nothing over
 *     `tail` (the brightness falls along `(1 - d/tail)^1.6`, so it lingers
 *     a moment and then dissolves);
 *   - ahead of it, it ramps up over `tip`, so the leading edge is soft too
 *     rather than a cut. The faintest layers reach furthest both ways.
 *
 * Positions are percentages of the outline (`pathLength="100"`). The peak
 * sits at 0 in the pattern; the animation's starting offset of -50 puts it at
 * the bottom right, half way round from where a rect's path begins. The
 * streak travels by animating `stroke-dashoffset` on the svg, which every
 * layer inherits: one animation, not one per layer.
 */
export function lightTrace(opts: { rx: number; tail: number; tip: number; cls?: string }): string {
  const layers = 48;
  const alpha = 0.1; // each layer's opacity — must match `.mk-trace` stroke-opacity
  const { rx, tail, tip } = opts;
  const top = 1 - (1 - alpha) ** (layers + 1);
  const rects = Array.from({ length: layers }, (_, i) => {
    const k = i + 1;
    // How far behind the peak layer k reaches: the distance at which the
    // target brightness has fallen to what k overlapping layers make.
    const lit = 1 - (1 - alpha) ** k;
    const back = Math.max(0.3, tail * (1 - (lit / top) ** (1 / 1.6)));
    const ahead = tip * (1 - k / (layers + 1));
    // The pattern is laid out with the peak at 0 and the dash wrapping round
    // it — `ahead` dash, the gap, `back` dash, a zero gap that joins the two —
    // so no layer ever has a zero-LENGTH dash: with round caps one of those
    // draws a dot, and 48 of them stacked made a bright speck on the outline.
    const dash = [ahead, 100 - ahead - back, back, 0].map((n) => n.toFixed(2)).join(" ");
    return `<rect width="100%" height="100%" rx="${rx}" pathLength="100" stroke-dasharray="${dash}"/>`;
  });
  return `<svg class="mk-trace${opts.cls ? ` ${opts.cls}` : ""}" aria-hidden="true">${rects.join("")}</svg>`;
}

/** `.ai-go`: a 44px pill, so the radius is half that less the 1.5px border it
 *  is centred on; a short perimeter, so the tail is a long share of it. */
const GO_TRACE = lightTrace({ rx: 21.25, tail: 28, tip: 3.5 });
/** `.ai-take`: a 34px pill with a 1px border; the light is violet in CSS. */
const TAKE_TRACE = lightTrace({ rx: 16.5, tail: 30, tip: 4, cls: "ai-take-trace" });

const TICK = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

/** The inside of an `.ai-go` button: the light, the sparkle, the label. Any
 *  code that relabels one while it works ("Reading…") must go through this,
 *  or the light and the icon are wiped with the old text. */
export const aiGoInner = (label: string): string => `${GO_TRACE}${ICONS.spark}<span>${label}</span>`;

/** The inside of an `.ai-take` button: the light, a tick, the label. */
export const aiTakeInner = (label: string): string => `${TAKE_TRACE}${TICK}<span>${label}</span>`;
