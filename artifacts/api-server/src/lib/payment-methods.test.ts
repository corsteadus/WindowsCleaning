import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  PAYMENT_METHOD_OPTIONS, PAYMENT_METHOD_VALUES, paymentMethodLabel, paymentReferenceHint,
} from "./payment-methods.ts";
import { MANUAL_PAYMENT_METHODS } from "./payment-core.ts";

describe("the payment methods on offer", () => {
  it("offers the four Kyle named, in his order, first", () => {
    assert.deepEqual(PAYMENT_METHOD_VALUES.slice(0, 4),
      ["cash", "credit_card", "check", "gift_certificate"]);
  });

  it("keeps the methods that were already in use, so old payments still read", () => {
    for (const kept of ["ach", "bank_transfer", "other"]) {
      assert.ok(PAYMENT_METHOD_VALUES.includes(kept), `${kept} was dropped`);
    }
  });

  it("offers no method twice", () => {
    assert.equal(new Set(PAYMENT_METHOD_VALUES).size, PAYMENT_METHOD_VALUES.length);
  });

  it("gives every method a label a person would recognise", () => {
    for (const option of PAYMENT_METHOD_OPTIONS) {
      assert.ok(option.label.trim().length > 0, `${option.value} has no label`);
      assert.doesNotMatch(option.label, /_/, `${option.value} shows its raw value`);
    }
    assert.equal(paymentMethodLabel("gift_certificate"), "Gift Certificate");
    assert.equal(paymentMethodLabel("bank_transfer"), "Bank transfer");
  });

  it("reads the one-click Mark Paid value without offering it as a choice", () => {
    assert.equal(paymentMethodLabel("manual"), "Marked paid");
    assert.ok(!PAYMENT_METHOD_VALUES.includes("manual"), "nobody should pick it from a list");
    assert.ok((MANUAL_PAYMENT_METHODS as readonly string[]).includes("manual"),
      "but the API must still accept what Mark Paid writes");
  });

  it("never shows an empty method as a blank", () => {
    assert.equal(paymentMethodLabel(null), "Unknown");
    assert.equal(paymentMethodLabel(""), "Unknown");
    assert.equal(paymentMethodLabel("something_we_stopped_using"), "something_we_stopped_using");
  });

  it("names what the reference beside each method is for", () => {
    assert.equal(paymentReferenceHint("check"), "Check number");
    assert.equal(paymentReferenceHint("gift_certificate"), "Certificate number");
    assert.equal(paymentReferenceHint("cash"), "Reference");
    assert.equal(paymentReferenceHint(null), "Reference");
  });

  it("never asks for card details on a credit card payment", () => {
    // Kyle #6: Corstead should not prompt for sensitive card information.
    assert.doesNotMatch(paymentReferenceHint("credit_card"), /card number|cvv|last 4|expiry/i);
    assert.equal(paymentReferenceHint("credit_card"), "Authorisation or receipt number");
  });

  it("accepts every offered method, and refuses one that is not offered", () => {
    for (const value of PAYMENT_METHOD_VALUES) {
      assert.ok((MANUAL_PAYMENT_METHODS as readonly string[]).includes(value), `${value} would be refused`);
    }
    assert.ok(!(MANUAL_PAYMENT_METHODS as readonly string[]).includes("bitcoin"));
  });
});
