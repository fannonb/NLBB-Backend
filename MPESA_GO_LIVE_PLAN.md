# M-Pesa Go-Live Plan

## Scope

This plan is now a later-phase checklist for M-Pesa, after the app and email integration are live.

Current backend support is strongest for:

- provider subscription STK push
- callback handling
- callback deduplication
- pending-payment reconciliation
- simulation mode for safe testing

This is **not yet** the full customer booking-payment product. Booking payments need a separate phase with payment intents, booking-level ledgering, and payout rules.

## Overall launch order

1. App goes live.
2. Email integration goes live.
3. M-Pesa integration goes live last.

## Goal

Turn on real M-Pesa payments safely after the main app and email stack are already stable, verify the full flow end to end, and keep rollback simple if anything misbehaves.

## Recommended rollout order

### Phase 1: confirm business rules

Lock these decisions before enabling live payments:

- Is the first live flow only provider subscriptions?
- What is the live shortcode/account reference?
- What is the live callback URL?
- Do we charge in full only, or support deposits later?
- What should happen when a payment is successful but the subscription update fails?

### Phase 2: prepare Safaricom credentials

Collect the production values and verify them against the Daraja portal:

- `MPESA_ENV=production`
- `MPESA_CONSUMER_KEY`
- `MPESA_CONSUMER_SECRET`
- `MPESA_SHORTCODE`
- `MPESA_PASSKEY`
- `MPESA_CALLBACK_URL`
- `MPESA_CALLBACK_SECRET`

Keep the credentials in Render only. Do not expose them to the admin web app or mobile app.

### Phase 3: keep the app in safe mode first

Before turning payments on globally:

- leave `MPESA_SIMULATE=true` in a non-production test environment
- keep `PAYMENTS_ENABLED=false` until production credentials are validated
- confirm the backend still answers `/api/health`
- confirm `/api/config` returns the expected flags

### Phase 4: test in sandbox or with a controlled production pilot

Run one controlled payment attempt and verify:

- STK push is created
- callback reaches Render
- the payment row is updated once only
- duplicate callbacks do not double-credit anything
- the subscription is activated after success
- a failed payment leaves the subscription unchanged

### Phase 5: enable production M-Pesa

When the pilot is stable:

- set `MPESA_SIMULATE=false`
- set `PAYMENTS_ENABLED=true`
- keep `REQUIRE_ACTIVE_USER=true`
- keep `ADMIN_API_KEY_ENABLED=false` unless you explicitly need it
- monitor logs during the first live transactions

### Phase 6: add reconciliation discipline

Keep a daily or hourly check for:

- pending payments that never received callbacks
- callback failures
- mismatched receipt numbers
- payments created but not reflected in subscription status

## Operational checklist

### Before you switch on live payments

- Daraja credentials copied into Render
- callback URL points to the live backend domain
- callback secret present and matching
- backend deploy is healthy on Render
- subscription payment endpoint tested successfully in safe mode
- at least one test phone number is ready

### On go-live day

- deploy the latest backend build
- trigger one controlled payment
- watch Render logs for callback receipt
- confirm the payment appears once only
- confirm the provider subscription becomes active

### After go-live

- watch the first 24 hours of logs closely
- keep a manual fallback path for failed payments
- review the payment list daily until confidence is high

## Rollback plan

If anything breaks:

- set `PAYMENTS_ENABLED=false`
- set `MPESA_SIMULATE=true`
- leave the backend up
- investigate logs before retrying

This gives you a clean way to pause real charges without taking the whole app offline.

## What still needs a later phase

The following items are separate from the first go-live:

- booking payment intents
- booking-level payment ledger
- provider settlement tracking
- automated refunds
- customer booking STK push
- payout automation

## Suggested next action

Finish the app launch, then finish email integration, and only then come back to the production credential checklist and controlled live subscription payment.
