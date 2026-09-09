// test/setupEnv.js — заглушки для обязательных переменных окружения (см. src/config.js),
// чтобы `npm test` не завершался process.exit(1) при импорте модулей без реального .env.
// Preload'ится через `node --require ./test/setupEnv.js --test` (см. package.json).
//
// FIREBASE_SERVICE_ACCOUNT — структурно валидный, но полностью одноразовый JSON сервисного
// аккаунта (project_id/client_email фиктивные, RSA-ключ сгенерирован только для этого файла,
// нигде больше не используется и ни к чему реальному доступа не даёт). Нужен структурно валидным,
// потому что firebase-admin.credential.cert() проверяет формат PEM уже при инициализации
// (src/lib/db.js), а не только при реальном сетевом вызове к Firestore.
const defaults = {
  VK_GROUP_ID: '1',
  VK_SECRET_KEY: 'test-secret',
  VK_SERVICE_KEY: 'test-service-key',
  TELEGRAM_BOT_TOKEN: '123456:TEST-TOKEN',
  TELEGRAM_CHAT_ID: '-100000000000',
  FIREBASE_SERVICE_ACCOUNT: "{\"type\":\"service_account\",\"project_id\":\"test-project\",\"private_key_id\":\"testkeyid\",\"private_key\":\"-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDALr6M+ingeNLq\\nGZDTPPQSzsiYCPbQFXa9eGvGBnZ/L56sY+9n0rPQKu7JpCghvram7WVMvoHNFlzC\\n0ZPnvD0pC3fig+jzP5cXArOyUM+xyYwcSWa71c/T4q0I1mFXfyEYSspbMY3CiRHj\\nfdcrnQRAcNd5wbL6ctvhNKVbDNtdTeFy3fXlRrcjLBl3LpN9fCYVdNxEI2Rkv+k5\\ns+aRCpf58oOiPhetUlWX4eaUR2SUCDvbRmoO48IOFSfwHwTqSFz20Z6yfoM8Xei2\\nn4uALnYr29Vozp8pfTiM+0JFnUPjkLRIbGRZbiTg9KsJkxKK+Q6TvZUWFPU7Infx\\naAiTp719AgMBAAECggEAERgXUD2Fhrc4i3oarQS5m7Ko77JcbHB8T1NsGAEbKSpN\\n2CegyStaCHoeeJu8C28F8B3NlOCdIGY3egdfkI09zhjRtmQ6pD2pGB2KvkxR17kw\\nV+kaKjr/xr5dhcZhLNcx/7x8o1U/tr4FHqcNgeOa1+CG9LLgqJuZfelLi/2+GrOw\\nWqUdvUPUB+Zn6UrcgVEh6uTYk2ypb7/8UWVw3ZCR/ORC+tux3o3jzkFVUYCLUYxV\\nh5gnhJbTERcrkHiA5PJVmBvGDeJ/PqW1Zips/x4h9tW2G5RJmZ5+A+KVOOpEC8Ah\\no/t8LCzn3TT1Grlgnd3Hv3dYX6HCjQ8Ftm0rAPbkQQKBgQD21/EvLOrrjFKx+/kM\\nRaC/5omugDWOMuafWTB4LLIyv9WNmGqJlmD570/wsb9zT6O/zfvhgsjJSC9N+lRY\\nXrD8gqWIqWkR4q8OHSfFjqqoshZPKbgbjYiFVGSEz3qaV9qv/Yjvxu1G2w3yPPB6\\nEJA+rauTT9NhAskplzTffi+MdwKBgQDHT7wowLi5Chgu0Fe0HyI5n0fG0JS80pOq\\nFG64gcsuiBFBfsJd2+41pniCDopsm6dk7RIgOqudyH49Zr1/dAcaqq9UJcBQRn5t\\nZqZ6VyUhk27Djgf/1ieok6xbSagQzkeUn80yp6caAdMuKAv2yLVjk6pfY6yFSDTh\\nb58Scl7mqwKBgQCrG3NXZUaO8x1bvTOdGyLcAz2LVdpJ8OTGrreXhjwcS7gHyBCJ\\nwVEFz6rVSRFSKHF1Ap9IajUuubf40L7o5vK+hv2iJvTrbfw0x2cLXeLUv2YRh/TU\\nPJ7W9XIcUgpFtQKlnhTvSTCvPieDtFRp+NNUb2SQ3/PBuoGhL+x5w+nH7wKBgFYh\\nRd2SkwEbtKGeVRg4kBC4nUr0XiJPGZLZK5O+OzCLinF0Nshav1Ed9Fu3rugKR8dc\\nj4Wv9PPFbZBZMrC+Ukea1ROXEMlf/UiHoI+j0x70WFxXp2tOf2rhDg2RAfjpO5Ol\\njwZB3vtlKH58vdbSm1hButFoAGjEcF2vX92X4RzrAoGAVsWefQhEiS1YzLMmrqpW\\nboQU6iaeGN9Knp/ZoR0gj83uMipdsbuLwMmOoaUL0NXyInQ+iBxmIMvOJAs6tMUQ\\nVCB2gtNGwQt/Ln6jQd3UDFMiW/ltNn0ZFmmbMo/Lnnouz1CgwT2+JbsZKINZjiPS\\nUwG4AdM4H9ZS/SsssMT/CLM=\\n-----END PRIVATE KEY-----\\n\",\"client_email\":\"test@test-project.iam.gserviceaccount.com\",\"client_id\":\"123456789\",\"auth_uri\":\"https://accounts.google.com/o/oauth2/auth\",\"token_uri\":\"https://oauth2.googleapis.com/token\"}",
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}
