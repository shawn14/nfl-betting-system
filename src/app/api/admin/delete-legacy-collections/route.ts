import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

const LEGACY_COLLECTIONS = ['teams_v2', 'games_v2', 'odds_v2', 'predictions_v2'];

async function deleteCollection(db: FirebaseFirestore.Firestore, collectionName: string): Promise<number> {
  const collectionRef = db.collection(collectionName);
  const snapshot = await collectionRef.get();

  if (snapshot.empty) {
    return 0;
  }

  let count = 0;
  let batch = db.batch();
  let batchCount = 0;

  // Firestore batches have a limit of 500 operations
  for (const doc of snapshot.docs) {
    batch.delete(doc.ref);
    count++;
    batchCount++;

    if (batchCount === 500) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  // Commit remaining deletes
  if (batchCount > 0) {
    await batch.commit();
  }

  return count;
}

export async function GET() {
  try {
    const db = getAdminDb();
    const results: Record<string, number> = {};

    for (const collection of LEGACY_COLLECTIONS) {
      const deletedCount = await deleteCollection(db, collection);
      results[collection] = deletedCount;
      console.log(`Deleted ${deletedCount} documents from ${collection}`);
    }

    return NextResponse.json({
      success: true,
      message: 'Legacy v2 collections deleted',
      deletedCounts: results,
      totalDeleted: Object.values(results).reduce((a, b) => a + b, 0),
    });
  } catch (error) {
    console.error('Error deleting legacy collections:', error);
    return NextResponse.json(
      { error: 'Failed to delete legacy collections', details: String(error) },
      { status: 500 }
    );
  }
}
