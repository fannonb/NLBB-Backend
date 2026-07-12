# M-Pesa Provider Payment Implementation Plan

## Goal

Add secure M-Pesa STK push payments for provider-side service bookings, confirm them via callback, and record them in Supabase/Postgres with enough detail for audit, reconciliation, and provider reporting.

This plan is for service payments, not only the existing provider subscription payment flow.

## Current repo state

- The backend already has a working Daraja-style subscription payment skeleton in [backend/src/services/paymentPgService.ts](D:/App%20Projects/Sean%20NLBB/NLBB/backend/src/services/paymentPgService.ts).
- That flow already does:
  - OAuth token fetch
  - STK push initiation
  - callback receipt
  - duplicate-success protection
  - raw callback storage
  - basic payment status updates
- The current schema is still too thin for customer booking payments:
  - `payments` is provider-centric, not order-centric
  - there is no payment intent / checkout concept
  - there is no immutable ledger table
  - there is no reconciliation job or STK query path
  - there is no settlement model for paying providers out
- The current booking UX still says customers pay at the venue, so provider booking/payment product rules need to change before rollout.

## Verified findings

- The official Daraja portal is live at [developer.safaricom.co.ke](https://developer.safaricom.co.ke/).
- The backend env and README already assume Daraja credentials:
  - `MPESA_CONSUMER_KEY`
  - `MPESA_CONSUMER_SECRET`
  - `MPESA_SHORTCODE`
  - `MPESA_PASSKEY`
  - `MPESA_CALLBACK_URL`
- Safaricom publicly describes Paybill as a cash collection model for organizations, which aligns with an NLBB-controlled collection shortcode better than trying to do direct provider-owned shortcode routing for MVP.

## Important note on "PyAbill"

I could not verify a public package named `pyabill` on PyPI during research.

Most likely interpretations:

1. `PyAbill` means an internal or third-party Python wrapper around Daraja.
2. `Pyabill` is shorthand for `Paybill`.

Because this repo backend is already `Express + TypeScript`, the safest plan is:

- keep Daraja integration inside the current Node backend for MVP, or
- if you specifically want a Python wrapper later, place it behind a small internal adapter service rather than mixing Python logic directly into the Node monolith.

Recommendation: treat "PyAbill" as an adapter boundary, not a hard dependency, until you confirm the exact library/repo.

## Recommended payment model

Use an **NLBB-controlled Paybill / shortcode** for customer collections, then settle provider earnings separately.

Why this is the best first production model:

- one credential set to secure and rotate
- one callback endpoint and one reconciliation flow
- consistent payment reporting
- easier fraud controls
- easier dispute handling
- easier rollback if a provider account is disabled

Do **not** start with provider-owned shortcodes for MVP.

That model creates harder problems:

- per-provider credential management
- per-provider callback routing
- inconsistent receipt auditability
- harder support and reconciliation
- much higher operational risk

## Architecture recommendation

### Option A: Direct Daraja in the existing Node backend

Use the existing `paymentPgService.ts` pattern and expand it into a full booking-payment module.

This is the recommended path.

### Option B: Python adapter service behind the Node backend

If you later confirm a real `PyAbill` library and want to use it:

- create a small internal Python service
- expose only internal endpoints such as:
  - `POST /internal/mpesa/stk-push`
  - `POST /internal/mpesa/stk-query`
- keep all business rules, idempotency, booking linking, and database writes in the Node backend

This keeps Python limited to gateway translation, not payment ownership.

## Target payment flow

### 1. Customer starts payment

- Customer selects a booking to pay.
- App sends:
  - `bookingId`
  - `phoneNumber`
  - optional `amount` only if backend still recalculates and validates against booking
- Backend creates a `payment_intent` in `created` state.
- Backend locks amount from the booking record, not from the client payload.

### 2. Backend initiates STK push

- Backend creates a new `mpesa_stk_request` row.
- Backend calls Daraja STK push with:
  - `BusinessShortCode`
  - `Password`
  - `Timestamp`
  - `TransactionType=CustomerPayBillOnline`
  - `Amount`
  - `PartyA`
  - `PartyB`
  - `PhoneNumber`
  - `CallBackURL`
  - `AccountReference`
  - `TransactionDesc`
- Backend saves:
  - `MerchantRequestID`
  - `CheckoutRequestID`
  - request payload hash
  - request timestamp
- Backend marks `payment_intent` as `pending_user_action`.

### 3. Callback arrives

- Callback is accepted only at a dedicated public endpoint.
- Raw callback body is stored immediately before business processing.
- Callback is matched by `CheckoutRequestID`.
- Backend updates the request and payment intent atomically.

### 4. Successful callback

- Mark `payment_intent` as `succeeded`.
- Create immutable ledger entries:
  - customer payment inflow
  - platform fee
  - provider payable
- Mark booking payment status as paid.
- Move booking status into the next allowed business state.
- Notify customer and provider.

### 5. Failed or cancelled callback

- Mark `payment_intent` as `failed` or `cancelled`.
- Store result code and result description.
- Keep booking unpaid.
- Allow safe retry from the client.

### 6. Reconciliation safety net

- If callback is delayed or missing, run an STK query / reconciliation job.
- Any `pending` request older than a threshold should be rechecked.
- Reconciliation updates should also write ledger or audit events.

## Database changes

Keep the existing subscription payment tables for subscriptions, but add a proper booking/service payment model.

### New tables

#### `payment_intents`

Purpose: one logical payment attempt owned by NLBB.

Key fields:

- `id`
- `booking_id`
- `customer_user_id`
- `provider_id`
- `payment_purpose` = `booking`
- `status` = `created|pending_user_action|processing|succeeded|failed|cancelled|expired`
- `amount`
- `currency`
- `phone_number`
- `idempotency_key`
- `client_reference`
- `account_reference`
- `checkout_request_id`
- `merchant_request_id`
- `mpesa_receipt_number`
- `failure_code`
- `failure_reason`
- `created_at`
- `updated_at`
- `succeeded_at`
- `expired_at`

#### `mpesa_callback_receipts`

Purpose: immutable raw callback inbox.

Key fields:

- `id`
- `payment_intent_id`
- `checkout_request_id`
- `merchant_request_id`
- `result_code`
- `result_desc`
- `payload_json`
- `received_at`
- `processed_at`
- `processing_status`

#### `payment_ledger_entries`

Purpose: immutable accounting trail.

Key fields:

- `id`
- `payment_intent_id`
- `booking_id`
- `provider_id`
- `entry_type` = `customer_cash_in|platform_fee|provider_payable|refund|chargeback|adjustment`
- `direction` = `debit|credit`
- `amount`
- `currency`
- `reference`
- `metadata_json`
- `created_at`

#### `provider_balances`

Purpose: current provider payable summary.

Key fields:

- `provider_id`
- `available_amount`
- `pending_amount`
- `held_amount`
- `updated_at`

#### `provider_settlements`

Purpose: later payout support from NLBB to providers.

Key fields:

- `id`
- `provider_id`
- `amount`
- `currency`
- `status` = `pending|processing|paid|failed`
- `destination_type`
- `destination_reference`
- `notes`
- `created_at`
- `updated_at`

### Existing tables to extend

#### `bookings`

Add:

- `payment_status` = `unpaid|pending|paid|failed|refunded`
- `paid_at`
- `payment_intent_id`

#### `payments`

Recommendation: do **not** stretch the current `payments` table for all new flows.

Use it as either:

- subscription-only legacy storage, or
- migrate it into a generic reporting view later

## API plan

### Customer-facing

- `POST /api/bookings/:bookingId/payments/stk-push`
- `GET /api/bookings/:bookingId/payments/status`
- `POST /api/payments/:paymentIntentId/retry`

### Internal/public callback

- `POST /api/payments/mpesa/callback`

### Provider-facing

- `GET /api/providers/me/payments`
- `GET /api/providers/me/payments/:paymentIntentId`
- `GET /api/providers/me/balance`
- `GET /api/providers/me/settlements`

### Admin/reconciliation

- `POST /api/admin/payments/:paymentIntentId/reconcile`
- `POST /api/admin/payments/:paymentIntentId/mark-failed`
- `GET /api/admin/payments`

## Security requirements

### 1. Never trust client amount

- Backend derives amount from booking and service pricing.
- Client only supplies `bookingId` and phone number.

### 2. Idempotency on initiation

- Require an idempotency key from the client, or generate one per unpaid booking action.
- Prevent duplicate STK pushes for the same unpaid booking within a short window.

### 3. Idempotency on callbacks

- Store every callback.
- Process each `CheckoutRequestID` exactly once.
- Re-processing should be safe and produce no double ledger entries.

### 4. Raw callback retention

- Keep the full callback payload.
- Hash it for tamper detection if desired.

### 5. Public callback hardening

- Keep callback route separate from authenticated routes.
- Continue using `MPESA_CALLBACK_SECRET` as a gate.
- Add:
  - IP allowlisting if Safaricom publishes stable source ranges for your setup
  - request-size limits
  - callback-specific rate limiting
  - structured audit logs

### 6. Booking ownership checks

- Only the booking owner should initiate payment.
- Only unpaid / payable bookings should allow STK push.

### 7. Replay protection

- Reject already-succeeded payment intents.
- Reject stale retries after booking is paid.

### 8. Reconciliation path

- Add STK query support for stuck pending transactions.
- A missing callback must not leave the system permanently ambiguous.

### 9. Secrets handling

- Store Daraja credentials only in backend secrets.
- Never expose shortcode, passkey, or credential-generation details to the app.

### 10. Observability

- Log request IDs
- log `payment_intent_id`
- log `checkout_request_id`
- log `merchant_request_id`
- log booking and provider IDs

## Business rules to define before coding

These need product confirmation:

1. When is payment collected?
   - at booking request
   - at provider confirmation
   - before appointment start

2. What happens on provider rejection after payment?
   - full refund
   - provider/manual review

3. Is there a platform fee?
   - fixed
   - percentage
   - none for MVP

4. Are providers settled instantly or on a schedule?
   - weekly is simplest for MVP

5. Do partial payments or deposits exist?
   - if no, keep whole-amount only for MVP

## Recommended MVP decisions

- Use NLBB shortcode only.
- Use whole booking payment only.
- Collect payment only after provider confirms booking.
- Hold provider funds in NLBB balance until settlement.
- Do not automate refunds in phase 1; record refund intent and process manually first.
- Add STK query reconciliation before production launch.

## PyAbill adapter strategy

If you later confirm a Python package or internal wrapper called `PyAbill`, the adapter should expose only these methods:

- `initiate_stk_push(phone_number, amount, account_reference, description) -> { checkout_request_id, merchant_request_id, raw_response }`
- `query_stk_status(checkout_request_id) -> { status, raw_response }`
- `normalize_callback(payload) -> { checkout_request_id, merchant_request_id, result_code, result_desc, receipt_number, phone_number, amount, transaction_date }`

Everything else should remain in NLBB backend code:

- booking validation
- payment intent creation
- callback idempotency
- ledger writes
- provider balance updates
- notifications
- reconciliation jobs

## Implementation phases

### Phase 1: schema and backend foundation

- Add booking payment tables
- add indexes and uniqueness constraints
- add enum/status constants
- add payment intent service

### Phase 2: STK initiation

- Create booking payment initiation endpoint
- validate booking ownership and payment eligibility
- initiate STK push
- persist request IDs

### Phase 3: callback processing

- Store raw callback
- map callback to payment intent
- mark success/failure
- write immutable ledger entries
- update booking payment status

### Phase 4: reconciliation and admin tools

- Add pending-payment reconciliation job
- add admin payment inspection endpoint
- add manual resolution actions

### Phase 5: provider reporting

- Provider payments list
- provider balance
- provider settlement summary

### Phase 6: production hardening

- secret rotation checklist
- callback rate limits
- failure alerts
- reconciliation dashboard
- refund workflow

## Concrete repo impact

### Files likely to add

- `backend/src/services/bookingPaymentService.ts`
- `backend/src/services/mpesaGateway.ts`
- `backend/src/jobs/paymentReconciliationJob.ts`
- `backend/src/routes/bookingPayments.ts`
- `backend/src/routes/providerBalances.ts`
- new Drizzle migration files

### Files likely to modify

- `backend/src/db/schema.ts`
- `backend/src/services/paymentPgService.ts`
- `backend/src/routes/payments.ts`
- `backend/src/routes/bookings.ts`
- `backend/src/middleware/callbackAuth.ts`
- `backend/.env.example`
- `backend/README.md`

## What I would implement first

1. New payment-intent schema for booking payments.
2. `POST /api/bookings/:bookingId/payments/stk-push`.
3. Hardened callback ingestion with immutable raw callback storage.
4. Ledger entries on success.
5. STK query reconciliation for pending intents.

## Sources used

- Official Daraja portal: [developer.safaricom.co.ke](https://developer.safaricom.co.ke/)
- Official Daraja sitemap: [developer.safaricom.co.ke/sitemap.xml](https://developer.safaricom.co.ke/sitemap.xml)
- Current backend payment implementation: [backend/src/services/paymentPgService.ts](D:/App%20Projects/Sean%20NLBB/NLBB/backend/src/services/paymentPgService.ts)
- Current backend schema: [backend/src/db/schema.ts](D:/App%20Projects/Sean%20NLBB/NLBB/backend/src/db/schema.ts)
- Current backend env template: [backend/.env.example](D:/App%20Projects/Sean%20NLBB/NLBB/backend/.env.example)

## Final recommendation

Build provider service payments on top of a new booking-payment intent + ledger design in the existing Node backend, using Daraja STK push and callback processing directly.

If "PyAbill" later resolves to a real Python wrapper you want to standardize on, place it behind an internal adapter boundary and keep all business logic, security controls, and database recording in the current backend.
