const { test } = require('node:test');
const assert = require('node:assert');
const { processOcrCandidate, recognizePlateFromImage } = require('../ocr');

test('OCR: extracts candidate plates and validates format', () => {
  const r1 = processOcrCandidate('MH12AB1234');
  assert.strictEqual(r1.success, true);
  assert.strictEqual(r1.normalized, 'MH12AB1234');
  assert.strictEqual(r1.formatted, 'MH 12 AB 1234');

  const r2 = processOcrCandidate('dl01ca9988');
  assert.strictEqual(r2.success, true);
  assert.strictEqual(r2.normalized, 'DL01CA9988');

  // OCR position heuristics (O -> 0, I -> 1)
  const r3 = processOcrCandidate('MH12ABI234');
  assert.strictEqual(r3.normalized, 'MH12AB1234');
});

test('OCR: image recognition extracts embedded plate metadata', () => {
  const simulatedImage = 'data:image/jpeg;name=KA05MJ4020;base64,/9j/4AAQSkZJRg==';
  const res = recognizePlateFromImage(simulatedImage, 'CAMERA');
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.plate, 'KA05MJ4020');
  assert.strictEqual(res.ocr.registrationState, 'KA');
});

test('OCR: returns graceful failure on blank or textless images', () => {
  const blankImage = 'data:image/png;base64,iVBORw0KGgo=';
  const res = recognizePlateFromImage(blankImage, 'UPLOAD');
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.plate, '');
  assert.ok(res.ocr.error.includes('No text could be extracted'));
});
