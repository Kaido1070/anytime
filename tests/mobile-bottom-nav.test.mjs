import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("mobile navigation responds to intentional scrolling, not tiny scroll jitter", async () => {
  const layout = await read("../src/layouts/AppLayout.tsx");
  assert.match(layout, /window\.addEventListener\("scroll", onScroll, \{ passive: true \}\)/);
  assert.match(layout, /window\.requestAnimationFrame\(/);
  assert.match(layout, /window\.cancelAnimationFrame\(/);
  assert.match(layout, /if \(Math\.abs\(delta\) < 1\) return/);
  assert.match(layout, /scrollTravel\.current \+= Math\.abs\(delta\)/);
  assert.match(layout, /direction > 0 \? 28 : 16/);
  assert.match(layout, /currentY < 80/);
  assert.match(layout, /scrollHeight <= window\.innerHeight \+ 20/);
  assert.match(layout, /setMobileNavHidden\(direction > 0\)/);
  assert.match(layout, /onFocusCapture=\{\(\) => setMobileNavHidden\(false\)\}/);
  assert.doesNotMatch(layout, /delta > 6|delta < -6/);
});

test("mobile nav smoothly slides downward without horizontal offset, desktop remains persistent", async () => {
  const css = await read("../src/mobile-fixes.css");
  assert.match(css, /@media \(max-width: 759px\)/);
  assert.match(css, /\.bottom-nav\.mobile-hidden\s*\{[^}]*translate3d\(0, calc\(100% \+ 12px\), 0\)/);
  assert.match(css, /transform 300ms cubic-bezier/);
  assert.match(css, /transition-duration: 240ms, 180ms/);
  assert.match(css, /pointer-events: none/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /translate\(-50%, calc\(100%/);
});
