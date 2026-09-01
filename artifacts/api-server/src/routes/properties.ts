import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import {
  db,
  propertiesTable,
  customersTable,
  propertyAccountRelationshipsTable,
  jobsTable,
} from "@workspace/db";
import {
  AccountRelationError,
  findReplacementProperty,
  lockAccount,
  promoteOwnerProperty,
  promoteRelationshipProperty,
  requireCustomer,
  syncLegacyProperty,
} from "../lib/account-relations.ts";
import { dedupePropertyRows } from "../lib/property-search.ts";
import { isAssignmentScopedOperationalRole } from "../lib/authorization.ts";
import { assignedJobCondition } from "../lib/field-tech-scope.ts";

export type PropertyFieldTechRepository = {
  listAssigned(userId: string, query: Record<string, unknown>): Promise<{
    rows: (typeof propertiesTable.$inferSelect)[];
    total: number;
    page: number;
    pageSize: number;
  }>;
  findAssigned(id: number, userId: string): Promise<typeof propertiesTable.$inferSelect | null>;
};

export function createPropertiesRouter(fieldTechRepository: PropertyFieldTechRepository = drizzlePropertyFieldTechRepository): IRouter {
const router: IRouter = Router();

router.get("/properties", async (req, res): Promise<void> => {
  try {
    if (isAssignmentScopedOperationalRole(req.user?.role)) {
      const result = await fieldTechRepository.listAssigned(req.user!.id, req.query as Record<string, unknown>);
      const data = result.rows.map(serializeFieldProperty);
      res.json({
        data,
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        hasMore: result.page * result.pageSize < result.total,
      });
      return;
    }
    const customerId = req.query.customerId === undefined ? null : parseId(req.query.customerId);
    const includeArchived = req.query.includeArchived === "true" || req.query.includeArchived === "1";
    const isPaged = ["page", "pageSize", "search", "status", "relationship"].some((key) => req.query[key] !== undefined);

    if (customerId !== null && !isPaged) {
      const all = await db.select().from(propertiesTable).orderBy(asc(propertiesTable.createdAt));
      const relations = await db.select().from(propertyAccountRelationshipsTable)
        .where(eq(propertyAccountRelationshipsTable.customerId, customerId));
      const relationByProperty = new Map(
        relations
          .filter((relation) => includeArchived || !relation.archivedAt)
          .map((relation) => [relation.propertyId, relation]),
      );
      const rows = all.filter((property) => {
        if (!includeArchived && property.archivedAt) return false;
        return property.customerId === customerId || relationByProperty.has(property.id);
      });
      res.json(rows.map((property) => serialize(
        property,
        property.customerId === customerId ? undefined : relationByProperty.get(property.id),
      )));
      return;
    }

    const status = String(req.query.status ?? (includeArchived ? "all" : "active")).toLowerCase();
    if (!["active", "archived", "all"].includes(status)) {
      throw new AccountRelationError(400, "status must be active, archived, or all");
    }
    const relationship = String(req.query.relationship ?? "all").toLowerCase();
    if (!["owned", "shared", "all"].includes(relationship)) {
      throw new AccountRelationError(400, "relationship must be owned, shared, or all");
    }
    const search = String(req.query.search ?? "").trim();
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "25"), 10) || 25));

    const conditions = [];
    if (status === "active") conditions.push(isNull(propertiesTable.archivedAt));
    if (status === "archived") conditions.push(isNotNull(propertiesTable.archivedAt));
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(or(
        ilike(propertiesTable.name, pattern),
        ilike(propertiesTable.address, pattern),
        ilike(propertiesTable.city, pattern),
        ilike(propertiesTable.state, pattern),
        ilike(propertiesTable.zip, pattern),
        sql`EXISTS (
          SELECT 1 FROM customers c
          WHERE c.id = ${propertiesTable.customerId}
             AND (
               c.company_name ILIKE ${pattern}
               OR concat_ws(' ', c.first_name, c.last_name) ILIKE ${pattern}
               OR concat_ws(' ', c.first_name, c.last_name, c.company_name) ILIKE ${pattern}
             )
         )`,
        sql`EXISTS (
           SELECT 1
           FROM property_account_relationships rel
           INNER JOIN customers c ON c.id = rel.customer_id
           WHERE rel.property_id = ${propertiesTable.id}
             AND rel.archived_at IS NULL
             AND (
               c.company_name ILIKE ${pattern}
               OR concat_ws(' ', c.first_name, c.last_name) ILIKE ${pattern}
               OR concat_ws(' ', c.first_name, c.last_name, c.company_name) ILIKE ${pattern}
             )
        )`,
      ));
    }
    if (relationship === "shared") {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM property_account_relationships rel
        WHERE rel.property_id = ${propertiesTable.id}
          AND rel.archived_at IS NULL
          AND rel.customer_id <> ${propertiesTable.customerId}
      )`);
    }
    if (relationship === "owned") {
      conditions.push(sql`NOT EXISTS (
        SELECT 1 FROM property_account_relationships rel
        WHERE rel.property_id = ${propertiesTable.id}
          AND rel.archived_at IS NULL
          AND rel.customer_id <> ${propertiesTable.customerId}
      )`);
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const totalRows = await db.select({ count: sql<number>`count(distinct ${propertiesTable.id})` })
      .from(propertiesTable)
      .where(where);
    const total = Number(totalRows[0]?.count ?? 0);
    const rows = dedupePropertyRows(await db.select()
      .from(propertiesTable)
      .where(where)
      .orderBy(desc(propertiesTable.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize));
    const data = await enrichGlobalProperties(rows);
    res.json({
      data,
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
    });
  } catch (error) {
    respondError(res, error, "Failed to fetch properties");
  }
});

router.post("/properties", async (req, res): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const customerId = parseId(body.customerId);
    const address = requiredText(body.address, "address");
    const city = requiredText(body.city, "city");
    const state = requiredText(body.state, "state");
    const zip = requiredText(body.zip, "zip");
    const property = await db.transaction(async (tx) => {
      await requireCustomer(tx, customerId);
      await lockAccount(tx, customerId);
      const active = await tx.select({ id: propertiesTable.id })
        .from(propertiesTable)
        .where(and(eq(propertiesTable.customerId, customerId), isNull(propertiesTable.archivedAt)));
      const shouldPrimary = body.isPrimary === true || active.length === 0;
      const [created] = await tx.insert(propertiesTable).values({
        customerId,
        name: nullableText(body.name),
        address,
        city,
        state,
        zip,
        county: nullableText(body.county),
        subdivision: nullableText(body.subdivision),
        directions: nullableText(body.directions),
        locationNotes: nullableText(body.locationNotes),
        billingAddress: nullableText(body.billingAddress),
        billingCity: nullableText(body.billingCity),
        billingState: nullableText(body.billingState),
        billingZip: nullableText(body.billingZip),
        propertyType: nullableText(body.propertyType) ?? "residential",
        stories: nullableNumber(body.stories),
        windowCount: nullableNumber(body.windowCount),
        accessNotes: nullableText(body.accessNotes),
        gateCode: nullableText(body.gateCode),
        hasScreens: body.hasScreens === true,
        hasHardWater: body.hasHardWater === true,
        hasTracks: body.hasTracks === true,
        riskNotes: nullableText(body.riskNotes),
        serviceNotes: nullableText(body.serviceNotes),
        isPrimary: shouldPrimary,
        isManualDefault: body.isManualDefault === true || shouldPrimary,
        isBillingAddress: body.isBillingAddress === true,
      }).returning();
      await tx.insert(propertyAccountRelationshipsTable).values({
        propertyId: created.id,
        customerId,
        relationshipType: "owner",
        isPrimary: shouldPrimary,
      });
      if (shouldPrimary) await syncLegacyProperty(tx, created);
      else if (created.isBillingAddress) {
        await tx.update(customersTable).set({
          billingAddress: created.billingAddress ?? created.address,
          billingCity: created.billingCity ?? created.city,
          billingState: created.billingState ?? created.state,
          billingZip: created.billingZip ?? created.zip,
        }).where(eq(customersTable.id, customerId));
      }
      return created;
    });
    res.status(201).json(serialize(property));
  } catch (error) {
    respondError(res, error, "Failed to create property");
  }
});

router.get("/properties/:id", async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    if (isAssignmentScopedOperationalRole(req.user?.role)) {
      const property = await fieldTechRepository.findAssigned(id, req.user!.id);
      if (!property) {
        res.status(403).json({ error: "This property is not connected to your assigned work", code: "assigned_work_required" });
        return;
      }
      res.json(serializeFieldProperty(property));
      return;
    }
    const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id));
    if (!property) throw new AccountRelationError(404, "Property not found");
    const relations = await db.select().from(propertyAccountRelationshipsTable)
      .where(eq(propertyAccountRelationshipsTable.propertyId, id))
      .orderBy(asc(propertyAccountRelationshipsTable.customerId));
    res.json({ ...serialize(property), relationships: relations.map(serializeRelationship) });
  } catch (error) {
    respondError(res, error, "Failed to fetch property");
  }
});

router.patch("/properties/:id", async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    const body = req.body as Record<string, unknown>;
    const property = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(propertiesTable).where(eq(propertiesTable.id, id));
      if (!current) throw new AccountRelationError(404, "Property not found");
      if (current.archivedAt) throw new AccountRelationError(409, "Archived properties must be restored before editing");
      await lockAccount(tx, current.customerId);
      const updateData: Record<string, unknown> = {};
      for (const field of [
        "name", "address", "city", "state", "zip", "county", "subdivision", "directions", "locationNotes",
        "billingAddress", "billingCity", "billingState", "billingZip",
        "propertyType", "accessNotes", "gateCode", "riskNotes", "serviceNotes",
      ] as const) {
        if (body[field] !== undefined) updateData[field] = field === "name" || field.startsWith("billing") || field.includes("Notes") || field === "gateCode" || field === "propertyType" || field === "county" || field === "subdivision" || field === "directions"
          ? nullableText(body[field])
          : requiredText(body[field], field);
      }
      for (const field of ["stories", "windowCount"] as const) {
        if (body[field] !== undefined) updateData[field] = nullableNumber(body[field]);
      }
      for (const field of ["hasScreens", "hasHardWater", "hasTracks", "isBillingAddress", "isManualDefault"] as const) {
        if (body[field] !== undefined) updateData[field] = body[field] === true;
      }
      if (Object.keys(updateData).length > 0) {
        const [updated] = await tx.update(propertiesTable).set(updateData).where(eq(propertiesTable.id, id)).returning();
        if (!updated) throw new AccountRelationError(404, "Property not found");
      }
      if (body.isPrimary === true) {
        return promoteOwnerProperty(tx, id, current.customerId);
      }
      if (body.isPrimary === false && current.isPrimary) {
        throw new AccountRelationError(409, "Promote another property before removing the primary designation");
      }
      const [updated] = await tx.select().from(propertiesTable).where(eq(propertiesTable.id, id));
      if (updated?.isPrimary) await syncLegacyProperty(tx, updated);
      else if (updated?.isBillingAddress) {
        await tx.update(customersTable).set({
          billingAddress: updated.billingAddress ?? updated.address,
          billingCity: updated.billingCity ?? updated.city,
          billingState: updated.billingState ?? updated.state,
          billingZip: updated.billingZip ?? updated.zip,
        }).where(eq(customersTable.id, updated.customerId));
      }
      return updated;
    });
    res.json(serialize(property));
  } catch (error) {
    respondError(res, error, "Failed to update property");
  }
});

router.post("/properties/:id/primary", async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id));
    if (!property) throw new AccountRelationError(404, "Property not found");
    const row = await db.transaction((tx) => promoteOwnerProperty(tx, id, property.customerId));
    res.json(serialize(row));
  } catch (error) {
    respondError(res, error, "Failed to set primary property");
  }
});

router.post("/properties/:id/archive", async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    const reason = nullableText((req.body as Record<string, unknown> | undefined)?.reason) ?? "Archived by user";
    const row = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(propertiesTable).where(eq(propertiesTable.id, id));
      if (!current) throw new AccountRelationError(404, "Property not found");
      await lockAccount(tx, current.customerId);
      if (current.archivedAt) return current;
      if (current.isPrimary) {
        const replacement = await findReplacementProperty(tx, current.customerId, current.id);
        if (!replacement) throw new AccountRelationError(409, "Promote another property before archiving the only active primary");
        await promoteOwnerProperty(tx, Number(replacement.id), current.customerId);
      }
      const [archived] = await tx.update(propertiesTable).set({
        isPrimary: false,
        archivedAt: new Date(),
        archiveReason: reason,
      }).where(eq(propertiesTable.id, id)).returning();
      await tx.update(propertyAccountRelationshipsTable).set({ isPrimary: false }).where(eq(propertyAccountRelationshipsTable.propertyId, id));
      return archived;
    });
    res.json(serialize(row));
  } catch (error) {
    respondError(res, error, "Failed to archive property");
  }
});

router.post("/properties/:id/restore", async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    const row = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(propertiesTable).where(eq(propertiesTable.id, id));
      if (!current) throw new AccountRelationError(404, "Property not found");
      await lockAccount(tx, current.customerId);
      if (!current.archivedAt) return current;
      const [restored] = await tx.update(propertiesTable).set({
        archivedAt: null,
        archivedBy: null,
        archiveReason: null,
        isPrimary: false,
      }).where(eq(propertiesTable.id, id)).returning();
      const [primary] = await tx.select({ id: propertiesTable.id })
        .from(propertiesTable)
        .where(and(eq(propertiesTable.customerId, current.customerId), isNull(propertiesTable.archivedAt), eq(propertiesTable.isPrimary, true)));
      if (!primary) return promoteOwnerProperty(tx, id, current.customerId);
      return restored;
    });
    res.json(serialize(row));
  } catch (error) {
    respondError(res, error, "Failed to restore property");
  }
});

// Backward-compatible destructive route: deletes are now recoverable archives.
router.delete("/properties/:id", async (req, res): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(propertiesTable).where(eq(propertiesTable.id, id));
      if (!current) throw new AccountRelationError(404, "Property not found");
      await lockAccount(tx, current.customerId);
      if (current.archivedAt) return;
      if (current.isPrimary) {
        const replacement = await findReplacementProperty(tx, current.customerId, current.id);
        if (!replacement) throw new AccountRelationError(409, "Promote another property before archiving the only active primary");
        await promoteOwnerProperty(tx, Number(replacement.id), current.customerId);
      }
      await tx.update(propertiesTable).set({
        isPrimary: false,
        archivedAt: new Date(),
        archiveReason: "Archived by user",
      }).where(eq(propertiesTable.id, id));
      await tx.update(propertyAccountRelationshipsTable).set({ isPrimary: false }).where(eq(propertyAccountRelationshipsTable.propertyId, id));
    });
    res.sendStatus(204);
  } catch (error) {
    respondError(res, error, "Failed to archive property");
  }
});

router.post("/properties/:id/relationships", async (req, res): Promise<void> => {
  try {
    const propertyId = parseId(req.params.id);
    const body = req.body as Record<string, unknown>;
    const customerId = parseId(body.customerId);
    const row = await db.transaction(async (tx) => {
      const [property] = await tx.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
      if (!property || property.archivedAt) throw new AccountRelationError(404, "Active property not found");
      await requireCustomer(tx, customerId);
      await lockAccount(tx, customerId);
      const [existing] = await tx.select().from(propertyAccountRelationshipsTable).where(and(
        eq(propertyAccountRelationshipsTable.propertyId, propertyId),
        eq(propertyAccountRelationshipsTable.customerId, customerId),
      ));
      if (existing?.archivedAt) {
        const active = await tx.select({ id: propertyAccountRelationshipsTable.id })
          .from(propertyAccountRelationshipsTable)
          .where(and(
            eq(propertyAccountRelationshipsTable.customerId, customerId),
            isNull(propertyAccountRelationshipsTable.archivedAt),
          ));
        const shouldPrimary = body.isPrimary === true || active.length === 0;
        const [restored] = await tx.update(propertyAccountRelationshipsTable).set({
          archivedAt: null,
          archivedBy: null,
          archiveReason: null,
          relationshipType: nullableText(body.relationshipType) ?? existing.relationshipType,
          isPrimary: false,
        }).where(eq(propertyAccountRelationshipsTable.id, existing.id)).returning();
        return shouldPrimary ? promoteRelationshipProperty(tx, propertyId, customerId) : restored;
      }
      if (existing) throw new AccountRelationError(409, "Property is already linked to this customer");
      const active = await tx.select({ id: propertyAccountRelationshipsTable.id })
        .from(propertyAccountRelationshipsTable)
        .where(and(eq(propertyAccountRelationshipsTable.customerId, customerId), isNull(propertyAccountRelationshipsTable.archivedAt)));
      const shouldPrimary = body.isPrimary === true || active.length === 0;
      const [created] = await tx.insert(propertyAccountRelationshipsTable).values({
        propertyId,
        customerId,
        relationshipType: nullableText(body.relationshipType) ?? "shared",
        isPrimary: shouldPrimary,
        notes: nullableText(body.notes),
      }).returning();
      return created;
    });
    res.status(201).json(serializeRelationship(row));
  } catch (error) {
    respondError(res, error, "Failed to link property");
  }
});

router.delete("/properties/:id/relationships/:customerId", async (req, res): Promise<void> => {
  try {
    const propertyId = parseId(req.params.id);
    const customerId = parseId(req.params.customerId);
    await db.transaction(async (tx) => {
      const [property] = await tx.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
      if (!property) throw new AccountRelationError(404, "Property not found");
      if (property.customerId === customerId) throw new AccountRelationError(409, "The owner relationship cannot be removed; archive the property instead");
      await lockAccount(tx, customerId);
      const [current] = await tx.select().from(propertyAccountRelationshipsTable).where(and(
        eq(propertyAccountRelationshipsTable.propertyId, propertyId),
        eq(propertyAccountRelationshipsTable.customerId, customerId),
        isNull(propertyAccountRelationshipsTable.archivedAt),
      ));
      if (!current) throw new AccountRelationError(404, "Property is not linked to this customer");
      if (current.isPrimary) {
        const [replacement] = await tx.select().from(propertyAccountRelationshipsTable).where(and(
          eq(propertyAccountRelationshipsTable.customerId, customerId),
          isNull(propertyAccountRelationshipsTable.archivedAt),
          ne(propertyAccountRelationshipsTable.id, current.id),
        )).orderBy(asc(propertyAccountRelationshipsTable.id)).limit(1);
        if (!replacement) throw new AccountRelationError(409, "Promote another property before removing the only active primary");
        await promoteRelationshipProperty(tx, replacement.propertyId, customerId);
      }
      await tx.update(propertyAccountRelationshipsTable).set({
        isPrimary: false,
        archivedAt: new Date(),
        archiveReason: "Unlinked by user",
      }).where(eq(propertyAccountRelationshipsTable.id, current.id));
    });
    res.sendStatus(204);
  } catch (error) {
    respondError(res, error, "Failed to unlink property");
  }
});

router.post("/customers/:customerId/set-default-property", async (req, res): Promise<void> => {
  try {
    const customerId = parseId(req.params.customerId);
    const propertyId = parseId((req.body as Record<string, unknown>).propertyId);
    const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
    if (!property) throw new AccountRelationError(404, "Property not found");
    if (property.customerId === customerId) {
      await db.transaction((tx) => promoteOwnerProperty(tx, propertyId, customerId));
    } else {
      await db.transaction((tx) => promoteRelationshipProperty(tx, propertyId, customerId));
    }
    res.json({ defaultPropertyId: propertyId });
  } catch (error) {
    respondError(res, error, "Failed to set default property");
  }
});

router.post("/customers/:customerId/reset-default-property", async (req, res): Promise<void> => {
  try {
    const customerId = parseId(req.params.customerId);
    await requireCustomer(db, customerId);
    await db.transaction(async (tx) => {
      await lockAccount(tx, customerId);
      await tx.update(customersTable).set({ defaultPropertyId: null }).where(eq(customersTable.id, customerId));
      await tx.update(propertiesTable).set({ isPrimary: false }).where(eq(propertiesTable.customerId, customerId));
      const autoId = await computeAutoDefault(tx, customerId);
      if (autoId) await promoteOwnerProperty(tx, autoId, customerId);
    });
    const [customer] = await db.select({ defaultPropertyId: customersTable.defaultPropertyId }).from(customersTable).where(eq(customersTable.id, customerId));
    res.json({ defaultPropertyId: customer?.defaultPropertyId ?? null, source: "auto" });
  } catch (error) {
    respondError(res, error, "Failed to reset default property");
  }
});

async function computeAutoDefault(executor: any, customerId: number): Promise<number | null> {
  const properties = await executor.select().from(propertiesTable).where(and(eq(propertiesTable.customerId, customerId), isNull(propertiesTable.archivedAt)));
  if (!properties.length) return null;
  const jobs = await executor.execute(sql`
    SELECT j.property_id
      FROM jobs j
     WHERE j.customer_id = ${customerId}
       AND j.is_hidden = false
       AND j.property_id IS NOT NULL
     ORDER BY j.created_at DESC
     LIMIT 1
  `);
  const jobPropertyId = Number((jobs.rows as any[])[0]?.property_id);
  if (jobPropertyId && properties.some((p: any) => p.id === jobPropertyId)) return jobPropertyId;
  const billing = properties.find((p: any) => p.isBillingAddress);
  return billing?.id ?? properties.sort((a: any, b: any) => a.id - b.id)[0].id;
}

function parseId(value: unknown): number {
  const id = Number(Array.isArray(value) ? value[0] : value);
  if (!Number.isInteger(id) || id <= 0) throw new AccountRelationError(400, "A valid id is required");
  return id;
}

function requiredText(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new AccountRelationError(400, `${field} is required`);
  return text;
}

function nullableText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function nullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new AccountRelationError(400, "Numeric property fields must be non-negative integers");
  return number;
}

async function enrichGlobalProperties(
  properties: (typeof propertiesTable.$inferSelect)[],
): Promise<Record<string, unknown>[]> {
  if (!properties.length) return [];
  const propertyIds = properties.map((property) => property.id);
  const relationships = await db
    .select()
    .from(propertyAccountRelationshipsTable)
    .where(inArray(propertyAccountRelationshipsTable.propertyId, propertyIds));
  const customerIds = [...new Set([
    ...properties.map((property) => property.customerId),
    ...relationships.map((relationship) => relationship.customerId),
  ])];
  const customers = customerIds.length
    ? await db.select().from(customersTable).where(inArray(customersTable.id, customerIds))
    : [];
  const customerMap = new Map(customers.map((customer) => [customer.id, customer]));
  const displayName = (customerId: number) => {
    const customer = customerMap.get(customerId);
    if (!customer) return `Customer #${customerId}`;
    const person = `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim();
    return customer.companyName && person
      ? `${person} — ${customer.companyName}`
      : person || customer.companyName || `Customer #${customerId}`;
  };

  return properties.map((property) => {
    const activeLinks = relationships.filter(
      (relationship) => relationship.propertyId === property.id && !relationship.archivedAt,
    );
    const sharedLinks = activeLinks.filter(
      (relationship) => relationship.customerId !== property.customerId,
    );
    const ownerLink = activeLinks.find(
      (relationship) => relationship.customerId === property.customerId,
    );
    return {
      ...serialize(property),
      isPrimary: ownerLink?.isPrimary ?? property.isPrimary,
      relationshipId: ownerLink?.id ?? null,
      relationshipType: "owner",
      isOwner: true,
      ownerName: displayName(property.customerId),
      isShared: sharedLinks.length > 0,
      sharedAccountCount: sharedLinks.length,
      accountLinks: activeLinks.map((relationship) => ({
        id: relationship.id,
        customerId: relationship.customerId,
        customerName: displayName(relationship.customerId),
        relationshipType: relationship.relationshipType,
        isPrimary: relationship.isPrimary,
        isOwner: relationship.customerId === property.customerId,
      })),
    };
  });
}

