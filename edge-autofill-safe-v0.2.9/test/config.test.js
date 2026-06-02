import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, isAllowedTarget } from '../src/config.js';

const baseConfig = {
  targetUrl: 'https://example.com/register?step=1',
  allowedOrigins: ['https://example.com'],
  profileDir: 'edge-profile',
  fields: [
    { selector: 'input[name="email"]', value: 'me@example.com' }
  ]
};

test('allows exact target origin matches only', () => {
  assert.equal(isAllowedTarget('https://example.com/path', ['https://example.com']), true);
  assert.equal(isAllowedTarget('https://evil-example.com/path', ['https://example.com']), false);
  assert.equal(isAllowedTarget('http://example.com/path', ['https://example.com']), false);
});

test('rejects config when target URL is outside allowed origins', () => {
  assert.throws(
    () => normalizeConfig({
      ...baseConfig,
      targetUrl: 'https://attacker.test/register'
    }),
    /targetUrl origin is not listed in allowedOrigins/
  );
});

test('rejects config that asks for automatic submission', () => {
  assert.throws(
    () => normalizeConfig({
      ...baseConfig,
      allowSubmit: true
    }),
    /automatic submission is disabled/
  );
});

test('rejects unsafe profile directories', () => {
  assert.throws(
    () => normalizeConfig({
      ...baseConfig,
      profileDir: '../normal-edge-profile'
    }),
    /profileDir must be a relative path inside this tool/
  );
});

test('normalizes safe defaults', () => {
  const config = normalizeConfig(baseConfig);

  assert.equal(config.targetUrl, baseConfig.targetUrl);
  assert.equal(config.allowedOrigins[0], 'https://example.com');
  assert.equal(config.profileDir, 'edge-profile');
  assert.equal(config.pauseAfterFill, true);
  assert.equal(config.fields[0].required, false);
});
