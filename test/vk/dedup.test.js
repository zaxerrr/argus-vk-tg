const test = require('node:test');
const assert = require('node:assert/strict');

const { buildKey, shouldProcessEvent, rememberEvent, isMirroredLike } = require('../../src/vk/dedup');

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

test('parallel duplicate deliveries: only the first passes (race regression)', async () => {
  const ctx = {
    type: 'like_add',
    group_id: 198160981,
    object: { liker_id: 23943160, object_type: 'post', object_id: 1521, object_owner_id: -198160981 }
  };
  // Firestore отвечает медленно — обе доставки успевают дойти до await до первой записи.
  const slowDb = {
    collection: () => ({
      doc: () => ({
        get: () => new Promise(r => setTimeout(() => r({ exists: false }), 20)),
        set: async () => {}
      })
    })
  };
  const results = await Promise.all([shouldProcessEvent(ctx, slowDb), shouldProcessEvent(ctx, slowDb)]);
  assert.deepEqual(results.sort(), [false, true]);
});

test('like on clip and on post with the same numeric id yield different keys', () => {
  const base = { type: 'like_add', group_id: 1, object: { liker_id: 5, object_id: 77, object_owner_id: -1 } };
  const clip = { ...base, object: { ...base.object, object_type: 'clip' } };
  const post = { ...base, object: { ...base.object, object_type: 'post' } };
  assert.notEqual(buildKey(clip), buildKey(post));
});

test('isMirroredLike: clip like + its post like from the same liker → second is a mirror', () => {
  const clip = { type: 'like_add', group_id: 9, object: { liker_id: 57709262, object_type: 'clip', object_id: 456239288, object_owner_id: -9 } };
  const post = { type: 'like_add', group_id: 9, object: { liker_id: 57709262, object_type: 'post', object_id: 1521, object_owner_id: -9 } };
  assert.equal(isMirroredLike(clip), false);
  assert.equal(isMirroredLike(post), true);
});

test('isMirroredLike: order post → clip works too; like_remove is paired separately', () => {
  const post = { type: 'like_add', group_id: 10, object: { liker_id: 1, object_type: 'post', object_id: 1521, object_owner_id: -10 } };
  const clip = { type: 'like_add', group_id: 10, object: { liker_id: 1, object_type: 'clip', object_id: 456, object_owner_id: -10 } };
  const unClip = { type: 'like_remove', group_id: 10, object: { liker_id: 1, object_type: 'clip', object_id: 456, object_owner_id: -10 } };
  assert.equal(isMirroredLike(post), false);
  assert.equal(isMirroredLike(unClip), false);
  assert.equal(isMirroredLike(clip), true);
});

test('isMirroredLike: two different posts, or different likers, are not mirrors', () => {
  const p1 = { type: 'like_add', group_id: 11, object: { liker_id: 1, object_type: 'post', object_id: 1, object_owner_id: -11 } };
  const p2 = { type: 'like_add', group_id: 11, object: { liker_id: 1, object_type: 'post', object_id: 2, object_owner_id: -11 } };
  const clipOther = { type: 'like_add', group_id: 11, object: { liker_id: 2, object_type: 'clip', object_id: 3, object_owner_id: -11 } };
  const photo = { type: 'like_add', group_id: 11, object: { liker_id: 1, object_type: 'photo', object_id: 4, object_owner_id: -11 } };
  assert.equal(isMirroredLike(p1), false);
  assert.equal(isMirroredLike(p2), false);
  assert.equal(isMirroredLike(clipOther), false);
  assert.equal(isMirroredLike(photo), false);
});
