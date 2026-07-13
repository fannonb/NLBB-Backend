import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { supabaseAdmin } from "../lib/supabase";
import { createSupabaseAuthClient } from "../lib/supabaseAuth";
import { env } from "../config/env";
import {
  ensureUserFromSupabaseAuth,
  getUserPreferences,
  getUserProfile,
  setUserAvatar,
  upsertPushToken,
  upsertPushTokenSchema,
  upsertUserPreferences,
  upsertUserPreferencesSchema,
  upsertUserProfile,
  upsertUserProfileSchema,
} from "../services/userService";
import { ApiError } from "../utils/apiError";
import { asyncHandler } from "../utils/asyncHandler";
import { z } from "zod";
import { uploadUserAvatar } from "../services/mediaStorageService";
import { sendPasswordResetEmail, sendWelcomeEmail } from "../services/emailService";
import type { UserRole } from "../types/domain";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2),
  phone: z.string().min(9).optional(),
  role: z.enum(["customer", "provider"]).optional().default("customer"),
  location: z.string().min(2).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  /** The access_token from the Supabase recovery email deep-link */
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

const uploadAvatarSchema = z.object({
  dataUri: z.string().min(16),
});

const normalizeAuthError = (error: { message?: string; status?: number; code?: string } | null) => {
  if (!error) {
    return null;
  }

  const message = error.message ?? "Authentication failed";
  const lower = message.toLowerCase();

  if (lower.includes("invalid login credentials")) {
    return new ApiError(401, "Invalid email or password", "INVALID_CREDENTIALS");
  }

  if (lower.includes("already registered") || lower.includes("already been registered")) {
    return new ApiError(409, "An account already exists for this email", "EMAIL_IN_USE");
  }

  if (lower.includes("password")) {
    return new ApiError(400, message, error.code ?? "INVALID_PASSWORD");
  }

  return new ApiError(error.status ?? 400, message, error.code ?? "AUTH_ERROR");
};

const mapAuthSessionResponse = async (
  accessToken: string,
  refreshToken: string,
  expiresIn: number | undefined,
  authUser: Parameters<typeof ensureUserFromSupabaseAuth>[0],
  overrides?: {
    role?: UserRole;
    fullName?: string | null;
    phone?: string | null;
    location?: string | null;
  }
) => {
  const user = await ensureUserFromSupabaseAuth(authUser, overrides);
  return {
    accessToken,
    refreshToken,
    expiresIn: expiresIn ?? 3600,
    user,
  };
};

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const payload = registerSchema.parse(req.body);
    const authClient = createSupabaseAuthClient();

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: payload.email.trim().toLowerCase(),
      password: payload.password,
      email_confirm: true,
      user_metadata: {
        role: payload.role,
        full_name: payload.fullName,
        phone: payload.phone ?? null,
        location: payload.location ?? null,
      },
    });

    if (createError || !created.user) {
      throw normalizeAuthError(createError) ?? new ApiError(400, "Could not create account", "REGISTER_FAILED");
    }

    const { data: signedIn, error: signInError } = await authClient.auth.signInWithPassword({
      email: payload.email.trim().toLowerCase(),
      password: payload.password,
    });

    if (signInError || !signedIn.session || !signedIn.user) {
      throw (
        normalizeAuthError(signInError) ??
        new ApiError(502, "Account created but session could not be established", "SESSION_CREATE_FAILED")
      );
    }

    const response = await mapAuthSessionResponse(
      signedIn.session.access_token,
      signedIn.session.refresh_token,
      signedIn.session.expires_in,
      signedIn.user,
      {
        role: payload.role,
        fullName: payload.fullName,
        phone: payload.phone ?? null,
        location: payload.location ?? null,
      }
    );

    void sendWelcomeEmail({
      to: payload.email.trim().toLowerCase(),
      fullName: payload.fullName.trim(),
      role: payload.role,
    }).then((result) => {
      if (!result.sent) {
        console.error("[auth] welcome email not sent:", result.reason);
      }
    }).catch((error) => {
      console.error("[auth] welcome email failed:", error);
    });

    res.status(201).json({ success: true, data: response });
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const payload = loginSchema.parse(req.body);
    const authClient = createSupabaseAuthClient();

    const { data, error } = await authClient.auth.signInWithPassword({
      email: payload.email.trim().toLowerCase(),
      password: payload.password,
    });

    if (error || !data.session || !data.user) {
      throw normalizeAuthError(error) ?? new ApiError(401, "Invalid email or password", "INVALID_CREDENTIALS");
    }

    const response = await mapAuthSessionResponse(
      data.session.access_token,
      data.session.refresh_token,
      data.session.expires_in,
      data.user
    );

    res.json({ success: true, data: response });
  })
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const payload = refreshSchema.parse(req.body);
    const authClient = createSupabaseAuthClient();

    const { data, error } = await authClient.auth.refreshSession({
      refresh_token: payload.refreshToken,
    });

    if (error || !data.session) {
      throw normalizeAuthError(error) ?? new ApiError(401, "Invalid refresh token", "INVALID_REFRESH_TOKEN");
    }

    if (data.user) {
      await ensureUserFromSupabaseAuth(data.user);
    }

    res.json({
      success: true,
      data: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresIn: data.session.expires_in ?? 3600,
      },
    });
  })
);

