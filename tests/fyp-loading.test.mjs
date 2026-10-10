import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("FYP uses the same loading card and ring as New without extra copy", async () => {
  const fyp = await read("../src/pages/Fyp.tsx");
  const styles = await read("../src/phase10_5.css");
  assert.match(fyp, /className="new-progress-card fyp-progress-card"/);
  assert.match(fyp, /className="new-progress-ring fyp-progress-ring"/);
  assert.match(fyp, /<b>جاري تجهيز قصصًا تناسب ما تتابعه<\/b>/);
  assert.match(fyp, /<small>ستظهر القصص فور اكتمال التحميل<\/small>/);
  assert.doesNotMatch(fyp, /FypSkeleton|fyp-skeleton" key=/);
  assert.doesNotMatch(fyp, /<span>مكتمل<\/span>|\{progress\.completed\} من/);
  assert.match(styles, /\.fyp-progress-card \.new-progress-copy b/);
});

test("FYP progress reflects completed loading work and resets for retry", async () => {
  const fyp = await read("../src/pages/Fyp.tsx");
  assert.match(fyp, /sourceRequestTotal = SOURCES\.length \* 2/);
  assert.match(fyp, /completedSourceRequests \+= 1/);
  assert.match(fyp, /hydratedCandidates \+= 1/);
  assert.match(fyp, /report\(100\)/);
  assert.match(fyp, /setProgress\(1\)/);
  assert.match(fyp, /if \(active\) setProgress/);
  assert.match(fyp, /<FypProgress percent=\{progress\} \/>/);
});

test("FYP advances with each completed input, source, or recommendation lookup", async () => {
  const fyp = await read("../src/pages/Fyp.tsx");
  assert.match(fyp, /onProgress\?\.\(completed, summaries\.length\)/);
  assert.match(fyp, /onProgress\?\.\(completed, chunks\.length\)/);
  assert.match(fyp, /onProgress\?\.\(completed, items\.length\)/);
  assert.match(fyp, /completedSourceRequests \+= 1/);
  assert.match(fyp, /hydratedCandidates \+= 1/);
  assert.match(fyp, /Math\.round\(percent \* 10\) \/ 10/);
  assert.match(fyp, /if \(next > lastReported\)/);
});

test("FYP animates only toward real milestones and respects reduced motion", async () => {
  const fyp = await read("../src/pages/Fyp.tsx");
  const css = await read("../src/phase10_5.css");
  assert.match(fyp, /setDisplayed\(\(current\) => Math\.min\(targetRef\.current, current \+ 1\)\)/);
  assert.match(fyp, /\}, 45\)/);
  assert.match(fyp, /window\.clearInterval\(timer\)/);
  assert.match(fyp, /prefers-reduced-motion: reduce/);
  assert.match(fyp, /displayed\.toFixed\(1\)/);
  assert.match(fyp, /aria-valuenow=\{Math\.floor\(displayed\)\}/);
  assert.match(css, /\.fyp-progress-card \.fyp-progress-ring/);
  assert.match(css, /\.fyp-progress-card \.new-progress-copy small/);
  assert.match(css, /\.fyp-progress-card\s*\{[^}]*background:/);
});
