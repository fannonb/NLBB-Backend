# Backend Supabase Schema Checklist

This checklist turns the app/backend mapping into concrete backend execution work.

## Goal

Make Supabase the platform of record for:

- authentication
- PostgreSQL
- object storage

while keeping the existing Express + Drizzle backend as the application/API layer.

## 1. Environment and project setup

- [ ] Create the Supabase project for NLBB.
- [ ] Set `SUPABASE_URL` in `backend/.env`.
- [ ] Set `SUPABASE_SERVICE_ROLE_KEY` in `backend/.env`.
- [ ] Set `DATABASE_URL` to the exact Supabase Postgres connection string from `Settings > Database > Connect`.
- [ ] Set bucket env vars if custom names are needed:
  - [ ] `SUPABASE_USER_AVATAR_BUCKET`
  - [ ] `SUPABASE_PROVIDER_AVATAR_BUCKET`
  - [ ] `SUPABASE_PROVIDER_COVER_BUCKET`
  - [ ] `SUPABASE_PROVIDER_GALLERY_BUCKET`
- [ ] Confirm local scripts and production deployment both inject the same required variables.

## 2. Supabase Auth checklist

- [ ] Use Supabase Auth as the canonical identity system.
- [ ] Confirm backend signup flow creates Supabase users.
- [ ] Confirm backend login flow exchanges credentials against Supabase Auth.
- [ ] Confirm backend refresh/logout flows align with Supabase session lifecycle.
- [ ] Keep app-level user bootstrap in Postgres after first verified request.
- [ ] Decide whether role bootstrap happens:
  - [ ] only in app DB `users.role`
  - [ ] or also in Supabase user metadata
- [ ] Decide whether email verification is required before first app usage.

## 3. Database checklist

These tables already exist conceptually in `backend/src/db/schema.ts` and should be validated against the final Supabase deployment.

### Identity and preferences

- [ ] `users`
- [ ] `user_profiles`
- [ ] `user_preferences`
- [ ] `push_tokens`

### Marketplace

- [ ] `categories`
- [ ] `providers`
- [ ] `provider_services`
- [ ] `provider_working_hours`
- [ ] `provider_media`
- [ ] `provider_verification_events`

### Customer engagement

- [ ] `favorites`
- [ ] `reviews`
- [ ] `notifications`

### Booking lifecycle

- [ ] `bookings`
- [ ] `booking_status_history`

### Revenue

- [ ] `subscription_plans`
- [ ] `provider_subscriptions`
- [ ] `payments`
- [ ] `payment_callbacks`
- [ ] `payment_events`

### Admin and audit

- [ ] `admin_logs`
- [ ] `audit_log`

## 4. Recommended schema additions

- [ ] Add `user_onboarding_state`
  - [ ] `user_id`
  - [ ] `completed_at`
  - [ ] `entry_source`
- [ ] Decide whether provider geo data stays inline or moves to a dedicated geo-friendly structure.
- [ ] Decide whether notification delivery jobs need their own durable queue table.
- [ ] Decide whether reminder scheduling needs a `booking_reminders` table.

## 5. Storage checklist

Create these buckets in Supabase Storage:

- [ ] `user-avatars`
- [ ] `provider-avatars`
- [ ] `provider-covers`
- [ ] `provider-gallery`

Storage rules:

- [ ] Store by user/provider id prefixes.
- [ ] Persist both public URL and storage key where useful.
- [ ] Confirm whether buckets are public or private.
- [ ] If private, define signed-URL strategy.
- [ ] Confirm max upload size for avatars/covers/gallery.
- [ ] Add image cleanup policy for replaced avatars/covers.

## 6. Route contract checklist

### Auth

- [ ] `POST /api/auth/register`
- [ ] `POST /api/auth/login`
- [ ] `POST /api/auth/refresh`
- [ ] `POST /api/auth/logout`
- [ ] `GET /api/auth/me`
- [ ] `POST /api/auth/profile`
- [ ] `POST /api/auth/avatar`
- [ ] `POST /api/auth/push-token`
- [ ] `GET /api/auth/preferences`
- [ ] `PATCH /api/auth/preferences`

