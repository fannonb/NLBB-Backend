import nodemailer from "nodemailer";
import type { SentMessageInfo, Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { env } from "../config/env";
import type { UserRole } from "../types/domain";

const SUPPORT_EMAIL = "support@nlbb.co.ke";

const getMissingConfig = () =>
  [
    !env.SMTP_HOST ? "SMTP_HOST" : null,
    !env.SMTP_PORT ? "SMTP_PORT" : null,
    !env.SMTP_USER ? "SMTP_USER" : null,
    !env.SMTP_PASSWORD ? "SMTP_PASSWORD" : null,
    !env.EMAIL_FROM ? "EMAIL_FROM" : null,
  ].filter(Boolean) as string[];

const isConfigured = () => getMissingConfig().length === 0;

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
  missing: string[];
  host: string | null;
  from: string | null;
  replyTo: string | null;
  candidates: Array<{
    label: string;
    port: number;
    secure: boolean;
    requireTLS: boolean;
    ignoreTLS: boolean;
    tlsRejectUnauthorized: boolean;
  }>;
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

const buildTransportCandidates = (): SmtpCandidate[] => {
  if (!isConfigured()) {
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

const sendEmail = async (payload: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<EmailSendResult> => {
  const candidates = buildTransportCandidates();
  if (candidates.length === 0) {
    // eslint-disable-next-line no-console
    console.warn("[email] SMTP is not configured; skipping email send", {
      missing: getMissingConfig(),
    });
    return {
      sent: false,
      reason: `SMTP is not configured. Missing: ${getMissingConfig().join(", ")}`,
    };
  }

  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      cachedTransporter = null;
      const transport = getTransporter(candidate);
      await transport.sendMail({
        from: env.EMAIL_FROM,
        to: payload.to,
        replyTo: env.EMAIL_REPLY_TO ?? SUPPORT_EMAIL,
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

export const getEmailDiagnostics = (): MailDiagnostic => {
  const candidates = buildTransportCandidates();

  return {
    configured: isConfigured(),
    missing: getMissingConfig(),
    host: env.SMTP_HOST ?? null,
    from: env.EMAIL_FROM ?? null,
    replyTo: env.EMAIL_REPLY_TO ?? SUPPORT_EMAIL,
    candidates: candidates.map((candidate) => ({
      label: candidate.label,
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
  const candidates = buildTransportCandidates();
  if (candidates.length === 0) {
    cachedVerificationState = {
      status: "failed",
      checkedAt: new Date().toISOString(),
      candidate: null,
      reason: `SMTP is not configured. Missing: ${getMissingConfig().join(", ")}`,
    };
    return {
      ok: false,
      reason: `SMTP is not configured. Missing: ${getMissingConfig().join(", ")}`,
    };
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
  const subject = `Welcome to NLBB, ${input.fullName}`;
  const body = [
    paragraph(`Hi ${input.fullName},`),
    paragraph(`Your ${roleLabel.toLowerCase()} account is ready on NLBB.`),
    input.role === "provider"
      ? paragraph("You can now complete your provider profile and wait for approval before going fully live.")
      : paragraph("You can now sign in and start using the app."),
    paragraph(`If you need help, reply to this email or contact ${SUPPORT_EMAIL}.`),
  ].join("");

  const text = [
    `Hi ${input.fullName},`,
    "",
    `Your ${roleLabel.toLowerCase()} account is ready on NLBB.`,
    input.role === "provider"
      ? "You can now complete your provider profile and wait for approval before going fully live."
      : "You can now sign in and start using the app.",
    "",
    `If you need help, reply to this email or contact ${SUPPORT_EMAIL}.`,
  ].join("\n");

  return sendEmail({
    to: input.to,
    subject,
    text,
    html: wrapTemplate(subject, body),
  });
};

export const sendPasswordResetEmail = async (input: { to: string; resetLink: string }): Promise<EmailSendResult> => {
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
    paragraph(`Need help? Reply to this message or email ${SUPPORT_EMAIL}.`),
  ].join("");

  const text = [
    "We received a request to reset your NLBB password.",
    "",
    `Use this link to continue: ${input.resetLink}`,
    "",
    "If you did not ask for a reset, you can ignore this email.",
    `Need help? Reply to this message or email ${SUPPORT_EMAIL}.`,
  ].join("\n");

  return sendEmail({
    to: input.to,
    subject,
    text,
    html: wrapTemplate(subject, body),
  });
};
