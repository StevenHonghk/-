import { fillPageWithSequence, formatSequenceReport } from './sequence-fill.js';

export const DEFAULT_CDP_ENDPOINT = 'http://127.0.0.1:9222';

function safeOrigin(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function filterAllowedPages(pages, allowedOrigins) {
  const allowed = new Set(allowedOrigins);

  return pages
    .map((page, index) => ({
      index,
      ...(page.page ? { page: page.page } : {}),
      url: page.url,
      title: page.title ?? ''
    }))
    .filter((page) => allowed.has(safeOrigin(page.url)));
}

export function formatPageChoices(pages) {
  return pages
    .map((page, index) => {
      const title = page.title?.trim() || 'Untitled page';
      return `${index + 1}. ${title}\n   ${page.url}`;
    })
    .join('\n');
}

export function selectPageChoice(pages, input) {
  const number = Number.parseInt(String(input).trim(), 10);

  if (!Number.isInteger(number) || number < 1 || number > pages.length) {
    throw new Error('choose a number from the list');
  }

  return pages[number - 1];
}

async function collectPages(browser) {
  const pages = [];

  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      pages.push({
        page,
        url: page.url(),
        title: await page.title().catch(() => '')
      });
    }
  }

  return pages;
}

async function choosePage(candidates, options) {
  if (candidates.length === 0) {
    throw new Error('no open tab matches allowedOrigins; open the target page in the connectable Edge window first');
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  options.log?.(`Matching tabs:\n${formatPageChoices(candidates)}`);
  const answer = await options.choosePage?.(candidates);
  return selectPageChoice(candidates, answer);
}

export async function runCurrentTabFill(config, options = {}) {
  const playwright = options.playwright ?? await import('playwright');
  const endpoint = options.endpoint ?? config.cdpEndpoint ?? DEFAULT_CDP_ENDPOINT;
  let browser;

  try {
    browser = await playwright.chromium.connectOverCDP(endpoint);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`could not connect to Edge at ${endpoint}; run start-edge-tab-mode.bat first. ${message}`);
  }

  try {
    const pages = await collectPages(browser);
    const candidates = filterAllowedPages(pages, config.allowedOrigins);
    const selected = await choosePage(candidates, options);

    await selected.page.bringToFront();
    const report = await fillPageWithSequence(selected.page, config.values);
    options.log?.(formatSequenceReport(report));

    return {
      selectedUrl: selected.url,
      selectedTitle: selected.title,
      ...report
    };
  } finally {
    await browser.close();
  }
}
