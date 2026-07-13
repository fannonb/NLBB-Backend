import path from "node:path";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { allowedOrigins, trustProxy } from "./config/env";
import { requestContext } from "./middleware/requestContext";
import { adminRouter } from "./routes/admin";
import { analyticsRouter } from "./routes/analytics";
import { authRouter } from "./routes/auth";
import { bookingsRouter } from "./routes/bookings";
import { categoriesRouter } from "./routes/categories";
import { configRouter } from "./routes/config";
import { favoritesRouter } from "./routes/favorites";
import { healthRouter } from "./routes/health";
import { notificationsRouter } from "./routes/notifications";
import { paymentsRouter } from "./routes/payments";
import { providersRouter } from "./routes/providers";
import { reviewsRouter } from "./routes/reviews";
import { subscriptionsRouter } from "./routes/subscriptions";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { apiLimiter, authLimiter } from "./middleware/rateLimiters";

export const app = express();

app.set("trust proxy", trustProxy);

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(requestContext);
app.use(express.json({ limit: "10mb" }));
app.use(
  morgan((tokens, req, res) => {
    const requestId = (req as typeof req & { requestId?: string }).requestId ?? "n/a";
    return [
      requestId,
      tokens.method(req, res),
      tokens.url(req, res),
      tokens.status(req, res),
      tokens["response-time"](req, res),
      "ms",
    ].join(" ");
  })
);
app.use((req, res, next) => {
  const path = req.path;
  const hasScopedLimiter =
    path.startsWith("/api/auth") ||
    path.startsWith("/api/payments/me") ||
    path.startsWith("/api/subscriptions/me/pay");

  if (hasScopedLimiter) {
    next();
    return;
  }

  apiLimiter(req, res, next);
});

app.get("/", (_req, res) => {
  res.json({
    success: true,
    data: {
      name: "NLBB Backend API",
      docs: "/api/health",
    },
  });
});

app.use("/api/health", healthRouter);
app.use("/api/config", configRouter);
app.use("/api/auth", authLimiter, authRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/providers", providersRouter);
app.use("/api/favorites", favoritesRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/reviews", reviewsRouter);
app.use("/api/subscriptions", subscriptionsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/admin", adminRouter);
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

app.use(notFoundHandler);
app.use(errorHandler);
