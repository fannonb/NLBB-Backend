export const DAY_MS = 24 * 60 * 60 * 1000;

export type SubscriptionPauseScope = "account" | "global" | "both";

export type SubscriptionAccessInput = {
  status?: string | null;
  expiresAt?: Date | string | null;
  renewalAt?: Date | string | null;
  pausedAt?: Date | string | null;
  remainingMsAtPause?: number | string | null;
};

const toTime = (value?: Date | string | null) => {
  if (!value) {
    return null;
  }
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

export const isPauseFrozen = (input: SubscriptionAccessInput, globallyPaused: boolean) =>
  Boolean(input.pausedAt) || globallyPaused;

export const remainingMs = (
  input: SubscriptionAccessInput,
  globallyPaused: boolean,
  now = Date.now()
) => {
  if (isPauseFrozen(input, globallyPaused) && input.remainingMsAtPause != null) {
    return Math.max(0, Number(input.remainingMsAtPause));
  }

  const expiry = toTime(input.expiresAt) ?? toTime(input.renewalAt);
  if (expiry == null) {
    return 0;
  }
  return Math.max(0, expiry - now);
};

export const remainingDaysFromMs = (ms: number) => Math.max(0, Math.ceil(ms / DAY_MS));

export const isEffectivelyActive = (
  input: SubscriptionAccessInput,
  globallyPaused: boolean,
  now = Date.now()
) => {
  if (isPauseFrozen(input, globallyPaused)) {
    return false;
  }
  if (input.status !== "active") {
    return false;
  }
  return remainingMs(input, globallyPaused, now) > 0;
};

export const pauseScopeFor = (
  pausedAt: Date | string | null | undefined,
  globallyPaused: boolean
): SubscriptionPauseScope | null => {
  const account = Boolean(pausedAt);
  if (account && globallyPaused) {
    return "both";
  }
  if (account) {
    return "account";
  }
  if (globallyPaused) {
    return "global";
  }
  return null;
};
