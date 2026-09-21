/**
 * Shapes the body of an unhandled route error.
 *
 * A thrown Drizzle error carries the failing SQL and its bound parameters in
 * `message`; on the login route those parameters include the submitted
 * username. Returning `err.message` verbatim therefore published internals to
 * whoever triggered the error. Deliberate HTTP errors (a 4xx raised with a
 * `status`) still say what they mean — those messages are written for the
 * caller. Anything 5xx is replaced with a fixed sentence plus a reference the
 * logs carry, so the detail is recoverable without being served.
 */

export interface ErrorLike {
  status?: unknown;
  statusCode?: unknown;
  message?: unknown;
  code?: unknown;
}

export interface ClientErrorResponse {
  status: number;
  body: { error: string; code?: string; reference?: string };
}

function httpStatus(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599
    ? value
    : null;
}

export function clientErrorResponse(err: ErrorLike | null | undefined, reference: string): ClientErrorResponse {
  const status = httpStatus(err?.status) ?? httpStatus(err?.statusCode) ?? 500;

  if (status >= 500) {
    return { status, body: { error: "Internal server error", reference } };
  }

  const message = typeof err?.message === "string" && err.message.trim()
    ? err.message
    : "Request failed";
  const code = typeof err?.code === "string" && err.code ? err.code : undefined;
  return { status, body: code ? { error: message, code } : { error: message } };
}
