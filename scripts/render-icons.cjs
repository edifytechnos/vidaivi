// Draws every app icon from one definition, so no size is ever hand-edited.
//
//   NODE_PATH=/opt/node-tools/node_modules node scripts/render-icons.cjs
//
// Writes public/favicon.svg and the five PNGs in public/icons/ the manifest
// and index.html name. Chromium renders them, the same engine that will show
// them, from the same SVG.
//
// - "any" (favicon, icon-192, icon-512): the rounded square, transparent
//   corners.
// - "maskable" (icon-maskable-*) and the iPhone's apple-touch-icon: full
//   bleed, because the platform cuts its own shape. The V needs no shrinking:
//   its farthest point, stroke included, is 170px from the centre, inside the
//   safe circle of 205px (40% of the side) Android keeps for any mask.
//
// The colour is the one brand violet, solid, as Seyali's brand dot is.

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");

const ROOT = path.join(__dirname, "..");
const VIOLET = "#5420e8";
const EXE = process.env.PLAYWRIGHT_CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const V = `<path d="M158 160 256 362 354 160" fill="none" stroke="#fff" stroke-width="66" stroke-linecap="round" stroke-linejoin="round"/>`;

const any = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="${VIOLET}"/>
  ${V}
</svg>
`;

const bleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${VIOLET}"/>
  ${V}
</svg>
`;

const OUT = [
  ["icons/icon-192.png", any, 192],
  ["icons/icon-512.png", any, 512],
  ["icons/icon-maskable-192.png", bleed, 192],
  ["icons/icon-maskable-512.png", bleed, 512],
  ["icons/apple-touch-icon.png", bleed, 180],
];

(async () => {
  fs.writeFileSync(path.join(ROOT, "public/favicon.svg"), any);
  const browser = await chromium.launch({ executablePath: EXE });
  for (const [file, svg, size] of OUT) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const sized = svg.replace("<svg ", `<svg width="${size}" height="${size}" `);
    await page.setContent(`<html><body style="margin:0;background:transparent">${sized}</body></html>`);
    await page.screenshot({ path: path.join(ROOT, "public", file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log("wrote", file, size);
  }
  await browser.close();
  console.log("wrote favicon.svg");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
