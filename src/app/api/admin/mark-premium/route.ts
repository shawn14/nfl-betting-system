import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';

export async function POST(request: Request) {
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

  const adminDb = getAdminDb();
  let userRef;

  if (uid) {
    userRef = adminDb.collection('users').doc(uid);
  } else {
    const snapshot = await adminDb
      .collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();
    if (snapshot.empty) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }
    userRef = snapshot.docs[0].ref;
  }

  await userRef.set(
    {
      subscriptionStatus: 'active',
      isPremium: true,
      stripeCustomerId: customerId,
      priceId: priceId,
    },
    { merge: true }
  );

  return NextResponse.json({ ok: true });
}
