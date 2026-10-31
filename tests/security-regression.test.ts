import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import postgres from "postgres";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";

// Never read backend/.env or connect to a deployed database during tests.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("Set TEST_DATABASE_URL to an isolated local database named nlbb_security_test");
const target = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.pathname !== "/nlbb_security_test") {
  throw new Error("Security tests require the isolated local nlbb_security_test database");
}
const scratch = join(tmpdir(), `nlbb-security-${process.pid}`);
mkdirSync(scratch, { recursive: true });
process.chdir(scratch);
Object.assign(process.env, {
  DATABASE_URL: databaseUrl, NODE_ENV: "test", APP_ENV: "development", MPESA_ENV: "sandbox",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-key", SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_JWT_SECRET: "local-test-signing-secret", ALLOWED_ORIGINS: "http://localhost:5181",
  MPESA_SIMULATE: "false", MPESA_CALLBACK_SECRET: "test-callback-secret", ADMIN_API_KEY_ENABLED: "false",
  EMAIL_FROM: "", RESEND_API_KEY: "", SMTP_HOST: "", SMTP_USER: "", SMTP_PASSWORD: "",
});

void (async () => {
  const sql = postgres(databaseUrl, { prepare: false, max: 10 });
  const customerId = randomUUID();
  const ownerId = randomUUID();
  let token = "";
  const authServer = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/auth/v1/token")) {
      res.end(JSON.stringify({ access_token: token, refresh_token: "test-refresh", expires_in: 3600,
        token_type: "bearer", user: { id: customerId, email: "customer@test.local", app_metadata: {}, user_metadata: {}, email_confirmed_at: new Date().toISOString() } }));
    } else if (req.url?.startsWith("/auth/v1/logout")) {
      const claims = JSON.parse(Buffer.from((req.headers.authorization ?? "").split(" ")[1].split(".")[1], "base64url").toString());
      await sql`delete from auth.sessions where id = ${claims.session_id}`;
      res.end("{}");
    } else {
      res.statusCode = 401;
      res.end(JSON.stringify({ message: "Invalid test token" }));
    }
  });
  await new Promise<void>((resolve) => authServer.listen(0, "127.0.0.1", resolve));
  const authPort = (authServer.address() as { port: number }).port;
  process.env.SUPABASE_URL = `http://127.0.0.1:${authPort}`;
  const schema = await import("../src/db/schema");
  const { getDb, closeDb, withDbTransaction, afterDbCommit } = await import("../src/db/client");
  const { resolveAccessToken } = await import("../src/middleware/auth");
  const { verifySupabaseAccessToken } = await import("../src/lib/verifySupabaseJwt");
  const { logPath } = await import("../src/utils/logPath");
  const { createBooking } = await import("../src/services/bookingPgService");
  const { processMpesaCallback, getBookingPaymentStatus } = await import("../src/services/paymentPgService");
  const { app } = await import("../src/app");
  const { eq } = await import("drizzle-orm");
  const db = getDb();
  let apiServer: ReturnType<typeof app.listen> | undefined;
  const mint = (sessionId: string, overrides: Record<string, unknown> = {}) => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: customerId, session_id: sessionId, exp: Math.floor(Date.now() / 1000) + 3600,
      aud: "authenticated", iss: `${process.env.SUPABASE_URL}/auth/v1`, ...overrides })).toString("base64url");
    return `${header}.${payload}.${createHmac("sha256", process.env.SUPABASE_JWT_SECRET!).update(`${header}.${payload}`).digest("base64url")}`;
  };
  const newSession = async () => {
    const id = randomUUID();
    await sql`insert into auth.sessions (id, user_id) values (${id}, ${customerId})`;
    return { id, token: mint(id) };
  };
  try {
    await sql.unsafe("drop schema public cascade; create schema public; drop schema if exists auth cascade; create schema auth;");
    const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
    for (const statement of statements) await sql.unsafe(statement);
    await sql.unsafe("create table auth.sessions (id uuid primary key, user_id uuid not null, not_after timestamptz)");
    await db.insert(schema.users).values([
      { id: customerId, email: "customer@test.local", role: "customer" },
      { id: ownerId, email: "provider@test.local", role: "provider" },
    ]);
    await db.insert(schema.userProfiles).values([
      { userId: customerId, fullName: "Test Customer" }, { userId: ownerId, fullName: "Test Provider" },
    ]);
    const [provider] = await db.insert(schema.providers).values({ ownerUserId: ownerId, name: "Test Studio", isOpen: true, adminStatus: "approved" }).returning();
    const [service] = await db.insert(schema.providerServices).values({ providerId: provider.id, name: "Haircut", durationMinutes: 30, priceAmount: "500" }).returning();
    const [plan] = await db.insert(schema.subscriptionPlans).values({ code: "monthly", name: "Monthly", billingPeriod: "monthly", priceAmount: "500" }).returning();
    const initialExpiry = new Date(Date.now() + 86400000 * 10);
    await db.insert(schema.providerSubscriptions).values({ providerId: provider.id, planId: plan.id, status: "active", expiresAt: initialExpiry, renewalAt: initialExpiry });
    await db.insert(schema.platformSettings).values({ id: "default", subscriptionsPaused: false });

    await test("logging excludes all callback and recovery query values", () => {
      assert.equal(logPath("/api/payments/mpesa/callback?callbackToken=secret&token=other"), "/api/payments/mpesa/callback");
    });
    await test("JWT verification rejects missing expiry, wrong issuer, wrong audience and expired tokens", () => {
      const id = randomUUID();
      for (const overrides of [{ exp: undefined }, { exp: 1 }, { iss: "https://untrusted.local/auth/v1" }, { aud: "anon" }]) {
        assert.equal(verifySupabaseAccessToken(mint(id, overrides), process.env.SUPABASE_JWT_SECRET!, `${process.env.SUPABASE_URL}/auth/v1`), null);
      }
    });
    await test("expired, revoked, and disabled sessions cannot reuse authentication", async () => {
      const session = await newSession();
      await resolveAccessToken(`Bearer ${session.token}`);
      await sql`update users set status = 'disabled' where id = ${customerId}`;
      await assert.rejects(resolveAccessToken(`Bearer ${session.token}`), /disabled/);
      await sql`update users set status = 'active' where id = ${customerId}`;
      await resolveAccessToken(`Bearer ${session.token}`);
      await sql`delete from auth.sessions where id = ${session.id}`;
      await assert.rejects(resolveAccessToken(`Bearer ${session.token}`), /signed out/);
      const expired = await newSession();
      await sql`update auth.sessions set not_after = now() - interval '1 second' where id = ${expired.id}`;
      await assert.rejects(resolveAccessToken(`Bearer ${expired.token}`), /signed out/);
    });
    await test("concurrent overlapping reservations produce one booking and one conflict", async () => {
      const payload = { providerId: provider.id, serviceId: service.id, scheduledAt: new Date(Date.now() + 86400000).toISOString() };
      const results = await Promise.allSettled([createBooking(customerId, payload), createBooking(customerId, payload)]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      assert.equal(failure.reason.code, "BOOKING_TIME_CONFLICT");
      const rows = await db.select().from(schema.bookings);
      assert.equal(rows.length, 1);
    });
    await test("booking and status history roll back when notification storage fails", async () => {
      await sql.unsafe(`create function public.fail_booking_notification_test() returns trigger language plpgsql as $$ begin raise exception 'injected notification failure'; end $$;
        create trigger fail_booking_notification_test before insert on public.notifications for each row execute function public.fail_booking_notification_test();`);
      try {
        await assert.rejects(createBooking(customerId, { providerId: provider.id, serviceId: service.id, scheduledAt: new Date(Date.now() + 2 * 86400000).toISOString() }));
        assert.equal((await db.select().from(schema.bookings)).length, 1);
        assert.equal((await db.select().from(schema.bookingStatusHistory)).length, 1);
      } finally {
        await sql.unsafe("drop trigger fail_booking_notification_test on public.notifications; drop function public.fail_booking_notification_test();");
      }
    });
    const callback = (checkout: string, amount = 500) => ({ Body: { stkCallback: { CheckoutRequestID: checkout, ResultCode: 0,
      CallbackMetadata: { Item: [{ Name: "Amount", Value: amount }, { Name: "MpesaReceiptNumber", Value: `RECEIPT-${checkout}` }] } } } });
    await test("duplicate payment callbacks credit a subscription once", async () => {
      await db.insert(schema.payments).values({ providerId: provider.id, amount: "500", checkoutRequestId: "duplicate" });
      await Promise.all([processMpesaCallback(callback("duplicate")), processMpesaCallback(callback("duplicate"))]);
      const [subscription] = await db.select().from(schema.providerSubscriptions).where(eq(schema.providerSubscriptions.providerId, provider.id));
      assert.equal(subscription.expiresAt!.getTime(), initialExpiry.getTime() + 30 * 86400000);
      const events = await db.select().from(schema.paymentEvents);
      assert.equal(events.length, 1);
    });
    await test("different concurrent payments preserve both subscription extensions", async () => {
      for (const checkout of ["one", "two"]) await db.insert(schema.payments).values({ providerId: provider.id, amount: "500", checkoutRequestId: checkout });
      await Promise.all([processMpesaCallback(callback("one")), processMpesaCallback(callback("two"))]);
      const [subscription] = await db.select().from(schema.providerSubscriptions).where(eq(schema.providerSubscriptions.providerId, provider.id));
      assert.equal(subscription.expiresAt!.getTime(), initialExpiry.getTime() + 90 * 86400000);
    });
    await test("mismatching callback amounts never activate payment", async () => {
      await db.insert(schema.payments).values({ providerId: provider.id, amount: "500", checkoutRequestId: "bad-amount" });
      await assert.rejects(processMpesaCallback(callback("bad-amount", 1)), /does not match/);
      const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.checkoutRequestId, "bad-amount"));
      assert.equal(payment.status, "pending");
    });
    await test("payment finalization rolls back status and events when subscription update fails", async () => {
      const [payment] = await db.insert(schema.payments).values({ providerId: provider.id, amount: "500", checkoutRequestId: "rollback" }).returning();
      await sql.unsafe(`create function public.fail_subscription_test() returns trigger language plpgsql as $$ begin raise exception 'injected subscription failure'; end $$;
        create trigger fail_subscription_test before update on public.provider_subscriptions for each row execute function public.fail_subscription_test();`);
      try {
        await assert.rejects(processMpesaCallback(callback("rollback")));
        const [unchanged] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
        assert.equal(unchanged.status, "pending");
        assert.equal((await db.select().from(schema.paymentEvents).where(eq(schema.paymentEvents.paymentId, payment.id))).length, 0);
      } finally {
        await sql.unsafe("drop trigger fail_subscription_test on public.provider_subscriptions; drop function public.fail_subscription_test();");
      }
      await processMpesaCallback(callback("rollback"));
      const [retried] = await db.select().from(schema.payments).where(eq(schema.payments.id, payment.id));
      assert.equal(retried.status, "success");
    });
    await test("leftover simulated booking payments cannot succeed with simulation disabled", async () => {
      const [booking] = await db.select().from(schema.bookings);
      await db.insert(schema.payments).values({ providerId: provider.id, bookingId: booking.id, purpose: "booking_service", amount: "500", checkoutRequestId: "SIM-leftover" });
      const payment = await getBookingPaymentStatus(booking.id, customerId, { reconcile: true });
      assert.equal(payment.status, "pending");
    });
    await test("transaction failures roll back writes and suppress external effects", async () => {
      let sent = false;
      await assert.rejects(withDbTransaction(async () => {
        await getDb().update(schema.users).set({ status: "disabled" }).where(eq(schema.users.id, customerId));
        afterDbCommit(() => { sent = true; });
        throw new Error("injected failure");
      }));
      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, customerId));
      assert.equal(user.status, "active");
      assert.equal(sent, false);
    });
    const session = await newSession();
    token = session.token;
    apiServer = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => apiServer!.once("listening", resolve));
    const base = `http://127.0.0.1:${(apiServer.address() as { port: number }).port}/api`;
    await test("browser login issues HttpOnly cookies without returning credentials", async () => {
      const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-NLBB-Client": "web", Origin: "http://localhost:5181" }, body: JSON.stringify({ email: "customer@test.local", password: "password123" }) });
      assert.equal(response.status, 200);
      const body = await response.json() as any;
      assert.equal(body.data.accessToken, undefined);
      assert.equal(body.data.refreshToken, undefined);
      assert.ok(response.headers.getSetCookie().every((cookie) => cookie.includes("HttpOnly")));
      const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
      const me = await fetch(`${base}/auth/me`, { headers: { "X-NLBB-Client": "web", Origin: "http://localhost:5181", Cookie: cookies } });
      assert.equal(me.status, 200);
      const refresh = await fetch(`${base}/auth/refresh`, { method: "POST", headers: { "X-NLBB-Client": "web", Origin: "http://localhost:5181", Cookie: cookies, "Content-Type": "application/json" }, body: "{}" });
      assert.equal(refresh.status, 200);
      assert.equal((await refresh.json() as any).data.refreshToken, undefined);
      const logout = await fetch(`${base}/auth/logout`, { method: "POST", headers: { "X-NLBB-Client": "web", Origin: "http://localhost:5181", Cookie: cookies, "Content-Type": "application/json" }, body: "{}" });
      assert.equal(logout.status, 200);
      assert.ok(logout.headers.getSetCookie().every((cookie) => cookie.includes("Expires=Thu, 01 Jan 1970")));
      await assert.rejects(resolveAccessToken(`Bearer ${token}`), /signed out/);
    });
    await test("untrusted browser origins cannot use cookies", async () => {
      const response = await fetch(`${base}/auth/me`, { headers: { "X-NLBB-Client": "web", Cookie: `nlbb_access=${token}` } });
      assert.equal(response.status, 403);
    });
    await test("same-origin browser GET supports browsers that omit Origin", async () => {
      const active = await newSession();
      const response = await fetch(`${base}/auth/me`, { headers: { "X-NLBB-Client": "web", "Sec-Fetch-Site": "same-origin", Cookie: `nlbb_access=${active.token}` } });
      assert.equal(response.status, 200);
    });
    await test("native login retains bearer-token response compatibility", async () => {
      const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "customer@test.local", password: "password123" }) });
      assert.equal((await response.json() as any).data.accessToken, token);
    });
    await test("payment callbacks require the secret", async () => {
      const response = await fetch(`${base}/payments/mpesa/callback?callbackToken=wrong-secret`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(callback("bad-amount")) });
      assert.equal(response.status, 401);
    });
  } finally {
    if (apiServer) await new Promise<void>((resolve) => apiServer!.close(() => resolve()));
    await new Promise<void>((resolve) => authServer.close(() => resolve()));
    await closeDb();
    await sql.end();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
