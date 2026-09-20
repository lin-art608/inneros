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
assert.equal(nav.drawerProgress({ deltaX:140, width:280, sidebarOpen:false }), 0.5);
assert.equal(nav.drawerProgress({ deltaX:-70, width:280, sidebarOpen:true }), 0.75);
assert.equal(nav.drawerProgress({ deltaX:999, width:280, sidebarOpen:false }), 1, '拖动进度必须限制在 0~1');
assert.equal(nav.settleDrawer({ progress:0.49, velocityX:0.5 }), true, '快速右甩应打开');
assert.equal(nav.settleDrawer({ progress:0.8, velocityX:-0.5 }), false, '快速左甩应关闭');
assert.equal(nav.settleDrawer({ progress:0.51, velocityX:0 }), true, '慢速拖动过半应打开');
assert.match(nav.hubHtml('resources', () => '<svg></svg>'), /CS2 赛程/);

console.log('navigation-feature.test: 全部通过');
