const test = require('node:test');
const assert = require('node:assert/strict');

const { state, setTopic, TOPIC_ROLES } = require('../src/state');

test('TOPIC_ROLES lists exactly the four supported roles', () => {
  assert.deepEqual([...TOPIC_ROLES].sort(), ['debug', 'lead', 'main', 'stats']);
});

test('setTopic rejects unknown roles without touching state', () => {
  const before = { ...state.topics };
  assert.equal(setTopic('unknown_role', 123), undefined);
  assert.deepEqual(state.topics, before);
});

test('setTopic sets a numeric thread id and clears it back to null', () => {
  assert.equal(setTopic('debug', '456'), 456);
  assert.equal(state.topics.debug, 456);
  assert.equal(setTopic('debug', null), null);
  assert.equal(state.topics.debug, null);
});