### Marketplace

- [ ] `GET /api/categories`
- [ ] `GET /api/providers`
- [ ] `GET /api/providers/:providerId`
- [ ] `GET /api/providers/:providerId/reviews`

### Provider self-service

- [ ] `GET /api/providers/me/profile`
- [ ] `POST /api/providers/me/profile`
- [ ] `POST /api/providers/me/media`
- [ ] `PATCH /api/providers/me/open-state`
- [ ] `GET /api/providers/me/services`
- [ ] `POST /api/providers/me/services`
- [ ] `PATCH /api/providers/me/services/:serviceId`
- [ ] `PATCH /api/providers/me/services/:serviceId/active`
- [ ] `DELETE /api/providers/me/services/:serviceId`

### Customer operations

- [ ] `GET /api/favorites/me`
- [ ] `POST /api/favorites/me`
- [ ] `DELETE /api/favorites/me/:providerId`
- [ ] `GET /api/bookings/me`
- [ ] `POST /api/bookings`
- [ ] `PATCH /api/bookings/:bookingId/status`
- [ ] `POST /api/reviews`
- [ ] `GET /api/notifications/me`
- [ ] `PATCH /api/notifications/me/read-all`
- [ ] `PATCH /api/notifications/:notificationId/read`

### Provider analytics and revenue

- [ ] `GET /api/analytics/provider/me`
- [ ] `GET /api/subscriptions/me`
- [ ] `POST /api/subscriptions/me/pay`
- [ ] `GET /api/payments/me`
- [ ] `POST /api/payments/mpesa/callback`

### Admin

- [ ] `GET /api/admin/dashboard`
- [ ] `GET /api/admin/providers`
- [ ] `PATCH /api/admin/providers/:providerId/status`
- [ ] `GET /api/admin/users`
- [ ] `PATCH /api/admin/users/:userId/status`
- [ ] `DELETE /api/admin/users/:userId`
- [ ] `GET /api/admin/revenue`

## 7. RLS and authorization checklist

- [ ] Confirm whether all app writes remain backend-mediated.
- [ ] Add RLS as defense in depth.
- [ ] Customers:
  - [ ] own profile only
  - [ ] own preferences only
  - [ ] own favorites only
  - [ ] own bookings only
  - [ ] own notifications only
- [ ] Providers:
  - [ ] own provider record only
  - [ ] own services/media/hours only
  - [ ] own provider-side bookings only
- [ ] Admin access remains server controlled.

## 8. Data migration checklist

- [ ] Decide whether to migrate from existing local/Postgres data or reseed clean.
- [ ] Export categories.
- [ ] Export providers.
- [ ] Export services.
- [ ] Export working hours.
- [ ] Export media metadata.
- [ ] Export favorites.
- [ ] Export bookings.
- [ ] Export reviews.
- [ ] Export subscriptions and payments.
- [ ] Backfill user rows to match Supabase auth ids.

## 9. Verification checklist

- [ ] Customer signup works end-to-end.
- [ ] Provider signup works end-to-end.
- [ ] `GET /api/auth/me` returns correct role/profile.
- [ ] Avatar upload lands in Supabase Storage.
- [ ] Provider cover/avatar/gallery uploads land in Supabase Storage.
- [ ] Provider profile save persists media URLs and working hours.
- [ ] Booking create/update works.
- [ ] Favorites work.
- [ ] Notifications work.
- [ ] Review submission works.
- [ ] Subscription payment flow works.
- [ ] Admin dashboard and moderation work.

## 10. Known frontend/backend alignment issues

- [x] Pick one booking UX: standardize on `BookingSheet` and remove the unused `BookingConfirmationScreen`.
- [x] Remove the broken `AddWalkIn` entry point from provider appointments.
- [x] Remove the unused `BookingHubScreen`.
- [x] Refresh stale navigation types.
- [ ] Decide how long demo mode remains supported beside live backend mode.
