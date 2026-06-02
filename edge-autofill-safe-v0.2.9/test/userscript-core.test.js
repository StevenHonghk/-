import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOUBAO_CHAT_URL,
  buildDoubaoWebPrompt,
  buildPageInfoSummary,
  formatDetectionStatus,
  formatFloatingButtonText,
  parseValuesText,
  planSequentialFill,
  preferAnswerContainerControls,
  preferAnswerEditorControls,
  preferNumberedBlankControls
} from '../src/userscript-core.js';

test('parses pasted values as one non-empty value per line', () => {
  assert.deepEqual(
    parseValuesText('张三\r\n\r\n  13800000000  \nzhangsan@example.com\n'),
    ['张三', '13800000000', 'zhangsan@example.com']
  );
});

test('plans sequential fill for empty safe controls only', () => {
  const controls = [
    { label: 'name', value: '', disabled: false, readOnly: false, visible: true, type: 'text' },
    { label: 'password', value: '', disabled: false, readOnly: false, visible: true, type: 'password' },
    { label: 'already', value: 'keep', disabled: false, readOnly: false, visible: true, type: 'text' },
    { label: 'phone', value: '', disabled: false, readOnly: false, visible: true, type: 'tel' }
  ];

  const plan = planSequentialFill(controls, ['张三', '13800000000', 'extra']);

  assert.deepEqual(plan.assignments, [
    { control: controls[0], value: '张三' },
    { control: controls[3], value: '13800000000' }
  ]);
  assert.deepEqual(plan.unusedValues, ['extra']);
  assert.deepEqual(plan.remainingControls, []);
});

test('treats empty UEditor controls as fillable even when backing textarea is hidden', () => {
  const controls = [
    { label: 'rich blank', value: '', disabled: false, readOnly: false, visible: false, type: 'ueditor', editor: true },
    { label: 'rich filled', value: 'keep', disabled: false, readOnly: false, visible: false, type: 'ueditor', editor: true }
  ];

  const plan = planSequentialFill(controls, ['富文本答案']);

  assert.deepEqual(plan.assignments, [
    { control: controls[0], value: '富文本答案' }
  ]);
});

test('prefers numbered answer blanks over other page controls', () => {
  const controls = [
    { label: 'audio keyword', value: '', disabled: false, readOnly: false, visible: true, type: 'text' },
    { label: '第2空:', value: '', disabled: false, readOnly: false, visible: true, type: 'text' },
    { label: '第1空:', value: '', disabled: false, readOnly: false, visible: true, type: 'text' },
    { label: 'comment box', value: '', disabled: false, readOnly: false, visible: true, type: 'text' }
  ];

  assert.deepEqual(preferNumberedBlankControls(controls), [controls[2], controls[1]]);

  const plan = planSequentialFill(controls, ['first', 'second', 'unused']);
  assert.deepEqual(plan.assignments, [
    { control: controls[2], value: 'first' },
    { control: controls[1], value: 'second' }
  ]);
  assert.deepEqual(plan.unusedValues, ['unused']);
}
);

test('prefers controls inside inpDiv answer containers', () => {
  const controls = [
    { label: 'search', value: '', disabled: false, readOnly: false, visible: true, type: 'text' },
    { label: '第2空:', value: '', disabled: false, readOnly: false, visible: true, type: 'text', containerId: 'inpDiv4054115671ebd7b8d-c6f7-4bf2-886e-4d51821119061' },
    { label: '第1空:', value: '', disabled: false, readOnly: false, visible: true, type: 'text', containerId: 'inpDiv4054115671ebd7b8d-c6f7-4bf2-886e-4d51821119061' }
  ];

  assert.deepEqual(preferAnswerContainerControls(controls), [controls[1], controls[2]]);

  const plan = planSequentialFill(controls, ['first', 'second']);
  assert.deepEqual(plan.assignments, [
    { control: controls[2], value: 'first' },
    { control: controls[1], value: 'second' }
  ]);
});

