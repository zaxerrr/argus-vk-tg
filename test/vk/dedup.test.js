const test = require('node:test');
const assert = require('node:assert/strict');

const { buildKey, shouldProcessEvent, rememberEvent } = require('../../src/vk/dedup');

test('same input yields same key', () => {
  const ctx = {
    type: 'wall_post_new',
    group_id: 123,
    object: {
      post_id: 456,
      date: 1710000000
    }
  };
  const key1 = buildKey(ctx);
  const key2 = buildKey(JSON.parse(JSON.stringify(ctx)));

  assert.equal(key1, key2);
});

test('shouldProcessEvent is true before rememberEvent and false after', () => {
  const ctx = {
    type: 'photo_new',
    group_id: 321,
    object: {
      photo_id: 999,
      date: 1710001234
    }
  };

  assert.equal(shouldProcessEvent(ctx), true);
  rememberEvent(ctx);
  assert.equal(shouldProcessEvent(ctx), false);
});

test('like_add events on different posts yield different keys (regression)', () => {
  const likeOnPostA = {
    type: 'like_add',
    group_id: 123,
    object: { liker_id: 111, object_type: 'post', object_id: 456, owner_id: -123 }
  };
  const likeOnPostB = {
    type: 'like_add',
    group_id: 123,
    object: { liker_id: 111, object_type: 'post', object_id: 789, owner_id: -123 }
  };

  assert.notEqual(buildKey(likeOnPostA), buildKey(likeOnPostB));
});

test('like_add events by different likers on the same post yield different keys', () => {
  const likeByUser1 = {
    type: 'like_add',
    group_id: 123,
    object: { liker_id: 111, object_type: 'post', object_id: 456, owner_id: -123 }
  };
  const likeByUser2 = {
    type: 'like_add',
    group_id: 123,
    object: { liker_id: 222, object_type: 'post', object_id: 456, owner_id: -123 }
  };

  assert.notEqual(buildKey(likeByUser1), buildKey(likeByUser2));
});

test('like_add and like_remove on the same post/liker yield different keys (different type)', () => {
  const like = {
    type: 'like_add',
    group_id: 123,
    object: { liker_id: 111, object_type: 'post', object_id: 456, owner_id: -123 }
  };
  const unlike = {
    type: 'like_remove',
    group_id: 123,
    object: { liker_id: 111, object_type: 'post', object_id: 456, owner_id: -123 }
  };

  assert.notEqual(buildKey(like), buildKey(unlike));
});

test('message_reaction_event on different messages yield different keys (regression)', () => {
  const reactionOnMsgA = {
    type: 'message_reaction_event',
    group_id: 123,
    object: { reactor_id: 111, message_id: 555, peer_id: 999, reaction_id: 1 }
  };
  const reactionOnMsgB = {
    type: 'message_reaction_event',
    group_id: 123,
    object: { reactor_id: 111, message_id: 556, peer_id: 999, reaction_id: 1 }
  };

  assert.notEqual(buildKey(reactionOnMsgA), buildKey(reactionOnMsgB));
});

test('message_reaction_event by different reactors on the same message yield different keys', () => {
  const reactionByUser1 = {
    type: 'message_reaction_event',
    group_id: 123,
    object: { reactor_id: 111, message_id: 555, peer_id: 999, reaction_id: 1 }
  };
  const reactionByUser2 = {
    type: 'message_reaction_event',
    group_id: 123,
    object: { reactor_id: 222, message_id: 555, peer_id: 999, reaction_id: 1 }
  };

  assert.notEqual(buildKey(reactionByUser1), buildKey(reactionByUser2));
});
