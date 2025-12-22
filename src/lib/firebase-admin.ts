import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let cachedDb: ReturnType<typeof getFirestore> | null = null;

function requireCredentials(): string {
  const rawCredentials = process.env.FIREBASE_ADMIN_CREDENTIALS;
  if (!rawCredentials) {
    throw new Error('FIREBASE_ADMIN_CREDENTIALS is not set.');
  }
  return rawCredentials;
}

export function getAdminDb() {
  if (cachedDb) return cachedDb;

  const rawCredentials = requireCredentials();
  const credentialsJson = rawCredentials.trim().startsWith('{')
    ? rawCredentials
    : Buffer.from(rawCredentials, 'base64').toString('utf8');

  const serviceAccount = JSON.parse(credentialsJson);

  const adminApp = getApps().length === 0
    ? initializeApp({ credential: cert(serviceAccount) })
    : getApps()[0];

  cachedDb = getFirestore(adminApp);
  return cachedDb;
}
