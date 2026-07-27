# M-Pesa Live Payments Implementation Plan

## Implementation status (as of review)

| Area | Status |
|------|--------|
| Env / live vs sandbox / simulate / public flags | Ready |
| Subscription STK + callback + activate once + reuse pending + reconcile | Ready |
| Kill switch (`PAYMENTS_ENABLED` / `MPESA_ENABLED`) | Ready (route + service) |
| Production marketplace hide + detail 404 for unpaid | Ready |
| Booking open-state API gate | Ready |
| Booking open-state UI lock (Dashboard) | Ready |
| Force-close on expiry reminder | Ready |
| `MPESA_SIMULATE` blocked on live hosts (`APP_ENV` / `NODE_ENV` / `MPESA_ENV=production`) | Ready |
| Callback secret required on live hosts (including payment kill-switch rollback) | Ready |
| Directory refresh on resume + clear cache after payment success | Ready |
| Production smoke test script | Ready (`src/scripts/mpesaSmokeTest.ts`) |
| Booking-service STK as a live surface | Deferred (service exists; mobile UI does not charge at book time) |

## Goal

Switch the existing STK push flow from test/sandbox to Safaricom live credentials with the smallest possible change set, a controlled pilot, and a clean rollback path.

## What the code already supports

- Live vs sandbox is selected by `MPESA_ENV` in `backend/src/services/paymentPgService.ts`.
- Simulation mode is already available through `MPESA_SIMULATE`.
- The subscription payment endpoint is already wired at `POST /api/subscriptions/me/pay`.
- The callback endpoint is already exposed at `POST /api/payments/mpesa/callback`.
- Callback verification already supports `MPESA_CALLBACK_SECRET`.
- Public release flags already expose `paymentsEnabled` and `mpesaEnabled` through `GET /api/config/public`.
- The subscription UI already reads those flags and disables the pay action when M-Pesa is off.
- The customer marketplace already hides unsubscribed providers in production through the backend listing layer.
- Provider details already return `not found` to customer viewers when the provider is not visible.
- Booking-payment plumbing also exists in the backend, but the safest first live surface is provider subscriptions unless you want both flows live at once.

## Relevant Files

- `backend/src/config/env.ts`
- `backend/src/config/features.ts`
- `backend/src/services/paymentPgService.ts`
- `backend/src/services/providerManagementPgService.ts`
- `backend/src/services/subscriptionPgService.ts`
- `backend/src/routes/subscriptions.ts`
- `backend/src/routes/payments.ts`
- `backend/src/repositories/marketplace/postgresMarketplaceRepository.ts`
- `backend/src/middleware/callbackAuth.ts`
- `src/hooks/useProviderDirectory.ts`
- `src/lib/api/providers.ts`
- `src/screens/provider/SubscriptionScreen.tsx`
- `src/screens/provider/DashboardScreen.tsx`
- `src/lib/api/publicConfig.ts`
- `src/lib/config.ts`
- `src/screens/customer/ExploreScreen.tsx`
- `src/screens/customer/ProviderDetailsScreen.tsx`
- `backend/.env.example`
- `backend/README.md`

## Provider Visibility And Booking Gate

The live-payment rollout should also enforce a strict rule: an unpaid provider profile stays hidden from the customer marketplace, and the provider cannot open the booking session until payment is confirmed.

1. Treat active subscription as the source of truth. A provider is only eligible for customer visibility when the latest subscription is active and not expired.

2. Keep the backend as the enforcement layer. The marketplace list and detail endpoints should continue to block customer-facing access for inactive subscriptions so stale or crafted client requests cannot reveal unpaid providers.

3. Lock the booking-session toggle until confirmation. The provider dashboard should not allow `isOpen=true` while the subscription is pending, failed, or expired. The API should reject that state change as well, not just the UI.

4. Unlock only after a confirmed callback. When Safaricom confirms payment, the backend should activate the subscription first, then allow the provider to open bookings. If you choose to auto-open on success, make that behavior explicit and consistent everywhere.

5. Handle stale cache safely. Customer directory caches and any locally cached provider lists should refresh after payment state changes, app resume, or explicit refresh so an unpaid provider does not linger on the Explore screen.

6. Keep the hidden state during failures. Missing callbacks, failed payments, and expired subscriptions should leave the profile hidden and the booking session closed until reconciliation confirms a valid payment.

## Rollout Plan