test('prefers answerEditor textareas in document order over other rules', () => {
  const controls = [
    { label: 'page search', value: '', disabled: false, readOnly: false, visible: true, type: 'text' },
    { label: '第2空:', value: '', disabled: false, readOnly: false, visible: true, type: 'textarea', isAnswerEditor: true },
    { label: '第1空:', value: '', disabled: false, readOnly: false, visible: true, type: 'textarea', isAnswerEditor: true },
    { label: '第3空:', value: '', disabled: false, readOnly: false, visible: true, type: 'text', containerId: 'inpDiv4054115671ebd7b8d-c6f7-4bf2-886e-4d51821119061' }
  ];

  assert.deepEqual(preferAnswerEditorControls(controls), [controls[1], controls[2]]);

  const plan = planSequentialFill(controls, ['first', 'second', 'unused']);
  assert.deepEqual(plan.assignments, [
    { control: controls[1], value: 'first' },
    { control: controls[2], value: 'second' }
  ]);
  assert.deepEqual(plan.unusedValues, ['unused']);
});

test('keeps extra empty controls as remaining controls', () => {
  const controls = [
    { label: 'name', value: '', disabled: false, readOnly: false, visible: true, type: 'text' },
    { label: 'phone', value: '', disabled: false, readOnly: false, visible: true, type: 'tel' }
  ];

  const plan = planSequentialFill(controls, ['张三']);

  assert.equal(plan.assignments.length, 1);
  assert.deepEqual(plan.remainingControls, [controls[1]]);
});

test('builds a Doubao web prompt for ordered blank assistance', () => {
  const prompt = buildDoubaoWebPrompt({
    rawText: '姓名：张三\n电话：13800000000',
    controls: [
      { label: '姓名' },
      { label: '电话' }
    ]
  });

  assert.match(prompt, /只输出每个空要填写的内容/);
  assert.match(prompt, /不要编号/);
  assert.match(prompt, /1\. 姓名/);
  assert.match(prompt, /2\. 电话/);
  assert.match(prompt, /张三/);
  assert.match(prompt, /13800000000/);
  assert.doesNotMatch(prompt, /API|接口地址|Key/i);
});

test('uses the Doubao public web chat URL, not an API endpoint', () => {
  const url = new URL(DOUBAO_CHAT_URL);
  assert.equal(url.hostname, 'www.doubao.com');
  assert.doesNotMatch(DOUBAO_CHAT_URL, /api|ark|volces/i);
});

test('builds redacted page info summaries for manual chat context', () => {
  const summary = buildPageInfoSummary({
    title: 'Unit 6 作业',
    url: 'https://example.com/mooc-ans/work/doHomeWorkNew?courseId=123&userId=456#top',
    frameMode: 'worker',
    iframeUrls: [
      'https://example.com/mooc-ans/work/doHomeWorkNew?courseId=123',
      'javascript:false'
    ],
    controlCount: 2,
    labels: ['第1空', '第2空']
  });

  assert.match(summary, /标题: Unit 6 作业/);
  assert.match(summary, /页面: https:\/\/example.com\/mooc-ans\/work\/doHomeWorkNew/);
  assert.match(summary, /运行模式: worker/);
  assert.match(summary, /可填空格: 2/);
  assert.match(summary, /1\. 第1空/);
  assert.doesNotMatch(summary, /courseId|userId|123|456|#top|javascript/);
});

test('formats live detection status and button text', () => {
  assert.equal(formatDetectionStatus(10, 8), '实时检测：可填空格 10 个，内容 8 行。');
  assert.equal(formatFloatingButtonText(0), '填空');
  assert.equal(formatFloatingButtonText(10), '填空(10)');
});

test('chooses the right frame mode for homework iframe pages', async () => {
  const { getAutofillFrameMode, shouldRunInFrame } = await import('../src/userscript-core.js');

  assert.equal(getAutofillFrameMode({
    isTopFrame: false,
    url: 'https://example.com/mooc-ans/work/doHomeWorkNew?courseId=1',
    answerEditorCount: 0,
    hasHomeworkFrame: false
  }), 'worker');

  assert.equal(getAutofillFrameMode({
    isTopFrame: false,
    url: 'https://example.com/other-frame',
    answerEditorCount: 0,
    hasHomeworkFrame: false
  }), 'off');

  assert.equal(getAutofillFrameMode({
    isTopFrame: true,
    url: 'https://example.com/mooc-ans/work/index',
    answerEditorCount: 0,
    hasHomeworkFrame: true
  }), 'controller');

  assert.equal(getAutofillFrameMode({
    isTopFrame: true,
    url: 'https://example.com/form',
    answerEditorCount: 0,
    hasHomeworkFrame: false
  }), 'local');

  assert.equal(shouldRunInFrame({
    isTopFrame: true,
    url: 'https://example.com/mooc-ans/work/index',
    answerEditorCount: 0,
    hasHomeworkFrame: true
  }), true);
});
