import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterAllowedPages,
  formatPageChoices,
  selectPageChoice
} from '../src/current-tab.js';

const pages = [
  { url: 'edge://newtab/', title: 'New tab' },
  { url: 'https://example.com/form', title: 'Example form' },
  { url: 'https://other.test/form', title: 'Other form' }
];

test('filters current tabs by allowed origins', () => {
  const allowed = filterAllowedPages(pages, ['https://example.com']);

  assert.deepEqual(allowed, [
    { index: 1, url: 'https://example.com/form', title: 'Example form' }
  ]);
});

test('formats page choices with stable one-based numbers', () => {
  const choices = formatPageChoices([
    { index: 1, url: 'https://example.com/form', title: 'Example form' },
    { index: 2, url: 'https://example.com/second', title: '' }
  ]);

  assert.match(choices, /1\. Example form/);
  assert.match(choices, /https:\/\/example.com\/form/);
  assert.match(choices, /2\. Untitled page/);
});

test('selects a page choice by one-based number', () => {
  const choice = selectPageChoice([
    { index: 1, url: 'https://example.com/form', title: 'Example form' },
    { index: 2, url: 'https://example.com/second', title: 'Second' }
  ], '2');

  assert.deepEqual(choice, {
    index: 2,
    url: 'https://example.com/second',
    title: 'Second'
  });
});

test('rejects invalid page choice numbers', () => {
  assert.throws(
    () => selectPageChoice([
      { index: 1, url: 'https://example.com/form', title: 'Example form' }
    ], '5'),
    /choose a number from the list/
  );
});
