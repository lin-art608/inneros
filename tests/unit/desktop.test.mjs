import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isAppUrl, isExternalUrl } = require('../../desktop/policy.cjs');
assert.equal(isAppUrl('https://inneros.pages.dev/'), true);
assert.equal(isAppUrl('https://inneros.pages.dev/?page=library'), true);
for (const url of ['http://inneros.pages.dev/', 'https://inneros.pages.dev.evil.test/',
  'https://inneros.pages.dev@evil.test/', 'javascript:alert(1)', 'file:///C:/Windows/', 'bad']) {
  assert.equal(isAppUrl(url), false, url);
}
assert.equal(isExternalUrl('https://example.com/'), true);
for (const url of ['javascript:alert(1)', 'file:///C:/Windows/', 'data:text/html,test', 'bad']) {
  assert.equal(isExternalUrl(url), false, url);
}
console.log('桌面导航与外链协议限制通过');
