import type { Provider } from "../../types/domain";
import { isEffectivelyActive } from "../../services/subscriptionAccess";

export const isSubscriptionCurrentlyActive = (
  subscription:
    | {
        status?: string | null;
        renewalDate?: string | null;
        expiresAt?: string | null;
        pausedAt?: string | null;
        remainingMsAtPause?: number | null;
      }
    | undefined,
  globallyPaused = false
) => {
  if (!subscription) {
    return false;
  }

  return isEffectivelyActive(
    {
      status: subscription.status,
      expiresAt: subscription.expiresAt,
      renewalAt: subscription.renewalDate,
      pausedAt: subscription.pausedAt,
      remainingMsAtPause: subscription.remainingMsAtPause,
    },
    globallyPaused
  );
};

export const sanitizeProvider = (
  provider: Provider,
  signedIn: boolean,
  isOwnerOrAdmin: boolean,
  isSubscribed: boolean
) => {
  // Contacts stay private for guests; signed-in customers/owners can call/WhatsApp.
  const hideContacts = !signedIn && !isOwnerOrAdmin;
  const resolvedPhone = (provider.phone ?? provider.mpesaPhone ?? "").trim() || undefined;
  const resolvedWhatsapp = (provider.whatsapp ?? provider.phone ?? provider.mpesaPhone ?? "").trim() || undefined;
  const services = isOwnerOrAdmin
    ? provider.services
    : provider.services.filter((service) => service.isActive !== false);

  return {
    ...provider,
    isSubscribed,
    phone: hideContacts ? undefined : resolvedPhone,
    whatsapp: hideContacts ? undefined : resolvedWhatsapp,
    // Availability flags stay visible so the app can say "sign in to call" vs "no number".
    hasPhone: Boolean(resolvedPhone),
    hasWhatsapp: Boolean(resolvedWhatsapp),
    contactsLocked: hideContacts,
    services,
  };
};

export const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const toIsoString = (value: Date | string | null | undefined) => {
  if (!value) {
    return new Date().toISOString();
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};
