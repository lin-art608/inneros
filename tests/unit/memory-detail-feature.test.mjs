import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../../src/features/memory-detail.js'), 'utf8');
const sandbox = { window: {}, Intl };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const ui = sandbox.window.InnerOSMemoryDetail;

assert.match(ui.icon('diary'), /<svg/);
assert.match(ui.icon('movie'), /<rect/);
assert.equal(ui.chapterLabel(0), '初记');
assert.equal(ui.chapterLabel(2), '续写 2');
assert.equal(ui.diaryFallbackTitle('', '2026-09-19'), '09月19日的日记');
assert.equal(ui.truncate('12345678901234567😀尾', 18), '12345678901234567😀…', '不得截断 emoji 代理对');
assert.equal(ui.diaryFallbackTitle('  今天很好 😀  ', '2026-09-19'), '今天很好 😀');

console.log('memory-detail-feature.test: 全部通过');
