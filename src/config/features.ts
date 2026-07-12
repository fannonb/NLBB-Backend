import { env } from "./env";
import { ApiError } from "../utils/apiError";

export const releaseFlags = {
  appEnv: env.APP_ENV,
  paymentsEnabled: env.PAYMENTS_ENABLED,
  mpesaEnabled: env.PAYMENTS_ENABLED && env.MPESA_ENABLED,
} as const;

export const getPublicReleaseConfig = () => ({
  appEnv: releaseFlags.appEnv,
  featureFlags: {
    paymentsEnabled: releaseFlags.paymentsEnabled,
    mpesaEnabled: releaseFlags.mpesaEnabled,
  },
});

export const assertMpesaPaymentsEnabled = () => {
  if (!releaseFlags.paymentsEnabled) {
    throw new ApiError(503, "Payments are temporarily unavailable.", "PAYMENTS_DISABLED");
  }

  if (!releaseFlags.mpesaEnabled) {
    throw new ApiError(503, "M-Pesa payments are not live yet.", "MPESA_DISABLED");
  }
};
