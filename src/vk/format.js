// src/vk/format.js — чистые функции форматирования VK-ссылок и склонений (без побочных эффектов),
// вынесены отдельно от src/vk/events.js, чтобы их можно было импортировать в тестах без
// подтягивания src/telegram.js (который при require() поднимает реальный long-polling бот).

function objNounDative(type) {
  const t = String(type || '').toLowerCase(); // для "к <чему?>"
  switch (t) {
    case 'post': return 'посту';
    case 'comment': return 'комментарию';
    case 'photo': return 'фотографии';
    case 'video': return 'видео';
    case 'clip': return 'клипу';
    case 'story': return 'истории';
    case 'note': return 'заметке';
    case 'photo_comment': return 'комментарию к фото';
    case 'video_comment': return 'комментарию к видео';
    case 'topic_comment': return 'комментарию в обсуждении';
    case 'market': return 'товару';
    case 'market_comment': return 'комментарию к товару';
    case 'topic': return 'обсуждению';
    default: return 'объекту';
  }
}

function objNounAblative(type) {
  const t = String(type || '').toLowerCase(); // для "от <чего?>"
  switch (t) {
    case 'post': return 'поста';
    case 'comment': return 'комментария';
    case 'photo': return 'фотографии';
    case 'video': return 'видео';
    case 'clip': return 'клипа';
    case 'story': return 'истории';
    case 'note': return 'заметки';
    case 'photo_comment': return 'комментария к фото';
    case 'video_comment': return 'комментария к видео';
    case 'topic_comment': return 'комментария в обсуждении';
    case 'market': return 'товара';
    case 'market_comment': return 'комментария к товару';
    case 'topic': return 'обсуждения';
    default: return 'объекта';
  }
}

function absOwner(ownerId) {
  return String(ownerId || '').replace(/^-/, '');
}

function buildObjectLink(ownerId, objectType, objectId, postId) {
  const t = String(objectType || '').toLowerCase();
  const ownAbs = absOwner(ownerId);
  switch (t) {
    case 'post':            return `https://vk.com/wall-${ownAbs}_${objectId}`;
    case 'comment':         return postId ? `https://vk.com/wall-${ownAbs}_${postId}?reply=${objectId}` : null;
    case 'photo':           return `https://vk.com/photo-${ownAbs}_${objectId}`;
    case 'video':           return `https://vk.com/video-${ownAbs}_${objectId}`;
    case 'clip':            return `https://vk.com/clip-${ownAbs}_${objectId}`; // если не работает — вернётся null
    case 'market':          return `https://vk.com/market-${ownAbs}?w=product-${ownAbs}_${objectId}`;
    case 'topic':           return `https://vk.com/topic-${ownAbs}_${postId || objectId}`;
    // У лайка комментария к фото/видео/обсуждению/товару VK не присылает ID родительского объекта
    // (post_id — только для комментария под записью), а подстановка ID самого комментария давала
    // ссылку на несуществующее фото/видео. Без родителя ссылки нет — только текст.
    case 'photo_comment':   return postId ? `https://vk.com/photo-${ownAbs}_${postId}?reply=${objectId}` : null;
    case 'video_comment':   return postId ? `https://vk.com/video-${ownAbs}_${postId}?reply=${objectId}` : null;
    case 'topic_comment':   return postId ? `https://vk.com/topic-${ownAbs}_${postId}?post=${objectId}` : null;
    case 'market_comment':  return postId ? `https://vk.com/market-${ownAbs}?w=product-${ownAbs}_${postId}` : null;
    default:                return null;
  }
}

function toLikesApiType(objectType) {
  const t = String(objectType || '').toLowerCase();
  switch (t) {
    case 'post':
    case 'comment':
    case 'photo':
    case 'video':
    case 'note':
    case 'photo_comment':
    case 'video_comment':
    case 'topic_comment':
    case 'market':
    case 'market_comment':
    case 'sitepage':
      return t;
    // Клип в VK — это видеозапись (clip-X_Y и video-X_Y открывают один объект), а отдельного типа
    // clip у likes.getList нет (dev.vk.com/ru/method/likes.getList). Не проверено на реальном
    // ключе: если VK ответит ошибкой, tryGetLikesCount залогирует её и счётчика просто не будет.
    case 'clip':
      return 'video';
    default:
      return null;
  }
}

module.exports = {
  objNounDative,
  objNounAblative,
  absOwner,
  buildObjectLink,
  toLikesApiType
};
