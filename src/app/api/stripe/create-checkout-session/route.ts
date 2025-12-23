import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAuth } from 'firebase-admin/auth';
import { getAdminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
export async function POST(request: Request) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || new URL(request.url).origin;
  if (!stripeSecretKey) {
    return NextResponse.json(
      { error: 'Stripe is not configured.' },
      { status: 500 }
    );
  }
  if (!process.env.FIREBASE_ADMIN_CREDENTIALS) {
    return NextResponse.json(
      { error: 'Firebase admin is not configured.' },
      { status: 500 }
    );
  }

  // Ensure the admin app is initialized before verifying tokens.
  let adminDb;
  try {
    adminDb = getAdminDb();
  } catch (error) {
    console.error('Firebase admin init error:', error);
    return NextResponse.json(
      { error: 'Firebase admin initialization failed.' },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return NextResponse.json({ error: 'Missing auth token.' }, { status: 401 });
  }

  let decodedToken;
  try {
    decodedToken = await getAuth().verifyIdToken(token);
  } catch (error) {
    console.error('Stripe checkout auth error:', error);
    return NextResponse.json({ error: 'Invalid auth token.' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const priceId = body?.priceId;
  if (!priceId) {
    return NextResponse.json({ error: 'Missing priceId.' }, { status: 400 });
  }

  try {
    const userRef = adminDb.collection('users').doc(decodedToken.uid);
    const snapshot = await userRef.get();
    const existingCustomerId = snapshot.exists
      ? (snapshot.data()?.stripeCustomerId as string | undefined)
      : undefined;

    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });

    const customerId = existingCustomerId || (await stripe.customers.create({
      email: decodedToken.email,
      metadata: { uid: decodedToken.uid },
    })).id;

    if (!existingCustomerId) {
      await userRef.set({ stripeCustomerId: customerId }, { merge: true });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      subscription_data: { metadata: { uid: decodedToken.uid } },
      success_url: `${baseUrl}/dashboard?checkout=success`,
      cancel_url: `${baseUrl}/dashboard?checkout=cancelled`,
      client_reference_id: decodedToken.uid,
      metadata: { uid: decodedToken.uid },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session.' },
      { status: 500 }
    );
  }
}
