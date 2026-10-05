/**
 * The usability sweep of 2026-10-04, as guards.
 *
 * A browser pass over the nine screens phases 16–19 touched found 36 things a
 * person would notice: controls with no readable name, database wording on
 * screen, "Add countie", and — the serious one — a quote's per-quote
 * description being deleted by an edit that never touched it.
 *
 * These assertions are what keeps each of them fixed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const quoteDetail = read("./QuoteDetail.tsx");
const quoteNew = read("./QuoteNew.tsx");
const settings = read("./Settings.tsx");
const services = read("./Services.tsx");
const picker = read("../components/ServicePickerDialog.tsx");
const categoryPicker = read("../components/ServiceCategoryPicker.tsx");
const customers = read("./Customers.tsx");

test("#9 applies to the quote page as well as to the builder", () => {
  // The title was an editable input here long after Phase 18 locked it in the
  // builder, which is what two copies of a rule gets you.
  assert.doesNotMatch(quoteDetail, /onUpdate\(item\.key, "description", e\.target\.value\)/);
  assert.match(quoteDetail, /<p className="text-sm font-bold text-slate-900">\{item\.description\}<\/p>/);
  assert.match(quoteDetail, /From service catalog/);
  assert.match(quoteDetail, /onUpdate\(item\.key, "serviceNotes", e\.target\.value\)/);
});

test("an edit cannot silently delete a line's description", () => {
  // The save rewrites every line. Without serviceNotes in the body the server
  // stores null, so editing a price erased what the builder had written.
  assert.match(quoteDetail, /serviceNotes: li\.serviceNotes\.trim\(\) \|\| null/);
  assert.match(quoteDetail, /serviceNotes: \(li as \{ serviceNotes\?: string \| null \}\)\.serviceNotes \?\? ""/);
});

test("a save leaves the page holding what it just saved", () => {
  // Saving and reopening Edit within the second used to hand back the version
  // from before the save, and saving again put the old value back.
  assert.match(quoteDetail, /setQueryData\(getGetQuoteQueryKey\(quoteId\), updated\)/);
});

test("#7 a line comes from the catalogue on both screens", () => {
  assert.doesNotMatch(quoteDetail, /Add Item/);
  assert.match(quoteDetail, /<ServicePickerDialog/);
  assert.match(quoteNew, /<ServicePickerDialog/);
  // One dialog, imported by both — not a copy in each page.
  for (const [label, source] of [["the quote page", quoteDetail], ["the builder", quoteNew]] as const) {
    assert.match(source, /from "@\/components\/ServicePickerDialog"/, `${label} does not import it`);
    assert.doesNotMatch(source, /^function ServicePickerDialog\(/m, `${label} declares its own copy`);
  }
});

test("a category is shown by its name, never by its code", () => {
  // `window_cleaning` with CSS capitalisation renders "Window_cleaning".
  assert.doesNotMatch(services, /className="capitalize">\{service\.category\}/);
  assert.match(services, /\{categoryName\(service\.category\)\}/);
  assert.match(picker, /\{categoryName\(service\.category\)\}/);
  assert.match(categoryPicker, /export function useServiceCategoryName/);
});

test("each catalogue says what one of its entries is called", () => {
  // The placeholder used to be the title with an "s" stripped off: "Add countie".
  assert.doesNotMatch(settings, /title\.toLowerCase\(\)\.replace\(\/s\$\/, ""\)/);
  assert.match(settings, /one: "county"/);
  for (const one of ["profile type", "profile group", "county", "payment term", "marketing source", "service type", "job type"]) {
    assert.match(settings, new RegExp(`one: "${one}"`), `no singular for ${one}`);
  }
});

test("every control a person types into has a name", () => {
  const named = [
    [quoteNew, 'htmlFor="quote-notes"', "the quote's notes"],
    [quoteNew, 'htmlFor="quote-terms"', "the quote's terms"],
    [quoteNew, 'htmlFor="appointment-date"', "the appointment date"],
    [quoteNew, 'htmlFor="appointment-time"', "the appointment start time"],
    [quoteNew, 'aria-label="Appointment duration"', "the duration"],
    [quoteNew, 'aria-label="Assigned employee"', "the employee"],
    [quoteNew, 'htmlFor="appointment-notes"', "the appointment notes"],
    [quoteNew, 'htmlFor="estimate-notes"', "the estimate notes"],
    [quoteDetail, 'aria-label="Email recipient"', "the email recipient"],
    [quoteDetail, 'aria-label="Text message recipient"', "the text recipient"],
    [quoteDetail, 'htmlFor="quote-edit-notes"', "the edited notes"],
    [quoteDetail, 'htmlFor="quote-edit-terms"', "the edited terms"],
    [settings, 'htmlFor="quiet-hours-timezone"', "the quiet-hours timezone"],
    [settings, 'aria-label="New field label"', "the new custom field"],
    [settings, 'aria-label={`Add a ${one}`}', "the catalogue add box"],
    [customers, 'aria-label="Search profiles"', "the profile search"],
  ] as const;
  for (const [source, needle, what] of named) {
    assert.ok(source.includes(needle), `${what} has no name`);
  }
});

test("a disabled button says why", () => {
  assert.match(quoteDetail, /Finalize the estimate first/);
});

test("the Service Catalog does not offer to manage pricing it no longer holds", () => {
  // Kyle #8 took pricing out of the catalogue; the page still advertised it.
  assert.doesNotMatch(services, /Manage your pricing and offerings/);
  assert.match(services, /What each one costs is decided on the quote/);
  // A price from before #8 says that is what it is, rather than sitting there
  // unexplained in the corner of the card.
  assert.match(services, /was \{formatCurrency\(service\.basePrice\)\}/);
});

test("#10's words are used where a new quote's status is chosen", () => {
  const quoteNewSource = read("./QuoteNew.tsx");
  assert.doesNotMatch(quoteNewSource, /<SelectItem value="draft">Draft<\/SelectItem>/);
  assert.match(quoteNewSource, /ESTIMATE_STATUS_LABELS\.draft/);
  assert.match(quoteNewSource, /ESTIMATE_STATUS_LABELS\.sent/);
});

test("a status with two underscores still reads as words", () => {
  assert.doesNotMatch(quoteDetail, /item\.status\.replace\("_", " "\)/);
  assert.match(quoteDetail, /item\.status\.replaceAll\("_", " "\)/);
});
