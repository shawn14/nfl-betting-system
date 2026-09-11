// Site-wide access switch.
//
//   FREE_ACCESS_MODE = true   → every signed-in user gets full (premium) access; paywall banners and
//                               the 3-game limit are off. Stripe checkout + webhook stay wired but unused.
//   FREE_ACCESS_MODE = false  → normal: premium comes from the user's Firestore doc (Stripe subscription
//                               or /api/admin/mark-premium).
//
// Flip this one line and push main to switch modes (main auto-deploys). Turned ON 2026-09-11 while the
// site builds an audience; turn OFF once there are users worth charging.
export const FREE_ACCESS_MODE = true;
