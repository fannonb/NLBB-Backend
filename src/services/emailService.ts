import nodemailer from "nodemailer";
import type { SentMessageInfo, Transporter } from "nodemailer";
import { env } from "../config/env";
import type { UserRole } from "../types/domain";

const SUPPORT_EMAIL = "support@nlbb.co.ke";

const isConfigured = () =>
  !!env.SMTP_HOST &&
  !!env.SMTP_PORT &&
  !!env.SMTP_USER &&
  !!env.SMTP_PASSWORD &&
  !!env.EMAIL_FROM;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

let cachedTransporter: Transporter<SentMessageInfo> | null = null;

const getTransporter = () => {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  if (!isConfigured()) {
    return null;
  }

  cachedTransporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
    },
  });

  return cachedTransporter;
};

const sendEmail = async (payload: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) => {
  const transport = getTransporter();
  if (!transport) {
    // eslint-disable-next-line no-console
    console.warn("[email] SMTP is not configured; skipping email send");
    return { sent: false as const };
  }

  await transport.sendMail({
    from: env.EMAIL_FROM,
    to: payload.to,
    replyTo: env.EMAIL_REPLY_TO ?? SUPPORT_EMAIL,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });

  return { sent: true as const };
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
}) => {
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

export const sendPasswordResetEmail = async (input: { to: string; resetLink: string }) => {
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
