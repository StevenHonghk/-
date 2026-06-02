import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { formatFillReport, resolveProfileDir } from '../src/autofill.js';

test('resolves profileDir relative to the config file directory', () => {
  const config = {
    configDir: path.join('C:', 'work', 'edge-autofill-safe', 'configs'),
    profileDir: 'edge-profile'
  };

  assert.equal(
    resolveProfileDir(config),
    path.resolve(config.configDir, 'edge-profile')
  );
});

test('formats filled and missing field results for manual review', () => {
  const report = formatFillReport([
    { label: 'Email', status: 'filled', matcher: 'selector: input[name="email"]' },
    { label: 'Phone', status: 'missing', matcher: 'label: Phone' }
  ]);

  assert.match(report, /Filled: 1/);
  assert.match(report, /Missing: 1/);
  assert.match(report, /Email/);
  assert.match(report, /Phone/);
});
