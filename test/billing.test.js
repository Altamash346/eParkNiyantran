const test = require('node:test');
const assert = require('node:assert');
const { calculateParkingCharge, calculateOverdueFine, checkFiveMinuteReminder } = require('../billing');

test('Tariff Boundary: 14:59 (< 15 min - Nil or ₹50 if pending fine)', () => {
  const normal = calculateParkingCharge(14 * 60 + 59, false, '4W');
  assert.strictEqual(normal.basicCharge, 0, '14:59 basic charge should be 0');
  assert.strictEqual(normal.tierLabel, '< 15 minutes');
  assert.strictEqual(normal.appliesBan, false);

  const withFine = calculateParkingCharge(14 * 60 + 59, true, '4W');
  assert.strictEqual(withFine.basicCharge, 50, '14:59 with pending fine should be 50');
  assert.strictEqual(withFine.appliesBan, false);
});

test('Tariff Boundary: 15:00 (Transition to Up to 60 minutes - ₹100 or ₹200 if fine)', () => {
  const normal = calculateParkingCharge(15 * 60, false, '4W');
  assert.strictEqual(normal.basicCharge, 100, '15:00 basic charge should be 100');
  assert.strictEqual(normal.tierLabel, 'Up to 60 minutes');
  assert.strictEqual(normal.appliesBan, false);

  const withFine = calculateParkingCharge(15 * 60, true, '4W');
  assert.strictEqual(withFine.basicCharge, 200, '15:00 with pending fine should be 200');
});

test('Tariff Boundary: 60:00 (Upper limit of Up to 60 minutes - ₹100)', () => {
  const normal = calculateParkingCharge(60 * 60, false, '4W');
  assert.strictEqual(normal.basicCharge, 100, '60:00 basic charge should be 100');
  assert.strictEqual(normal.tierLabel, 'Up to 60 minutes');

  const withFine = calculateParkingCharge(60 * 60, true, '4W');
  assert.strictEqual(withFine.basicCharge, 200, '60:00 with pending fine should be 200');
});

test('Tariff Boundary: 60:01 (Transition to Up to 90 minutes - ₹250 or ₹500 if fine)', () => {
  const normal = calculateParkingCharge(60 * 60 + 1, false, '4W');
  assert.strictEqual(normal.basicCharge, 250, '60:01 basic charge should be 250');
  assert.strictEqual(normal.tierLabel, 'Up to 90 minutes');

  const withFine = calculateParkingCharge(60 * 60 + 1, true, '4W');
  assert.strictEqual(withFine.basicCharge, 500, '60:01 with fine should be 500');
});

test('Tariff Boundary: 90:00 (Upper limit of Up to 90 minutes - ₹250)', () => {
  const normal = calculateParkingCharge(90 * 60, false, '4W');
  assert.strictEqual(normal.basicCharge, 250, '90:00 basic charge should be 250');
  assert.strictEqual(normal.tierLabel, 'Up to 90 minutes');

  const withFine = calculateParkingCharge(90 * 60, true, '4W');
  assert.strictEqual(withFine.basicCharge, 500, '90:00 with fine should be 500');
});

test('Tariff Boundary: 180:00 (Upper limit of Up to 180 minutes - ₹500, no ban)', () => {
  const normal = calculateParkingCharge(180 * 60, false, '4W');
  assert.strictEqual(normal.basicCharge, 500, '180:00 basic charge should be 500');
  assert.strictEqual(normal.tierLabel, 'Up to 180 minutes');
  assert.strictEqual(normal.appliesBan, false);

  const withFine = calculateParkingCharge(180 * 60, true, '4W');
  assert.strictEqual(withFine.basicCharge, 1000, '180:00 with fine should be 1000');
});

test('Tariff Boundary: >180:00 (180:01 triggers ₹1,000 / ₹2,000 AND 10-day parking ban)', () => {
  const normal = calculateParkingCharge(180 * 60 + 1, false, '4W');
  assert.strictEqual(normal.basicCharge, 1000, '>180 min basic charge should be 1000');
  assert.strictEqual(normal.tierLabel, '> 180 minutes');
  assert.strictEqual(normal.appliesBan, true, 'Must apply 10-day parking ban');
  assert.strictEqual(normal.banDays, 10);

  const withFine = calculateParkingCharge(180 * 60 + 1, true, '4W');
  assert.strictEqual(withFine.basicCharge, 2000, '>180 min with fine should be 2000');
  assert.strictEqual(withFine.appliesBan, true);
  assert.strictEqual(withFine.banDays, 10);
});

test('Agency Split: Exactly 10% to parking personnel agency', () => {
  const charge60 = calculateParkingCharge(45 * 60, false, '4W');
  assert.strictEqual(charge60.basicCharge, 100);
  assert.strictEqual(charge60.agencyShare, 10, 'Agency gets 10% of 100 = 10');
  assert.strictEqual(charge60.facilityShare, 90, 'Facility gets 90');

  const charge90 = calculateParkingCharge(75 * 60, false, '4W');
  assert.strictEqual(charge90.basicCharge, 250);
  assert.strictEqual(charge90.agencyShare, 25, 'Agency gets 10% of 250 = 25');
  assert.strictEqual(charge90.facilityShare, 225);
});

test('5-Minute Reminder Logic: triggers 5 minutes before tier expiration', () => {
  // Tier 1 ends at 15:00 (900s). Reminder window is 10:00 to 14:59 (600s - 899s)
  const remBefore10m = checkFiveMinuteReminder(9 * 60);
  assert.strictEqual(remBefore10m.shouldTrigger, false);

  const remAt10m = checkFiveMinuteReminder(10 * 60);
  assert.strictEqual(remAt10m.shouldTrigger, true);
  assert.strictEqual(remAt10m.approachingTier, '< 15 minutes');

  // Tier 2 ends at 60:00 (3600s). Reminder window starts at 55:00 (3300s)
  const remAt55m = checkFiveMinuteReminder(55 * 60);
  assert.strictEqual(remAt55m.shouldTrigger, true);
  assert.strictEqual(remAt55m.approachingTier, 'Up to 60 minutes');
});

test('Late Payment Overdue Fine: ₹100 per day', () => {
  assert.strictEqual(calculateOverdueFine(0), 0);
  assert.strictEqual(calculateOverdueFine(1), 100);
  assert.strictEqual(calculateOverdueFine(3), 300);
  assert.strictEqual(calculateOverdueFine(5.8), 500); // floored to 5 days
});
