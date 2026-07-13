import nodemailer from "nodemailer";
import type { SentMessageInfo, Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { env } from "../config/env";
import type { UserRole } from "../types/domain";

const RESEND_API_BASE_URL = "https://api.resend.com";
const DEFAULT_CONTACT_EMAIL = "info@nlbb.co.ke";

const hasText = (value: string | undefined | null) => Boolean(value?.trim());

const uniqueStrings = (values: Array<string | null>) => [...new Set(values.filter(Boolean) as string[])];

const extractEmailAddress = (value: string | undefined | null) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const angleMatch = trimmed.match(/<([^>]+)>/);
  if (angleMatch?.[1]) {
    return angleMatch[1].trim();
  }

  if (trimmed.includes("@")) {
    return trimmed;
  }

  return null;
};

const getFromAddress = () => env.EMAIL_FROM?.trim() ?? null;

const getReplyToAddress = () =>
  env.EMAIL_REPLY_TO?.trim() ?? extractEmailAddress(env.EMAIL_FROM) ?? DEFAULT_CONTACT_EMAIL;

const isResendConfigured = () => hasText(env.RESEND_API_KEY) && hasText(env.EMAIL_FROM);

const isSmtpConfigured = () =>
  hasText(env.SMTP_HOST) &&
  Boolean(env.SMTP_PORT) &&
  hasText(env.SMTP_USER) &&
  hasText(env.SMTP_PASSWORD) &&
  hasText(env.EMAIL_FROM);

type EmailProvider = "resend" | "smtp" | "unconfigured";

const getEmailProvider = (): EmailProvider => {
  if (isResendConfigured()) {
    return "resend";
  }

  if (isSmtpConfigured()) {
    return "smtp";
  }

  return "unconfigured";
};

const getResendMissingConfig = () =>
  uniqueStrings([
    !hasText(env.RESEND_API_KEY) ? "RESEND_API_KEY" : null,
    !hasText(env.EMAIL_FROM) ? "EMAIL_FROM" : null,
  ]);

const getSmtpMissingConfig = () =>
  uniqueStrings([
    !hasText(env.SMTP_HOST) ? "SMTP_HOST" : null,
    !env.SMTP_PORT ? "SMTP_PORT" : null,
    !hasText(env.SMTP_USER) ? "SMTP_USER" : null,
    !hasText(env.SMTP_PASSWORD) ? "SMTP_PASSWORD" : null,
    !hasText(env.EMAIL_FROM) ? "EMAIL_FROM" : null,
  ]);

const getMissingConfig = () => {
  const provider = getEmailProvider();
  if (provider === "resend") {
    return getResendMissingConfig();
  }

  if (provider === "smtp") {
    return getSmtpMissingConfig();
  }

  return uniqueStrings([...getResendMissingConfig(), ...getSmtpMissingConfig()]);
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

let cachedTransporter: Transporter<SentMessageInfo> | null = null;

export type EmailSendResult =
  | {
      sent: true;
      transport: string;
    }
  | {
      sent: false;
      reason: string;
    };

type SmtpCandidate = {
  key: string;
  label: string;
  options: SMTPTransport.Options;
};

type MailDiagnostic = {
  configured: boolean;
  provider: EmailProvider;
  missing: string[];
  from: string | null;
  replyTo: string | null;
  candidates: Array<
    | {
        label: string;
        provider: "resend";
        endpoint: string;
      }
    | {
        label: string;
        provider: "smtp";
        port: number;
        secure: boolean;
        requireTLS: boolean;
        ignoreTLS: boolean;
        tlsRejectUnauthorized: boolean;
      }
  >;
};

type MailVerificationResult =
  | {
      ok: true;
      candidate: string;
    }
  | {
      ok: false;
      reason: string;
    };

type MailVerificationState =
  | {
      status: "unchecked";
      checkedAt: string | null;
      candidate: null;
      reason: null;
    }
  | {
      status: "ok";
      checkedAt: string;
      candidate: string;
      reason: null;
    }
  | {
      status: "failed";
      checkedAt: string;
      candidate: null;
      reason: string;
    };

let cachedVerificationState: MailVerificationState = {
  status: "unchecked",
  checkedAt: null,
  candidate: null,
  reason: null,
};

const buildTransportOptions = (port: number, secure: boolean): SMTPTransport.Options => ({
  host: env.SMTP_HOST,
  port,
  secure,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASSWORD,
  },
  connectionTimeout: env.SMTP_CONNECTION_TIMEOUT_MS ?? 10_000,
  greetingTimeout: env.SMTP_GREETING_TIMEOUT_MS ?? 10_000,
  socketTimeout: env.SMTP_SOCKET_TIMEOUT_MS ?? 20_000,
  requireTLS: !secure && (env.SMTP_REQUIRE_TLS || port === 587),
  ignoreTLS: !secure && env.SMTP_IGNORE_TLS,
  tls: {
    servername: env.SMTP_HOST,
    rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED,
  },
});

