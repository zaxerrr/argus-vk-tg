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

test('shouldProcessEvent is true before rememberEvent and false after (in-memory only, no db)', async () => {
  const ctx = {
    type: 'photo_new',
    group_id: 321,
    object: {
      photo_id: 999,
      date: 1710001234
    }
  };

  assert.equal(await shouldProcessEvent(ctx), true);
  rememberEvent(ctx);
  assert.equal(await shouldProcessEvent(ctx), false);
});

// Лёгкий фейк Firestore-клиента — без реального firebase-admin, только collection().doc().get()/.set()
// на in-memory Map. Имитирует "рестарт процесса" сценарием: рассматриваемый ключ уже персистентен
// в Firestore, но in-memory NodeCache пуст (новый процесс = новый экземпляр кэша).
function createFakeDb(seed = new Map()) {
  const store = seed;
  return {
    store,
    collection: () => ({
      doc: (id) => ({
        get: async () => ({ exists: store.has(id) }),
        set: async (data) => { store.set(id, data); }
      })
    })
  };
}

test('rememberEvent persists the key to the given db', async () => {
  const ctx = {
    type: 'like_add',
    group_id: 198160981,
    object: { liker_id: 111, object_type: 'post', object_id: 1513, owner_id: -198160981 }
  };
  const db = createFakeDb();

  rememberEvent(ctx, db);
  // Дать fire-and-forget записи в фейковую "Firestore" завершиться.
  await new Promise(r => setImmediate(r));
  assert.equal(db.store.has(buildKey(ctx)), true);
});

test('shouldProcessEvent catches a duplicate via Firestore even when the in-memory cache is empty (simulated restart)', async () => {
  // Ключ, который ЕЩЁ НИ РАЗУ не передавался в rememberEvent в этом тестовом процессе — значит
  // его точно нет в module-level in-memory cache, только в "персистентном" фейковом хранилище.
  // Так проверяется именно резервный (Firestore) уровень, а не in-memory.
  const ctx = {
    type: 'like_add',
    group_id: 198160981,
    object: { liker_id: 222, object_type: 'post', object_id: 1101, owner_id: -198160981 }
  };
  const key = buildKey(ctx);
  const dbAfterRestart = createFakeDb(new Map([[key, { ts: 'x' }]]));

  assert.equal(await shouldProcessEvent(ctx, dbAfterRestart), false);
});

test('shouldProcessEvent falls back to "allow" (true) if the Firestore check throws', async () => {
  const ctx = {
    type: 'wall_repost',
    group_id: 1,
    object: { id: 42 }
  };
  const brokenDb = {
    collection: () => ({
      doc: () => ({ get: async () => { throw new Error('Firestore unavailable'); } })
    })
  };
  assert.equal(await shouldProcessEvent(ctx, brokenDb), true);
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
