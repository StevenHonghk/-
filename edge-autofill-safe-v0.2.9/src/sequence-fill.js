import { resolveProfileDir } from './autofill.js';

const SEQUENCE_ATTR = 'data-edge-autofill-seq';

function controlLabel(control) {
  return control.label || control.placeholder || control.name || control.id || `field ${control.index + 1}`;
}

function previewValue(value) {
  const text = String(value);
  return text.length > 32 ? `${text.slice(0, 29)}...` : text;
}

export function buildSequenceAssignments(controls, values) {
  const count = Math.min(controls.length, values.length);
  const assignments = [];

  for (let index = 0; index < count; index += 1) {
    assignments.push({
      control: controls[index],
      value: values[index]
    });
  }

  return {
    assignments,
    remainingControls: controls.slice(count),
    unusedValues: values.slice(count)
  };
}

export function formatSequenceReport({ filled, remainingControls, unusedValues }) {
  const lines = [
    'Sequence fill report',
    `Filled: ${filled.length}`,
    `Empty controls left: ${remainingControls.length}`,
    `Unused values: ${unusedValues.length}`
  ];

  for (const item of filled) {
    lines.push(`- [filled] ${item.label}: ${item.valuePreview}`);
  }

  for (const control of remainingControls) {
    lines.push(`- [left empty] ${controlLabel(control)}`);
  }

  if (unusedValues.length > 0) {
    lines.push('- [unused values]');
    for (const value of unusedValues) {
      lines.push(`  ${previewValue(value)}`);
    }
  }

  return lines.join('\n');
}

export async function discoverEmptyControls(page) {
  return page.evaluate((attrName) => {
    const blockedInputTypes = new Set([
      'button',
      'checkbox',
      'color',
      'file',
      'hidden',
      'image',
      'password',
      'radio',
      'range',
      'reset',
      'submit'
    ]);

    function isVisible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.width > 0
        && rect.height > 0;
    }

    function getElementValue(element) {
      if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
        return element.value;
      }

      if (element.isContentEditable) {
        return element.textContent ?? '';
      }

      return '';
    }

    function isFillable(element) {
      if (element.disabled || element.readOnly || !isVisible(element)) {
        return false;
      }

      if (element instanceof HTMLInputElement) {
        const type = element.type.toLowerCase();
        return !blockedInputTypes.has(type) && getElementValue(element).trim().length === 0;
      }

      if (element instanceof HTMLTextAreaElement) {
        return getElementValue(element).trim().length === 0;
      }

      return element.isContentEditable && getElementValue(element).trim().length === 0;
    }

    function readLabel(element) {
      if (element.labels?.length > 0) {
        return Array.from(element.labels)
          .map((label) => label.textContent?.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .join(' / ');
      }

      return element.getAttribute('aria-label')?.trim()
        || element.getAttribute('placeholder')?.trim()
        || element.getAttribute('name')?.trim()
        || element.id?.trim()
        || '';
    }

    const controls = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'))
      .filter(isFillable)
      .map((element) => ({ element }));

    return controls.map(({ element }, index) => {
      element.setAttribute(attrName, String(index));
      return {
        index,
        selector: `[${attrName}="${index}"]`,
        label: readLabel(element),
        id: element.id || '',
        name: element.getAttribute('name') || '',
        placeholder: element.getAttribute('placeholder') || ''
      };
    });
  }, SEQUENCE_ATTR);
}

async function fillAssignment(page, assignment) {
  const locator = page.locator(assignment.control.selector).first();
  await locator.fill(String(assignment.value));

  return {
    label: controlLabel(assignment.control),
    valuePreview: previewValue(assignment.value)
  };
}

export async function fillPageWithSequence(page, values) {
  const controls = await discoverEmptyControls(page);
  const assignments = buildSequenceAssignments(controls, values);
  const filled = [];

  for (const assignment of assignments.assignments) {
    filled.push(await fillAssignment(page, assignment));
  }

  return {
    filled,
    remainingControls: assignments.remainingControls,
    unusedValues: assignments.unusedValues
  };
}

export async function runSequenceFill(config, options = {}) {
  const playwright = options.playwright ?? await import('playwright');
  const context = await playwright.chromium.launchPersistentContext(resolveProfileDir(config), {
    channel: 'msedge',
    headless: false,
    viewport: null
  });

  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(config.targetUrl, { waitUntil: 'domcontentloaded' });

    const report = await fillPageWithSequence(page, config.values);

    options.log?.(formatSequenceReport(report));

    if (config.pauseAfterFill) {
      await options.reviewWaiter?.();
    }

    return report;
  } finally {
    if (options.closeBrowser !== false) {
      await context.close();
    }
  }
}