const buildSmtpCandidates = (): SmtpCandidate[] => {
  if (!isSmtpConfigured()) {
    return [];
  }

  const candidates: SmtpCandidate[] = [];
  const registerCandidate = (port: number, secure: boolean, label: string) => {
    const key = `${env.SMTP_HOST}:${port}:${secure ? "secure" : "starttls"}`;
    if (candidates.some((candidate) => candidate.key === key)) {
      return;
    }

    candidates.push({
      key,
      label,
      options: buildTransportOptions(port, secure),
    });
  };

  registerCandidate(env.SMTP_PORT!, env.SMTP_SECURE || env.SMTP_PORT === 465, "primary");

  if (env.SMTP_PORT === 465 && !env.SMTP_SECURE) {
    registerCandidate(465, true, "automatic SSL retry");
  }

  if (env.SMTP_PORT === 587 && env.SMTP_SECURE) {
    registerCandidate(587, false, "automatic STARTTLS retry");
  }

  if (env.SMTP_FALLBACK_PORT) {
    registerCandidate(
      env.SMTP_FALLBACK_PORT,
      env.SMTP_FALLBACK_PORT === 465,
      "configured fallback"
    );
  } else if (env.SMTP_PORT === 465) {
    registerCandidate(587, false, "automatic STARTTLS fallback");
  } else if (env.SMTP_PORT === 587) {
    registerCandidate(465, true, "automatic SSL fallback");
  }

  return candidates;
};

const formatMailError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return "Unknown email error";
  }

  const details = error as Error & {
    code?: string;
    command?: string;
    responseCode?: number;
    response?: string;
  };

  return [
    details.message,
    details.code ? `code=${details.code}` : null,
    details.command ? `command=${details.command}` : null,
    details.responseCode ? `responseCode=${details.responseCode}` : null,
    details.response ? `response=${details.response}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
};

const getTransporter = (candidate: SmtpCandidate) => {
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport(candidate.options);
  }

  return cachedTransporter;
};

const sendViaResend = async (payload: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<EmailSendResult> => {
  const from = getFromAddress();
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!from) {
    return {
      sent: false,
      reason: `Resend is not configured. Missing: ${getResendMissingConfig().join(", ")}`,
    };
  }

  if (!apiKey) {
    return {
      sent: false,
      reason: `Resend is not configured. Missing: ${getResendMissingConfig().join(", ")}`,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${RESEND_API_BASE_URL}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [payload.to],
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      }),
      signal: controller.signal,
    });

    const responseText = await response.text();
    if (!response.ok) {
      return {
        sent: false,
        reason: `Resend send failed (${response.status}): ${responseText || response.statusText}`,
      };
    }

    return { sent: true, transport: "resend" };
  } catch (error) {
    return {
      sent: false,
      reason: formatMailError(error),
    };
  } finally {
    clearTimeout(timeout);
  }
};

const sendViaSmtp = async (payload: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<EmailSendResult> => {
  const candidates = buildSmtpCandidates();
  if (candidates.length === 0) {
    // eslint-disable-next-line no-console
    console.warn("[email] SMTP is not configured; skipping email send", {
      missing: getSmtpMissingConfig(),
    });
    return {
      sent: false,
      reason: `SMTP is not configured. Missing: ${getSmtpMissingConfig().join(", ")}`,
    };
  }

  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      cachedTransporter = null;
      const transport = getTransporter(candidate);
      const from = getFromAddress();
      if (!from) {
        return {
          sent: false,
          reason: `SMTP is not configured. Missing: ${getSmtpMissingConfig().join(", ")}`,
        };
      }
      await transport.sendMail({
        from,
        to: payload.to,
        replyTo: getReplyToAddress(),
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      });

      if (candidate.label !== "primary") {
        // eslint-disable-next-line no-console
        console.warn(`[email] sent successfully using ${candidate.label}`);
      }

      return { sent: true, transport: candidate.label };
    } catch (error) {
      lastError = error;
      cachedTransporter = null;
      // eslint-disable-next-line no-console
      console.warn(
        `[email] failed via ${candidate.label} (${env.SMTP_HOST}:${candidate.options.port}, secure=${candidate.options.secure})`,
        formatMailError(error)
      );
    }
  }

  return {
    sent: false,
    reason: formatMailError(lastError),
  };
};

const verifyResendTransport = async (): Promise<MailVerificationResult> => {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey || !getFromAddress()) {
    const reason = `Resend is not configured. Missing: ${getResendMissingConfig().join(", ")}`;
    cachedVerificationState = {
      status: "failed",
      checkedAt: new Date().toISOString(),
      candidate: null,
      reason,
    };
    return { ok: false, reason };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${RESEND_API_BASE_URL}/domains`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    const responseText = await response.text();
    if (!response.ok) {
      if (response.status === 401 && responseText.includes("restricted_api_key")) {
        cachedVerificationState = {
          status: "ok",
          checkedAt: new Date().toISOString(),
          candidate: "resend (send-only key)",
          reason: null,
        };
        return { ok: true, candidate: "resend (send-only key)" };
      }

      const reason = `Resend verification failed (${response.status}): ${responseText || response.statusText}`;
      cachedVerificationState = {
        status: "failed",
        checkedAt: new Date().toISOString(),
        candidate: null,
        reason,
      };
      return { ok: false, reason };
    }

    cachedVerificationState = {
      status: "ok",
      checkedAt: new Date().toISOString(),
      candidate: "resend",
      reason: null,
    };
    return { ok: true, candidate: "resend" };
  } catch (error) {
    const reason = formatMailError(error);
    cachedVerificationState = {
      status: "failed",
      checkedAt: new Date().toISOString(),
      candidate: null,
      reason,
    };
    return { ok: false, reason };
  } finally {
    clearTimeout(timeout);
  }
};

