import axios from "axios";
import { desc, eq } from "drizzle-orm";
import { env } from "../config/env";
import { getDb } from "../db/client";
import { paymentCallbacks, paymentEvents, payments, providers } from "../db/schema";
import type { Payment } from "../types/domain";
import { ApiError } from "../utils/apiError";
import { createNotification } from "./notificationPgService";
import {
  applySubscriptionPayment,
  getProviderIdByOwnerUid,
  getSubscriptionAmountDue,
  normalizeSubscriptionStatus,
} from "./subscriptionPgService";

interface InitiatePaymentInput {
  providerId: string;
  phoneNumber: string;
  amount?: number;
}

interface MpesaCallbackBody {
  Body?: {
    stkCallback?: {
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResultCode?: number;
      ResultDesc?: string;
      CallbackMetadata?: {
        Item?: Array<{ Name?: string; Value?: string | number }>;
      };
    };
  };
}

const SUBSCRIPTION_AMOUNT_KES = 1;
const STK_QUERY_STILL_PROCESSING_CODE = 4999;
const MPESA_TOKEN_REFRESH_BUFFER_MS = 60_000;

const cleanEnvValue = (value?: string | null) => value?.trim();

let cachedMpesaToken: { token: string; expiresAt: number } | null = null;

const normalizeMpesaPhoneNumber = (rawPhoneNumber: string) => {
  const digits = rawPhoneNumber.replace(/\D/g, "");

  if (digits.length === 9 && (digits.startsWith("7") || digits.startsWith("1"))) {
    return `254${digits}`;
  }

  if (digits.length === 10 && digits.startsWith("0")) {
    const subscriber = digits.slice(1);
    if (subscriber.startsWith("7") || subscriber.startsWith("1")) {
      return `254${subscriber}`;
    }
  }

  if (digits.length === 12 && digits.startsWith("254")) {
    const subscriber = digits.slice(3);
    if (subscriber.startsWith("7") || subscriber.startsWith("1")) {
      return digits;
    }
  }

  throw new ApiError(
    400,
    "Enter a valid Safaricom M-Pesa number in 07..., 01..., or 254... format.",
    "INVALID_MPESA_PHONE"
  );
};

const getMpesaBaseUrl = () =>
  env.MPESA_ENV === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";

const getCallbackUrl = () => {
  const callbackUrl = env.MPESA_CALLBACK_URL;
  if (!callbackUrl) {
    return callbackUrl;
  }
  if (!env.MPESA_CALLBACK_SECRET) {
    return callbackUrl;
  }
  const hasQuery = callbackUrl.includes("?");
  const separator = hasQuery ? "&" : "?";
  return `${callbackUrl}${separator}callbackToken=${encodeURIComponent(env.MPESA_CALLBACK_SECRET)}`;
};

const formatTimestamp = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = `${d.getMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getDate()}`.padStart(2, "0");
  const hh = `${d.getHours()}`.padStart(2, "0");
  const min = `${d.getMinutes()}`.padStart(2, "0");
  const ss = `${d.getSeconds()}`.padStart(2, "0");
  return `${yyyy}${mm}${dd}${hh}${min}${ss}`;
};

const getMetadataValue = (items: Array<{ Name?: string; Value?: string | number }> | undefined, key: string) =>
  items?.find((item) => item.Name === key)?.Value;

const getCallbackAmount = (
  items: Array<{ Name?: string; Value?: string | number }> | undefined,
  fallbackAmount: number
) => {
  const amount = Number(getMetadataValue(items, "Amount") ?? fallbackAmount);
  return Number.isFinite(amount) ? amount : fallbackAmount;
};

const isRecoverableMpesaError = (error: unknown) =>
  axios.isAxiosError(error) ||
  (error instanceof ApiError && (error.code === "MPESA_AUTH_FAILED" || error.code === "MPESA_STK_FAILED"));

