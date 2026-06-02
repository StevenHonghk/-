import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildFieldCandidates } from './field-matchers.js';

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function normalizeOrigin(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty URL origin`);
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL origin`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must use http or https`);
  }

  return url.origin;
}

function normalizeTargetUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('targetUrl must be a non-empty URL');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('targetUrl must be a valid URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('targetUrl must use http or https');
  }

  return url.href;
}

function normalizeProfileDir(value) {
  const profileDir = value ?? 'edge-profile';

  if (typeof profileDir !== 'string' || profileDir.trim().length === 0) {
    throw new Error('profileDir must be a non-empty relative path');
  }

  const trimmed = profileDir.trim();
  const parts = trimmed.split(/[\\/]+/);

  if (path.isAbsolute(trimmed) || parts.includes('..') || parts.includes('')) {
    throw new Error('profileDir must be a relative path inside this tool');
  }

  return trimmed;
}

function normalizeField(field, index) {
  requireObject(field, `fields[${index}]`);

  if (!Object.hasOwn(field, 'value')) {
    throw new Error(`fields[${index}].value is required`);
  }

  if (!['string', 'number', 'boolean'].includes(typeof field.value)) {
    throw new Error(`fields[${index}].value must be a string, number, or boolean`);
  }

  const normalized = {
    selector: field.selector,
    label: field.label,
    name: field.name,
    id: field.id,
    placeholder: field.placeholder,
    ariaLabel: field.ariaLabel,
    value: field.value,
    required: field.required === true
  };

  buildFieldCandidates(normalized);
  return normalized;
}

export function isAllowedTarget(targetUrl, allowedOrigins) {
  try {
    const target = new URL(targetUrl);
    return allowedOrigins
      .map((origin) => normalizeOrigin(origin, 'allowedOrigins[]'))
      .includes(target.origin);
  } catch {
    return false;
  }
}

export function normalizeConfig(rawConfig) {
  requireObject(rawConfig, 'config');

  if (rawConfig.allowSubmit === true || rawConfig.autoSubmit === true) {
    throw new Error('automatic submission is disabled');
  }

  const targetUrl = normalizeTargetUrl(rawConfig.targetUrl);

  if (!Array.isArray(rawConfig.allowedOrigins) || rawConfig.allowedOrigins.length === 0) {
    throw new Error('allowedOrigins must contain at least one URL origin');
  }

  const allowedOrigins = rawConfig.allowedOrigins.map((origin, index) =>
    normalizeOrigin(origin, `allowedOrigins[${index}]`)
  );

  if (!isAllowedTarget(targetUrl, allowedOrigins)) {
    throw new Error('targetUrl origin is not listed in allowedOrigins');
  }

  if (!Array.isArray(rawConfig.fields) || rawConfig.fields.length === 0) {
    throw new Error('fields must contain at least one field rule');
  }

  return {
    targetUrl,
    allowedOrigins,
    profileDir: normalizeProfileDir(rawConfig.profileDir),
    pauseAfterFill: rawConfig.pauseAfterFill !== false,
    fields: rawConfig.fields.map(normalizeField)
  };
}

export async function loadConfig(configPath) {
  const filePath = path.resolve(configPath);
  const text = await readFile(filePath, 'utf8');
  const rawConfig = JSON.parse(text);
  return {
    ...normalizeConfig(rawConfig),
    configPath: filePath,
    configDir: path.dirname(filePath)
  };
}
