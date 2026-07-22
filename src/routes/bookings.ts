import { Router } from "express";
import { z } from "zod";
import { assertMpesaPaymentsEnabled } from "../config/features";
import { createBooking, createBookingSchema, listBookingsForUser, updateBookingStatus, updateBookingStatusSchema } from "../services/bookingPgService";
import { requireAuth, requireRole } from "../middleware/auth";
import { paymentLimiter } from "../middleware/rateLimiters";
import { getBookingPaymentStatus, initiateBookingMpesaStkPush } from "../services/paymentPgService";
import { asyncHandler } from "../utils/asyncHandler";

export const bookingsRouter = Router();

bookingsRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const bookings = await listBookingsForUser(req.auth!.uid, req.auth!.role);
    res.json({ success: true, data: bookings });
  })
);

bookingsRouter.post(
  "/",
  requireAuth,
  requireRole("customer", "admin"),
  asyncHandler(async (req, res) => {
    const payload = createBookingSchema.parse(req.body);
    const booking = await createBooking(req.auth!.uid, payload);
    res.status(201).json({ success: true, data: booking });
  })
);

bookingsRouter.post(
  "/:bookingId/pay",
  paymentLimiter,
  requireAuth,
  requireRole("customer", "admin"),
  asyncHandler(async (req, res) => {
    assertMpesaPaymentsEnabled();
    const payload = z.object({ phoneNumber: z.string().min(9) }).parse(req.body);
    const result = await initiateBookingMpesaStkPush({
      bookingId: req.params.bookingId,
      customerId: req.auth!.uid,
      phoneNumber: payload.phoneNumber,
    });
    res.status(202).json({ success: true, data: result });
  })
);

bookingsRouter.get(
  "/:bookingId/payment-status",
  requireAuth,
  requireRole("customer", "admin"),
  asyncHandler(async (req, res) => {
    const result = await getBookingPaymentStatus(req.params.bookingId, req.auth!.uid, {
      reconcile: req.query.reconcile === "true",
    });
    res.json({ success: true, data: result });
  })
);

bookingsRouter.patch(
  "/:bookingId/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = updateBookingStatusSchema.parse(req.body);
    const booking = await updateBookingStatus(req.params.bookingId, req.auth!, payload.status);
    res.json({ success: true, data: booking });
  })
);
