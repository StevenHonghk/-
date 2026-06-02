import path from 'node:path';
import { buildFieldCandidates } from './field-matchers.js';

export function resolveProfileDir(config) {
  return path.resolve(config.configDir ?? process.cwd(), config.profileDir);
}

function fieldLabel(field) {
  return field.label ?? field.name ?? field.id ?? field.placeholder ?? field.ariaLabel ?? field.selector;
}

function matcherLabel(candidate) {
  return `${candidate.type}: ${candidate.value}`;
}

export function formatFillReport(results) {
  const filled = results.filter((result) => result.status === 'filled').length;
  const missing = results.filter((result) => result.status === 'missing').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const lines = [
    'Autofill report',
    `Filled: ${filled}`,
    `Missing: ${missing}`,
    `Failed: ${failed}`
  ];

  for (const result of results) {
    lines.push(`- [${result.status}] ${result.label} (${result.matcher})`);
    if (result.error) {
      lines.push(`  ${result.error}`);
    }
  }

  return lines.join('\n');
}

async function firstMatchingLocator(page, field) {
  for (const candidate of buildFieldCandidates(field)) {
    const locator = candidate.type === 'label'
      ? page.getByLabel(candidate.value, { exact: true }).first()
      : page.locator(candidate.value).first();

    if (await locator.count() > 0) {
      return { locator, matcher: matcherLabel(candidate) };
    }
  }

  return null;
}

async function applyValue(locator, value) {
  const elementInfo = await locator.evaluate((element) => ({
    tagName: element.tagName.toLowerCase(),
    type: element.getAttribute('type')?.toLowerCase() ?? ''
  }));

  if (['checkbox', 'radio'].includes(elementInfo.type)) {
    if (Boolean(value)) {
      await locator.check();
    } else {
      await locator.uncheck();
    }
    return;
  }

  if (elementInfo.tagName === 'select') {
    await locator.selectOption(String(value));
    return;
  }

  await locator.fill(String(value));
}

export async function fillConfiguredFields(page, fields) {
  const results = [];

  for (const field of fields) {
    const label = fieldLabel(field);
    const match = await firstMatchingLocator(page, field);

    if (!match) {
      results.push({
        label,
        status: 'missing',
        matcher: 'no configured matcher found'
      });
      continue;
    }

    try {
      await applyValue(match.locator, field.value);
      results.push({
        label,
        status: 'filled',
        matcher: match.matcher
      });
    } catch (error) {
      results.push({
        label,
        status: 'failed',
        matcher: match.matcher,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return results;
}

export async function runAutofill(config, options = {}) {
  const playwright = options.playwright ?? await import('playwright');
  const context = await playwright.chromium.launchPersistentContext(resolveProfileDir(config), {
    channel: 'msedge',
    headless: false,
    viewport: null
  });

  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded' });

    const results = await fillConfiguredFields(page, config.fields);
    const requiredMisses = results.filter((result, index) =>
      config.fields[index]?.required && result.status !== 'filled'
    );

    options.log?.(formatFillReport(results));

    if (requiredMisses.length > 0) {
      throw new Error(`required fields were not filled: ${requiredMisses.map((result) => result.label).join(', ')}`);
    }

    if (config.pauseAfterFill) {
      await options.reviewWaiter?.();
    }

    return results;
  } finally {
    if (options.closeBrowser !== false) {
      await context.close();
    }
  }
}
