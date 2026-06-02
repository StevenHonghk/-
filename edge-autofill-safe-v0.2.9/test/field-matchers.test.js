import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFieldCandidates,
  cssString,
  normalizeText
} from '../src/field-matchers.js';

test('escapes CSS string fragments safely', () => {
  assert.equal(cssString('a"b\\c'), '"a\\"b\\\\c"');
});

test('normalizes visible text for stable matching', () => {
  assert.equal(normalizeText('  Full\n Name\t '), 'full name');
});

test('builds selector-first candidates before fuzzy attributes', () => {
  const candidates = buildFieldCandidates({
    selector: '#email',
    label: 'Email address',
    name: 'email',
    placeholder: 'you@example.com',
    ariaLabel: 'Work email'
  });

  assert.deepEqual(candidates.slice(0, 3), [
    { type: 'selector', value: '#email' },
    { type: 'label', value: 'Email address' },
    { type: 'css', value: '[name="email"]' }
  ]);

  assert.ok(candidates.some((candidate) => candidate.value === '[placeholder="you@example.com"]'));
  assert.ok(candidates.some((candidate) => candidate.value === '[aria-label="Work email"]'));
});

test('rejects fields without a matcher', () => {
  assert.throws(
    () => buildFieldCandidates({ value: 'missing matcher' }),
    /field needs selector, label, name, id, placeholder, or ariaLabel/
  );
});
