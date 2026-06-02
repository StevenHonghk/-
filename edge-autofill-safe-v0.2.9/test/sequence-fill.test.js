import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSequenceAssignments,
  formatSequenceReport
} from '../src/sequence-fill.js';

const controls = [
  { index: 0, label: '姓名', selector: 'input:nth-of-type(1)' },
  { index: 1, label: '电话', selector: 'input:nth-of-type(2)' },
  { index: 2, label: '邮箱', selector: 'input:nth-of-type(3)' }
];

test('assigns values to detected controls in order', () => {
  const result = buildSequenceAssignments(controls, ['张三', '13800000000']);

  assert.deepEqual(result.assignments, [
    { control: controls[0], value: '张三' },
    { control: controls[1], value: '13800000000' }
  ]);
  assert.deepEqual(result.remainingControls, [controls[2]]);
  assert.deepEqual(result.unusedValues, []);
});

test('reports extra values without assigning them', () => {
  const result = buildSequenceAssignments(controls.slice(0, 1), ['张三', 'extra']);

  assert.equal(result.assignments.length, 1);
  assert.deepEqual(result.unusedValues, ['extra']);
});

test('formats sequence fill report with mismatch warnings', () => {
  const report = formatSequenceReport({
    filled: [
      { label: '姓名', valuePreview: '张三' }
    ],
    remainingControls: [
      { label: '邮箱' }
    ],
    unusedValues: ['extra']
  });

  assert.match(report, /Filled: 1/);
  assert.match(report, /Empty controls left: 1/);
  assert.match(report, /Unused values: 1/);
  assert.match(report, /姓名/);
  assert.match(report, /邮箱/);
});
