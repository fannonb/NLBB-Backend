# Backend Execution Backlog

This is the recommended implementation order for the backend cutover.

## Now in progress

- [x] Add Supabase bucket env configuration.
- [x] Add a shared Supabase Storage upload service.
- [x] Route user avatar uploads through Supabase Storage.
- [x] Route provider media uploads through Supabase Storage.
- [x] Write a backend-local Supabase schema checklist.

## Next 1: auth hardening

- [x] Implement `register` route with Supabase-backed session creation.
- [x] Implement `login` route with Supabase-backed session creation.
- [x] Implement `refresh` route with Supabase-backed session refresh.
- [x] Implement `change-password` route with current-password verification.
- [ ] Confirm `register` route creates Supabase Auth users and returns frontend-compatible payload against a live project.
- [ ] Confirm `login` route signs in with Supabase Auth and returns access + refresh tokens against a live project.
- [ ] Confirm `refresh` route works with Supabase tokens instead of legacy assumptions against a live project.
- [ ] Add integration tests for `auth/register`, `auth/login`, `auth/me`, `auth/logout`.
- [ ] Decide whether role is mirrored into Supabase user metadata.

## Next 2: media and storage completion

- [ ] Persist provider media `storageKey` explicitly wherever media URLs are saved.
- [ ] Add old-file cleanup strategy when avatar/cover is replaced.
- [ ] Add upload tests for:
  - [ ] customer avatar
  - [ ] provider avatar
  - [ ] provider cover
  - [ ] provider gallery

## Next 3: core customer path

- [ ] Verify `categories` and `providers` endpoints against Supabase-hosted Postgres.
- [ ] Verify favorites CRUD.
- [ ] Verify booking creation conflict checks.
- [ ] Verify booking cancellation flow.
- [ ] Verify customer notification read state.
- [ ] Verify review creation rules.

## Next 4: provider operations

- [ ] Verify provider self-profile bootstrap for first-time provider users.
- [ ] Verify service CRUD.
- [ ] Verify open/closed state.
- [ ] Verify analytics queries against Supabase-hosted data.
- [ ] Verify provider notifications and appointment actions.

## Next 5: subscriptions and payments

- [ ] Verify provider subscription fetch.
- [ ] Verify payment initiation.
- [ ] Verify callback idempotency.
- [ ] Verify revenue reporting endpoints.

## Next 6: admin and audit

- [ ] Verify provider moderation flows.
- [ ] Verify user status management.
- [ ] Verify admin metrics.
- [ ] Expand admin/audit logs where actions are still missing.

## Cleanup after cutover

- [ ] Remove local-disk upload assumptions from docs and code paths.
- [ ] Decide whether `backend/uploads/` remains only for legacy/dev support or is removed entirely.
- [ ] Add deployment docs for Supabase-hosted production backend configuration.
