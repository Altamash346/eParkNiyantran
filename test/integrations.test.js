const test = require('node:test');
const assert = require('node:assert');
const {
  queryMastersIndiaVahan,
  sendSmsViaGateway,
  createRazorpayOrder,
  verifyRazorpaySignature,
  getApiSettings,
  saveApiSettings
} = require('../integrations');

test('Masters India VAHAN API: detects verified existing vehicle', async () => {
  const result = await queryMastersIndiaVahan('MH12AB1234');
  assert.strictEqual(result.exists, true, 'Vehicle should exist on VAHAN');
  assert.strictEqual(result.plate, 'MH12AB1234');
  assert.strictEqual(result.data.owner, 'Sanket Sondkar');
  assert.strictEqual(result.data.category, '4W');
  assert.ok(result.endpointUsed.includes('https://api-platform.mastersindia.co/api/v2/sbt/VAHAN/'));
});

test('Masters India VAHAN API: detects NON-EXISTENT vehicle and flags counterfeit/fake', async () => {
  const result = await queryMastersIndiaVahan('FAKE99XX0000');
  assert.strictEqual(result.exists, false, 'Fake plate must not exist');
  assert.strictEqual(result.data, null);
  assert.ok(result.error.includes('does not exist on VAHAN national registry'));
});

test('SMS Gateway: dispatches DLT-compliant message and saves record', async () => {
  const sms = await sendSmsViaGateway('TEST-SES-001', '+91 98230 12345', 'ENTRY_WELCOME', 'Welcome MH12AB1234! Slot 4W-01 allocated.');
  assert.ok(sms.notificationId.startsWith('SMS-'));
  assert.strictEqual(sms.status, 'SENT');
  assert.strictEqual(sms.dltTemplateId, 'DLT-TMPL-ENTRY-01');
});

test('Razorpay Payment Gateway: creates order and validates HMAC signature', async () => {
  const order = await createRazorpayOrder('SES-TEST-123', 250, 'MH12AB1234');
  assert.strictEqual(order.success, true);
  assert.strictEqual(order.amount, 250);
  assert.strictEqual(order.amountInPaise, 25000);
  assert.ok(order.orderId.startsWith('order_'));

  // Valid signature verification
  const verification = verifyRazorpaySignature(order.orderId, 'pay_12345678', 'sig_valid_test_hash');
  assert.strictEqual(verification.valid, true);
});

test('Gateway Settings: persists and retrieves configuration', () => {
  const current = getApiSettings();
  assert.ok(current.vahan.endpointUrl);
  assert.ok(current.sms.provider);
  assert.ok(current.payment.provider);

  const updated = saveApiSettings({
    vahan: { ...current.vahan, mode: 'auto' },
    sms: { ...current.sms, senderId: 'PARKNG' },
    payment: { ...current.payment, mode: 'test' }
  });
  assert.strictEqual(updated.sms.senderId, 'PARKNG');
});
