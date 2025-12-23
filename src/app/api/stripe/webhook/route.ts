import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAdminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const maxDuration = 30; // Allow 30 seconds for Firebase cold start

const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

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
    console.log('Stripe webhook received:', event.type);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const uid = session.metadata?.uid || session.client_reference_id;
      const initStart = Date.now();
      const adminDb = getAdminDb();
      console.log('Firebase init ms:', Date.now() - initStart);

      const lookupStart = Date.now();
      const userRef = uid
        ? adminDb.collection('users').doc(uid)
        : await resolveUserRefByCustomer(session.customer as string | null);
      console.log('User lookup ms:', Date.now() - lookupStart);

      if (!userRef) {
        console.error(
          'checkout.session.completed: No user found for session',
          session.id,
          'customer:',
          session.customer
        );
        return NextResponse.json({ received: true });
      }

      const writeStart = Date.now();
      await userRef.set(
        {
          stripeCustomerId: session.customer || undefined,
          subscriptionStatus: session.payment_status === 'paid' ? 'active' : 'trialing',
          isPremium: true,
        },
        { merge: true }
      );
      console.log('Firestore write ms:', Date.now() - writeStart);

      return NextResponse.json({ received: true, uid: userRef.id });
    }

    const adminDb = getAdminDb();

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const uid = subscription.metadata?.uid;
        const userRef = uid
          ? adminDb.collection('users').doc(uid)
          : await resolveUserRefByCustomer(subscription.customer as string);
        if (!userRef) {
          console.error(`${event.type}: No user found for subscription`, subscription.id, 'customer:', subscription.customer);
          break;
        }
        console.log(`${event.type}: Updating user`, userRef.id, 'status:', subscription.status);

        const priceId = subscription.items.data[0]?.price?.id;
        const subData: Record<string, unknown> = {
          subscriptionStatus: subscription.status,
          currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
          isPremium: subscription.status === 'active' || subscription.status === 'trialing',
        };
        if (priceId) subData.priceId = priceId;
        await userRef.set(subData, { merge: true });
        break;
      }
      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Stripe webhook handler error:', error);
    return NextResponse.json({ error: 'Webhook handler failed.', details: String(error) }, { status: 500 });
  }
}
