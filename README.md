# NLBB Backend

Backend API for NLBB marketplace, built with `Express + TypeScript + PostgreSQL`.

## What is implemented

- Backend auth/session management
- User profile bootstrap/update (`customer`, `provider`, `admin`)
- Provider discovery and details with contact gating for anonymous users
- Provider profile onboarding + open/close state management
- Booking lifecycle:
  - create booking (customer)
  - list my bookings (customer/provider)
  - status updates with transition guards
- Provider subscription management (Ksh. 300 monthly)
- M-Pesa integration:
  - STK push request endpoint
  - callback endpoint
  - simulation mode for local/dev
- Notifications storage and read/unread management
- Favorites management for customers
- Provider review creation/listing and rating rollups
- Provider analytics + admin overview metrics
- Admin provider verification endpoints
- Postgres seed script for MVP datasets (including favorites/reviews)
- Initial Drizzle/PostgreSQL schema + generated migration
- Data-source repository layer for categories and provider discovery/details

## Quick start

1. Copy env template:

```bash
cp .env.example .env
```

2. Install dependencies:

```bash
npm install
```

3. Run in dev mode:

```bash
npm run dev
```

### Windows one-command local startup

If you are using the local user-owned Postgres cluster in `backend/.pgdata`, run:

```powershell
npm run dev:local
```

This script:

- starts the local Postgres cluster (if not already running),
- sets `DATABASE_URL=postgresql://nlbb:nlbb_dev@127.0.0.1:55432/nlbb` for the process,
- starts the backend in watch mode.

If you only want to start the local database cluster without launching the backend:

```powershell
npm run db:start:local
```

To stop the local database cluster:

```powershell
npm run db:stop:local
```

To check local database status:

```powershell
npm run db:status:local
```

4. Optional database generation/migration:

```bash
npm run db:generate
npm run db:migrate
```

5. Optional seed (destructive, wipes current DB data first):

```bash
npm run seed -- --yes
# or
npm run seed:yes
```

## Environment notes

- `ALLOWED_ORIGINS` should include your web admin origin(s), e.g. `http://localhost:3000`.
- `DATABASE_URL` is required for the backend and for Drizzle migrations. For hosted Supabase, prefer the exact `Session pooler` URI from `Settings > Database > Connect`, especially on IPv4-only networks.
- `SUPABASE_ANON_KEY` is recommended for backend-mediated sign-in, sign-up, and refresh flows. If omitted, the backend falls back to the service-role key for auth-client calls.
- Media uploads now target Supabase Storage buckets instead of local disk routes. Configure:
  - `SUPABASE_USER_AVATAR_BUCKET`
  - `SUPABASE_PROVIDER_AVATAR_BUCKET`
  - `SUPABASE_PROVIDER_COVER_BUCKET`
  - `SUPABASE_PROVIDER_GALLERY_BUCKET`
- `REDIS_URL` is reserved for sessions, rate limiting, and idempotency as we expand the backend.
- `AUTH_TOKEN_SECRET` signs access tokens issued by the backend.
- `MPESA_SIMULATE=true` lets you test subscription payment flow without hitting Daraja.
- `MPESA_CALLBACK_SECRET` is recommended in production; when set, backend appends `callbackToken` to callback URL and validates incoming callbacks.
- `ADMIN_API_KEY_ENABLED=true|false` controls whether admin API-key proxy bypass is allowed on `/api/admin/*` routes.
- `REQUIRE_ACTIVE_USER=true|false` controls whether disabled user accounts are rejected by auth middleware.
- For real Daraja STK Push, set:
  - `MPESA_CONSUMER_KEY`
  - `MPESA_CONSUMER_SECRET`
  - `MPESA_SHORTCODE`
  - `MPESA_PASSKEY`
  - `MPESA_CALLBACK_URL`

## API route map

- `GET /api/health`
- `GET /api/health/ready`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/change-password`
- `GET /api/auth/me`
- `POST /api/auth/avatar`
- `POST /api/auth/profile`
- `GET /api/auth/preferences`
- `PATCH /api/auth/preferences`
- `POST /api/auth/push-token`
- `GET /api/categories`
- `GET /api/providers`
- `GET /api/providers/:providerId`
- `GET /api/providers/:providerId/reviews`
- `GET /api/providers/me/profile`
- `POST /api/providers/me/profile`
- `PATCH /api/providers/me/open-state`
- `GET /api/providers/me/services`
- `POST /api/providers/me/services`
- `PATCH /api/providers/me/services/:serviceId`
- `PATCH /api/providers/me/services/:serviceId/active`
- `DELETE /api/providers/me/services/:serviceId`
- `GET /api/bookings/me`
- `POST /api/bookings`
- `PATCH /api/bookings/:bookingId/status`
- `GET /api/favorites/me`
- `POST /api/favorites/me`
- `DELETE /api/favorites/me/:providerId`
- `GET /api/reviews/provider/:providerId`
- `GET /api/reviews/provider/me`
- `POST /api/reviews`
- `GET /api/subscriptions/me`
- `POST /api/subscriptions/me/pay`
- `GET /api/payments/me`
- `POST /api/payments/mpesa/callback`
- `GET /api/notifications/me`
- `PATCH /api/notifications/me/read-all`
- `PATCH /api/notifications/:notificationId/read`
- `GET /api/analytics/provider/me`
- `GET /api/analytics/admin/overview`
- `GET /api/admin/providers`
- `GET /api/admin/dashboard`
- `GET /api/admin/providers?status=<all|pending|approved|suspended>&q=<search>`
- `PATCH /api/admin/providers/:providerId/status`
- `PATCH /api/admin/providers/:providerId/verify`
- `GET /api/admin/users?status=<all|active|disabled>&q=<search>`
- `PATCH /api/admin/users/:userId/status`
- `DELETE /api/admin/users/:userId`
- `GET /api/admin/revenue`

## Hardening included

- Global API rate limiting plus tighter auth/payment route limits
- Request IDs on all responses (`x-request-id`) and request log correlation
- Callback verification middleware for M-Pesa webhook endpoint
- Idempotent M-Pesa callback handling for duplicate deliveries
- Configurable admin API-key bypass (admin routes only) and active-user enforcement in auth middleware
- Postgres schema and migration templates in `backend/src/db` and `backend/drizzle`

## Frontend integration reminders

This backend is ready, but your frontend currently still uses local mock stores/data. The frontend team will need to:

1. Replace mock auth in `authStore` with the backend `/api/auth/*` token flow.
2. Replace `mockData` usage with API fetches to these endpoints.
3. Wire booking/subscription/notification screens to backend calls.
4. Add provider onboarding/profile save API calls.

## Web Admin location

Detected web admin project:

- `D:\App Projects\Sean NLBB\NLBB-admin`

This backend now exposes admin-friendly endpoints that mirror that project's current mock data structure so integration can replace `lib/mockData.ts` incrementally.
