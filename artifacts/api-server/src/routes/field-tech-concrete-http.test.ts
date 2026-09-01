import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express from "express";
import { authorizeApiRequest } from "../lib/authorization.ts";
import {
  createContactsRouter,
} from "./contacts.ts";
import { createCustomersRouter } from "./customers.ts";
import { createJobsRouter } from "./jobs.ts";
import { createPropertiesRouter } from "./properties.ts";

const NOW = new Date("2026-08-14T12:00:00.000Z");
const assigned = (userId: string) => JSON.stringify([{
  name: "Exterior windows",
  assignedUserIds: [userId],
  unitPrice: 425,
  totalPrice: 425,
  discountAmount: 15,
}]);

class FieldTechHttpFixture {
  writes = 0;
  mutationDispatches = 0;
  readonly customers = [
    { id: 1, firstName: "Ada", lastName: "Assigned", companyName: null, email: "ada@example.test", phone: "555-0101", homePhone: null, workPhone: null, cellPhone: null, altPhone: null, billingAddress: "1 Main", billingCity: "Austin", billingState: "TX", billingZip: "78701", preferredContactMethod: null, status: "active", lifecycleStatus: "customer", clientType: "residential", directions: null, windowCount: 12, createdAt: NOW, updatedAt: NOW },
    { id: 2, firstName: "Bea", lastName: "Other", companyName: null, email: "bea@example.test", phone: "555-0102", homePhone: null, workPhone: null, cellPhone: null, altPhone: null, billingAddress: "2 Main", billingCity: "Austin", billingState: "TX", billingZip: "78702", preferredContactMethod: null, status: "active", lifecycleStatus: "customer", clientType: "residential", directions: null, windowCount: 4, createdAt: NOW, updatedAt: NOW },
  ];
  readonly properties = [
    { id: 10, customerId: 1, name: "Ada home", address: "1 Main", city: "Austin", state: "TX", zip: "78701", propertyType: "residential", stories: 1, windowCount: 12, directions: "Side gate", locationNotes: null, accessNotes: "Call first", gateCode: null, riskNotes: null, serviceNotes: null, hasScreens: true, hasHardWater: false, hasTracks: true },
    { id: 20, customerId: 2, name: "Bea home", address: "2 Main", city: "Austin", state: "TX", zip: "78702", propertyType: "residential", stories: 1, windowCount: 4, directions: null, locationNotes: null, accessNotes: null, gateCode: null, riskNotes: null, serviceNotes: null, hasScreens: false, hasHardWater: false, hasTracks: false },
  ];
  readonly contacts = [
    { id: 100, customerId: 1, firstName: "Ada", lastName: "Assigned", email: "ada@example.test", phone: "555-0101", alternatePhone: null, role: "Owner", isPrimary: true },
    { id: 200, customerId: 2, firstName: "Bea", lastName: "Other", email: "bea@example.test", phone: "555-0102", alternatePhone: null, role: "Owner", isPrimary: true },
  ];
  readonly jobs = [
    {
      id: 1000, customerId: 1, propertyId: 10, jobNumber: "J-ASSIGNED",
      status: "scheduled", serviceType: "Window cleaning", scheduledDate: "2026-08-14",
      notes: "Use side gate", lineItems: assigned("tech-a"), totalAmount: "425.00",
      quoteId: 71, createdAt: NOW, updatedAt: NOW,
      linkedQuote: { id: 71, quoteNumber: "Q-SECRET", status: "accepted", totalAmount: 425 },
      invoices: [{ id: 81, invoiceNumber: "INV-SECRET", status: "paid", amount: 425 }],
      payments: [{ id: 91, paymentStatus: "captured", amount: 425, cardLast4: "4242" }],
      balanceDue: 0,
    },
    { id: 1001, customerId: 1, propertyId: 10, jobNumber: "J-SIBLING", status: "scheduled", lineItems: assigned("tech-b"), totalAmount: "900.00", quoteId: 74, createdAt: NOW, updatedAt: NOW },
    { id: 2000, customerId: 2, propertyId: 20, jobNumber: "J-OTHER", status: "scheduled", lineItems: assigned("tech-b"), totalAmount: "25.00", quoteId: 72, createdAt: NOW, updatedAt: NOW },
    { id: 3000, customerId: 2, propertyId: 20, jobNumber: "J-UNASSIGNED", status: "scheduled", lineItems: "[]", totalAmount: "25.00", quoteId: 73, createdAt: NOW, updatedAt: NOW },
  ];

  isAssigned(job: Record<string, any>, userId: string) {
    return JSON.parse(job.lineItems).some((line: { assignedUserIds?: string[] }) => line.assignedUserIds?.includes(userId));
  }
}

