/**
 * M-Pesa production smoke test.
 *
 * Verifies that the public config exposes live payment flags and that the
 * M-Pesa callback endpoint is reachable and protected by the callback secret.
 *
 * Usage:
 *   npx tsx src/scripts/mpesaSmokeTest.ts <API_BASE_URL> [callbackSecret]
 *
 * Example:
 *   npx tsx src/scripts/mpesaSmokeTest.ts https://api.nlbb.co.ke my-secret
 *
 * Exit codes:
 *   0 = all checks passed
 *   1 = one or more checks failed
 */

const API_BASE_URL = process.argv[2] ?? process.env.APP_BASE_URL ?? "http://localhost:4000";
const CALLBACK_SECRET = process.argv[3] ?? process.env.MPESA_CALLBACK_SECRET ?? "";

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: CheckResult[] = [];

const check = async (name: string, fn: () => Promise<{ passed: boolean; detail: string }>) => {
  try {
    const result = await fn();
    results.push({ name, ...result });
  } catch (error) {
    results.push({
      name,
      passed: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

const fetchJson = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
};

const main = async () => {
  console.log(`\nM-Pesa smoke test against: ${API_BASE_URL}\n`);

  // 1. Health check
  await check("GET /api/health", async () => {
    const { status, body } = await fetchJson(`${API_BASE_URL}/api/health`);
    const ok = status === 200 && body?.success === true && body?.data?.status === "ok";
    return {
      passed: ok,
      detail: ok ? "Backend is healthy" : `Unexpected response: ${status} ${JSON.stringify(body).slice(0, 200)}`,
    };
  });

  // 2. Readiness check (database)
  await check("GET /api/health/ready", async () => {
    const { status, body } = await fetchJson(`${API_BASE_URL}/api/health/ready`);
    const ok = status === 200 && body?.success === true && body?.data?.status === "ready";
    return {
      passed: ok,
      detail: ok ? "Database is ready" : `Unexpected response: ${status} ${JSON.stringify(body).slice(0, 200)}`,
    };
  });

  // 3. Public config exposes payment flags
  await check("GET /api/config/public (paymentsEnabled & mpesaEnabled)", async () => {
    const { status, body } = await fetchJson(`${API_BASE_URL}/api/config/public`);
    const flags = body?.data?.featureFlags;
    const ok =
      status === 200 &&
      flags?.paymentsEnabled === true &&
      flags?.mpesaEnabled === true;
    return {
      passed: ok,
      detail: ok
        ? "paymentsEnabled=true, mpesaEnabled=true"
        : `Unexpected flags: ${JSON.stringify(flags ?? body).slice(0, 200)}`,
    };
  });

  // 4. Callback endpoint rejects requests without a valid token (when secret is set)
  await check("POST /api/payments/mpesa/callback (token protection)", async () => {
    const { status } = await fetchJson(`${API_BASE_URL}/api/payments/mpesa/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Body: { stkCallback: { CheckoutRequestID: "smoke-test" } } }),
    });

    if (CALLBACK_SECRET) {
      const ok = status === 401;
      return {
        passed: ok,
        detail: ok
          ? "Callback rejected without token (secret is set)"
          : `Expected 401, got ${status}`,
      };
    }

    // No secret configured: the callback should still accept the request (it will
    // fail on the missing payment row, which is fine for this smoke test).
    const ok = status === 404 || status === 200;
    return {
      passed: ok,
      detail: ok
        ? "Callback accepted without token (no secret configured)"
        : `Expected 200/404, got ${status}`,
    };
  });

  // 5. Callback endpoint accepts requests with a valid token
  if (CALLBACK_SECRET) {
    await check("POST /api/payments/mpesa/callback (valid token accepted)", async () => {
      const { status } = await fetchJson(
        `${API_BASE_URL}/api/payments/mpesa/callback?callbackToken=${encodeURIComponent(CALLBACK_SECRET)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ Body: { stkCallback: { CheckoutRequestID: "smoke-test" } } }),
        }
      );
      // With a valid token, the callback should reach the handler and return 404
      // for the non-existent checkout request ID.
      const ok = status === 404 || status === 200;
      return {
        passed: ok,
        detail: ok
          ? "Callback accepted with valid token"
          : `Expected 200/404, got ${status}`,
      };
    });
  }

  // Report
  console.log("\n--- Results ---");
  let allPassed = true;
  for (const result of results) {
    const icon = result.passed ? "✅" : "❌";
    console.log(`${icon} ${result.name}: ${result.detail}`);
    if (!result.passed) {
      allPassed = false;
    }
  }

  console.log(allPassed ? "\n✅ All smoke tests passed.\n" : "\n❌ Some smoke tests failed.\n");
  process.exit(allPassed ? 0 : 1);
};

main().catch((error) => {
  console.error("Smoke test crashed:", error);
  process.exit(1);
});