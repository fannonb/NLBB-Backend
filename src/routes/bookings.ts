import { Router } from "express";
import { createBooking, createBookingSchema, listBookingsForUser, updateBookingStatus, updateBookingStatusSchema } from "../services/bookingPgService";
import { requireAuth, requireRole } from "../middleware/auth";
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

bookingsRouter.patch(
  "/:bookingId/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = updateBookingStatusSchema.parse(req.body);
    const booking = await updateBookingStatus(req.params.bookingId, req.auth!, payload.status);
    res.json({ success: true, data: booking });
  })
);