async function withHttp(run: (base: string, fixture: FieldTechHttpFixture) => Promise<void>) {
  const fixture = new FieldTechHttpFixture();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = {
      id: req.header("x-user") ?? "tech-a",
      role: req.header("x-role") ?? "field_tech",
    };
    next();
  });
  app.use(authorizeApiRequest);
  app.use(createCustomersRouter({
    list: async (_where, pageSize, offset, userId) => fixture.customers.filter((customer) => fixture.jobs.some((job) => job.customerId === customer.id && fixture.isAssigned(job, userId))).slice(offset, offset + pageSize) as any,
    count: async (_where, userId) => fixture.customers.filter((customer) => fixture.jobs.some((job) => job.customerId === customer.id && fixture.isAssigned(job, userId))).length,
    findCustomer: async (id) => fixture.customers.find((customer) => customer.id === id) ?? null,
    listAssignedJobs: async (customerId, userId) => fixture.jobs.filter((job) => job.customerId === customerId && fixture.isAssigned(job, userId)),
    listProperties: async (ids) => fixture.properties.filter((property) => ids.includes(property.id)),
    listContacts: async (customerId) => fixture.contacts.filter((contact) => contact.customerId === customerId),
  } as any));
  app.use(createPropertiesRouter({
    listAssigned: async (userId) => {
      const rows = fixture.properties.filter((property) => fixture.jobs.some((job) => job.propertyId === property.id && fixture.isAssigned(job, userId))) as any;
      return { rows, total: rows.length, page: 1, pageSize: 25 };
    },
    findAssigned: async (id, userId) => fixture.properties.find((property) => property.id === id && fixture.jobs.some((job) => job.propertyId === id && fixture.isAssigned(job, userId))) as any ?? null,
  }));
  app.use(createContactsRouter({
    listAssigned: async (userId, customerId) => fixture.contacts.filter((contact) => (customerId === null || contact.customerId === customerId) && fixture.jobs.some((job) => job.customerId === contact.customerId && fixture.isAssigned(job, userId))) as any,
  }));
  app.use(createJobsRouter({
    listAssigned: async (userId) => {
      const rows = fixture.jobs.filter((job) => fixture.isAssigned(job, userId));
      return { rows: rows as any, total: rows.length };
    },
    listUnscheduled: async () => [],
    enrichAssigned: async (jobs) => jobs,
    find: async (id) => fixture.jobs.find((job) => job.id === id) as any ?? null,
    findAssigned: async (id, userId) => fixture.jobs.find((job) => job.id === id && fixture.isAssigned(job, userId)) as any ?? null,
    getAssignedDetails: async (id, userId) => fixture.jobs.find((job) => job.id === id && fixture.isAssigned(job, userId)) ?? null,
    getDetails: async (id) => fixture.jobs.find((job) => job.id === id) ?? null,
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}`, fixture); }
  finally { await close(server); }
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
async function call(base: string, path: string, method = "GET", body?: unknown, user = "tech-a", role = "field_tech") {
  const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-user": user, "x-role": role }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
function containsFinancial(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsFinancial);
  return Object.entries(value).some(([key, child]) => [
    "totalAmount", "quoteId", "quoteNumber", "linkedQuote", "invoices",
    "invoiceNumber", "payments", "paymentStatus", "unitPrice", "totalPrice",
    "price", "amount", "cost", "subtotal", "tax", "discountAmount", "balanceDue",
  ].includes(key) || containsFinancial(child));
}

test("field-tech concrete HTTP reads omit unrelated work and financial data without writes", async () => {
  await withHttp(async (base, fixture) => {
    const [jobs, customers, properties, contacts] = await Promise.all([call(base, "/jobs"), call(base, "/customers"), call(base, "/properties"), call(base, "/contacts")]);
    assert.deepEqual(jobs.body.map((job: any) => job.id), [1000]);
    assert.deepEqual(customers.body.customers.map((customer: any) => customer.id), [1]);
    assert.deepEqual(properties.body.data.map((property: any) => property.id), [10]);
    assert.deepEqual(contacts.body.map((contact: any) => contact.id), [100]);
    assert.equal(containsFinancial([jobs.body, customers.body, properties.body, contacts.body]), false);
    assert.equal(fixture.writes, 0);
  });
});

test("field-tech concrete HTTP makes unassigned and nonexistent job details indistinguishable", async () => {
  await withHttp(async (base, fixture) => {
    for (const path of ["/jobs/2000", "/jobs/3000", "/jobs/9999"]) {
      const response = await call(base, path);
      assert.equal(response.status, 404);
      assert.deepEqual(response.body, { error: "Job not found" });
    }
    for (const path of ["/customers/2", "/properties/20"]) assert.equal((await call(base, path)).status, 403);
    const detail = await call(base, "/customers/1");
    const job = await call(base, "/jobs/1000");
    assert.equal(detail.status, 200);
    assert.equal(job.status, 200);
    assert.equal(job.body.customerId, 1);
    assert.deepEqual(detail.body.jobs.map((job: any) => job.id), [1000]);
    assert.equal(detail.body.properties[0].address, "1 Main");
    assert.equal(detail.body.contacts[0].phone, "555-0101");
    assert.equal(containsFinancial([detail.body, job.body]), false);
    assert.equal(fixture.writes, 0);
  });
});

test("production job detail serializer is operational-only for field tech and full for office", async () => {
  await withHttp(async (base) => {
    const field = await call(base, "/jobs/1000");
    assert.equal(field.status, 200);
    assert.equal(field.body.jobNumber, "J-ASSIGNED");
    assert.equal(field.body.status, "scheduled");
    assert.equal(field.body.serviceType, "Window cleaning");
    assert.equal(field.body.notes, "Use side gate");
    assert.equal(containsFinancial(field.body), false);

    const office = await call(base, "/jobs/1000", "GET", undefined, "office-a", "office_admin");
    assert.equal(office.status, 200);
    assert.equal(office.body.totalAmount, "425.00");
    assert.equal(office.body.quoteId, 71);
    assert.equal(office.body.linkedQuote.quoteNumber, "Q-SECRET");
    assert.equal(office.body.invoices[0].amount, 425);
    assert.equal(office.body.payments[0].paymentStatus, "captured");
  });
});

test("field-tech HTTP authorization blocks forbidden mutations before repository writes", async () => {
  await withHttp(async (base, fixture) => {
    for (const body of [{ totalAmount: 99 }, { scheduledDate: "2026-08-15" }, { notes: "" }]) assert.equal((await call(base, "/jobs/1000", "PATCH", body)).status, 403);
    assert.equal(fixture.writes, 0);
    assert.equal(fixture.mutationDispatches, 0);
  });
});

test("field-tech direct DELETE is denied by the route-local operational guard without writes", async () => {
  await withHttp(async (base, fixture) => {
    const response = await call(base, "/jobs/1000", "DELETE");
    assert.equal(response.status, 403);
    assert.equal(response.body.capability, "jobs.manage");
    assert.equal(fixture.writes, 0);
  });
});

test("legacy employee receives only the assigned operational graph and safe projection", async () => {
  await withHttp(async (base, fixture) => {
    const [jobs, customer, properties, contacts] = await Promise.all([
      call(base, "/jobs", "GET", undefined, "tech-a", "employee"),
      call(base, "/customers/1", "GET", undefined, "tech-a", "employee"),
      call(base, "/properties", "GET", undefined, "tech-a", "employee"),
      call(base, "/contacts", "GET", undefined, "tech-a", "employee"),
    ]);
    assert.deepEqual(jobs.body.map((job: any) => job.id), [1000]);
    assert.deepEqual(customer.body.jobs.map((job: any) => job.id), [1000]);
    assert.deepEqual(properties.body.data.map((property: any) => property.id), [10]);
    assert.deepEqual(contacts.body.map((contact: any) => contact.id), [100]);
    assert.equal(containsFinancial([jobs.body, customer.body, properties.body, contacts.body]), false);
    assert.equal(fixture.writes, 0);
  });
});

test("legacy employee loses graph and mutations immediately after reassignment", async () => {
  await withHttp(async (base, fixture) => {
    const assignedJob = fixture.jobs.find((job) => job.id === 1000)!;
    assignedJob.lineItems = assigned("tech-b");

    const hidden = await call(base, "/jobs/1000", "GET", undefined, "tech-a", "employee");
    assert.equal(hidden.status, 404);
    assert.deepEqual(hidden.body, { error: "Job not found" });
    for (const path of ["/customers/1", "/properties/10"]) assert.equal((await call(base, path, "GET", undefined, "tech-a", "employee")).status, 403);
    for (const body of [
      { status: "in_progress" },
      { status: "completed" },
      { notes: "Stale note" },
    ]) {
      assert.equal((await call(base, "/jobs/1000", "PATCH", body, "tech-a", "employee")).status, 403);
    }
    assert.equal(fixture.writes, 0);

    const reassigned = await call(base, "/jobs/1000", "GET", undefined, "tech-b", "employee");
    assert.equal(reassigned.status, 200);
    assert.equal(reassigned.body.id, 1000);
    assert.equal(containsFinancial(reassigned.body), false);
  });
});

test("office and admin retain full sibling and financial job behavior", async () => {
  await withHttp(async (base) => {
    for (const role of ["office_admin", "admin"]) {
      const sibling = await call(base, "/jobs/1001", "GET", undefined, `${role}-user`, role);
      assert.equal(sibling.status, 200);
      assert.equal(sibling.body.totalAmount, "900.00");
      assert.equal(sibling.body.quoteId, 74);
    }
  });
});