const verifySmtpTransport = async (): Promise<MailVerificationResult> => {
  const candidates = buildSmtpCandidates();
  if (candidates.length === 0) {
    const reason = `SMTP is not configured. Missing: ${getSmtpMissingConfig().join(", ")}`;
    cachedVerificationState = {
      status: "failed",
      checkedAt: new Date().toISOString(),
      candidate: null,
      reason,
    };
    return { ok: false, reason };
  }

  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      cachedTransporter = null;
      const transport = getTransporter(candidate);
      await transport.verify();
      cachedTransporter = null;
      cachedVerificationState = {
        status: "ok",
        checkedAt: new Date().toISOString(),
        candidate: candidate.label,
        reason: null,
      };
      return { ok: true, candidate: candidate.label };
    } catch (error) {
      lastError = error;
      cachedTransporter = null;
      // eslint-disable-next-line no-console
      console.warn(
        `[email] verify failed via ${candidate.label} (${env.SMTP_HOST}:${candidate.options.port}, secure=${candidate.options.secure})`,
        formatMailError(error)
      );
    }
  }

  const reason = formatMailError(lastError);
  cachedVerificationState = {
    status: "failed",
    checkedAt: new Date().toISOString(),
    candidate: null,
    reason,
  };

  return {
    ok: false,
    reason,
  };
};

