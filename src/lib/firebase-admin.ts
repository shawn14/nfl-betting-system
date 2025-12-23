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

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(credentialsJson);
  } catch (error) {
    console.error('Failed to parse FIREBASE_ADMIN_CREDENTIALS JSON:', error);
    console.error('First 100 chars:', credentialsJson.slice(0, 100));
    throw new Error('Invalid FIREBASE_ADMIN_CREDENTIALS JSON format');
  }

  console.log('Firebase Admin project_id:', serviceAccount.project_id);
  if (!serviceAccount.project_id || !serviceAccount.private_key) {
    console.error(
      'Missing required fields in service account. Has project_id:',
      !!serviceAccount.project_id,
      'Has private_key:',
      !!serviceAccount.private_key
    );
    throw new Error('Invalid service account: missing project_id or private_key');
  }

  const adminApp = getApps().length === 0
    ? initializeApp({ credential: cert(serviceAccount) })
    : getApps()[0];

  cachedDb = getFirestore(adminApp);
  return cachedDb;
}
