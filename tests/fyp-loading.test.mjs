import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("FYP uses the same loading card and ring as New without extra copy", async () => {
  const fyp = await read("../src/pages/Fyp.tsx");
  const styles = await read("../src/phase10_5.css");
  assert.match(fyp, /className="new-progress-card fyp-progress-card"/);
  assert.match(fyp, /className="new-progress-ring"/);
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
  assert.match(fyp, /setProgress\(0\)/);
  assert.match(fyp, /if \(active\) setProgress/);
  assert.match(fyp, /<FypProgress percent=\{progress\} \/>/);
});
