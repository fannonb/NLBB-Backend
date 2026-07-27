# M-Pesa Support Runbook

This runbook covers the most common support tasks for the NLBB M-Pesa STK push flow after go-live.

## Prerequisites

- Backend admin access (or database read access to the `payments`, `payment_callbacks`, and `payment_events` tables).
- The provider's `providerId` or the `CheckoutRequestID` from the M-Pesa prompt.
- Access to backend logs for the production deployment.

## 1. "STK sent but no callback" (pending payment never resolves)

### Symptoms
- The provider tapped **Pay**, received the STK prompt, completed (or cancelled) it, but the subscription screen still shows **pending**.
- No callback row exists in `payment_callbacks` for the `CheckoutRequestID`.

### Steps
1. Find the payment row:
   ```sql
   SELECT id, provider_id, status, checkout_request_id, amount, phone_number, created_at
   FROM payments
   WHERE provider_id = '<providerId>'
   ORDER BY created_at DESC
   LIMIT 5;
   ```
2. If `status = 'pending'`, ask the provider to open the subscription screen again. The app calls `GET /api/subscriptions/me?reconcile=true`, which queries Daraja's STK push status endpoint and finalizes the payment server-side.
3. If reconcile does not resolve it, run the reconcile manually from the backend:
   ```ts
   import { reconcilePendingPaymentsForProvider } from "./services/paymentPgService";
   await reconcilePendingPaymentsForProvider("<providerId>");
   ```
4. If Daraja returns `ResultCode 4999` (still processing), wait 30 seconds and retry. The backend throttles status queries to avoid Daraja rate limits.
5. If the payment is older than 2 minutes and Daraja returns a non-zero `ResultCode`, the payment is marked **failed** and the subscription stays inactive. Ask the provider to initiate a new payment.

## 2. Duplicate callback (subscription credited twice)

### Symptoms
- The provider's subscription was extended by more than 30 days from a single payment.

### Steps
1. Check callback duplicates:
   ```sql
   SELECT payment_id, count(*) AS hits
   FROM payment_callbacks
   GROUP BY payment_id
   HAVING count(*) > 1;
   ```
2. The backend's `processMpesaCallback` is idempotent: if the payment is already `success` or `failed`, it returns `duplicate: true` and does not re-apply the subscription. So a duplicate callback should never double-credit.
3. If you still see a double-credit, inspect `payment_events` for the payment to confirm which event applied the subscription:
   ```sql
   SELECT * FROM payment_events WHERE payment_id = '<paymentId>' ORDER BY created_at;
   ```
4. Manually correct the subscription row if needed:
   ```sql
   UPDATE provider_subscriptions
   SET status = 'active', expires_at = '<correct ISO date>'
   WHERE provider_id = '<providerId>';
   ```

## 3. Reading callback failures

### Symptoms
- A payment is marked **failed** but the provider insists they paid.

### Steps
1. Find the callback payload:
   ```sql
   SELECT * FROM payment_callbacks
   WHERE payment_id = '<paymentId>'
   ORDER BY received_at;
   ```
2. Parse `payload_json` and look at `Body.stkCallback.ResultCode` and `ResultDesc`:
   - `0` = success.
   - `1032` = cancelled by user.
   - `1037` = timeout / subscriber unreachable.
   - `1` = generic failure.
3. Check `payment_events` for the event type (`payment_failed`, `payment_failed_query`).
4. If the callback shows success but the payment is still `failed`, the callback may have arrived after a manual reconcile marked it failed. Re-run reconcile to re-query Daraja; if Daraja confirms success, the payment will flip to `success` and the subscription will activate.

## 4. Provider cannot open bookings after payment

### Symptoms
- The provider's subscription is **active** but `PATCH /api/providers/me/open-state` returns `403 SUBSCRIPTION_INACTIVE`.

### Steps
1. Confirm the subscription is actually active and not expired:
   ```sql
   SELECT status, expires_at FROM provider_subscriptions WHERE provider_id = '<providerId>';
   ```
2. If `expires_at` is in the past, `normalizeSubscriptionStatus` will flip it to `expired` on the next read. Ask the provider to pay again.
3. If the subscription is genuinely active and the error persists, restart the backend to clear any stale in-memory state, then retry.

## 5. Unpaid provider visible in customer Explore

### Symptoms
- A provider with an inactive subscription appears in the customer marketplace.

### Steps
1. Confirm the subscription status and expiry in the database.
2. In production (`APP_ENV=production`), the marketplace repository filters out unsubscribed providers for customer viewers. If the provider is still visible:
   - Check `APP_ENV` is set to `production` on the backend.
   - Check the provider's `admin_status` is `approved`.
   - Have the customer pull-to-refresh the Explore screen to clear any stale client cache.
3. If the provider is the owner or an admin viewing the profile, the visibility gate is intentionally bypassed for those roles.

## 6. Disabling payments quickly (rollback)

Set these environment variables and redeploy:
```
PAYMENTS_ENABLED=false
MPESA_ENABLED=false
```
- `PAYMENTS_ENABLED=false` stops new payment attempts at the API layer (`POST /api/subscriptions/me/pay` returns `503 PAYMENTS_DISABLED`).
- `MPESA_ENABLED=false` keeps the UI and public config in a safe off state.
- Leave the callback endpoint online while you reconcile any payments that already started.
- Re-enable live payments only after the configuration and callback path are rechecked.

## 7. Restarting the backend during a pending transaction

The payment state is stored in the database, not in memory. After a restart:
1. The provider opens the subscription screen.
2. The app calls `GET /api/subscriptions/me?reconcile=true`.
3. The backend queries Daraja for the pending `CheckoutRequestID` and finalizes the payment.
4. The subscription activates if Daraja confirms success.

No manual intervention is required unless Daraja is unreachable.