function serialize(property: Record<string, any>, relation?: Record<string, any>): Record<string, unknown> {
  return {
    ...property,
    isPrimary: relation ? relation.isPrimary : property.isPrimary,
    relationshipId: relation?.id ?? null,
    relationshipType: relation?.relationshipType ?? "owner",
    isOwner: relation ? false : true,
    archivedAt: property.archivedAt?.toISOString?.() ?? null,
    createdAt: property.createdAt?.toISOString?.() ?? property.createdAt,
    updatedAt: property.updatedAt?.toISOString?.() ?? property.updatedAt,
  };
}

function serializeFieldProperty(property: typeof propertiesTable.$inferSelect): Record<string, unknown> {
  return {
    id: property.id,
    customerId: property.customerId,
    name: property.name,
    address: property.address,
    city: property.city,
    state: property.state,
    zip: property.zip,
    propertyType: property.propertyType,
    stories: property.stories,
    windowCount: property.windowCount,
    directions: property.directions,
    locationNotes: property.locationNotes,
    accessNotes: property.accessNotes,
    gateCode: property.gateCode,
    riskNotes: property.riskNotes,
    serviceNotes: property.serviceNotes,
    hasScreens: property.hasScreens,
    hasHardWater: property.hasHardWater,
    hasTracks: property.hasTracks,
  };
}

