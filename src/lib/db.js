
// src/lib/db.js (CommonJS)
// Инициализация Firebase Admin SDK и клиента Firestore.
const admin = require('firebase-admin');
const { FIREBASE_SERVICE_ACCOUNT } = require('../config');

let serviceAccount;
try {
  serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
} catch (e) {
  console.error('FIREBASE_SERVICE_ACCOUNT содержит невалидный JSON:', e.message);
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

module.exports = { admin, db };