const finalizePaymentStatus = async (
  payment: {
    id: string;
    providerId: string;
    status: string;
  },
  outcome: {
    success: boolean;
    amountPaid?: number;
    mpesaReceiptNumber?: string | null;
    rawPayload?: unknown;
    eventType: string;
  }
) => {
  const db = getDb();
  const nextStatus = outcome.success ? "success" : "failed";

  if (payment.status === nextStatus) {
    return;
  }

  await db
    .update(payments)
    .set({
      status: nextStatus,
      mpesaReceiptNumber: outcome.mpesaReceiptNumber ?? null,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, payment.id));

  await db.insert(paymentEvents).values({
    paymentId: payment.id,
    eventType: outcome.eventType,
    payloadJson: outcome.rawPayload ? JSON.stringify(outcome.rawPayload) : null,
    createdAt: new Date(),
  });

  if (outcome.success) {
    await applySubscriptionPayment(
      payment.providerId,
      outcome.amountPaid ?? Number((payment as { amount?: unknown }).amount ?? 0),
      payment.id
    );
    const [provider] = await db
      .select({ ownerUserId: providers.ownerUserId })
      .from(providers)
      .where(eq(providers.id, payment.providerId))
      .limit(1);
    if (provider) {
      await createNotification({
        userId: provider.ownerUserId,
        title: "Subscription Activated",
        body: "Your Ksh. 1 payment was successful. Visibility is now active.",
        type: "payment",
        actionType: "provider_subscription",
        actionId: payment.id,
      });
    }
  } else {
    await normalizeSubscriptionStatus(payment.providerId);
  }
};

const createPendingPayment = async (input: {
  providerId: string;
  phoneNumber: string;
  amount: number;
  checkoutRequestId: string;
  merchantRequestId?: string;
}) => {
  const db = getDb();
  const [payment] = await db
    .insert(payments)
    .values({
      providerId: input.providerId,
      amount: input.amount.toString(),
      currency: "KES",
      method: "mpesa",
      status: "pending",
      phoneNumber: input.phoneNumber,
      checkoutRequestId: input.checkoutRequestId,
      merchantRequestId: input.merchantRequestId ?? null,
      mpesaReceiptNumber: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return payment;
};

const getMpesaAccessToken = async () => {
  if (cachedMpesaToken && cachedMpesaToken.expiresAt - MPESA_TOKEN_REFRESH_BUFFER_MS > Date.now()) {
    return cachedMpesaToken.token;
  }

  const MPESA_CONSUMER_KEY = cleanEnvValue(env.MPESA_CONSUMER_KEY);
  const MPESA_CONSUMER_SECRET = cleanEnvValue(env.MPESA_CONSUMER_SECRET);
  if (!MPESA_CONSUMER_KEY || !MPESA_CONSUMER_SECRET) {
    throw new ApiError(500, "Missing M-Pesa credentials", "MPESA_CONFIG_ERROR");
  }

  try {
    const auth = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString("base64");
    const response = await axios.get<{ access_token: string; expires_in?: string | number }>(
      `${getMpesaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${auth}` }, timeout: 10_000, proxy: false }
    );
    const expiresInSeconds = Number(response.data.expires_in ?? 3599);
    cachedMpesaToken = {
      token: response.data.access_token,
      expiresAt: Date.now() + Math.max(60, expiresInSeconds) * 1000,
    };
    return cachedMpesaToken.token;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const remoteMessage =
        (typeof error.response?.data === "object" && error.response?.data && "errorMessage" in error.response.data
          ? String((error.response.data as { errorMessage?: unknown }).errorMessage)
          : undefined) ??
        error.message;
      throw new ApiError(
        502,
        `M-Pesa auth failed: ${remoteMessage}. Check that your consumer key/secret match the current ${env.MPESA_ENV} environment and contain no extra spaces.`,
        "MPESA_AUTH_FAILED",
        error.response?.data
      );
    }
    throw error;
  }
};

