import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { getAuth } from 'firebase-admin/auth';

export const maxDuration = 30; // Allow 30 seconds for Firebase cold start

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const uid = body?.uid as string | undefined;
    const email = body?.email as string | undefined;
    const customerId = body?.customerId as string | undefined;
    const priceId = body?.priceId as string | undefined;

    if (!uid && !email) {
      return NextResponse.json(
        { error: 'Provide uid or email.' },
        { status: 400 }
      );
    }

    // Initialize admin DB first (this also initializes the app)
    console.log('mark-premium: initializing DB');
    const initStart = Date.now();
    const adminDb = getAdminDb();
    console.log('mark-premium: DB init ms:', Date.now() - initStart);

    let userRef;
    let resolvedUid = uid;

    if (uid) {
      userRef = adminDb.collection('users').doc(uid);
    } else {
      // First try to find by email in Firestore
      console.log('mark-premium: querying by email');
      const queryStart = Date.now();
      const snapshot = await adminDb
        .collection('users')
        .where('email', '==', email)
        .limit(1)
        .get();
      console.log('mark-premium: query ms:', Date.now() - queryStart);

      if (!snapshot.empty) {
        userRef = snapshot.docs[0].ref;
        resolvedUid = snapshot.docs[0].id;
      } else {
        // Fall back to Firebase Auth lookup
        console.log('mark-premium: looking up in Auth');
        const authStart = Date.now();
        try {
          const authUser = await getAuth().getUserByEmail(email!);
          console.log('mark-premium: auth lookup ms:', Date.now() - authStart);
          resolvedUid = authUser.uid;
          userRef = adminDb.collection('users').doc(authUser.uid);
        } catch {
          console.log('mark-premium: auth lookup failed ms:', Date.now() - authStart);
          return NextResponse.json({ error: 'User not found in Firestore or Auth.' }, { status: 404 });
        }
      }
    }

    const updateData: Record<string, unknown> = {
      subscriptionStatus: 'active',
      isPremium: true,
    };
    if (email) updateData.email = email;
    if (customerId) updateData.stripeCustomerId = customerId;
    if (priceId) updateData.priceId = priceId;

    console.log('mark-premium: writing to Firestore');
    const writeStart = Date.now();
    await userRef.set(updateData, { merge: true });
    console.log('mark-premium: write ms:', Date.now() - writeStart);

    return NextResponse.json({ ok: true, uid: resolvedUid });
  } catch (error) {
    console.error('mark-premium error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
