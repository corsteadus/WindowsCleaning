import assert from "node:assert/strict";
import { test } from "node:test";
import { clientErrorResponse } from "./error-response.ts";

const REF = "11111111-2222-3333-4444-555555555555";

// The error a failing Drizzle query actually throws: the SQL and the bound
// parameters are in the message, and on the login route one of those
// parameters is whatever username was submitted.
const DRIZZLE_ERROR = {
  message:
    'Failed query: select "users"."id", "users"."password_hash" from "users" '
    + 'where "users"."username" = $1 limit $2\nparams: admin@example.com,1',
};

test("a database failure tells the caller nothing about the query", () => {
  const { status, body } = clientErrorResponse(DRIZZLE_ERROR, REF);
  assert.equal(status, 500);
  assert.equal(body.error, "Internal server error");
  assert.equal(body.reference, REF);
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /select/i);
  assert.doesNotMatch(serialized, /users/);
  assert.doesNotMatch(serialized, /admin@example\.com/);
});

test("an error with no status at all is treated as a server error", () => {
  const { status, body } = clientErrorResponse(new Error("connection terminated"), REF);
  assert.equal(status, 500);
  assert.equal(body.error, "Internal server error");
});

test("a deliberate 4xx keeps the message written for the caller", () => {
  const { status, body } = clientErrorResponse(
    { status: 409, message: "Jobs linked to an invoice cannot be deleted", code: "invoice_linked_job" },
    REF,
  );
  assert.equal(status, 409);
  assert.equal(body.error, "Jobs linked to an invoice cannot be deleted");
  assert.equal(body.code, "invoice_linked_job");
  assert.equal(body.reference, undefined);
});

test("statusCode is honoured the same way as status", () => {
  assert.equal(clientErrorResponse({ statusCode: 404, message: "Not found" }, REF).status, 404);
});

test("a 5xx carried on the error is kept, but its message is not", () => {
  const { status, body } = clientErrorResponse({ status: 503, message: "pool exhausted: host=db" }, REF);
  assert.equal(status, 503);
  assert.equal(body.error, "Internal server error");
});

test("a nonsense status falls back to 500 rather than being echoed", () => {
  for (const bad of [200, 0, -1, 999, "409", null, undefined, NaN]) {
    assert.equal(clientErrorResponse({ status: bad, message: "leaky" }, REF).status, 500);
  }
});

test("a 4xx with an empty message still says something", () => {
  assert.equal(clientErrorResponse({ status: 400, message: "   " }, REF).body.error, "Request failed");
});

test("a null error is handled", () => {
  assert.equal(clientErrorResponse(null, REF).status, 500);
});