const queryStkPushStatus = async (checkoutRequestId: string) => {
  const MPESA_SHORTCODE = cleanEnvValue(env.MPESA_SHORTCODE);
  const MPESA_PASSKEY = cleanEnvValue(env.MPESA_PASSKEY);
  if (!MPESA_SHORTCODE || !MPESA_PASSKEY) {
    throw new ApiError(500, "Missing M-Pesa shortcode/passkey", "MPESA_CONFIG_ERROR");
  }

  const timestamp = formatTimestamp();
  const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString("base64");
  const token = await getMpesaAccessToken();

  const response = await axios.post<{
    ResponseCode?: string;
    ResponseDescription?: string;
    ResultCode?: string | number;
    ResultDesc?: string;
    CheckoutRequestID?: string;
  }>(
    `${getMpesaBaseUrl()}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    { headers: { Authorization: `Bearer ${token}` }, timeout: 15_000, proxy: false }
  );

  return response.data;
};

export const initiateMpesaStkPush = async (input: InitiatePaymentInput) => {
  const amount = input.amount ?? await getSubscriptionAmountDue(input.providerId);
  const normalizedPhoneNumber = normalizeMpesaPhoneNumber(input.phoneNumber);

  if (amount <= 0) {
    throw new ApiError(400, "No payment is due. Existing subscription credit covers this renewal.", "SUBSCRIPTION_CREDIT_COVERS_DUE");
  }

  if (env.MPESA_SIMULATE) {
    const checkoutRequestId = `SIM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await createPendingPayment({
      providerId: input.providerId,
      phoneNumber: normalizedPhoneNumber,
      amount,
      checkoutRequestId,
      merchantRequestId: checkoutRequestId,
    });
    return { checkoutRequestId, message: "Simulated STK push initiated" };
  }

  const MPESA_SHORTCODE = cleanEnvValue(env.MPESA_SHORTCODE);
  const MPESA_PASSKEY = cleanEnvValue(env.MPESA_PASSKEY);
  const MPESA_CALLBACK_URL = cleanEnvValue(env.MPESA_CALLBACK_URL);
  if (!MPESA_SHORTCODE || !MPESA_PASSKEY || !MPESA_CALLBACK_URL) {
    throw new ApiError(500, "Missing M-Pesa shortcode/passkey/callback URL", "MPESA_CONFIG_ERROR");
  }

  const timestamp = formatTimestamp();
  const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`).toString("base64");
  const token = await getMpesaAccessToken();

  let response: {
    data: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResponseCode: string;
      ResponseDescription: string;
      CustomerMessage: string;
    };
  };

  try {
    response = await axios.post<{
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResponseCode: string;
      ResponseDescription: string;
      CustomerMessage: string;
    }>(
      `${getMpesaBaseUrl()}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: normalizedPhoneNumber,
        PartyB: MPESA_SHORTCODE,
        PhoneNumber: normalizedPhoneNumber,
        CallBackURL: getCallbackUrl(),
        AccountReference: input.providerId,
        TransactionDesc: "NLBB Monthly Subscription",
      },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15_000, proxy: false }
    );
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const responseData = error.response?.data;
      const remoteMessage =
        (typeof responseData === "object" && responseData && "errorMessage" in responseData
          ? String((responseData as { errorMessage?: unknown }).errorMessage)
          : undefined) ??
        (typeof responseData === "object" && responseData && "ResponseDescription" in responseData
          ? String((responseData as { ResponseDescription?: unknown }).ResponseDescription)
          : undefined) ??
        error.message;
      throw new ApiError(502, `M-Pesa STK push failed: ${remoteMessage}`, "MPESA_STK_FAILED", responseData);
    }
    throw error;
  }

  await createPendingPayment({
    providerId: input.providerId,
    phoneNumber: normalizedPhoneNumber,
    amount,
    checkoutRequestId: response.data.CheckoutRequestID,
    merchantRequestId: response.data.MerchantRequestID,
  });

  return {
    checkoutRequestId: response.data.CheckoutRequestID,
    message: response.data.CustomerMessage,
  };
};

