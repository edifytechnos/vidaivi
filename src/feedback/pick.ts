// "Point at it": the person taps the part of the screen that is wrong, and
// the report carries what that element is and how it is drawn — its tag and
// text, a selector to find it, its size and place on screen, and the
// computed styles that decide how it looks (font size, padding, width…).
// For "the button looks too small", that is most of the diagnosis.
//
// While picking, a transparent layer over the page takes every tap, so the
// page itself never reacts (pointing at Hand in must not hand in). The layer
// is lifted for the moment it asks the browser what lies underneath.
//
// Never sent: anything typed into a field (no value), and the text of
// anything the app masks (data-clarity-mask / data-fb-mask).
import { ensureStyle } from "./style";

export type PickedElement = {
  tag: string; id: string; classes: string; role: string; label: string; text: string; selector: string;
  rect: { x: number; y: number; w: number; h: number }; viewport: string;
  styles: Record<string, string>; parent?: Record<string, string>; html: string;
};

const STYLE_KEYS = ["display", "position", "box-sizing", "width", "height", "min-width", "min-height", "max-width", "padding", "margin", "font-size", "font-weight", "line-height", "font-family", "color", "background-color", "border", "border-radius", "overflow", "white-space", "text-overflow", "gap", "flex", "align-items", "justify-content", "z-index", "opacity", "transform", "visibility"];
const MASKED = "[data-clarity-mask], [data-fb-mask]";

function cssPath(el: Element): string {
  const parts: string[] = [];
  for (let n: Element | null = el, i = 0; n && n.nodeType === 1 && i < 5; n = n.parentElement, i++) {
    const tag = n.tagName.toLowerCase();
    if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) { parts.unshift(`${tag}#${n.id}`); break; }
    const cls = [...n.classList].filter((c) => !c.startsWith("fb-") && /^[A-Za-z_][\w-]*$/.test(c)).slice(0, 2).map((c) => `.${c}`).join("");
    const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n!.tagName) : [];
    parts.unshift(`${tag}${cls}${same.length > 1 ? `:nth-of-type(${same.indexOf(n) + 1})` : ""}`);
    if (tag === "body") break;
  }
  return parts.join(" > ");
}

export function describeElement(el: Element): PickedElement {
  const masked = !!el.closest(MASKED);
  const field = /^(input|textarea|select)$/i.test(el.tagName) || (el as HTMLElement).isContentEditable;
  const cs = getComputedStyle(el);
  const styles: Record<string, string> = {};
  for (const k of STYLE_KEYS) { const v = cs.getPropertyValue(k); if (v) styles[k] = v; }
  const pcs = el.parentElement ? getComputedStyle(el.parentElement) : null;
  const r = el.getBoundingClientRect();
  // The element as markup: values dropped, masked text blanked, cut short.
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll?.("input, textarea").forEach((x) => { x.removeAttribute("value"); x.textContent = ""; });
  copy.removeAttribute?.("value");
  if (masked) copy.textContent = "…";
  copy.querySelectorAll?.(MASKED).forEach((x) => { x.textContent = "…"; });
  const text = masked || field ? "" : ((el as HTMLElement).innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
  return {
    tag: el.tagName.toLowerCase(), id: el.id || "", classes: [...el.classList].filter((c) => !c.startsWith("fb-")).slice(0, 6).join(" "),
    role: el.getAttribute("role") || "", label: el.getAttribute("aria-label") || (el as HTMLInputElement).placeholder || "",
    text, selector: cssPath(el),
    rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    viewport: `${innerWidth}x${innerHeight}`, styles,
    ...(pcs ? { parent: { tag: el.parentElement!.tagName.toLowerCase(), display: pcs.display, "flex-direction": pcs.flexDirection, gap: pcs.gap, width: pcs.width, "align-items": pcs.alignItems, "justify-content": pcs.justifyContent } } : {}),
    html: copy.outerHTML.replace(/\s+/g, " ").slice(0, 1500),
  };
}

/** Let the person point at one element; `done(null)` if they cancel. */
export function pickElement(done: (picked: { el: Element; info: PickedElement } | null) => void): void {
  ensureStyle();
  const layer = Object.assign(document.createElement("div"), { className: "fb-root fb-pick-layer" });
  const box = Object.assign(document.createElement("div"), { className: "fb-root fb-pick-box" });
  box.hidden = true;
  const bar = Object.assign(document.createElement("div"), { className: "fb-root fb-pick-bar", role: "status" });
  const label = Object.assign(document.createElement("span"), { textContent: "Tap the part that looks wrong" });
  const use = Object.assign(document.createElement("button"), { type: "button", className: "fb-btn fb-primary", textContent: "Use this" });
  const cancel = Object.assign(document.createElement("button"), { type: "button", className: "fb-btn fb-ghost", textContent: "Cancel" });
  use.hidden = true;
  bar.append(label, use, cancel);
  document.body.append(layer, box, bar);

  let current: Element | null = null;
  const under = (x: number, y: number) => {
    layer.style.pointerEvents = "none";
    const el = document.elementFromPoint(x, y);
    layer.style.pointerEvents = "";
    return el && !el.closest(".fb-root") && el !== document.documentElement && el !== document.body ? el : null;
  };
  const show = (el: Element | null) => {
    if (!el) { box.hidden = true; return; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
    box.hidden = false;
  };
  const finish = (picked: { el: Element; info: PickedElement } | null) => {
    layer.remove(); box.remove(); bar.remove();
    document.removeEventListener("keydown", onKey, true);
    done(picked);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null); } };
  document.addEventListener("keydown", onKey, true);

  // A mouse hovers before it clicks; a finger only taps. So hover outlines,
  // and a tap (or click) chooses — then "Use this" confirms, or tap again.
  layer.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" && !current) show(under(e.clientX, e.clientY)); });
  layer.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    current = under(e.clientX, e.clientY);
    show(current);
    use.hidden = !current;
    label.textContent = current ? "This one?" : "Tap the part that looks wrong";
  });
  use.addEventListener("click", () => current && finish({ el: current, info: describeElement(current) }));
  cancel.addEventListener("click", () => finish(null));
}
