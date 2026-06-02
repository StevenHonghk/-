export function normalizeText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function cssString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function buildFieldCandidates(field) {
  const candidates = [];

  if (hasText(field.selector)) {
    candidates.push({ type: 'selector', value: field.selector.trim() });
  }

  if (hasText(field.label)) {
    candidates.push({ type: 'label', value: field.label.trim() });
  }

  if (hasText(field.name)) {
    candidates.push({ type: 'css', value: `[name=${cssString(field.name.trim())}]` });
  }

  if (hasText(field.id)) {
    candidates.push({ type: 'css', value: `[id=${cssString(field.id.trim())}]` });
  }

  if (hasText(field.placeholder)) {
    candidates.push({ type: 'css', value: `[placeholder=${cssString(field.placeholder.trim())}]` });
  }

  if (hasText(field.ariaLabel)) {
    candidates.push({ type: 'css', value: `[aria-label=${cssString(field.ariaLabel.trim())}]` });
  }

  if (candidates.length === 0) {
    throw new Error('field needs selector, label, name, id, placeholder, or ariaLabel');
  }

  return candidates;
}