// Sign out the current Supabase session.
// Note: clients should also call supabase.auth.signOut() to clear local tokens.
authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    await supabaseAdmin.auth.admin.signOut(req.auth!.sessionId);
    res.json({ success: true, data: { revoked: true } });
  })
);

authRouter.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = changePasswordSchema.parse(req.body);
    const authClient = createSupabaseAuthClient();

    const { error: verifyError } = await authClient.auth.signInWithPassword({
      email: req.auth!.email,
      password: payload.currentPassword,
    });

    if (verifyError) {
      throw normalizeAuthError(verifyError) ?? new ApiError(401, "Current password is incorrect", "INVALID_CREDENTIALS");
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(req.auth!.uid, {
      password: payload.newPassword,
    });

    if (updateError) {
      throw normalizeAuthError(updateError) ?? new ApiError(400, "Password update failed", "PASSWORD_UPDATE_FAILED");
    }

    res.json({ success: true, data: { updated: true } });
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await getUserProfile(req.auth!.uid);
    res.json({ success: true, data: user });
  })
);

authRouter.post(
  "/avatar",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = uploadAvatarSchema.parse(req.body);
    const uploaded = await uploadUserAvatar(req.auth!.uid, payload.dataUri);
    const user = await setUserAvatar(req.auth!.uid, uploaded.publicUrl);
    res.status(201).json({ success: true, data: user });
  })
);

// Called after Supabase signup to set display name, role, and other profile fields.
authRouter.post(
  "/profile",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = upsertUserProfileSchema.parse(req.body);
    const user = await upsertUserProfile(req.auth!.uid, req.auth?.email, payload);
    res.status(201).json({ success: true, data: user });
  })
);

authRouter.get(
  "/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const preferences = await getUserPreferences(req.auth!.uid);
    res.json({ success: true, data: preferences });
  })
);

authRouter.patch(
  "/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = upsertUserPreferencesSchema.parse(req.body);
    const preferences = await upsertUserPreferences(req.auth!.uid, payload);
    res.json({ success: true, data: preferences });
  })
);

authRouter.post(
  "/push-token",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = upsertPushTokenSchema.parse(req.body);
    await upsertPushToken(req.auth!.uid, payload);
    res.json({ success: true, data: { registered: true } });
  })
);

// ─── Password Recovery ────────────────────────────────────────────────────────

/**
 * POST /api/auth/forgot-password
 *
 * Generates a recovery link and sends it through the NLBB email provider.
 * Always returns 200 regardless of whether the email exists in order to
 * prevent user-enumeration attacks.
 *
 * The email contains a recovery link that redirects into the mobile reset flow:
 *   <PASSWORD_RESET_REDIRECT_URL>#access_token=<token>&type=recovery
 *
 * The mobile client must intercept this deep-link, extract the access_token,
 * and POST it together with the new password to /api/auth/reset-password.
 */
authRouter.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    let sent = false;

    try {
      const { email } = forgotPasswordSchema.parse(req.body);
      const { data, error } = await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email: email.trim().toLowerCase(),
        options: {
          redirectTo: env.PASSWORD_RESET_REDIRECT_URL,
        },
      });

      if (error || !data?.properties?.action_link) {
        throw error ?? new Error("Recovery link could not be generated");
      }

      const emailResult = await sendPasswordResetEmail({
        to: email.trim().toLowerCase(),
        resetLink: data.properties.action_link,
      });

      sent = emailResult.sent;
      if (!emailResult.sent) {
        console.error("[auth] password reset email not sent:", emailResult.reason);
      }
    } catch (err) {
      // Log server-side but do not expose to client.
      console.error("[auth] forgot-password internal error:", err);
    }

    res.json({ success: true, data: { sent } });
  })
);

/**
 * POST /api/auth/reset-password
 *
 * Accepts the recovery access_token extracted from the deep-link email and
 * sets a new password for the corresponding user.
 *
 * Flow:
 *  1. Mobile app receives the deep-link: nlbb://reset-password#access_token=xxx&type=recovery
 *  2. App parses the token from the URL fragment.
 *  3. App POSTs { token, newPassword } to this endpoint.
 *  4. Backend verifies the token via supabase.auth.getUser() and updates the password.
 */
authRouter.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);

    // Resolve the user ID from the recovery access token
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !userData.user) {
      throw new ApiError(
        401,
        "This reset link is invalid or has expired. Please request a new one.",
        "INVALID_RESET_TOKEN"
      );
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      userData.user.id,
      { password: newPassword }
    );

    if (updateError) {
      throw (
        normalizeAuthError(updateError) ??
        new ApiError(400, "Password could not be updated. Please try again.", "PASSWORD_UPDATE_FAILED")
      );
    }

    res.json({ success: true, data: { reset: true } });
  })
);
