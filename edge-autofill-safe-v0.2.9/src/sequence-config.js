import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isAllowedTarget } from './config.js';

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function normalizeUrl(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty URL`);
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must use http or https`);
  }

  return url;
}

function normalizeRelativePath(value, name, message) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty relative path`);
  }

  const trimmed = value.trim();
  const parts = trimmed.split(/[\\/]+/);

  if (path.isAbsolute(trimmed) || parts.includes('..') || parts.includes('')) {
    throw new Error(message);
  }

  return trimmed;
}

function normalizeAllowedOrigins(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('allowedOrigins must contain at least one URL origin');
  }

  return value.map((origin, index) => normalizeUrl(origin, `allowedOrigins[${index}]`).origin);
}

export function parseSequenceValues(text) {
  return String(text)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function normalizeSequenceConfig(rawConfig) {
  requireObject(rawConfig, 'config');

  if (rawConfig.allowSubmit === true || rawConfig.autoSubmit === true) {
    throw new Error('automatic submission is disabled');
  }

  const targetUrl = normalizeUrl(rawConfig.targetUrl, 'targetUrl').href;
  const allowedOrigins = normalizeAllowedOrigins(rawConfig.allowedOrigins);

  if (!isAllowedTarget(targetUrl, allowedOrigins)) {
    throw new Error('targetUrl origin is not listed in allowedOrigins');
  }

  return {
    targetUrl,
    allowedOrigins,
    valuesFile: normalizeRelativePath(
      rawConfig.valuesFile ?? 'values.txt',
      'valuesFile',
      'valuesFile must be a relative path inside the config directory'
    ),
    profileDir: normalizeRelativePath(
      rawConfig.profileDir ?? 'edge-profile',
      'profileDir',
      'profileDir must be a relative path inside this tool'
    ),
    pauseAfterFill: rawConfig.pauseAfterFill !== false
  };
}

function normalizeValuesConfig(rawConfig, normalizer) {
  const config = normalizer(rawConfig);
  return config;
}

export function normalizeCurrentTabConfig(rawConfig) {
  requireObject(rawConfig, 'config');

  if (rawConfig.allowSubmit === true || rawConfig.autoSubmit === true) {
    throw new Error('automatic submission is disabled');
  }

  return {
    allowedOrigins: normalizeAllowedOrigins(rawConfig.allowedOrigins),
    valuesFile: normalizeRelativePath(
      rawConfig.valuesFile ?? 'values.txt',
      'valuesFile',
      'valuesFile must be a relative path inside the config directory'
    ),
    profileDir: normalizeRelativePath(
      rawConfig.profileDir ?? 'edge-profile',
      'profileDir',
      'profileDir must be a relative path inside this tool'
    ),
    pauseAfterFill: rawConfig.pauseAfterFill !== false,
    cdpEndpoint: rawConfig.cdpEndpoint
  };
}

async function loadValuesConfig(configPath, normalizer) {
  const filePath = path.resolve(configPath);
  const configDir = path.dirname(filePath);
  const rawConfig = JSON.parse(await readFile(filePath, 'utf8'));
  const config = normalizeValuesConfig(rawConfig, normalizer);
  const valuesPath = path.resolve(configDir, config.valuesFile);
  const values = parseSequenceValues(await readFile(valuesPath, 'utf8'));

  if (values.length === 0) {
    throw new Error('valuesFile must contain at least one non-empty line');
  }

  return {
    ...config,
    configPath: filePath,
    configDir,
    valuesPath,
    values
  };
}

export async function loadSequenceConfig(configPath) {
  return loadValuesConfig(configPath, normalizeSequenceConfig);
}

export async function loadCurrentTabConfig(configPath) {
  return loadValuesConfig(configPath, normalizeCurrentTabConfig);
}