export const processMpesaCallback = async (payload: MpesaCallbackBody) => {
  const db = getDb();
  const callback = payload.Body?.stkCallback;
  const checkoutRequestId = callback?.CheckoutRequestID;
  if (!checkoutRequestId) {
    throw new ApiError(400, "Missing CheckoutRequestID in callback", "INVALID_CALLBACK");
  }

  const [payment] = await db.select().from(payments).where(eq(payments.checkoutRequestId, checkoutRequestId)).limit(1);
  if (!payment) {
    throw new ApiError(404, "Payment not found for callback", "PAYMENT_NOT_FOUND");
  }

  await db.insert(paymentCallbacks).values({
    paymentId: payment.id,
    externalReference: callback?.MerchantRequestID ?? null,
    payloadJson: JSON.stringify(payload),
    receivedAt: new Date(),
  });

  const success = (callback?.ResultCode ?? 1) === 0;
  if (payment.status === "success" || payment.status === "failed") {
    return { ok: true, checkoutRequestId, status: payment.status, duplicate: true };
  }

  await finalizePaymentStatus(payment, {
    success,
    amountPaid: getCallbackAmount(callback?.CallbackMetadata?.Item, Number(payment.amount)),
    mpesaReceiptNumber: (getMetadataValue(callback?.CallbackMetadata?.Item, "MpesaReceiptNumber") as string | undefined) ?? null,
    rawPayload: payload,
    eventType: success ? "payment_success" : "payment_failed",
  });

  return {
    ok: true,
    checkoutRequestId,
    status: success ? "success" : "failed",
    payment: { id: payment.id },
  };
};

export const reconcilePendingPaymentsForProvider = async (providerId: string) => {
  if (env.MPESA_SIMULATE) {
    await normalizeSubscriptionStatus(providerId);
    return;
  }

  const db = getDb();
  const pendingRows = await db
    .select()
    .from(payments)
    .where(eq(payments.providerId, providerId))
    .orderBy(desc(payments.createdAt));

  for (const payment of pendingRows) {
    if (payment.status !== "pending" || !payment.checkoutRequestId) {
      continue;
    }
    if (payment.checkoutRequestId.startsWith("SIM-")) {
      continue;
    }

    try {
      const result = await queryStkPushStatus(payment.checkoutRequestId);
      const resultCode =
        result.ResultCode === undefined || result.ResultCode === null ? null : Number(result.ResultCode);

      if (resultCode === null || Number.isNaN(resultCode)) {
        continue;
      }

      if (resultCode === STK_QUERY_STILL_PROCESSING_CODE) {
        continue;
      }

      await finalizePaymentStatus(payment, {
        success: resultCode === 0,
        rawPayload: result,
        eventType: resultCode === 0 ? "payment_success_query" : "payment_failed_query",
      });
    } catch (error) {
      if (isRecoverableMpesaError(error)) {
        continue;
      }
      throw error;
    }
  }

  await normalizeSubscriptionStatus(providerId);
};

export const reconcilePendingPaymentsForProviders = async (providerIds: string[]) => {
  for (const providerId of providerIds) {
    await reconcilePendingPaymentsForProvider(providerId);
  }
};

export const listProviderPayments = async (providerId: string) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.providerId, providerId))
    .orderBy(desc(payments.createdAt));

  return rows.map((row) => ({
    id: row.id,
    providerId: row.providerId,
    amount: Number(row.amount),
    phoneNumber: row.phoneNumber ?? "",
    method: row.method as Payment["method"],
    status: row.status as Payment["status"],
    checkoutRequestId: row.checkoutRequestId ?? "",
    merchantRequestId: row.merchantRequestId ?? undefined,
    mpesaReceiptNumber: row.mpesaReceiptNumber ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
};
