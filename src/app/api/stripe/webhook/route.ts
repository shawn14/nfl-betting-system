import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

async function resolveUserRefByCustomer(customerId?: string | null) {
  if (!customerId) return null;
  const adminDb = getAdminDb();
  const snapshot = await adminDb
    .collection('users')
    .where('stripeCustomerId', '==', customerId)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return snapshot.docs[0].ref;
}

export async function POST(request: Request) {
  if (!stripeSecretKey || !webhookSecret) {
    return NextResponse.json(
      { error: 'Stripe webhook is not configured.' },
      { status: 500 }
    );
  }

  let event: Stripe.Event;
  const signature = request.headers.get('stripe-signature');
  const body = await request.text();

  if (!signature) {
    return NextResponse.json({ error: 'Missing Stripe signature.' }, { status: 400 });
  }

  try {
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' });
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    console.error('Stripe webhook signature error:', error);
    return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 400 });
  }

  try {
    const adminDb = getAdminDb();

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const uid = session.metadata?.uid || session.client_reference_id;
        if (!uid) break;

        const userRef = adminDb.collection('users').doc(uid);
        await userRef.set(
          {
            stripeCustomerId: session.customer || undefined,
            subscriptionStatus: session.payment_status === 'paid' ? 'active' : 'trialing',
            isPremium: true,
          },
          { merge: true }
        );
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const uid = subscription.metadata?.uid;
        const userRef = uid
          ? adminDb.collection('users').doc(uid)
          : await resolveUserRefByCustomer(subscription.customer as string);
        if (!userRef) break;

        const priceId = subscription.items.data[0]?.price?.id;
        await userRef.set(
          {
            subscriptionStatus: subscription.status,
            currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
            priceId: priceId || undefined,
            isPremium: subscription.status === 'active' || subscription.status === 'trialing',
          },
          { merge: true }
        );
        break;
      }
      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook handler error:', error);
    return NextResponse.json({ error: 'Webhook handler failed.' }, { status: 500 });
  }
}
