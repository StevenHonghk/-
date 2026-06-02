import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCurrentTabConfig,
  normalizeSequenceConfig,
  parseSequenceValues
} from '../src/sequence-config.js';

const baseConfig = {
  targetUrl: 'https://example.com/form',
  allowedOrigins: ['https://example.com'],
  valuesFile: 'values.txt',
  profileDir: 'edge-profile'
};

test('parses one non-empty value per line', () => {
  assert.deepEqual(
    parseSequenceValues('张三\r\n\r\n  北京 朝阳  \nzhangsan@example.com\n'),
    ['张三', '北京 朝阳', 'zhangsan@example.com']
  );
});

test('rejects sequence config outside allowed origins', () => {
  assert.throws(
    () => normalizeSequenceConfig({
      ...baseConfig,
      targetUrl: 'https://attacker.test/form'
    }),
    /targetUrl origin is not listed in allowedOrigins/
  );
});

test('rejects sequence config that asks for automatic submission', () => {
  assert.throws(
    () => normalizeSequenceConfig({
      ...baseConfig,
      allowSubmit: true
    }),
    /automatic submission is disabled/
  );
});

test('rejects unsafe sequence values file paths', () => {
  assert.throws(
    () => normalizeSequenceConfig({
      ...baseConfig,
      valuesFile: '../values.txt'
    }),
    /valuesFile must be a relative path inside the config directory/
  );
});

test('normalizes sequence config defaults', () => {
  const config = normalizeSequenceConfig(baseConfig);

  assert.equal(config.targetUrl, 'https://example.com/form');
  assert.deepEqual(config.allowedOrigins, ['https://example.com']);
  assert.equal(config.valuesFile, 'values.txt');
  assert.equal(config.profileDir, 'edge-profile');
  assert.equal(config.pauseAfterFill, true);
});

test('current tab config does not require targetUrl', () => {
  const config = normalizeCurrentTabConfig({
    allowedOrigins: ['https://example.com'],
    valuesFile: 'values.txt'
  });

  assert.deepEqual(config.allowedOrigins, ['https://example.com']);
  assert.equal(config.valuesFile, 'values.txt');
  assert.equal(config.profileDir, 'edge-profile');
});
