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
assert.equal(ui.titleEditable('diary'), true);
assert.equal(ui.titleEditable('movie'), false);
assert.equal(ui.titleEditable('book'), false);
assert.equal(ui.primaryContent({ entries:[{ content:'初记' }, { content:'续写' }] }), '初记');
assert.equal(ui.galleryIndex(3, 3), 0);
assert.equal(ui.galleryIndex(-1, 3), 2);
assert.equal(ui.swipeDirection(300, 200), 1, '左滑进入下一张');
assert.equal(ui.swipeDirection(100, 180), -1, '右滑进入上一张');
assert.equal(ui.swipeDirection(100, 130), 0, '短距离移动不切图');

console.log('memory-detail-feature.test: 全部通过');
