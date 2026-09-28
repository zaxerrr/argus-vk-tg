const test = require('node:test');
const assert = require('node:assert/strict');

const { toFirestoreSafe } = require('../../src/lib/firestoreSafe');

test('nested arrays become JSON strings (Firestore rejects arrays inside arrays)', () => {
  const payload = { type: 'message_reply', object: { keyboard: { buttons: [[{ action: { label: 'Да' } }], [1, 2]] } } };
  const safe = toFirestoreSafe(payload);
  assert.deepEqual(safe.object.keyboard.buttons, ['[{"action":{"label":"Да"}}]', '[1,2]']);
  assert.equal(safe.type, 'message_reply');
});

test('undefined values are dropped from objects and nulled in arrays', () => {
  assert.deepEqual(toFirestoreSafe({ a: undefined, b: 1, c: [undefined, 2] }), { b: 1, c: [null, 2] });
  assert.equal(toFirestoreSafe(undefined), null);
});

test('reserved __name__-style keys are renamed', () => {
  assert.deepEqual(toFirestoreSafe({ __name__: 1, __x: 2 }), { ___name__: 1, __x: 2 });
});

test('plain JSON passes through unchanged', () => {
  const v = { type: 'like_add', object: { liker_id: 1, object_type: 'post', items: [1, 2, { a: 'b' }] }, n: null, ok: true };
  assert.deepEqual(toFirestoreSafe(v), v);
});

test('very deep structures are cut off as a JSON string instead of failing', () => {
  let deep = { leaf: 1 };
  for (let i = 0; i < 30; i++) deep = { d: deep };
  const safe = toFirestoreSafe(deep);
  let node = safe; let depth = 0;
  while (node && typeof node === 'object') { node = node.d; depth++; }
  assert.equal(typeof node, 'string');
  assert.ok(depth <= 20);
});
