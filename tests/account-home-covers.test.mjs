import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

function compile(source, dependencies) {
  const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  new Function('require', 'exports', 'React', js)(name => dependencies[name], exports, React);
  return exports;
}
const snapshots = await readFile(new URL('../src/services/workSnapshots.ts', import.meta.url), 'utf8');
const {mergeAccountWorks} = compile(snapshots, {});
test('live metadata enrichment preserves the verified R2 cover', () => {
  const cover = '/api/work-snapshots/cover?key=tx%3Astory&v=1';
  const result = mergeAccountWorks({'tx:story': {key: 'tx:story', title: 'old', cover}}, {'tx:story': {key: 'tx:story', title: 'new', cover: 'https://slow-source/cover.jpg', chapters: [{number: 59}]}});
  assert.equal(result['tx:story'].cover, cover);
  assert.equal(result['tx:story'].title, 'new');
  assert.equal(result['tx:story'].chapters[0].number, 59);
});
test('R2 covers render immediately for all sources without upstream cover lookups', async () => {
  let calls = 0;
  const source = await readFile(new URL('../src/components/SourceCoverImage.tsx', import.meta.url), 'utf8');
  const {SourceCoverImage} = compile(source, {react: React, '../services/sources': {sourceService: {coverCandidates() {calls++; throw new Error('unexpected source lookup');}}}});
  for (const name of ['teamx', 'mangatime', '3asq', 'starzmanga', 'azora', 'xsano', 'mangalik']) {
    const html = renderToStaticMarkup(React.createElement(SourceCoverImage, {item: {source: name, cover: '/api/work-snapshots/cover?key=story&v=1'}, alt: 'cover'}));
    assert.match(html, /src="\/api\/work-snapshots\/cover/);
  }
  assert.equal(calls, 0);
});
