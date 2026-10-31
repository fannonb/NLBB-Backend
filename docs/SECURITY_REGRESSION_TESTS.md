# Security and concurrency verification

Run `npm run test:security` with `TEST_DATABASE_URL` pointing to a disposable local PostgreSQL database named `nlbb_security_test`. The runner refuses other database names and non-loopback hosts. It recreates the test database's `public` and `auth` schemas, generates tables from the current Drizzle schema, and uses a local mock Supabase Auth server. It does not load `backend/.env` or call live payment, email, or auth services.

The backend CI workflow runs this suite against an isolated PostgreSQL 18 service. Coverage includes overlapping reservations, duplicate callbacks, concurrent subscription renewals, rollback after a subscription update failure, leftover simulated payments, disabled/revoked sessions, JWT validation, callback authentication, browser cookie login/refresh/logout, CSRF origin checks, and native bearer-token compatibility.

## Deployment requirements

- Deploy the API changes before or together with the web build. Existing web users must sign in again: plaintext localStorage tokens are intentionally discarded.
- The backend database role must be able to read and delete rows in `auth.sessions`. This app already uses a privileged server-side Postgres connection. Session checks fail closed if the connection lacks access. No new application schema migration is needed.
- Configure `ALLOWED_ORIGINS` with the exact web origins, and serve the API over HTTPS in production. Browser requests send credentials and the `X-NLBB-Client: web` header; native clients continue using bearer tokens.
- Production cookies are HttpOnly, Secure, and SameSite=None to support the existing separate API host. Prefer an API domain on the same site as the web app (or a same-origin `/api` reverse proxy), since browsers may block third-party cookies. Include the web origin in `ALLOWED_ORIGINS` in either configuration.
- Set `VITE_API_BASE_URL` to the intended HTTPS API URL. If absent in a production build, the web app uses its own origin's `/api`; production never falls back to localhost. Vercel's CSP allows HTTPS API connections.
- Push and email delivery runs after transaction commit. Those deliveries are best effort; durable retry/outbox processing remains a separate enhancement.
- Historical logs may already contain the old M-Pesa callback secret. Rotate that secret in the deployment environment and restrict access to old logs when releasing the logging fix. Do not print the replacement value.
