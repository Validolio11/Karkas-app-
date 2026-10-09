import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordedTaskSeconds, summarizeTaskTime, formatRecordedDuration } from './taskTimeStats';

test('missing zero malformed and partial-second readings remain unmeasured', () => {
  for (const timeSpentSeconds of [undefined, 0, -1, NaN, Infinity, 0.5]) assert.equal(recordedTaskSeconds({ timeSpentSeconds }), null);
  assert.equal(recordedTaskSeconds({ timeSpentSeconds: 61.9 }), 61);
});
test('completed-work coverage averages only measured samples and never treats missing work as zero', () => {
  const completedReadings = [{ timeSpentSeconds: 60 }, {}, { timeSpentSeconds: 0 }, { timeSpentSeconds: 180 }];
  assert.deepEqual(summarizeTaskTime(completedReadings), { measuredTasks: 2, unmeasuredTasks: 2, totalSeconds: 240, averageSeconds: 120 });
  assert.deepEqual(summarizeTaskTime([{}, { timeSpentSeconds: 0 }]), { measuredTasks: 0, unmeasuredTasks: 2, totalSeconds: 0, averageSeconds: null });
  assert.deepEqual(summarizeTaskTime([]), { measuredTasks: 0, unmeasuredTasks: 0, totalSeconds: 0, averageSeconds: null });
});
test('readable durations distinguish unknown time from recorded seconds', () => {
  assert.equal(formatRecordedDuration(null, 'en'), 'Not measured');
  assert.equal(formatRecordedDuration(59, 'en'), '59 s');
  assert.equal(formatRecordedDuration(125, 'en'), '2 m 5 s');
  assert.equal(formatRecordedDuration(3660, 'en'), '1 h 1 m');
});
