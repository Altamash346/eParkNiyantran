const test = require('node:test');
const assert = require('node:assert');
const { db } = require('../database');

test('eParkNiyantran Complaints: Record complaint and compute summary', () => {
  const ticketId = 'CMP-TEST-' + Date.now();
  const now = new Date().toISOString();

  // Insert a test grievance
  db.prepare(`
    INSERT INTO complaints (ticket_id, session_id, vehicle_plate, complainant_name, phone, category, rating, message, status, created_at)
    VALUES (?, 'SESS-TEST-01', 'MH12AB1234', 'Rohan Mehra', '+91 9876500001', 'TARIFF_OVERCHARGE', 2, 'Charged for extra hour due to barrier delay', 'OPEN', ?)
  `).run(ticketId, now);

  // Retrieve complaint
  const record = db.prepare('SELECT * FROM complaints WHERE ticket_id = ?').get(ticketId);
  assert.ok(record, 'Complaint ticket must exist');
  assert.strictEqual(record.ticket_id, ticketId);
  assert.strictEqual(record.complainant_name, 'Rohan Mehra');
  assert.strictEqual(record.status, 'OPEN');
  assert.strictEqual(record.rating, 2);
  assert.strictEqual(record.category, 'TARIFF_OVERCHARGE');

  // Verify summary calculation
  const total = db.prepare('SELECT COUNT(*) as count FROM complaints').get().count;
  const openCount = db.prepare("SELECT COUNT(*) as count FROM complaints WHERE status = 'OPEN'").get().count;
  const avgRow = db.prepare('SELECT AVG(rating) as avgRating FROM complaints').get();

  assert.ok(total >= 1, 'Total complaints count must be at least 1');
  assert.ok(openCount >= 1, 'Open complaints count must be at least 1');
  assert.ok(avgRow.avgRating >= 1 && avgRow.avgRating <= 5, 'Average rating must be between 1 and 5');

  // Resolve complaint
  const resolveNote = 'Reviewed barrier logs and refunded ₹50 to complainant UPI';
  const resolvedAt = new Date().toISOString();

  db.prepare(`
    UPDATE complaints
    SET status = 'RESOLVED',
        resolution_notes = ?,
        resolved_by_operator_id = 'ADMIN-SUPERVISOR',
        resolved_at = ?
    WHERE ticket_id = ?
  `).run(resolveNote, resolvedAt, ticketId);

  const updated = db.prepare('SELECT * FROM complaints WHERE ticket_id = ?').get(ticketId);
  assert.strictEqual(updated.status, 'RESOLVED');
  assert.strictEqual(updated.resolution_notes, resolveNote);
  assert.strictEqual(updated.resolved_by_operator_id, 'ADMIN-SUPERVISOR');
  assert.ok(updated.resolved_at);

  // Clean up test ticket
  db.prepare('DELETE FROM complaints WHERE ticket_id = ?').run(ticketId);
});

test('eParkNiyantran Complaints: Seed complaints and 5-star rating support', () => {
  const ticketId = 'CMP-STAR-' + Date.now();
  db.prepare(`
    INSERT INTO complaints (ticket_id, complainant_name, phone, category, rating, message, status, created_at)
    VALUES (?, 'Anita Roy', '+91 9811223344', 'GENERAL_FEEDBACK', 5, 'Excellent clean bays and fast QR payment!', 'RESOLVED', ?)
  `).run(ticketId, new Date().toISOString());

  const record = db.prepare('SELECT * FROM complaints WHERE ticket_id = ?').get(ticketId);
  assert.strictEqual(record.rating, 5);
  assert.strictEqual(record.category, 'GENERAL_FEEDBACK');
  assert.strictEqual(record.status, 'RESOLVED');

  // Clean up
  db.prepare('DELETE FROM complaints WHERE ticket_id = ?').run(ticketId);
});