1. Confirm launch scope. Keep the first live release focused on provider subscription STK push, and defer booking payments unless they are explicitly part of the go-live. Record the live shortcode, passkey, callback URL, and support contacts before changing any secrets.

2. Update production configuration. Set `APP_ENV=production`, `MPESA_ENV=production`, and `MPESA_SIMULATE=false`. Keep `PAYMENTS_ENABLED=true` and `MPESA_ENABLED=true` only when you are ready to expose live payments. Populate `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_URL`, and `MPESA_CALLBACK_SECRET`. Set `EXPO_PUBLIC_API_BASE_URL` to the live API host for the production mobile build. Review `ALLOWED_ORIGINS`, `APP_BASE_URL`, and `TRUST_PROXY` for the production host. Keep any unused placeholder env vars documented, but do not rely on them for STK push unless the backend code actually uses them.

3. Verify callback delivery. Confirm the callback URL is public, HTTPS, and reachable from the internet. Confirm Daraja is using the exact live callback path. Confirm the callback route remains unauthenticated but protected by the callback secret. Confirm any proxy or CDN preserves the `callbackToken` query string. Confirm the backend appends the callback secret only when `MPESA_CALLBACK_SECRET` is set.

4. Run a controlled pilot. Use one known Safaricom number and one known provider account. Trigger `POST /api/subscriptions/me/pay`. Confirm the phone receives the STK prompt. Confirm a successful callback activates the subscription exactly once. Confirm a cancelled or declined prompt does not activate the subscription. Confirm duplicate callbacks do not double-credit the account. Confirm repeated payment attempts reuse a recent pending request instead of creating noise. Confirm the provider does not appear in the customer Explore screen until the payment is confirmed and the booking session can be opened.

5. Validate recovery and reconciliation. Call `GET /api/subscriptions/me?reconcile=true` after a pending payment to confirm recovery still works. Restart the backend during a pending transaction and verify the final state still resolves correctly. Check the payment history in the app against the backend payment table. Confirm the callback and payment logs include enough detail for support to trace a transaction.

6. Cut over to live. Deploy the production backend with the live M-Pesa secrets. Confirm `GET /api/health` and `GET /api/health/ready` are healthy after deploy. Confirm `GET /api/config/public` returns `paymentsEnabled=true` and `mpesaEnabled=true`. Run one final production-host test using a controlled live number. Watch logs closely for the first few live transactions.

7. Stabilize after launch. Review payment failures, callback delays, and any M-Pesa rate limits daily during the first week. Keep manual support instructions ready for "STK sent but no callback" cases. Check pending payments each day until the team is confident the flow is stable. Record any Safaricom quirks or support contacts in the runbook.

## Validation Matrix

- STK push success: payment row is created, callback arrives, subscription becomes active.
- STK push declined: payment stays unpaid or failed, subscription does not change.
- Duplicate payment request: existing pending request is reused.
- Duplicate callback: the final payment state does not change twice.
- Callback after restart: the payment still resolves because the state is stored in the database.
- Public config off: the UI disables the button and the API rejects new payment requests.
- Unpaid provider: the customer Explore screen and provider details screen do not show the profile.
- Unpaid provider: the booking-session toggle stays closed and `PATCH /api/providers/me/open-state` cannot open it.
- Confirmed payment: the provider becomes eligible for customer visibility and may open bookings.

## Rollback Plan

- Set `PAYMENTS_ENABLED=false` to stop new payment attempts at the API layer.
- Set `MPESA_ENABLED=false` to keep the UI and public config in a safe off state.
- If you need test mode again, use `MPESA_SIMULATE=true` only in a non-production environment.
- Leave the callback endpoint online while you reconcile any payments that already started.
- Re-enable live payments only after the configuration and callback path are rechecked.

## Optional Cleanup

- Align `backend/.env.example` with the exact env vars used by the current STK push flow.
- Remove or document any placeholder variables that are not used by the code path.
- Add a short support runbook for retrying reconciliation and reading callback failures.
- Add one production smoke test that checks `GET /api/config/public` and the callback path before each release.

## Go-Live Acceptance Criteria

- A real Safaricom number can complete the STK prompt in production.
- The backend records the callback once and only once.
- The provider subscription becomes active after payment.
- The app shows the new subscription state without manual database edits.
- An unpaid provider never appears in customer search or provider detail views.
- A provider cannot open the booking session until payment confirmation exists.
- The team can disable payments quickly without taking the rest of the app offline.
