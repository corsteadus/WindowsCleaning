import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { hasCustomerDescriptions, jobServices } from "./job-services.ts";

describe("reading a job's services — Kyle #31", () => {
  // What `persistAcceptedEstimateJobsCore` writes: the snapshot line, spread,
  // where `description` is the catalogue title and `serviceNotes` is what the
  // customer was told.
  it("reads a job converted from an accepted estimate", () => {
    const stored = JSON.stringify([{
      id: 7, serviceId: 3, description: "Exterior Window Cleaning",
      serviceNotes: "All ground-floor windows, frames and sills wiped down.",
      quantity: 1, unitPrice: 320, totalPrice: 320,
      propertyId: 11, isUpsell: false, acceptedRevisionId: 4, assignedUserIds: [],
    }]);
    assert.deepEqual(jobServices(stored), [{
      name: "Exterior Window Cleaning",
      description: "All ground-floor windows, frames and sills wiped down.",
      quantity: 1, unitPrice: 320, totalPrice: 320,
    }]);
  });

  // What `initialJobSnapshot` writes, where the two words swap meaning.
  it("reads a new customer's first job, where `description` means the opposite", () => {
    const stored = JSON.stringify([{
      serviceId: 3, serviceName: "Gutter Clearing",
      description: "Downpipes flushed and debris bagged.",
      quantity: 2, unitPrice: 50, totalPrice: 100,
      propertyId: 11, address: "9 Elm Street",
    }]);
    assert.deepEqual(jobServices(stored), [{
      name: "Gutter Clearing",
      description: "Downpipes flushed and debris bagged.",
      quantity: 2, unitPrice: 50, totalPrice: 100,
    }]);
  });

  it("never reads the service's own name as the customer's description", () => {
    // The failure that would look like working software: the title echoed
    // into the description, so every line appears to have one.
    const converted = jobServices(JSON.stringify([
      { description: "Exterior Window Cleaning", quantity: 1, unitPrice: 320, totalPrice: 320 },
    ]));
    assert.equal(converted[0].name, "Exterior Window Cleaning");
    assert.equal(converted[0].description, "", "no customer text was written for this line");
    assert.equal(hasCustomerDescriptions(converted), false);
  });

  it("a line with no description still shows, because the work is still on the job", () => {
    const services = jobServices(JSON.stringify([
      { serviceName: "Screen Cleaning", quantity: 4, unitPrice: 12, totalPrice: 48 },
    ]));
    assert.equal(services.length, 1);
    assert.equal(services[0].name, "Screen Cleaning");
    assert.equal(services[0].description, "");
  });

  it("reports whether anything was written for the customer", () => {
    assert.equal(hasCustomerDescriptions([]), false);
    assert.equal(hasCustomerDescriptions(jobServices(JSON.stringify([
      { serviceName: "A", description: "", quantity: 1, unitPrice: 1, totalPrice: 1 },
      { serviceName: "B", description: "Frames included.", quantity: 1, unitPrice: 1, totalPrice: 1 },
    ]))), true);
  });
});

describe("a job screen must not break on an odd row", () => {
  it("gives nothing rather than throwing", () => {
    // `jobs.line_items` is free text and decades of imports live in it.
    for (const input of [null, undefined, "", "   ", "not json", "{}", '"a string"', "[1,2,3]", 42, {}]) {
      assert.deepEqual(jobServices(input), [], JSON.stringify(input));
    }
  });

  it("keeps the readable lines out of a part-broken list", () => {
    const services = jobServices(JSON.stringify([
      null, "junk", { serviceName: "Window Cleaning", quantity: 1, unitPrice: 90, totalPrice: 90 }, [],
    ]));
    assert.equal(services.length, 1);
    assert.equal(services[0].name, "Window Cleaning");
  });

  it("accepts an already-parsed array as well as a string", () => {
    assert.equal(jobServices([{ serviceName: "X", quantity: 1, unitPrice: 2, totalPrice: 2 }]).length, 1);
  });

  it("works out a missing total rather than showing nothing", () => {
    const [service] = jobServices(JSON.stringify([{ serviceName: "X", quantity: 3, unitPrice: 15 }]));
    assert.equal(service.totalPrice, 45);
  });

  it("numbers that arrived as strings still add up", () => {
    const [service] = jobServices(JSON.stringify([
      { serviceName: "X", quantity: "2", unitPrice: "25.50", totalPrice: "51.00" },
    ]));
    assert.deepEqual(
      [service.quantity, service.unitPrice, service.totalPrice],
      [2, 25.5, 51],
    );
  });

  it("an empty line is dropped, not shown as a blank row", () => {
    assert.deepEqual(jobServices(JSON.stringify([{ quantity: 1, unitPrice: 0, totalPrice: 0 }])), []);
  });
});

describe("the job screen keeps the customer's words apart from the crew's", () => {
  const page = readFileSync(
    fileURLToPath(new URL("../pages/JobDetail.tsx", import.meta.url)),
    "utf8",
  );

  it("shows the services and their descriptions", () => {
    assert.match(page, /from "@\/lib\/job-services"/);
    assert.match(page, /data-testid="job-services"/);
  });

  it("still keeps Job Notes and Tech / Crew Notes as their own thing", () => {
    // #31: these are internal, and must not be mistaken for what the
    // customer was promised.
    assert.match(page, /Job Notes/);
    assert.match(page, /Tech \/ Crew Notes/);
    assert.match(page, /data-testid="internal-notes-warning"/);
  });
});
