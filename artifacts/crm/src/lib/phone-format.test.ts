import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPhoneAsTyped, isCompletePhone, phoneDigits } from "./phone-format.ts";

describe("formatPhoneAsTyped", () => {
  it("shapes a plain ten-digit number the way Kyle asked", () => {
    assert.equal(formatPhoneAsTyped("8165551234"), "(816) 555-1234");
  });

  it("grows as the number is typed, rather than all at once", () => {
    assert.equal(formatPhoneAsTyped("8"), "(8");
    assert.equal(formatPhoneAsTyped("816"), "(816");
    assert.equal(formatPhoneAsTyped("8165"), "(816) 5");
    assert.equal(formatPhoneAsTyped("816555"), "(816) 555");
    assert.equal(formatPhoneAsTyped("8165551"), "(816) 555-1");
  });

  it("accepts a number that is already punctuated and leaves it looking the same", () => {
    assert.equal(formatPhoneAsTyped("(816) 555-1234"), "(816) 555-1234");
    assert.equal(formatPhoneAsTyped("816-555-1234"), "(816) 555-1234");
    assert.equal(formatPhoneAsTyped("816.555.1234"), "(816) 555-1234");
    assert.equal(formatPhoneAsTyped("816 555 1234"), "(816) 555-1234");
  });

  it("keeps a leading country code in front", () => {
    assert.equal(formatPhoneAsTyped("18165551234"), "1 (816) 555-1234");
    assert.equal(formatPhoneAsTyped("1-816-555-1234"), "1 (816) 555-1234");
  });

  it("leaves an international number alone", () => {
    assert.equal(formatPhoneAsTyped("+44 20 7946 0958"), "+44 20 7946 0958");
  });

  it("leaves anything with words in it alone — an extension is not punctuation", () => {
    assert.equal(formatPhoneAsTyped("8165551234 ext 12"), "8165551234 ext 12");
    assert.equal(formatPhoneAsTyped("call the office"), "call the office");
  });

  it("leaves a number too long to be a US one alone", () => {
    assert.equal(formatPhoneAsTyped("123456789012345"), "123456789012345");
  });

  it("leaves an empty field empty, and does not invent brackets", () => {
    assert.equal(formatPhoneAsTyped(""), "");
    assert.equal(formatPhoneAsTyped("   "), "   ");
  });

  it("is stable: formatting what it already formatted changes nothing", () => {
    for (const input of ["8165551234", "816", "8165", "18165551234", "+44 20 7946 0958", ""]) {
      const once = formatPhoneAsTyped(input);
      assert.equal(formatPhoneAsTyped(once), once, `"${input}" moved on the second pass`);
    }
  });
});

describe("phoneDigits", () => {
  it("keeps only the digits", () => {
    assert.equal(phoneDigits("(816) 555-1234"), "8165551234");
    assert.equal(phoneDigits("no digits here"), "");
  });
});

describe("isCompletePhone", () => {
  it("knows when there are enough digits to be a real number", () => {
    assert.equal(isCompletePhone("(816) 555-1234"), true);
    assert.equal(isCompletePhone("1 (816) 555-1234"), true);
    assert.equal(isCompletePhone("816555"), false);
    assert.equal(isCompletePhone(""), false);
  });
});
