import { getAdminDb } from '@/lib/firebase-admin';
import { SportKey, SportState } from '@/services/firestore-types';

const MAX_BATCH_SIZE = 400;

export function sanitizeForFirestore<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as T;
}

export async function getSportState(sport: SportKey): Promise<SportState | null> {
  const adminDb = getAdminDb();
  const ref = adminDb.collection('sports').doc(sport);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return snap.data() as SportState;
}

export async function setSportState(sport: SportKey, state: SportState): Promise<void> {
  const adminDb = getAdminDb();
  const ref = adminDb.collection('sports').doc(sport);
  await ref.set(sanitizeForFirestore(state as Record<string, unknown>), { merge: true });
}

export async function getDocsMap<T>(
  sport: SportKey,
  subcollection: string
): Promise<Record<string, T>> {
  const adminDb = getAdminDb();
  const ref = adminDb.collection('sports').doc(sport).collection(subcollection);
  const snap = await ref.get();
  const data: Record<string, T> = {};
  for (const docSnap of snap.docs) {
    data[docSnap.id] = docSnap.data() as T;
  }
  return data;
}

export async function getDocsList<T>(
  sport: SportKey,
  subcollection: string
): Promise<Array<T & { id: string }>> {
  const adminDb = getAdminDb();
  const ref = adminDb.collection('sports').doc(sport).collection(subcollection);
  const snap = await ref.get();
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as T) }));
}

export async function saveDocsBatch<T extends Record<string, unknown>>(
  sport: SportKey,
  subcollection: string,
  docs: Array<{ id: string; data: T }>
): Promise<void> {
  if (docs.length === 0) return;
  const adminDb = getAdminDb();
  for (let i = 0; i < docs.length; i += MAX_BATCH_SIZE) {
    const batch = adminDb.batch();
    const slice = docs.slice(i, i + MAX_BATCH_SIZE);
    for (const item of slice) {
      const ref = adminDb.collection('sports').doc(sport).collection(subcollection).doc(item.id);
      batch.set(ref, sanitizeForFirestore(item.data), { merge: true });
    }
    await batch.commit();
  }
}
