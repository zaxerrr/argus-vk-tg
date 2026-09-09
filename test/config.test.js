const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Тестируем src/config.js в отдельном процессе с явно контролируемым окружением —
// он вызывает process.exit(1) при импорте, если переменной не хватает, поэтому его нельзя
// require()'ить напрямую в этом тестовом процессе (уронит весь прогон тестов).
const configPath = path.join(__dirname, '..', 'src', 'config.js');

const FULL_ENV = {
  VK_GROUP_ID: '1',
  VK_SECRET_KEY: 'x',
  VK_SERVICE_KEY: 'x',
  TELEGRAM_BOT_TOKEN: 'x',
  TELEGRAM_CHAT_ID: '1',
  // config.js только проверяет наличие этой переменной (required()) — парсит JSON уже
  // src/lib/db.js, которого этот тест не требует, так что валидный JSON здесь не нужен.
  FIREBASE_SERVICE_ACCOUNT: 'x',
};

function runWithEnv(env) {
  return spawnSync(process.execPath, ['-e', `require(${JSON.stringify(configPath)})`], {
    env: { PATH: process.env.PATH, ...env },
  });
}

test('exits with code 1 when a required env var is missing', () => {
  const { VK_SERVICE_KEY, ...envWithoutServiceKey } = FULL_ENV;
  const result = runWithEnv(envWithoutServiceKey);
  assert.equal(result.status, 1);
});

test('loads successfully when all required env vars are present', () => {
  const result = runWithEnv(FULL_ENV);
  assert.equal(result.status, 0);
});
