import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const userscript = readFileSync(new URL('../tampermonkey-sequence-autofill.user.js', import.meta.url), 'utf8');

test('userscript can run in homework iframes without using the old blanket noframes guard', () => {
  assert.doesNotMatch(userscript, /\/\/ @noframes/);
  assert.doesNotMatch(userscript, /window\.top\s*!==\s*window\.self\s*\)\s*\{\s*return;/);
  assert.match(userscript, /shouldStartAutofill/);
  assert.match(userscript, /doHomeWorkNew/);
});

test('userscript supports dragging the panel and clearing script-filled content', () => {
  assert.match(userscript, /@version\s+0\.2\.9/);
  assert.match(userscript, /function makePanelDraggable/);
  assert.match(userscript, /cursor:move/);
  assert.match(userscript, /function clearLastFilledControls/);
  assert.match(userscript, /async function clearDetectedPage/);
  assert.match(userscript, /message\.type === 'clear'/);
  assert.match(userscript, /清除已填写/);
});

test('userscript uses Doubao web chat instead of direct AI APIs', () => {
  assert.doesNotMatch(userscript, /GM_xmlhttpRequest/);
  assert.doesNotMatch(userscript, /OPENAI_API_URL/);
  assert.doesNotMatch(userscript, /DOUBAO_API_URL/);
  assert.doesNotMatch(userscript, /API Key/);
  assert.doesNotMatch(userscript, /\/\/ @connect/);
  assert.match(userscript, /DOUBAO_CHAT_URL/);
  assert.match(userscript, /openDoubaoChat/);
  assert.match(userscript, /发到豆包网页/);
});
