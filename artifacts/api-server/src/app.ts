import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { authMiddleware } from "./middlewares/authMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import { clientErrorResponse } from "./lib/error-response";
import {
  authorizeApiRequest,
  setAuthenticatedApiCacheHeaders,
} from "./lib/authorization";

const app: Express = express();

// Disable ETags so clients always receive fresh data instead of 304 Not Modified
app.set("etag", false);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0]?.replace(/\/public\/estimates\/[^/]+/, "/public/estimates/[redacted]"),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
// Stripe webhooks require the raw body for signature verification — must come before express.json()
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));
// 50 MB global limit — large enough for import JSON payloads (Customer Factor exports with thousands of rows)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(authMiddleware);
app.use("/api", setAuthenticatedApiCacheHeaders);
app.use("/api", authorizeApiRequest);

app.use("/api", router);

// ─── Global JSON error handler (must be last, 4-arg signature required) ──────
// Ensures any unhandled throw inside a route returns JSON, never HTML.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const reference = randomUUID();
  logger.error({ err, reference }, "Unhandled route error");
  const { status, body } = clientErrorResponse(err, reference);
  if (!res.headersSent) {
    res.status(status).json(body);
  }
});

export default app;
