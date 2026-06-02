// ==UserScript==
// @name         Safe Sequence Autofill
// @namespace    local.edge.autofill.safe
// @version      0.2.9
// @description  Paste values line by line and fill empty form fields in order. Manual trigger only; never submits forms.
// @author       local
// @match        http://*/*
// @match        https://*/*
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'safeSequenceAutofillValues';
  const DOUBAO_SOURCE_STORAGE_KEY = 'safeSequenceAutofillDoubaoSource';
  const DOUBAO_PROMPT_STORAGE_KEY = 'safeSequenceAutofillDoubaoPrompt';
  const DOUBAO_PROMPT_TIME_STORAGE_KEY = 'safeSequenceAutofillDoubaoPromptTime';
  const DOUBAO_CHAT_URL = 'https://www.doubao.com/chat/';
  const PANEL_ID = 'safe-sequence-autofill-panel';
  const BUTTON_ID = 'safe-sequence-autofill-button';
  const DOUBAO_PANEL_ID = 'safe-sequence-doubao-panel';
  const BRIDGE_SOURCE = 'safe-sequence-autofill-bridge';
  const BRIDGE_TIMEOUT_MS = 5000;
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
  let activePanelRefresh = null;
  let liveRefreshTimer = null;
  let liveDetectionObserver = null;
  let bridgeControllerInstalled = false;
  let bridgeWorkerInstalled = false;
  let bridgeRequestId = 0;
  const pendingBridgeRequests = new Map();
  let lastFilledControls = [];

  function parseValuesText(text) {
    return String(text || '')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return style.visibility !== 'hidden'
      && style.display !== 'none'
      && rect.width > 0
      && rect.height > 0;
  }

  function isOwnUiElement(element) {
    return Boolean(element.closest(`#${PANEL_ID}, #${BUTTON_ID}, #${DOUBAO_PANEL_ID}`));
  }

  function isTopFrame() {
    return window.top === window.self;
  }

  function isHomeworkFrameUrl(url) {
    return /(?:\/mooc-ans\/work\/doHomeWorkNew|doHomeWorkNew|\/mooc2\/work\/dowork|\/api\/work(?:[/?#]|$)|\/mooc-ans\/knowledge\/cards|\/ananas\/modules\/work\/)/.test(String(url || ''));
  }

  function isChaoxingPage() {
    const location = window.location || {};
    const hostname = String(location.hostname || '');
    const href = String(location.href || '');

    return /(?:^|\.)chaoxing\.com$/i.test(hostname)
      || /(?:^|\.)fanya\.chaoxing\.com$/i.test(hostname)
      || /chaoxing\.com/i.test(href);
  }

  function getAnswerEditorCount() {
    return document.querySelectorAll('textarea[id^="answerEditor"], textarea[name^="answerEditor"]').length;
  }

  function hasHomeworkFrame() {
    return [...document.querySelectorAll('iframe')]
      .some((frame) => isHomeworkFrameUrl(frame.src || '') || frameHasAnswerEditors(frame));
  }

  function frameHasAnswerEditors(frame) {
    try {
      return Boolean(frame.contentDocument && frame.contentDocument.querySelector('textarea[id^="answerEditor"], textarea[name^="answerEditor"]'));
    } catch {
      return false;
    }
  }

  function shouldStartAutofill() {
    return getAutofillFrameMode() !== 'off';
  }

  function getAutofillFrameMode() {
    if (isTopFrame()) {
      if (hasHomeworkFrame() && getAnswerEditorCount() === 0 && !isHomeworkFrameUrl(window.location.href)) {
        return 'controller';
      }

      return 'local';
    }

    return 'worker';
  }

  function getElementValue(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value;
    }

    if (element.isContentEditable) {
      return element.textContent || '';
    }

    return '';
  }

  function getPageWindow() {
    return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  }

  function findUeditor(textarea) {
    const pageWindow = getPageWindow();
    const editorId = textarea.id || textarea.getAttribute('name');

    if (!editorId || !pageWindow.UE || typeof pageWindow.UE.getEditor !== 'function') {
      return null;
    }

    try {
      const editor = pageWindow.UE.getEditor(editorId);
      return editor && typeof editor.setContent === 'function' ? editor : null;
    } catch {
      return null;
    }
  }

  function getUeditorValue(editor) {
    try {
      if (typeof editor.getContentTxt === 'function') {
        return editor.getContentTxt();
      }

      if (typeof editor.getContent === 'function') {
        return editor.getContent().replace(/<[^>]*>/g, '');
      }
    } catch {
      return '';
    }

    return '';
  }

  function isSafeEmptyControl(element) {
    if (element.disabled || element.readOnly || !isVisible(element)) {
      return false;
    }

    if (getElementValue(element).trim().length > 0) {
      return false;
    }

    if (element instanceof HTMLInputElement) {
      return !BLOCKED_INPUT_TYPES.has(element.type.toLowerCase());
    }

    return element instanceof HTMLTextAreaElement || element.isContentEditable;
  }

  function readLabel(element, index) {
    if (element.labels && element.labels.length > 0) {
      const label = Array.from(element.labels)
        .map((item) => (item.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' / ');

      if (label) {
        return label;
      }
    }

    return element.getAttribute('aria-label')
      || element.getAttribute('placeholder')
      || element.getAttribute('name')
      || element.id
      || `field ${index + 1}`;
  }

  function compactText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function nearbyLabelText(element) {
    const parts = [];
    const previous = element.previousElementSibling;

    if (previous) {
      parts.push(compactText(previous.textContent));
    }

    if (element.parentElement) {
      const text = compactText(element.parentElement.textContent);
      const match = text.match(/第\s*\d+\s*空\s*[:：]?/);
      if (match) {
        parts.push(match[0]);
      }
    }

    return parts.filter(Boolean).join(' ');
  }

  function readControlLabel(element, index) {
    const nearby = nearbyLabelText(element);
    if (/第\s*\d+\s*空/.test(nearby)) {
      return nearby;
    }

    return readLabel(element, index);
  }

  function getBlankNumber(label) {
    const match = String(label || '').match(/第\s*(\d+)\s*空/);
    return match ? Number.parseInt(match[1], 10) : null;
  }

  function isAnswerContainerId(id) {
    return /^inpDiv/i.test(String(id || ''));
  }

  function getAnswerContainerId(element) {
    const container = typeof element.closest === 'function'
      ? element.closest('[id^="inpDiv"], [id^="inpdiv"]')
      : null;

    if (container) {
      return container.id;
    }

    const getAttr = (name) => (
      typeof element.getAttribute === 'function' ? element.getAttribute(name) || '' : ''
    );
    const names = [element.id, element.name, getAttr('name')];

    for (const value of names) {
      const match = String(value || '').match(/^answerEditor(.+)$/i);
      if (!match || !match[1]) {
        continue;
      }

      const suffix = match[1];
      const fallback = document.getElementById(`inpDiv${suffix}`) || document.getElementById(`inpdiv${suffix}`);
      if (fallback) {
        return fallback.id;
      }
    }

    return '';
  }

  function isExcludedPageControl(element) {
    if (!element || isOwnUiElement(element)) {
      return true;
    }

    const getAttr = (name) => (
      typeof element.getAttribute === 'function' ? element.getAttribute(name) || '' : ''
    );
    const identity = [
      element.id,
      element.name,
      element.className,
      getAttr('placeholder'),
      getAttr('aria-label'),
      getAttr('type')
    ].join(' ').toLowerCase();
    const answerIdentity = /answer|answereditor|inpdiv|blank|填空/.test(identity);

    if (!answerIdentity && /(search|chapterlist|keyword|comment|discuss|topic|note|captcha|validate|verify|upload|file|phone|email|login|password)/.test(identity)) {
      return true;
    }

    return Boolean(element.closest('.discusBg, .note, .newTopic1, .formTopic, .comment, .topic, .search, #selector, #validate, #chapterVerificationCode, .maskDivReport'));
  }

  function getQuestionContainer(element) {
    return element.closest('.TiMu, .questionLi, .blankItemDiv, .readComprehensionQues, .question, .work, [id^="inpDiv"], [id^="inpdiv"]');
  }

  function isAnswerLikeControl(element) {
    if (!element || isExcludedPageControl(element)) {
      return false;
    }

    const getAttr = (name) => (
      typeof element.getAttribute === 'function' ? element.getAttribute(name) || '' : ''
    );
    const id = String(element.id || '');
    const name = String(element.name || getAttr('name') || '');

    if (/^answerEditor/i.test(id) || /^answerEditor/i.test(name)) {
      return true;
    }

    if (isAnswerContainerId(getAnswerContainerId(element))) {
      return true;
    }

    const questionContainer = getQuestionContainer(element);
    if (!questionContainer) {
      return false;
    }

    const parentText = element.parentElement
      ? element.parentElement.innerText || element.parentElement.textContent || ''
      : '';
    const questionText = questionContainer.innerText || questionContainer.textContent || '';
    const labelText = readControlLabel(element, 0);
    const text = compactText(`${questionText} ${parentText} ${labelText}`);

    return /第\s*\d+\s*空|填空题|填空|\bblank\b|\banswer\b/i.test(text);
  }

  function sortControlsByDomOrder(controls) {
    return [...controls].sort((a, b) => {
      const first = a.element || a;
      const second = b.element || b;

      if (!first || !second || first === second || typeof first.compareDocumentPosition !== 'function') {
        return 0;
      }

      return first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  function preferAnswerContainerControls(controls) {
    const answerControls = controls.filter((control) => isAnswerContainerId(control.containerId));
    return answerControls.length > 0 ? answerControls : controls;
  }

  function buildDoubaoWebPrompt(rawText, controls) {
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
      String(rawText || '')
    ].join('\n');
  }

  function formatDetectionStatus(controlCount, valueCount) {
    return `实时检测：可填空格 ${controlCount} 个，内容 ${valueCount} 行。`;
  }

  function formatFloatingButtonText(controlCount) {
    return controlCount > 0 ? `填空(${controlCount})` : '填空';
  }

  function preferNumberedBlankControls(controls) {
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

  function isAnswerEditorTextarea(element) {
    return element instanceof HTMLTextAreaElement
      && (/^answerEditor/.test(element.id || '') || /^answerEditor/.test(element.getAttribute('name') || ''));
  }

  function getAnswerEditorTextareas() {
    return [...document.querySelectorAll('textarea[id^="answerEditor"], textarea[name^="answerEditor"]')]
      .filter((textarea) => !isOwnUiElement(textarea))
      .sort((a, b) => (
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      ));
  }

  function createTextareaControl(textarea, index, isAnswerEditor) {
    const editor = findUeditor(textarea);

    if (editor) {
      if (getUeditorValue(editor).trim().length > 0) {
        return null;
      }

      return {
        element: textarea,
        editor,
        kind: 'ueditor',
        label: isAnswerEditor ? `第${index + 1}空` : readControlLabel(textarea, index),
        containerId: getAnswerContainerId(textarea),
        isAnswerEditor
      };
    }

    if (!isSafeEmptyControl(textarea)) {
      return null;
    }

    return {
      element: textarea,
      kind: 'native',
      label: isAnswerEditor ? `第${index + 1}空` : readControlLabel(textarea, index),
      containerId: getAnswerContainerId(textarea),
      isAnswerEditor
    };
  }

  function createNativeControl(element, index) {
    return {
      element,
      kind: 'native',
      label: readControlLabel(element, index),
      containerId: getAnswerContainerId(element)
    };
  }

  function discoverControls() {
    const genericControls = [];
    const structuredControls = [];
    const answerEditorControls = getAnswerEditorTextareas()
      .map((textarea, index) => createTextareaControl(textarea, index, true))
      .filter(Boolean);

    if (answerEditorControls.length > 0) {
      return answerEditorControls;
    }

    for (const textarea of document.querySelectorAll('textarea')) {
      if (isOwnUiElement(textarea) || isAnswerEditorTextarea(textarea) || isExcludedPageControl(textarea)) {
        continue;
      }

      const control = createTextareaControl(textarea, genericControls.length, false);
      if (control) {
        genericControls.push(control);

        if (isAnswerLikeControl(textarea)) {
          structuredControls.push(control);
        }
      }
    }

    const seen = new Set(genericControls.map((control) => control.element));

    for (const element of document.querySelectorAll('input, textarea, [contenteditable="true"]')) {
      if (seen.has(element) || isExcludedPageControl(element) || !isSafeEmptyControl(element)) {
        continue;
      }

      const control = createNativeControl(element, genericControls.length);
      genericControls.push(control);

      if (isAnswerLikeControl(element)) {
        structuredControls.push(control);
      }
    }

    if (structuredControls.length > 0) {
      return preferNumberedBlankControls(preferAnswerContainerControls(sortControlsByDomOrder(structuredControls)));
    }

    return isChaoxingPage() ? [] : sortControlsByDomOrder(genericControls);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function syncUeditorIframeBody(control, textValue) {
    if (!control || !control.containerId || typeof document === 'undefined' || typeof document.getElementById !== 'function') {
      return;
    }

    const container = document.getElementById(control.containerId);
    const iframe = container && typeof container.querySelector === 'function'
      ? container.querySelector('iframe[id^="ueditor_"], iframe')
      : null;

    if (!iframe) {
      return;
    }

    let body = null;
    try {
      body = iframe.contentDocument && iframe.contentDocument.body
        ? iframe.contentDocument.body
        : iframe.contentWindow && iframe.contentWindow.document && iframe.contentWindow.document.body;
    } catch {
      body = null;
    }

    if (!body) {
      return;
    }

    body.innerHTML = `<p>${escapeHtml(textValue)}<br></p>`;

    if (typeof body.dispatchEvent !== 'function') {
      return;
    }

    try {
      body.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: textValue
      }));
    } catch {
      body.dispatchEvent(new Event('input', { bubbles: true }));
    }

    body.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function syncAnswerContainerDisplay(control, textValue) {
    if (!control || !control.containerId || typeof document === 'undefined' || typeof document.getElementById !== 'function') {
      return;
    }

    const container = document.getElementById(control.containerId);
    if (!container) {
      return;
    }

    const target = typeof container.querySelector === 'function'
      ? container.querySelector('[contenteditable="true"], .edui-body-container, .view, textarea, input')
      : null;
    const displayElement = target || container;

    if (displayElement instanceof HTMLInputElement || displayElement instanceof HTMLTextAreaElement) {
      displayElement.value = textValue;

      if (typeof displayElement.setAttribute === 'function') {
        displayElement.setAttribute('value', textValue);
      }
    } else {
      displayElement.textContent = textValue;
    }

    if (typeof displayElement.dispatchEvent !== 'function') {
      return;
    }

    try {
      displayElement.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: textValue
      }));
    } catch {
      displayElement.dispatchEvent(new Event('input', { bubbles: true }));
    }

    displayElement.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setControlValue(control, value) {
    const element = control.element;
    const textValue = String(value);

    if (control.kind === 'ueditor' && control.editor) {
      const notifyTextarea = () => {
        if (typeof element.dispatchEvent !== 'function') {
          return;
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));

        if (typeof element.blur === 'function') {
          element.blur();
        }
      };
      const setEditorContent = () => {
        control.editor.setContent(textValue);

        if (typeof control.editor.sync === 'function') {
          control.editor.sync();
        }

        element.value = textValue;
        if (typeof element.setAttribute === 'function') {
          element.setAttribute('value', textValue);
        }

        if (typeof control.editor.fireEvent === 'function') {
          control.editor.fireEvent('contentChange');
          control.editor.fireEvent('contentchange');
        }

        syncUeditorIframeBody(control, textValue);
        syncAnswerContainerDisplay(control, textValue);
        notifyTextarea();
      };

      if (typeof control.editor.ready === 'function') {
        control.editor.ready(setEditorContent);
      } else {
        setEditorContent();
      }
      return;
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.focus();

      if (typeof element.click === 'function') {
        element.click();
      }

      if (typeof element.select === 'function') {
        element.select();
      }

      try {
        element.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: textValue
        }));
      } catch {
        element.dispatchEvent(new Event('beforeinput', { bubbles: true, cancelable: true }));
      }

      const valueDescriptor = Object.getOwnPropertyDescriptor(
        element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      );

      if (valueDescriptor && typeof valueDescriptor.set === 'function') {
        valueDescriptor.set.call(element, textValue);
      } else {
        element.value = textValue;
      }

      if (typeof element.setAttribute === 'function') {
        element.setAttribute('value', textValue);
      }

      syncAnswerContainerDisplay(control, textValue);
      element.dispatchEvent(new Event('input', { bubbles: true }));

      try {
        element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
      } catch {
        element.dispatchEvent(new Event('keyup', { bubbles: true }));
      }

      element.dispatchEvent(new Event('change', { bubbles: true }));

      if (typeof element.blur === 'function') {
        element.blur();
      }
      return;
    }

    if (element.isContentEditable) {
      element.focus();
      element.textContent = textValue;
      syncAnswerContainerDisplay(control, textValue);
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: textValue
      }));

      element.dispatchEvent(new Event('change', { bubbles: true }));

      if (typeof element.blur === 'function') {
        element.blur();
      }
    }
  }

  function planSequentialFill(controls, values) {
    const answerEditorControls = controls.filter((control) => control.isAnswerEditor);
    const preferredControls = answerEditorControls.length > 0
      ? answerEditorControls
      : preferNumberedBlankControls(preferAnswerContainerControls(controls));
    const count = Math.min(preferredControls.length, values.length);
    const assignments = [];

    for (let index = 0; index < count; index += 1) {
      assignments.push({
        control: preferredControls[index],
        value: values[index]
      });
    }

    return {
      assignments,
      remainingControls: preferredControls.slice(count),
      unusedValues: values.slice(count)
    };
  }

  function clearLastFilledControls() {
    const controls = lastFilledControls.filter((control) => control && control.element);
    const labels = [];

    for (const control of controls) {
      setControlValue(control, '');
      labels.push(control.label || '');
    }

    lastFilledControls = [];
    return {
      cleared: controls.length,
      labels
    };
  }

  function fillCurrentPage(values) {
    const controls = discoverControls();
    const plan = planSequentialFill(controls, values);

    for (const assignment of plan.assignments) {
      setControlValue(assignment.control, assignment.value);
    }

    lastFilledControls = plan.assignments.map((assignment) => assignment.control);

    return {
      filled: plan.assignments.length,
      remainingControls: plan.remainingControls.length,
      unusedValues: plan.unusedValues.length,
      labels: plan.assignments.map((assignment) => assignment.control.label)
    };
  }

  function summarizeCurrentPageControls() {
    const controls = discoverControls();
    return {
      controlCount: controls.length,
      labels: controls.slice(0, 20).map((control) => control.label)
    };
  }

  function limitText(text, maxLength) {
    const normalized = compactText(text);
    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, maxLength)}\n\n（内容过长，已截断）`;
  }

  function buildCurrentPageTextSummary() {
    const selectors = [
      '.TiMu',
      '.questionLi',
      '.blankItemDiv',
      '.readComprehensionQues',
      '.question',
      '.work',
      'main',
      'article',
      'body'
    ];

    for (const selector of selectors) {
      const chunks = [...document.querySelectorAll(selector)]
        .filter((element) => !isOwnUiElement(element))
        .slice(0, 30)
        .map((element) => compactText(element.innerText || element.textContent || ''))
        .filter((text) => text.length > 20);

      if (chunks.length > 0) {
        return limitText(chunks.join('\n\n'), 8000);
      }
    }

    return '';
  }

  function getHomeworkFrames() {
    return [...document.querySelectorAll('iframe')]
      .filter((frame) => isHomeworkFrameUrl(frame.src || ''));
  }

  function handleBridgeReply(event) {
    const message = event.data;
    if (!message || message.source !== BRIDGE_SOURCE || message.direction !== 'reply') {
      return;
    }

    const pending = pendingBridgeRequests.get(message.requestId);
    if (!pending) {
      return;
    }

    window.clearTimeout(pending.timer);
    pendingBridgeRequests.delete(message.requestId);

    if (message.error) {
      pending.reject(new Error(message.error));
      return;
    }

    pending.resolve(message.payload);
  }

  function installBridgeController() {
    if (bridgeControllerInstalled) {
      return;
    }

    bridgeControllerInstalled = true;
    window.addEventListener('message', handleBridgeReply);
  }

  function requestHomeworkFrame(type, payload) {
    installBridgeController();

    const frames = getHomeworkFrames();
    if (frames.length === 0) {
      return Promise.reject(new Error('没有找到课程题目 iframe。'));
    }

    const requestId = `safe-sequence-${Date.now()}-${bridgeRequestId += 1}`;
    const message = {
      source: BRIDGE_SOURCE,
      direction: 'request',
      type,
      requestId,
      payload: payload || {}
    };

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingBridgeRequests.delete(requestId);
        reject(new Error('作业 iframe 没有响应，请确认 Tampermonkey 允许在 iframe 中运行。'));
      }, BRIDGE_TIMEOUT_MS);

      pendingBridgeRequests.set(requestId, { resolve, reject, timer });

      for (const frame of frames) {
        try {
          frame.contentWindow.postMessage(message, '*');
        } catch {
          // Keep sending to other candidate frames.
        }
      }
    });
  }

  function installBridgeWorker() {
    if (bridgeWorkerInstalled) {
      return;
    }

    bridgeWorkerInstalled = true;
    window.addEventListener('message', async (event) => {
      const message = event.data;
      if (!message || message.source !== BRIDGE_SOURCE || message.direction !== 'request') {
        return;
      }

      const reply = (payload, error) => {
        if (event.source && typeof event.source.postMessage === 'function') {
          event.source.postMessage({
            source: BRIDGE_SOURCE,
            direction: 'reply',
            requestId: message.requestId,
            payload,
            error: error ? String(error.message || error) : ''
          }, '*');
        }
      };

      try {
        if (message.type === 'detect') {
          reply(hasHomeworkFrame() ? await requestHomeworkFrame('detect') : summarizeCurrentPageControls());
          return;
        }

        if (message.type === 'fill') {
          reply(hasHomeworkFrame() ? await requestHomeworkFrame('fill', message.payload) : fillCurrentPage(message.payload && message.payload.values ? message.payload.values : []));
          return;
        }

        if (message.type === 'clear') {
          reply(hasHomeworkFrame() ? await requestHomeworkFrame('clear') : clearLastFilledControls());
          return;
        }

        if (message.type === 'pageText') {
          reply(hasHomeworkFrame() ? await requestHomeworkFrame('pageText') : buildCurrentPageTextSummary());
          return;
        }
      } catch (error) {
        reply(null, error);
      }
    });
  }

  async function getDetectionSummary() {
    if (getAutofillFrameMode() === 'controller') {
      try {
        return await requestHomeworkFrame('detect');
      } catch (error) {
        return {
          controlCount: 0,
          labels: [],
          error: error && error.message ? error.message : '无法连接作业 iframe。'
        };
      }
    }

    return summarizeCurrentPageControls();
  }

  async function fillDetectedPage(values) {
    if (getAutofillFrameMode() === 'controller') {
      return requestHomeworkFrame('fill', { values });
    }

    return fillCurrentPage(values);
  }

  async function clearDetectedPage() {
    if (getAutofillFrameMode() === 'controller') {
      return requestHomeworkFrame('clear');
    }

    return clearLastFilledControls();
  }

  async function getControlsForDoubao() {
    if (getAutofillFrameMode() === 'controller') {
      const summary = await getDetectionSummary();
      return (summary.labels || []).map((label) => ({ label }));
    }

    return discoverControls();
  }

  async function getPageTextForDoubao() {
    if (getAutofillFrameMode() === 'controller') {
      try {
        return await requestHomeworkFrame('pageText');
      } catch {
        return '';
      }
    }

    return buildCurrentPageTextSummary();
  }

  function getStoredValuesText() {
    return GM_getValue(STORAGE_KEY, '');
  }

  function setStoredValuesText(text) {
    GM_setValue(STORAGE_KEY, String(text || ''));
  }

  function getStoredDoubaoSource() {
    return GM_getValue(DOUBAO_SOURCE_STORAGE_KEY, '');
  }

  function setStoredDoubaoSource(text) {
    GM_setValue(DOUBAO_SOURCE_STORAGE_KEY, String(text || ''));
  }

  function setStoredDoubaoPrompt(text) {
    GM_setValue(DOUBAO_PROMPT_STORAGE_KEY, String(text || ''));
    GM_setValue(DOUBAO_PROMPT_TIME_STORAGE_KEY, Date.now());
  }

  function getStoredDoubaoPrompt() {
    return GM_getValue(DOUBAO_PROMPT_STORAGE_KEY, '');
  }

  function clearStoredDoubaoPrompt() {
    GM_setValue(DOUBAO_PROMPT_STORAGE_KEY, '');
    GM_setValue(DOUBAO_PROMPT_TIME_STORAGE_KEY, 0);
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483647',
      'padding:10px 12px',
      'max-width:360px',
      'font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'color:#fff',
      'background:#1f2937',
      'border-radius:6px',
      'box-shadow:0 8px 24px rgba(0,0,0,.24)'
    ].join(';');
    document.documentElement.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4200);
  }

  function createButton(text, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', onClick);
    button.style.cssText = [
      'border:0',
      'border-radius:5px',
      'padding:6px 9px',
      'font:13px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'cursor:pointer',
      'color:#fff',
      'background:#2563eb'
    ].join(';');
    return button;
  }

  function isDoubaoChatPage() {
    return /(^|\.)doubao\.com$/i.test(window.location.hostname);
  }

  function dispatchTextInputEvents(element, text) {
    try {
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));
    } catch {
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }

    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setTextControlValue(element, text) {
    const proto = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(element, text);
    } else {
      element.value = text;
    }
  }

  function fillEditableElement(element, text) {
    element.focus();

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      setTextControlValue(element, text);
      dispatchTextInputEvents(element, text);
      return true;
    }

    if (element.isContentEditable || element.getAttribute('role') === 'textbox') {
      element.textContent = text;
      dispatchTextInputEvents(element, text);
      return true;
    }

    return false;
  }

  function findDoubaoChatInput() {
    const selectors = [
      'textarea:not([disabled]):not([readonly])',
      'input[type="text"]:not([disabled]):not([readonly])',
      '[contenteditable="true"]',
      '[role="textbox"]'
    ];

    const candidates = selectors
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .filter((element) => !isOwnUiElement(element) && isVisible(element));

    return candidates.length > 0 ? candidates[candidates.length - 1] : null;
  }

  function fillDoubaoPromptInput(promptText) {
    const input = findDoubaoChatInput();
    if (!input) {
      return false;
    }

    return fillEditableElement(input, promptText);
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }

    return false;
  }

  function openDoubaoChat(promptText) {
    setStoredDoubaoPrompt(promptText);
    const opened = window.open(DOUBAO_CHAT_URL, '_blank', 'noopener');
    if (!opened) {
      showToast('浏览器拦截了新窗口，请允许弹窗后再试。');
      return;
    }

    showToast('已打开豆包网页，提示词会尽量自动放进输入框。');
  }

  function installDoubaoChatBridge() {
    const promptText = getStoredDoubaoPrompt();
    if (!promptText) {
      return;
    }

    document.getElementById(DOUBAO_PANEL_ID)?.remove();

    const panel = document.createElement('section');
    panel.id = DOUBAO_PANEL_ID;
    panel.style.cssText = [
      'position:fixed',
      'right:16px',
      'top:72px',
      'z-index:2147483647',
      'width:320px',
      'max-width:calc(100vw - 32px)',
      'background:#fff',
      'color:#111827',
      'border:1px solid #d1d5db',
      'border-radius:8px',
      'box-shadow:0 18px 48px rgba(0,0,0,.2)',
      'font:13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    ].join(';');

    const header = document.createElement('div');
    header.textContent = '顺序填空：豆包网页';
    header.style.cssText = 'padding:10px 12px;font-weight:700;border-bottom:1px solid #e5e7eb;cursor:move;user-select:none;';
    makePanelDraggable(panel, header);

    const preview = document.createElement('textarea');
    preview.value = promptText;
    preview.readOnly = true;
    preview.style.cssText = [
      'box-sizing:border-box',
      'width:calc(100% - 24px)',
      'height:140px',
      'margin:12px',
      'resize:vertical',
      'padding:8px',
      'border:1px solid #d1d5db',
      'border-radius:6px',
      'font:12px/1.45 Consolas,monospace',
      'background:#f9fafb'
    ].join(';');

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:0 12px 12px;';

    const insertButton = createButton('填入输入框', () => {
      if (fillDoubaoPromptInput(promptText)) {
        showToast('已放入豆包输入框，检查后手动发送。');
      } else {
        showToast('没找到豆包输入框，请等页面加载后再点一次。');
      }
    });

    const copyButton = createButton('复制提示词', async () => {
      try {
        const copied = await copyTextToClipboard(promptText);
        showToast(copied ? '提示词已复制。' : '当前浏览器不允许自动复制，请手动复制文本框内容。');
      } catch {
        showToast('复制失败，请手动复制文本框内容。');
      }
    });
    copyButton.style.background = '#6b7280';

    const clearButton = createButton('清除', () => {
      clearStoredDoubaoPrompt();
      panel.remove();
      showToast('已清除豆包提示词。');
    });
    clearButton.style.background = '#374151';

    actions.append(insertButton, copyButton, clearButton);
    panel.append(header, preview, actions);
    document.documentElement.appendChild(panel);

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (fillDoubaoPromptInput(promptText) || attempts >= 20) {
        window.clearInterval(timer);
        if (attempts < 20) {
          showToast('已放入豆包输入框，检查后手动发送。');
        }
      }
    }, 700);
  }

  function updateFloatingButton() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) {
      return;
    }

    if (getAutofillFrameMode() === 'controller') {
      getDetectionSummary().then((summary) => {
        const nextText = formatFloatingButtonText(summary.controlCount || 0);
        if (button.textContent !== nextText) {
          button.textContent = nextText;
        }
      });
      return;
    }

    const nextText = formatFloatingButtonText(discoverControls().length);
    if (button.textContent !== nextText) {
      button.textContent = nextText;
    }
  }

  function refreshLiveDetection() {
    updateFloatingButton();

    if (typeof activePanelRefresh === 'function') {
      activePanelRefresh();
    }
  }

  function scheduleLiveRefresh() {
    window.clearTimeout(liveRefreshTimer);
    liveRefreshTimer = window.setTimeout(refreshLiveDetection, 180);
  }

  function installLiveDetection() {
    if (liveDetectionObserver) {
      return;
    }

    liveDetectionObserver = new MutationObserver(scheduleLiveRefresh);
    liveDetectionObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'disabled', 'readonly', 'aria-hidden']
    });
    document.addEventListener('input', scheduleLiveRefresh, true);
    document.addEventListener('change', scheduleLiveRefresh, true);
  }

  function makePanelDraggable(panel, handle) {
    let dragState = null;

    handle.addEventListener('pointerdown', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.button !== 0 || (target && target.closest('button,input,textarea,select,summary'))) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top
      };

      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener('pointermove', (event) => {
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      const maxLeft = Math.max(0, window.innerWidth - rect.width);
      const maxTop = Math.max(0, window.innerHeight - rect.height);
      const nextLeft = Math.min(Math.max(0, dragState.left + event.clientX - dragState.startX), maxLeft);
      const nextTop = Math.min(Math.max(0, dragState.top + event.clientY - dragState.startY), maxTop);
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    });

    handle.addEventListener('pointerup', (event) => {
      if (dragState && dragState.pointerId === event.pointerId) {
        dragState = null;
        handle.releasePointerCapture(event.pointerId);
      }
    });

    handle.addEventListener('pointercancel', () => {
      dragState = null;
    });
  }

  function openPanel() {
    document.getElementById(PANEL_ID)?.remove();

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed',
      'right:16px',
      'top:72px',
      'z-index:2147483647',
      'width:360px',
      'max-width:calc(100vw - 32px)',
      'background:#fff',
      'color:#111827',
      'border:1px solid #d1d5db',
      'border-radius:8px',
      'box-shadow:0 18px 48px rgba(0,0,0,.2)',
      'font:13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    ].join(';');

    const header = document.createElement('div');
    header.textContent = '顺序填空';
    header.style.cssText = 'padding:10px 12px;font-weight:700;border-bottom:1px solid #e5e7eb;cursor:move;user-select:none;';
    makePanelDraggable(panel, header);

    const textarea = document.createElement('textarea');
    textarea.value = getStoredValuesText();
    textarea.placeholder = '一行一个内容，例如：\n张三\n13800000000\nzhangsan@example.com';
    textarea.style.cssText = [
      'box-sizing:border-box',
      'width:calc(100% - 24px)',
      'height:180px',
      'margin:12px',
      'resize:vertical',
      'padding:8px',
      'border:1px solid #d1d5db',
      'border-radius:6px',
      'font:13px/1.45 Consolas,monospace',
      'color:#111827',
      'background:#fff'
    ].join(';');

    const status = document.createElement('div');
    status.style.cssText = 'padding:0 12px 10px;color:#4b5563;';

    const preview = document.createElement('pre');
    preview.style.cssText = [
      'box-sizing:border-box',
      'width:calc(100% - 24px)',
      'max-height:110px',
      'margin:0 12px 12px',
      'overflow:auto',
      'white-space:pre-wrap',
      'padding:8px',
      'border:1px solid #e5e7eb',
      'border-radius:6px',
      'font:12px/1.45 Consolas,monospace',
      'color:#374151',
      'background:#f9fafb'
    ].join(';');

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:0 12px 12px;';

    let refreshStatusId = 0;

    async function refreshStatus() {
      const currentRefreshId = refreshStatusId += 1;
      const values = parseValuesText(textarea.value);
      const summary = await getDetectionSummary();

      if (currentRefreshId !== refreshStatusId) {
        return;
      }

      const labels = summary.labels || [];
      const nextStatus = formatDetectionStatus(summary.controlCount || 0, values.length);
      const nextPreview = summary.error
        ? summary.error
        : labels.length > 0
          ? labels.slice(0, 20).map((label, index) => `${index + 1}. ${label}`).join('\n')
          : '未检测到可填空格';

      if (status.textContent !== nextStatus) {
        status.textContent = nextStatus;
      }

      if (preview.textContent !== nextPreview) {
        preview.textContent = nextPreview;
      }

      updateFloatingButton();
    }

    textarea.addEventListener('input', refreshStatus);

    const saveButton = createButton('保存内容', () => {
      setStoredValuesText(textarea.value);
      refreshStatus();
      showToast('内容已保存到 Tampermonkey 存储。');
    });

    const fillButton = createButton('填入当前页', async () => {
      const values = parseValuesText(textarea.value);
      if (values.length === 0) {
        showToast('没有可填内容，请先粘贴一行一个的内容。');
        return;
      }

      setStoredValuesText(textarea.value);
      fillButton.disabled = true;
      fillButton.textContent = '填入中...';

      try {
        const report = await fillDetectedPage(values);
        refreshStatus();
        showToast(`已填 ${report.filled} 个；剩余空格 ${report.remainingControls} 个；未用内容 ${report.unusedValues} 行。`);
      } catch (error) {
        showToast(error && error.message ? error.message : '填入失败。');
      } finally {
        fillButton.disabled = false;
        fillButton.textContent = '填入当前页';
      }
    });

    const clearFilledButton = createButton('清除已填写', async () => {
      clearFilledButton.disabled = true;
      clearFilledButton.textContent = '清除中...';

      try {
        const report = await clearDetectedPage();
        refreshStatus();
        showToast(report.cleared > 0
          ? `已清除 ${report.cleared} 个由脚本填写的内容。`
          : '没有可清除的已填写内容。');
      } catch (error) {
        showToast(error && error.message ? error.message : '清除已填写内容失败。');
      } finally {
        clearFilledButton.disabled = false;
        clearFilledButton.textContent = '清除已填写';
      }
    });
    clearFilledButton.style.background = '#b45309';

    const clearButton = createButton('清空保存', () => {
      textarea.value = '';
      setStoredValuesText('');
      refreshStatus();
      showToast('已清空保存内容。');
    });
    clearButton.style.background = '#6b7280';

    const doubaoBox = document.createElement('details');
    doubaoBox.style.cssText = 'margin:0 12px 12px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;';

    const doubaoSummary = document.createElement('summary');
    doubaoSummary.textContent = '豆包网页聊天';
    doubaoSummary.style.cssText = 'padding:8px;cursor:pointer;font-weight:600;';

    const doubaoSourceTextarea = document.createElement('textarea');
    doubaoSourceTextarea.value = getStoredDoubaoSource();
    doubaoSourceTextarea.placeholder = '可粘贴题目/原文，也可以点“获取当前页文字”';
    doubaoSourceTextarea.style.cssText = [
      'box-sizing:border-box',
      'width:calc(100% - 16px)',
      'height:116px',
      'margin:0 8px 8px',
      'resize:vertical',
      'padding:7px',
      'border:1px solid #d1d5db',
      'border-radius:5px',
      'font:12px/1.45 Consolas,monospace',
      'background:#fff'
    ].join(';');

    const doubaoActions = document.createElement('div');
    doubaoActions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:0 8px 8px;';

    const doubaoSaveButton = createButton('保存素材', () => {
      setStoredDoubaoSource(doubaoSourceTextarea.value);
      showToast('豆包素材已保存。');
    });
    doubaoSaveButton.style.background = '#6b7280';

    const capturePageButton = createButton('获取当前页文字', async () => {
      capturePageButton.disabled = true;
      capturePageButton.textContent = '获取中...';

      try {
        const pageText = await getPageTextForDoubao();
        if (!pageText) {
          showToast('没有获取到页面文字，可以手动粘贴。');
          return;
        }

        doubaoSourceTextarea.value = pageText;
        setStoredDoubaoSource(pageText);
        showToast('已获取当前页文字。');
      } catch (error) {
        showToast(error && error.message ? error.message : '获取当前页文字失败。');
      } finally {
        capturePageButton.disabled = false;
        capturePageButton.textContent = '获取当前页文字';
      }
    });
    capturePageButton.style.background = '#0f766e';

    const doubaoSendButton = createButton('发到豆包网页', async () => {
      doubaoSendButton.disabled = true;
      doubaoSendButton.textContent = '准备中...';

      try {
        const controls = await getControlsForDoubao();
        const rawText = doubaoSourceTextarea.value.trim() || await getPageTextForDoubao();

        if (controls.length === 0) {
          showToast('当前页面没有检测到可填空格。');
          return;
        }

        if (!rawText) {
          showToast('没有题目/原文内容，请先获取当前页文字或手动粘贴。');
          return;
        }

        setStoredDoubaoSource(rawText);
        doubaoSourceTextarea.value = rawText;
        openDoubaoChat(buildDoubaoWebPrompt(rawText, controls));
      } catch (error) {
        showToast(error && error.message ? error.message : '打开豆包网页失败。');
      } finally {
        doubaoSendButton.disabled = false;
        doubaoSendButton.textContent = '发到豆包网页';
      }
    });

    doubaoActions.append(capturePageButton, doubaoSaveButton, doubaoSendButton);
    doubaoBox.append(doubaoSummary, doubaoSourceTextarea, doubaoActions);

    const closeButton = createButton('关闭', () => {
      if (activePanelRefresh === refreshStatus) {
        activePanelRefresh = null;
      }
      panel.remove();
    });
    closeButton.style.background = '#374151';

    actions.append(saveButton, fillButton, clearFilledButton, clearButton, closeButton);
    panel.append(header, textarea, status, preview, doubaoBox, actions);
    document.documentElement.appendChild(panel);
    activePanelRefresh = refreshStatus;
    refreshStatus();
    textarea.focus();
  }

  function createFloatingButton() {
    if (document.getElementById(BUTTON_ID)) {
      return;
    }

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = formatFloatingButtonText(discoverControls().length);
    button.addEventListener('click', openPanel);
    button.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:2147483646',
      'border:0',
      'border-radius:8px',
      'padding:8px 10px',
      'font:13px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'cursor:pointer',
      'color:#fff',
      'background:#2563eb',
      'box-shadow:0 8px 24px rgba(0,0,0,.2)'
    ].join(';');
    document.documentElement.appendChild(button);
  }

  function start() {
    if (isDoubaoChatPage()) {
      installDoubaoChatBridge();
      return;
    }

    const mode = getAutofillFrameMode();

    if (mode === 'off') {
      return;
    }

    if (mode === 'worker') {
      installBridgeWorker();
      return;
    }

    installBridgeController();
    GM_registerMenuCommand('顺序填空：打开面板', openPanel);
    GM_registerMenuCommand('顺序填空：直接填入保存内容', async () => {
      const values = parseValuesText(getStoredValuesText());
      if (values.length === 0) {
        showToast('没有保存内容，请先打开面板粘贴内容。');
        return;
      }

      try {
        const report = await fillDetectedPage(values);
        showToast(`已填 ${report.filled} 个；剩余空格 ${report.remainingControls} 个；未用内容 ${report.unusedValues} 行。`);
      } catch (error) {
        showToast(error && error.message ? error.message : '填入失败。');
      }
    });
    createFloatingButton();
    installLiveDetection();
    scheduleLiveRefresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