function serializeRelationship(row: Record<string, any>): Record<string, unknown> {
  return {
    ...row,
    archivedAt: row.archivedAt?.toISOString?.() ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  };
}

function respondError(res: any, error: unknown, fallback: string): void {
  if (error instanceof AccountRelationError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error(fallback, error);
  res.status(500).json({ error: fallback });
}

return router;
}

const drizzlePropertyFieldTechRepository: PropertyFieldTechRepository = {
  listAssigned: async (userId, query) => {
    const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(query.pageSize ?? "25"), 10) || 25));
    const conditions: any[] = [assignedJobCondition(userId)];
    // For shared locations the job's account, not the property's owning
    // account, defines the technician-visible operational graph.
    if (query.customerId !== undefined) conditions.push(eq(jobsTable.customerId, Number(query.customerId)));
    const includeArchived = query.includeArchived === "true" || query.includeArchived === "1";
    const status = String(query.status ?? (includeArchived ? "all" : "active")).toLowerCase();
    if (status === "active") conditions.push(isNull(propertiesTable.archivedAt));
    if (status === "archived") conditions.push(isNotNull(propertiesTable.archivedAt));
    const search = String(query.search ?? "").trim();
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(or(
        ilike(propertiesTable.name, pattern),
        ilike(propertiesTable.address, pattern),
        ilike(propertiesTable.city, pattern),
        ilike(propertiesTable.state, pattern),
        ilike(propertiesTable.zip, pattern),
        sql`EXISTS (
          SELECT 1 FROM customers c
           WHERE c.id = ${jobsTable.customerId}
             AND (
               c.company_name ILIKE ${pattern}
               OR concat_ws(' ', c.first_name, c.last_name) ILIKE ${pattern}
             )
        )`,
      ));
    }
    const where = and(...conditions);
    const [rows, count] = await Promise.all([
      db.selectDistinct({ property: propertiesTable }).from(propertiesTable)
      .innerJoin(jobsTable, eq(jobsTable.propertyId, propertiesTable.id))
        .where(where).orderBy(asc(propertiesTable.createdAt))
        .limit(pageSize).offset((page - 1) * pageSize),
      db.select({ count: sql<number>`count(distinct ${propertiesTable.id})` }).from(propertiesTable)
        .innerJoin(jobsTable, eq(jobsTable.propertyId, propertiesTable.id))
        .where(where),
    ]);
    return { rows: rows.map(({ property }) => property), total: Number(count[0]?.count ?? 0), page, pageSize };
  },
  findAssigned: async (id, userId) => {
    const [row] = await db.select({ property: propertiesTable }).from(propertiesTable)
      .innerJoin(jobsTable, eq(jobsTable.propertyId, propertiesTable.id))
      .where(and(eq(propertiesTable.id, id), assignedJobCondition(userId)));
    return row?.property ?? null;
  },
};

export default createPropertiesRouter();