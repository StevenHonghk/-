const BLOCKED_INPUT_TYPES = new Set([
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

export const DOUBAO_CHAT_URL = 'https://www.doubao.com/chat/';

export function parseValuesText(text) {
  return String(text ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function isSafeEmptyControl(control) {
  if (control.type === 'ueditor') {
    return Boolean(control.editor) && String(control.value ?? '').trim().length === 0;
  }

  if (control.disabled || control.readOnly || !control.visible) {
    return false;
  }

  if (String(control.value ?? '').trim().length > 0) {
    return false;
  }

  const type = String(control.type ?? 'text').toLowerCase();
  return !BLOCKED_INPUT_TYPES.has(type);
}

export function getBlankNumber(label) {
  const match = String(label ?? '').match(/第\s*(\d+)\s*空/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function isAnswerContainerId(id) {
  return /^inpDiv/i.test(String(id ?? ''));
}

export function preferAnswerContainerControls(controls) {
  const answerControls = controls.filter((control) => isAnswerContainerId(control.containerId));
  return answerControls.length > 0 ? answerControls : controls;
}

export function preferAnswerEditorControls(controls) {
  const answerEditorControls = controls.filter((control) => control.isAnswerEditor);
  return answerEditorControls.length > 0 ? answerEditorControls : controls;
}

export function preferNumberedBlankControls(controls) {
  const numbered = controls
    .map((control, index) => ({
      control,
      index,
      blankNumber: getBlankNumber(control.label)
    }))
    .filter((item) => Number.isInteger(item.blankNumber));

  if (numbered.length === 0) {
    return controls;
  }

  return numbered
    .sort((a, b) => a.blankNumber - b.blankNumber || a.index - b.index)
    .map((item) => item.control);
}

export function planSequentialFill(controls, values) {
  const safe = controls.filter(isSafeEmptyControl);
  const answerEditors = safe.filter((control) => control.isAnswerEditor);
  const fillable = answerEditors.length > 0
    ? answerEditors
    : preferNumberedBlankControls(preferAnswerContainerControls(safe));
  const count = Math.min(fillable.length, values.length);
  const assignments = [];

  for (let index = 0; index < count; index += 1) {
    assignments.push({
      control: fillable[index],
      value: values[index]
    });
  }

  return {
    assignments,
    remainingControls: fillable.slice(count),
    unusedValues: values.slice(count)
  };
}

export function isHomeworkFrameUrl(url) {
  return /(?:\/mooc-ans\/work\/doHomeWorkNew|doHomeWorkNew)/.test(String(url ?? ''));
}

export function shouldRunInFrame({
  isTopFrame,
  url,
  answerEditorCount = 0,
  hasHomeworkFrame = false
}) {
  return getAutofillFrameMode({
    isTopFrame,
    url,
    answerEditorCount,
    hasHomeworkFrame
  }) !== 'off';
}

export function getAutofillFrameMode({
  isTopFrame,
  url,
  answerEditorCount = 0,
  hasHomeworkFrame = false
}) {
  if (isTopFrame) {
    if (hasHomeworkFrame && answerEditorCount === 0 && !isHomeworkFrameUrl(url)) {
      return 'controller';
    }

    return 'local';
  }

  if (answerEditorCount > 0 || isHomeworkFrameUrl(url)) {
    return 'worker';
  }

  return 'off';
}

export function buildDoubaoWebPrompt({ rawText, controls = [] }) {
  const labels = controls
    .map((control, index) => `${index + 1}. ${control.label || `field ${index + 1}`}`)
    .join('\n');

  return [
    '请帮我把下面内容整理成填空用的列表。',
    '输出要求：',
    '1. 只输出每个空要填写的内容，一行一个。',
    '2. 顺序必须和字段顺序一致。',
    '3. 不要编号，不要解释，不要输出多余文字。',
    '4. 不确定的空请写“不确定”。',
    '',
    '字段顺序:',
    labels || '(未检测到字段标签)',
    '',
    '页面/题目内容:',
    String(rawText ?? '')
  ].join('\n');
}

function sanitizeUrlForSummary(url) {
  try {
    const parsed = new URL(String(url ?? ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }

    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '';
  }
}

export function buildPageInfoSummary({
  title,
  url,
  frameMode,
  iframeUrls = [],
  controlCount = 0,
  labels = []
}) {
  const safeUrl = sanitizeUrlForSummary(url);
  const safeIframeUrls = iframeUrls
    .map(sanitizeUrlForSummary)
    .filter(Boolean);
  const safeLabels = labels
    .map((label) => String(label ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 20);

  return [
    '页面信息摘要（已去除 URL 参数和 hash）',
    `标题: ${String(title ?? '').trim() || '(无标题)'}`,
    `页面: ${safeUrl || '(不可用)'}`,
    `运行模式: ${String(frameMode ?? 'unknown')}`,
    `可填空格: ${Number.isFinite(controlCount) ? controlCount : 0}`,
    safeIframeUrls.length > 0 ? `iframe: ${safeIframeUrls.join(', ')}` : 'iframe: (无)',
    safeLabels.length > 0
      ? ['字段标签:', ...safeLabels.map((label, index) => `${index + 1}. ${label}`)].join('\n')
      : '字段标签: (无)'
  ].join('\n');
}

export function formatDetectionStatus(controlCount, valueCount) {
  return `实时检测：可填空格 ${controlCount} 个，内容 ${valueCount} 行。`;
}

export function formatFloatingButtonText(controlCount) {
  return controlCount > 0 ? `填空(${controlCount})` : '填空';
}
