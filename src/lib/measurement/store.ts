import type { Firestore } from 'firebase-admin/firestore';
import { clean } from './core.ts';

export const COLLECTION = 'predictionMeasurementsV1';
export interface Stored { id: string; kind: string; committedAt?: string; [key: string]: any }

/** No update/merge method exists for evidence. A Firestore transaction arbitrates concurrent writers. */
export class MeasurementStore {
  private db: Firestore;
  private collection: string;
  constructor(db: Firestore, collection = COLLECTION) { this.db = db; this.collection = collection; }
  async get<T extends Stored>(id: string): Promise<T | null> {
    const doc = await this.db.collection(this.collection).doc(id).get();
    return doc.exists ? { ...doc.data(), id: doc.id, committedAt: doc.createTime!.toDate().toISOString() } as T : null;
  }
  async create<T extends Stored>(record: T): Promise<T> {
    const { committedAt: _ignored, ...body } = record;
    const ref=this.db.collection(this.collection).doc(record.id);
    // REST transport in firebase-admin 12.7/google-gax retries ALREADY_EXISTS for ten minutes.
    // A read-before-set transaction provides the same first-writer-wins invariant without 409.
    await this.db.runTransaction(async tx => {
      const existing=await tx.get(ref);
      if (!existing.exists) tx.set(ref,clean(body));
    }, {maxAttempts: 3});
    const stored = await this.get<T>(record.id);
    if (!stored) throw new Error(`Create without readback: ${record.id}`);
    return stored;
  }
  async list<T extends Stored>(kind: string, limit = 2000): Promise<T[]> {
    // Bounded deliberately. Reaching the ceiling is an error, never a silently truncated scorecard.
    const result = await this.db.collection(this.collection).where('kind','==',kind).limit(limit+1).get();
    if (result.size > limit) throw new Error(`Measurement ${kind} exceeds ${limit}; archive/version the experiment before continuing`);
    return result.docs.map(doc => ({ ...doc.data(), id: doc.id, committedAt: doc.createTime!.toDate().toISOString() } as T));
  }
  async forEvent<T extends Stored>(kind: string, sport: string, eventId: string): Promise<T[]> {
    // Single-field index on eventId; kinds/sport filtered locally to avoid a new composite index.
    const result = await this.db.collection(this.collection).where('eventId','==',eventId).get();
    return result.docs.filter(d => d.get('kind') === kind && d.get('sport') === sport)
      .map(doc => ({...doc.data(), id:doc.id, committedAt:doc.createTime!.toDate().toISOString()} as T));
  }
  async health() {
    const doc=await this.db.collection(`${this.collection}Health`).doc('latest').get();
    return doc.exists ? doc.data() : null;
  }
  async heartbeat(value: Record<string, unknown>) {
    await this.db.collection(`${this.collection}Health`).doc('latest').set(clean(value));
  }
}
