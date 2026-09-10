
// src/lib/db.js (CommonJS)
// Инициализация Firebase Admin SDK и клиента Firestore.
//
// Модульный API (firebase-admin/app, firebase-admin/firestore) вместо неймспейсного
// (admin.credential.cert(...) / admin.firestore()) — начиная с firebase-admin@14 неймспейсный
// admin.credential.cert исчезает, модульный работает на всех актуальных версиях.
const { cert, initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { FIREBASE_SERVICE_ACCOUNT, FIREBASE_FIRESTORE_DATABASE_ID } = require('../config');

let serviceAccount;
try {
  serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
} catch (e) {
  console.error('FIREBASE_SERVICE_ACCOUNT содержит невалидный JSON:', e.message);
  process.exit(1);
}

const app = initializeApp({ credential: cert(serviceAccount) });

// Явный ID базы обязателен: getFirestore(app) без второго аргумента ищет специальную базу
// "(default)", которой в этом проекте нет — см. комментарий у FIREBASE_FIRESTORE_DATABASE_ID
// в src/config.js.
const db = getFirestore(app, FIREBASE_FIRESTORE_DATABASE_ID);

module.exports = { db, FieldValue };
