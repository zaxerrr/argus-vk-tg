const test = require('node:test');
const assert = require('node:assert/strict');

const { objNounDative, objNounAblative, absOwner, buildObjectLink, toLikesApiType } = require('../../src/vk/format');

test('objNounDative returns known declensions and falls back for unknown types', () => {
  assert.equal(objNounDative('post'), 'посту');
  assert.equal(objNounDative('PHOTO'), 'фотографии');
  assert.equal(objNounDative('unknown_type'), 'объекту');
});

test('objNounAblative returns known declensions and falls back for unknown types', () => {
  assert.equal(objNounAblative('post'), 'поста');
  assert.equal(objNounAblative('video'), 'видео');
  assert.equal(objNounAblative('unknown_type'), 'объекта');
});

test('absOwner strips a leading minus (group owner ids are negative in VK)', () => {
  assert.equal(absOwner(-12345), '12345');
  assert.equal(absOwner('-12345'), '12345');
  assert.equal(absOwner(12345), '12345');
  assert.equal(absOwner(undefined), '');
});

test('buildObjectLink builds correct VK deep links per object type', () => {
  assert.equal(buildObjectLink(-100, 'post', 55), 'https://vk.com/wall-100_55');
  assert.equal(buildObjectLink(-100, 'comment', 7, 55), 'https://vk.com/wall-100_55?reply=7');
  assert.equal(buildObjectLink(-100, 'comment', 7, null), null);
  assert.equal(buildObjectLink(-100, 'photo', 9), 'https://vk.com/photo-100_9');
  assert.equal(buildObjectLink(-100, 'unknown_type', 9), null);
});

test('toLikesApiType allow-lists only types supported by likes.getList', () => {
  assert.equal(toLikesApiType('post'), 'post');
  assert.equal(toLikesApiType('PHOTO_COMMENT'), 'photo_comment');
  assert.equal(toLikesApiType('story'), null);
});

test('toLikesApiType maps clip to video (clips are videos in VK, likes.getList has no clip type)', () => {
  assert.equal(toLikesApiType('clip'), 'video');
});
