import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { discoverEmptyControls } from '../src/sequence-fill.js';

test('discovers empty controls in DOM order and skips unsafe controls', async (t) => {
  let browser;

  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  } catch {
    t.skip('Microsoft Edge is not available');
    return;
  }

  try {
    const page = await browser.newPage();
    await page.setContent(`
      <input aria-label="姓名">
      <input type="password" aria-label="密码">
      <input aria-label="已有" value="keep">
      <textarea aria-label="备注"></textarea>
    `);

    const controls = await discoverEmptyControls(page);

    assert.deepEqual(
      controls.map((control) => control.label),
      ['姓名', '备注']
    );
  } finally {
    await browser?.close();
  }
});
