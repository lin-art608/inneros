import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../../src/features/navigation.js'), 'utf8');
const sandbox = { window: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const nav = sandbox.window.InnerOSNavigation;

assert.equal(nav.parentOf('timeline'), 'memory');
assert.equal(nav.parentOf('res-cs'), 'resources');
assert.equal(nav.parentOf('memory'), null);
assert.equal(nav.swipeAction({ startX:180, startY:300, endX:300, endY:310, sidebarOpen:false }), 'open');
assert.equal(nav.swipeAction({ startX:300, startY:300, endX:190, endY:305, sidebarOpen:true }), 'close');
assert.equal(nav.swipeAction({ startX:180, startY:300, endX:220, endY:500, sidebarOpen:false }), null);
assert.match(nav.hubHtml('resources', () => '<svg></svg>'), /CS 赛事/);

console.log('navigation-feature.test: 全部通过');
