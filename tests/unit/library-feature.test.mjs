import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../../src/features/library.js'), 'utf8');
const sandbox = { window: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const library = sandbox.window.InnerOSLibrary;

assert.deepEqual(Array.from(library.definitions(), x => x.type), ['movie', 'series', 'book', 'place']);
assert.equal(library.activate('series'), 'series');
assert.equal(library.current(), 'series');
assert.equal(library.activate('music'), 'movie', '已封存的收藏分类不得成为活动页签');
assert.deepEqual(
  { ...library.counts([{ type: 'movie' }, { type: 'series' }, { type: 'music' }, { type: 'series' }]) },
  { movie: 1, series: 2, book: 0, place: 0 },
);

console.log('library-feature.test: 全部通过');