const sendEmail = async (payload: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<EmailSendResult> => {
  const provider = getEmailProvider();

  if (provider === "resend") {
    return sendViaResend(payload);
  }

  if (provider === "smtp") {
    return sendViaSmtp(payload);
  }

  // eslint-disable-next-line no-console
  console.warn("[email] email transport is not configured; skipping email send", {
    missing: getMissingConfig(),
  });
  return {
    sent: false,
    reason: `Email transport is not configured. Missing: ${getMissingConfig().join(", ")}`,
  };
};

export const getEmailDiagnostics = (): MailDiagnostic => {
  const provider = getEmailProvider();

  return {
    configured: provider !== "unconfigured",
    provider,
    missing: getMissingConfig(),
    from: getFromAddress(),
    replyTo: getReplyToAddress(),
    candidates:
      provider === "resend"
        ? [
            {
              label: "resend",
              provider: "resend",
              endpoint: "POST /emails",
            },
          ]
        : buildSmtpCandidates().map((candidate) => ({
            label: candidate.label,
            provider: "smtp" as const,
            port: candidate.options.port ?? 0,
            secure: Boolean(candidate.options.secure),
            requireTLS: Boolean(candidate.options.requireTLS),
            ignoreTLS: Boolean(candidate.options.ignoreTLS),
            tlsRejectUnauthorized: candidate.options.tls?.rejectUnauthorized !== false,
          })),
  };
};

export const getEmailVerificationState = (): MailVerificationState => cachedVerificationState;

export const verifyEmailTransport = async (): Promise<MailVerificationResult> => {
  const provider = getEmailProvider();

  if (provider === "resend") {
    return verifyResendTransport();
  }

  if (provider === "smtp") {
    return verifySmtpTransport();
  }

  const reason = `Email transport is not configured. Missing: ${getMissingConfig().join(", ")}`;
  cachedVerificationState = {
    status: "failed",
    checkedAt: new Date().toISOString(),
    candidate: null,
    reason,
  };

  return {
    ok: false,
    reason,
  };
};

const wrapTemplate = (title: string, bodyHtml: string) => `
  <div style="margin:0;padding:0;background:#f8f5ef;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      <div style="background:#ffffff;border:1px solid #eadfc7;border-radius:20px;padding:32px;">
        <div style="font-size:14px;font-weight:700;letter-spacing:0.12em;color:#b68c18;margin-bottom:12px;">NLBB</div>
        <h1 style="margin:0 0 20px;font-size:30px;line-height:1.1;color:#1d1d1d;">${escapeHtml(title)}</h1>
        <div style="font-size:16px;line-height:1.7;color:#333;">${bodyHtml}</div>
      </div>
      <div style="padding:18px 4px 0;font-size:12px;line-height:1.6;color:#7b6b4c;text-align:center;">
        If you did not request this email, you can ignore it.
      </div>
    </div>
  </div>
`;

const paragraph = (text: string) => `<p style="margin:0 0 16px;">${escapeHtml(text)}</p>`;

export const sendWelcomeEmail = async (input: {
  to: string;
  fullName: string;
  role: UserRole;
}): Promise<EmailSendResult> => {
  const roleLabel = input.role === "provider" ? "Provider" : input.role === "admin" ? "Admin" : "Customer";
  const contactEmail = getReplyToAddress();
  const subject = `Welcome to NLBB, ${input.fullName}`;
  const body = [
    paragraph(`Hi ${input.fullName},`),
    paragraph(`Your ${roleLabel.toLowerCase()} account is ready on NLBB.`),
    input.role === "provider"
      ? paragraph("You can now complete your provider profile and wait for approval before going fully live.")
      : paragraph("You can now sign in and start using the app."),
    paragraph(`If you need help, reply to this email or contact ${contactEmail}.`),
  ].join("");

  const text = [
    `Hi ${input.fullName},`,
    "",
    `Your ${roleLabel.toLowerCase()} account is ready on NLBB.`,
    input.role === "provider"
      ? "You can now complete your provider profile and wait for approval before going fully live."
      : "You can now sign in and start using the app.",
    "",
    `If you need help, reply to this email or contact ${contactEmail}.`,
  ].join("\n");

  return sendEmail({
    to: input.to,
    subject,
    text,
    html: wrapTemplate(subject, body),
  });
};

export const sendPasswordResetEmail = async (input: { to: string; resetLink: string }): Promise<EmailSendResult> => {
  const contactEmail = getReplyToAddress();
  const subject = "Reset your NLBB password";
  const body = [
    paragraph("We received a request to reset your NLBB password."),
    paragraph(
      `Tap the button below to continue. If the button does not work, copy and paste this link into your browser: ${input.resetLink}`
    ),
    `<p style="margin:24px 0;"><a href="${escapeHtml(
      input.resetLink
    )}" style="display:inline-block;background:#b68c18;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:700;">Reset password</a></p>`,
    paragraph(`This link is for your account only. If you did not ask for a reset, you can ignore this email.`),
    paragraph(`Need help? Reply to this message or email ${contactEmail}.`),
  ].join("");

  const text = [
    "We received a request to reset your NLBB password.",
    "",
    `Use this link to continue: ${input.resetLink}`,
    "",
    "If you did not ask for a reset, you can ignore this email.",
    `Need help? Reply to this message or email ${contactEmail}.`,
  ].join("\n");

  return sendEmail({
    to: input.to,
    subject,
    text,
    html: wrapTemplate(subject, body),
  });
};
