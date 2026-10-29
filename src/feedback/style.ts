// The widget's own styles, injected once. Everything is under .fb-root and
// prefixed fb-, so no app's CSS reaches in and none of ours leaks out. The
// colours are the family's calm palette (Seyali's tokens.css, Vidai's :root):
// greys with no blue, near-black ink, and one violet for what can be pressed.
export const CSS = `
.fb-root{--fb-primary:#5420e8;--fb-deep:#3b17a6;--fb-tint:#f1edfe;--fb-ink:#1d1d1f;--fb-muted:#6e6e73;--fb-line:#e8e8ed;--fb-input:#d2d2d7;--fb-fill:#f5f5f7;--fb-green:#1a7f37;--fb-green-bg:#e8f5ec;--fb-red:#c62828;
  font-family:inherit;color:var(--fb-ink);font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased}
.fb-root *,.fb-root *::before,.fb-root *::after{box-sizing:border-box}
.fb-scrim{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center;padding:14px}
.fb-card{position:relative;width:100%;max-width:540px;max-height:calc(100dvh - 28px);display:flex;flex-direction:column;background:#fff;border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.22);overflow:hidden}
.fb-head{display:flex;align-items:center;gap:8px;padding:14px 14px 0 18px}
.fb-title{flex:1;margin:0;font-size:17px;font-weight:700;letter-spacing:-.01em}
.fb-x{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:0;border-radius:999px;background:transparent;color:var(--fb-muted);cursor:pointer}
.fb-x:hover{background:var(--fb-fill);color:var(--fb-ink)}
.fb-tabs{display:flex;gap:2px;margin:12px 18px 0;padding:3px;border-radius:999px;background:#ededf0}
.fb-tab{flex:1;min-width:0;height:34px;border:0;border-radius:999px;background:transparent;color:var(--fb-muted);font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 6px}
.fb-tab[aria-selected=true]{background:#fff;color:var(--fb-ink);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.fb-body{flex:1;overflow:auto;padding:16px 18px 6px;overscroll-behavior:contain}
.fb-field{display:block;margin:0 0 14px}
.fb-label{display:block;margin:0 0 6px;font-size:13px;font-weight:600}
.fb-hint{display:block;margin:4px 0 0;font-size:12.5px;color:var(--fb-muted)}
.fb-input,.fb-area{display:block;width:100%;border:1px solid var(--fb-input);border-radius:10px;background:#fff;color:var(--fb-ink);font:inherit;font-size:15px;padding:10px 12px;outline:none}
.fb-area{min-height:92px;resize:vertical}
.fb-input:focus,.fb-area:focus{border-color:var(--fb-primary);box-shadow:0 0 0 3px rgba(84,32,232,.15)}
.fb-input::placeholder,.fb-area::placeholder{color:#8e8e93;font-style:italic}
.fb-sec{margin:4px 0 14px;padding:12px;border:1px solid var(--fb-line);border-radius:12px;background:var(--fb-fill)}
.fb-sec-h{margin:0 0 8px;font-size:13px;font-weight:700}
.fb-check{display:flex;gap:10px;align-items:flex-start;padding:6px 0;cursor:pointer}
.fb-check input{appearance:none;flex:none;width:20px;height:20px;margin:1px 0 0;border:1.5px solid var(--fb-input);border-radius:6px;background:#fff;display:grid;place-content:center;cursor:pointer}
.fb-check input:checked{background:var(--fb-primary);border-color:var(--fb-primary)}
.fb-check input:checked::after{content:"";width:10px;height:6px;border:2px solid #fff;border-top:0;border-right:0;transform:rotate(-45deg) translate(1px,-1px)}
.fb-check input:focus-visible{outline:2px solid var(--fb-primary);outline-offset:2px}
.fb-check-main{min-width:0;flex:1}
.fb-check-t{display:block;font-size:14px;font-weight:600}
.fb-check-s{display:block;font-size:12.5px;color:var(--fb-muted)}
.fb-link{border:0;background:none;padding:0;color:var(--fb-primary);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.fb-tools{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.fb-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:44px;padding:0 16px;border-radius:999px;border:1px solid var(--fb-input);background:#fff;color:var(--fb-ink);font:inherit;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap}
.fb-btn:hover{background:var(--fb-fill)}
.fb-btn:disabled{opacity:.5;cursor:default}
.fb-btn-sm{min-height:36px;padding:0 12px;font-size:13px}
.fb-primary{background:var(--fb-primary);border-color:var(--fb-primary);color:#fff}
.fb-primary:hover{background:var(--fb-deep)}
.fb-btn:focus-visible,.fb-tab:focus-visible,.fb-x:focus-visible,.fb-link:focus-visible,.fb-row:focus-visible,.fb-star:focus-visible,.fb-vote:focus-visible{outline:2px solid var(--fb-primary);outline-offset:2px}
.fb-rec-dot{width:9px;height:9px;border-radius:999px;background:var(--fb-red)}
.fb-files{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.fb-file{display:flex;align-items:center;gap:8px;max-width:100%;padding:5px 6px 5px 5px;border:1px solid var(--fb-line);border-radius:10px;background:#fff;font-size:12.5px}
.fb-file img{width:40px;height:40px;object-fit:cover;border-radius:6px;background:var(--fb-fill)}
.fb-file-name{min-width:0;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fb-file .fb-x{width:28px;height:28px}
.fb-foot{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 18px 16px;border-top:1px solid var(--fb-line)}
.fb-foot-note{flex:1;min-width:0;font-size:12.5px;color:var(--fb-muted)}
.fb-error{margin:0 0 12px;padding:10px 12px;border-radius:10px;background:#fdecec;color:var(--fb-red);font-size:13.5px}
.fb-similar{margin:-4px 0 14px;border:1px solid var(--fb-line);border-radius:12px;overflow:hidden}
.fb-similar-h{margin:0;padding:10px 12px;background:var(--fb-fill);font-size:13px;font-weight:700}
.fb-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-top:1px solid var(--fb-line)}
.fb-item-main{min-width:0;flex:1}
.fb-item-t{display:block;font-size:14px;font-weight:600;overflow-wrap:anywhere}
.fb-item-s{display:block;font-size:12.5px;color:var(--fb-muted)}
.fb-vote{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;flex:none;width:52px;min-height:48px;border:1px solid var(--fb-input);border-radius:12px;background:#fff;color:var(--fb-ink);font:inherit;font-size:13px;font-weight:700;cursor:pointer;line-height:1.1}
.fb-vote[aria-pressed=true]{border-color:var(--fb-primary);background:var(--fb-tint);color:var(--fb-deep)}
.fb-vote svg{width:16px;height:16px}
.fb-stars{display:flex;gap:6px;margin:2px 0 14px}
.fb-star{width:46px;height:46px;border:0;border-radius:12px;background:var(--fb-fill);color:#c7c7cc;cursor:pointer;display:grid;place-content:center}
.fb-star[aria-checked=true]{color:var(--fb-primary);background:var(--fb-tint)}
.fb-star svg{width:26px;height:26px}
.fb-list{display:flex;flex-direction:column;gap:8px}
.fb-row{display:flex;align-items:center;gap:10px;width:100%;padding:12px;border:1px solid var(--fb-line);border-radius:12px;background:#fff;color:inherit;font:inherit;text-align:left;cursor:pointer}
.fb-row:hover{background:var(--fb-fill)}
.fb-chip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;background:#ededf0;color:#3a3a3c;font-size:12px;font-weight:600;white-space:nowrap}
.fb-chip-on{background:var(--fb-tint);color:var(--fb-deep)}
.fb-chip-done{background:var(--fb-green-bg);color:var(--fb-green)}
.fb-kind{display:inline-flex;flex:none;align-items:center;justify-content:center;width:34px;height:34px;border-radius:10px;background:var(--fb-fill);color:var(--fb-muted)}
.fb-kind svg{width:18px;height:18px}
.fb-tl{list-style:none;margin:10px 0 0;padding:0 0 0 14px;border-left:2px solid var(--fb-line)}
.fb-tl li{position:relative;margin:0 0 12px;font-size:13.5px}
.fb-tl li::before{content:"";position:absolute;left:-20px;top:5px;width:10px;height:10px;border-radius:999px;background:#fff;border:2px solid var(--fb-input)}
.fb-tl li.fb-tl-on::before{border-color:var(--fb-primary);background:var(--fb-primary)}
.fb-tl time{display:block;font-size:12px;color:var(--fb-muted)}
.fb-quote{margin:6px 0 0;padding:8px 10px;border-radius:10px;background:var(--fb-fill);white-space:pre-wrap;overflow-wrap:anywhere}
.fb-pre{max-height:240px;overflow:auto;margin:8px 0 0;padding:8px 10px;border-radius:10px;background:#1d1d1f;color:#f5f5f7;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.fb-empty{padding:24px 12px;text-align:center;color:var(--fb-muted);font-size:14px}
.fb-done{padding:18px 4px 8px;text-align:center}
.fb-done-mark{width:56px;height:56px;margin:0 auto 12px;border-radius:999px;background:var(--fb-green-bg);color:var(--fb-green);display:grid;place-content:center}
.fb-done h3{margin:0 0 6px;font-size:18px}
.fb-done p{margin:0 auto;max-width:36ch;color:var(--fb-muted);font-size:14px}
.fb-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.fb-back{display:inline-flex;align-items:center;gap:4px;margin:0 0 10px}
.fb-pill{position:fixed;z-index:2147483001;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:6px 6px 6px 14px;border-radius:999px;background:#1d1d1f;color:#fff;box-shadow:0 8px 28px rgba(0,0,0,.3);font-size:14px;font-weight:600}
.fb-pill .fb-rec-dot{animation:fb-blink 1s steps(2,start) infinite}
.fb-pill .fb-btn{min-height:36px;background:#fff;color:#1d1d1f;border-color:#fff}
@keyframes fb-blink{to{visibility:hidden}}
.fb-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.fb-player{display:flex;flex-direction:column;gap:8px}
.fb-stage{position:relative;width:100%;min-height:120px;overflow:hidden;border:1px solid var(--fb-line);border-radius:12px;background:var(--fb-fill)}
.fb-stage-note{margin:0;padding:40px 12px;text-align:center;color:var(--fb-muted);font-size:13px}
.fb-stage .replayer-wrapper{position:absolute;top:0;left:0}
.fb-stage .replayer-wrapper>iframe{border:0;display:block;background:#fff;pointer-events:none}
.fb-stage .replayer-mouse{position:absolute;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:999px;background:rgba(84,32,232,.35);border:2px solid #5420e8;transition:left .05s linear,top .05s linear;pointer-events:none;z-index:2}
.fb-stage .replayer-mouse.active{animation:fb-click .3s ease-in-out 1}
.fb-stage .replayer-mouse-tail{display:none}
@keyframes fb-click{50%{transform:scale(1.8);opacity:.6}}
.fb-highlight{position:absolute;z-index:3;border:3px solid #5420e8;border-radius:8px;box-shadow:0 0 0 9999px rgba(0,0,0,.18);pointer-events:none}
.fb-controls{display:flex;align-items:center;gap:10px}
.fb-play{display:grid;place-content:center;flex:none;width:40px;height:40px;border-radius:999px;border:1px solid var(--fb-input);background:#fff;color:var(--fb-ink);cursor:pointer}
.fb-play:focus-visible{outline:2px solid var(--fb-primary);outline-offset:2px}
.fb-scrub{flex:1;min-width:0;accent-color:var(--fb-primary)}
.fb-time{flex:none;font:12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fb-muted)}
.fb-tri{margin:12px 0 0;padding:12px;border-radius:12px;background:var(--fb-tint);color:#2b1a6b;text-align:left}
.fb-tri-h{display:flex;align-items:center;gap:6px;margin:0 0 6px;font-size:12.5px;font-weight:700;color:var(--fb-deep)}
.fb-tri p{margin:0 0 8px;font-size:13.5px;color:var(--fb-ink)}
.fb-tri ol{margin:0 0 8px;padding-left:20px;font-size:13.5px;color:var(--fb-ink)}
.fb-tri dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:0;font-size:13px;color:var(--fb-ink)}
.fb-tri dt{color:var(--fb-muted)}
.fb-tri-wait{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--fb-deep)}
.fb-spin{width:14px;height:14px;border-radius:999px;border:2px solid rgba(84,32,232,.25);border-top-color:#5420e8;animation:fb-spin .8s linear infinite}
@keyframes fb-spin{to{transform:rotate(360deg)}}
.fb-pick-box{position:fixed;z-index:2147483001;border:3px solid #5420e8;border-radius:6px;background:rgba(84,32,232,.08);pointer-events:none;transition:all .06s ease-out}
.fb-pick-layer{position:fixed;inset:0;z-index:2147483000;cursor:crosshair;touch-action:none}
.fb-pick-bar{position:fixed;z-index:2147483002;left:50%;top:calc(10px + env(safe-area-inset-top));transform:translateX(-50%);display:flex;align-items:center;gap:8px;max-width:calc(100vw - 20px);padding:6px 6px 6px 14px;border-radius:999px;background:#1d1d1f;color:#fff;box-shadow:0 8px 28px rgba(0,0,0,.3);font-size:14px;font-weight:600}
.fb-pick-bar .fb-btn{min-height:36px;padding:0 12px;font-size:13px}
.fb-pick-bar .fb-btn.fb-primary{background:#fff;color:#1d1d1f;border-color:#fff}
.fb-pick-bar .fb-btn.fb-ghost{background:transparent;color:#fff;border-color:rgba(255,255,255,.4)}
@media (max-width:520px){
  .fb-foot{flex-direction:column-reverse;align-items:stretch}
  .fb-foot .fb-btn{width:100%}
  .fb-foot-note{text-align:center}
}
@media (prefers-reduced-motion:reduce){.fb-pill .fb-rec-dot,.fb-spin,.fb-stage .replayer-mouse.active{animation:none}.fb-pick-box{transition:none}}
`;

/** Put the styles on the page once — the dialog, the player and the picker all ask. */
export function ensureStyle(): void {
  if (typeof document === "undefined" || document.getElementById("fb-style")) return;
  const s = document.createElement("style");
  s.id = "fb-style";
  s.textContent = CSS;
  document.head.appendChild(s);
}
