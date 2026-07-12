# NLBB Backend Render Deployment

This backend is ready to deploy on Render from:

- GitHub repo: `https://github.com/fannonb/NLBB-Backend`
- Branch: `main`
- Runtime: Docker
- Health check: `/api/health`

## What is already prepared

- `Dockerfile` for production builds
- `render.yaml` blueprint with:
  - free web service plan
  - Frankfurt region
  - auto deploy from `main`
  - health check path
  - M-Pesa disabled for first live release
  - required secret fields marked for manual entry in Render

## Recommended first deployment

Use the backend without live M-Pesa first:

- `PAYMENTS_ENABLED=false`
- `MPESA_ENABLED=false`

This keeps the live app stable while we finish and test M-Pesa separately.

## Render setup steps

1. Sign in to Render and connect your GitHub account if it is not already connected.
2. Create a new Blueprint or Web Service from `fannonb/NLBB-Backend`.
3. If Render detects `render.yaml`, use it.
4. Confirm the service name is `nlbb-backend`.
5. Confirm the region is `frankfurt`.
6. Confirm the branch is `main`.
7. Add the secret environment values when Render prompts for them.

## Environment values you must provide in Render

These are the only values that still need to be pasted manually from your real services:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `DATABASE_URL`

Keep these disabled or empty for the first production deploy:

- `MPESA_ENV`
- `MPESA_CONSUMER_KEY`
- `MPESA_CONSUMER_SECRET`
- `MPESA_SHORTCODE`
- `MPESA_PASSKEY`
- `MPESA_CALLBACK_URL`
- `MPESA_CALLBACK_SECRET`
- `MPESA_INITIATOR_NAME`
- `MPESA_SECURITY_CREDENTIAL`
- `ADMIN_API_KEY`

## After the backend is live

1. Open the Render service URL and confirm `/api/health` returns success.
2. Add a custom domain such as `api.nlbb.co.ke` in Render.
3. Add the DNS record in cPanel as prompted by Render.
4. Update the Vercel admin app environment:
   - `VITE_API_BASE_URL=https://api.nlbb.co.ke/api`
5. Redeploy the Vercel admin app after updating the environment variable.

## Notes

- `APP_BASE_URL` is set automatically from Render's own external URL in `render.yaml`.
- The current blueprint allows local admin origins too, so local testing can continue after deployment.
- If you want a paid instance later, upgrade the Render plan without changing the app code.
