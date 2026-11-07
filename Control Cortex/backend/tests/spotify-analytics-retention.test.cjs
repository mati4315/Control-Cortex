'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
let DatabaseSync = null;
try { DatabaseSync = require('node:sqlite').DatabaseSync; } catch (_) { /* Node anterior a 22 */ }
const { createAnalytics } = require('../spotify-analytics');

test('Spotify interaction retention and clear leave permanent audience tables intact', { skip: !DatabaseSync && 'node:sqlite requires Node 22 or newer' }, t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const analytics = createAnalytics({ db, filePath: ':memory:', session: 'retention-test' });
  assert.equal(analytics.enabled, true);
  assert.equal(db.prepare('PRAGMA secure_delete').get().secure_delete, 1);

  const now = Date.now();
  assert.equal(analytics.recordInteraction({ timestamp: now - 1000, requester: 'Persona antigua', comment: 'tema viejo', isRequest: true }), true);
  assert.equal(analytics.recordInteraction({ timestamp: now, requester: 'Persona vigente', comment: 'tema actual', isRequest: true }), true);
  db.prepare('INSERT INTO "user" (requester_key, platform, display_name) VALUES (?, ?, ?)').run('facebook:archive', 'facebook', 'Audiencia');
  db.prepare('INSERT INTO audience_comments (content_key, program_date, comment, ts, received_at) VALUES (?, ?, ?, ?, ?)')
    .run('permanent-audience-row', '2026-11-08', 'comentario histórico', now - 2000, now - 2000);

  assert.equal(analytics.pruneInteractionsBefore(now - 500), 1);
  assert.deepEqual(db.prepare('SELECT comment FROM interactions').all().map(row => row.comment), ['tema actual']);
  assert.equal(analytics.clearInteractions(), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM interactions').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "user"').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audience_comments').get().count, 1);
});
