import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { SportKey, SportState } from '@/services/firestore-types';

const MAX_BATCH_SIZE = 400;

function getDb() {
  if (!db) throw new Error('Firestore not initialized');
  return db;
}

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
  const ref = doc(getDb(), 'sports', sport);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() as SportState;
}

export async function setSportState(sport: SportKey, state: SportState): Promise<void> {
  const ref = doc(getDb(), 'sports', sport);
  await setDoc(ref, sanitizeForFirestore(state as Record<string, unknown>), { merge: true });
}

export async function getDocsMap<T>(
  sport: SportKey,
  subcollection: string
): Promise<Record<string, T>> {
  const ref = collection(getDb(), 'sports', sport, subcollection);
  const snap = await getDocs(ref);
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
  const ref = collection(getDb(), 'sports', sport, subcollection);
  const snap = await getDocs(ref);
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as T) }));
}

export async function saveDocsBatch<T extends Record<string, unknown>>(
  sport: SportKey,
  subcollection: string,
  docs: Array<{ id: string; data: T }>
): Promise<void> {
  if (docs.length === 0) return;
  const firestore = getDb();
  for (let i = 0; i < docs.length; i += MAX_BATCH_SIZE) {
    const batch = writeBatch(firestore);
    const slice = docs.slice(i, i + MAX_BATCH_SIZE);
    for (const item of slice) {
      const ref = doc(firestore, 'sports', sport, subcollection, item.id);
      batch.set(ref, sanitizeForFirestore(item.data), { merge: true });
    }
    await batch.commit();
  }
}
