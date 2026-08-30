import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidEmail, localDateTimeInputValue, parseRecipientText } from './recipients';

test('parses, deduplicates, and reports malformed recipient values', () => {
  assert.deepEqual(parseRecipientText('one@example.com, two@example.com\none@example.com bad@'), {
    recipients: ['one@example.com', 'two@example.com'],
    malformed: ['bad@'],
  });
});

test('validates email values and formats local datetime inputs', () => {
  assert.equal(isValidEmail('person@example.com'), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(localDateTimeInputValue(new Date(2026, 0, 2, 3, 4)), '2026-01-02T03:04');
});
