import { Router, type IRouter, type Request } from "express";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  accountProfileSettingsTable,
  contactChannelPurposesTable,
  contactChannelsTable,
  contactsTable,
  customFieldDefinitionsTable,
  customFieldValuesTable,
  customersTable,
  db,
  profileCatalogItemsTable,
  propertiesTable,
} from "@workspace/db";
import { AccountRelationError, lockAccount, requireCustomer } from "../lib/account-relations.js";
import { catalogSelectionInput, channelPurposePatch } from "../lib/profile-details-core.js";

const router: IRouter = Router();
const CHANNEL_TYPES = new Set(["email", "phone"]);
const CATALOG_TYPES: Record<string, string> = {
  "profile-types": "profile_type",
  "profile-groups": "profile_group",
  counties: "county",
  "payment-terms": "payment_terms",
  "marketing-sources": "marketing_source",
  "service-types": "service_type",
  "job-types": "job_type",
};

function parseId(value: unknown, name = "id"): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new AccountRelationError(400, `${name} must be a positive integer`);
  return id;
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function actor(req: Request): string | null {
  if (!req.user) return null;
  const displayName = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim();
  return displayName || req.user.email || String(req.user.id);
}

function catalogType(slug: unknown): string {
  const type = CATALOG_TYPES[String(slug)];
  if (!type) throw new AccountRelationError(404, "Catalog not found");
  return type;
}

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function channelPurposes(body: Record<string, unknown>): string[] {
  try {
    return channelPurposePatch(body) ?? ["general"];
  } catch (error) {
    throw new AccountRelationError(
      400,
      error instanceof Error ? error.message : "purposes must contain general, billing, or estimates",
    );
  }
}

async function requireScopedAccount(executor: any, id: number, prospectOnly: boolean) {
  const customer = await requireCustomer(executor, id);
  if (prospectOnly && customer.lifecycleStatus !== "prospect") {
    throw new AccountRelationError(404, "Prospect not found");
  }
  return customer;
}

async function lookupCatalogId(
  executor: any,
  type: string,
  value: unknown,
): Promise<number | null> {
  if (value == null || value === "") return null;
  if (Number.isInteger(Number(value))) {
    const id = Number(value);
    const [match] = await executor.select({ id: profileCatalogItemsTable.id })
      .from(profileCatalogItemsTable)
      .where(and(eq(profileCatalogItemsTable.id, id), eq(profileCatalogItemsTable.catalogType, type)));
    if (!match) throw new AccountRelationError(400, "Selected catalog item is invalid");
    return id;
  }
  const [match] = await executor.select({ id: profileCatalogItemsTable.id })
    .from(profileCatalogItemsTable)
    .where(and(
      eq(profileCatalogItemsTable.catalogType, type),
      eq(profileCatalogItemsTable.name, String(value)),
    ));
  return match?.id ?? null;
}

async function readChannels(customerId: number) {
  const channels = await db.select().from(contactChannelsTable)
    .where(and(eq(contactChannelsTable.customerId, customerId), isNull(contactChannelsTable.archivedAt)))
    .orderBy(asc(contactChannelsTable.id));
  const purposeRows = channels.length
    ? await db.select().from(contactChannelPurposesTable)
      .where(inArray(contactChannelPurposesTable.channelId, channels.map((channel) => channel.id)))
    : [];
  return channels.map((channel) => {
    const purposes = purposeRows
      .filter((row) => row.channelId === channel.id)
      .map((row) => row.purpose);
    return {
      ...channel,
      type: channel.channelType,
      purposes,
      purpose: purposes[0] ?? "general",
    };
  });
}

async function readCustomFields(customerId: number, template: string) {
  const definitions = await db.select().from(customFieldDefinitionsTable)
    .where(and(
      eq(customFieldDefinitionsTable.isActive, true),
      eq(customFieldDefinitionsTable.scope, "account"),
    ))
    .orderBy(asc(customFieldDefinitionsTable.sortOrder), asc(customFieldDefinitionsTable.label));
  const applicable = definitions.filter((definition) =>
    definition.template === "all" || definition.template === template);
  const values = applicable.length
    ? await db.select().from(customFieldValuesTable).where(and(
      eq(customFieldValuesTable.customerId, customerId),
      inArray(customFieldValuesTable.definitionId, applicable.map((field) => field.id)),
    ))
    : [];
  return applicable.map((definition) => ({
    id: definition.id,
    fieldId: definition.id,
    fieldKey: definition.fieldKey,
    label: definition.label,
    fieldType: definition.fieldType,
    required: definition.isRequired,
    position: definition.sortOrder,
    value: values.find((value) => value.definitionId === definition.id)?.value ?? "",
  }));
}

async function readProfileDetails(customerId: number, prospectOnly: boolean) {
  const customer = await requireScopedAccount(db, customerId, prospectOnly);
  const [settings] = await db.select().from(accountProfileSettingsTable)
    .where(eq(accountProfileSettingsTable.customerId, customerId));
  const ids = [
    settings?.profileTypeId,
    settings?.profileGroupId,
    settings?.paymentTermsId,
    settings?.marketingSourceId,
  ].filter((id): id is number => id != null);
  const selectedCatalogs = ids.length
    ? await db.select().from(profileCatalogItemsTable).where(inArray(profileCatalogItemsTable.id, ids))
    : [];
  const nameFor = (id: number | null | undefined) =>
    id == null ? null : selectedCatalogs.find((item) => item.id === id)?.name ?? null;
  const [companyDefaultPaymentTerms] = await db.select().from(profileCatalogItemsTable).where(and(
    eq(profileCatalogItemsTable.catalogType, "payment_terms"),
    eq(profileCatalogItemsTable.isDefault, true),
    eq(profileCatalogItemsTable.isActive, true),
  ));
  const accountPaymentTerms = settings?.paymentTermsOverride ?? nameFor(settings?.paymentTermsId);
  const [channels, customFields, locations] = await Promise.all([
    readChannels(customerId),
    readCustomFields(customerId, typeof customer.clientType === "string" ? customer.clientType : "residential"),
    db.select().from(propertiesTable)
      .where(and(eq(propertiesTable.customerId, customerId), isNull(propertiesTable.archivedAt)))
      .orderBy(asc(propertiesTable.id)),
  ]);
  return {
    customerId,
    profileTemplate: customer.clientType ?? "residential",
    profileType: nameFor(settings?.profileTypeId),
    profileTypeId: settings?.profileTypeId ?? null,
    profileGroup: nameFor(settings?.profileGroupId),
    profileGroupId: settings?.profileGroupId ?? null,
    paymentTerms: accountPaymentTerms,
    effectivePaymentTerms: accountPaymentTerms ?? companyDefaultPaymentTerms?.name ?? null,
    paymentTermsSource: accountPaymentTerms ? "account_specific" : "company_default",
    paymentTermsId: settings?.paymentTermsId ?? null,
    marketingSource: nameFor(settings?.marketingSourceId) ?? customer.source ?? null,
    marketingSourceId: settings?.marketingSourceId ?? null,
    preferredContactMethod: settings?.preferredContactMethod ?? customer.preferredContactMethod,
    sendingPreferences: settings?.sendingPreferences ?? customer.sendingPreferences,
    isNonProfit: customer.isNonProfit,
    taxExempt: customer.taxExempt,
    ccFeeExempt: customer.ccFeeExempt,
    channels,
    customFields,
    locations,
  };
}

router.get(["/customers/:id/profile-details", "/prospects/:id/profile-details"], async (req, res) => {
  try {
    res.json(await readProfileDetails(parseId(req.params.id), req.path.startsWith("/prospects/")));
  } catch (error) {
    respondError(res, error, "Failed to fetch profile details");
  }
});

router.put(["/customers/:id/profile-settings", "/prospects/:id/profile-settings"], async (req, res) => {
  try {
    const customerId = parseId(req.params.id);
    const body = req.body as Record<string, unknown>;
    await db.transaction(async (tx) => {
      await requireScopedAccount(tx, customerId, req.path.startsWith("/prospects/"));
      await lockAccount(tx, customerId);
      const profileTypeId = await lookupCatalogId(
        tx, "profile_type", catalogSelectionInput(body, "profileTypeId", "profileType"),
      );
      const profileGroupId = await lookupCatalogId(
        tx, "profile_group", catalogSelectionInput(body, "profileGroupId", "profileGroup"),
      );
      const paymentTermsId = await lookupCatalogId(
        tx, "payment_terms", catalogSelectionInput(body, "paymentTermsId", "paymentTerms"),
      );
      const marketingSourceId = await lookupCatalogId(
        tx, "marketing_source", catalogSelectionInput(body, "marketingSourceId", "marketingSource"),
      );
      const profileTemplate = body.profileTemplate === "commercial" ? "commercial" : "residential";
      await tx.update(customersTable).set({
        clientType: profileTemplate,
        isNonProfit: bool(body.isNonProfit),
        taxExempt: bool(body.taxExempt),
        ccFeeExempt: bool(body.ccFeeExempt),
        source: text(body.marketingSource),
      }).where(eq(customersTable.id, customerId));
      await tx.insert(accountProfileSettingsTable).values({
        customerId,
        profileTypeId,
        profileGroupId,
        paymentTermsId,
        marketingSourceId,
        paymentTermsOverride: paymentTermsId ? null : text(body.paymentTermsOverride ?? body.paymentTerms),
        preferredContactMethod: text(body.preferredContactMethod),
        sendingPreferences: text(body.sendingPreferences),
      }).onConflictDoUpdate({
        target: accountProfileSettingsTable.customerId,
        set: {
          profileTypeId,
          profileGroupId,
          paymentTermsId,
          marketingSourceId,
          paymentTermsOverride: paymentTermsId ? null : text(body.paymentTermsOverride ?? body.paymentTerms),
          preferredContactMethod: text(body.preferredContactMethod),
          sendingPreferences: text(body.sendingPreferences),
          updatedAt: new Date(),
        },
      });
    });
    res.json(await readProfileDetails(customerId, req.path.startsWith("/prospects/")));
  } catch (error) {
    respondError(res, error, "Failed to update profile settings");
  }
});

router.get(["/customers/:id/channels", "/prospects/:id/channels"], async (req, res) => {
  try {
    const customerId = parseId(req.params.id);
    await requireScopedAccount(db, customerId, req.path.startsWith("/prospects/"));
    res.json(await readChannels(customerId));
  } catch (error) {
    respondError(res, error, "Failed to fetch contact channels");
  }
});

router.post(["/customers/:id/channels", "/prospects/:id/channels"], async (req, res) => {
  try {
    const customerId = parseId(req.params.id);
    const body = req.body as Record<string, unknown>;
    const channelType = String(body.channelType ?? body.type ?? "");
    if (!CHANNEL_TYPES.has(channelType)) throw new AccountRelationError(400, "type must be email or phone");
    const value = text(body.value);
    if (!value) throw new AccountRelationError(400, "value is required");
    const purposes = channelPurposes(body);
    const created = await db.transaction(async (tx) => {
      await requireScopedAccount(tx, customerId, req.path.startsWith("/prospects/"));
      await lockAccount(tx, customerId);
      const contactId = body.contactId == null || body.contactId === "" ? null : parseId(body.contactId, "contactId");
      if (contactId != null) {
        const [contact] = await tx.select({ id: contactsTable.id }).from(contactsTable)
          .where(and(eq(contactsTable.id, contactId), eq(contactsTable.customerId, customerId), isNull(contactsTable.archivedAt)));
        if (!contact) throw new AccountRelationError(400, "contactId does not belong to this account");
      }
      const [channel] = await tx.insert(contactChannelsTable).values({
        customerId,
        contactId,
        channelType,
        label: text(body.label) ?? (channelType === "email" ? "Email" : "Phone"),
        value,
        isPrimary: bool(body.isPrimary),
        notes: text(body.notes),
      }).returning();
      await tx.insert(contactChannelPurposesTable).values(
        purposes.map((purpose) => ({ channelId: channel.id, purpose })),
      );
      return channel;
    });
    res.status(201).json({ ...created, type: created.channelType, purposes, purpose: purposes[0] });
  } catch (error) {
    respondError(res, error, "Failed to add contact channel");
  }
});

router.patch("/contact-channels/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const body = req.body as Record<string, unknown>;
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(contactChannelsTable)
        .where(and(eq(contactChannelsTable.id, id), isNull(contactChannelsTable.archivedAt)));
      if (!current) throw new AccountRelationError(404, "Contact channel not found");
      await lockAccount(tx, current.customerId);
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (body.value !== undefined) {
        const value = text(body.value);
        if (!value) throw new AccountRelationError(400, "value is required");
        updateData.value = value;
      }
      if (body.label !== undefined) updateData.label = text(body.label) ?? current.label;
      if (body.type !== undefined || body.channelType !== undefined) {
        const type = String(body.channelType ?? body.type);
        if (!CHANNEL_TYPES.has(type)) throw new AccountRelationError(400, "type must be email or phone");
        updateData.channelType = type;
      }
      if (body.contactId !== undefined) {
        const contactId = body.contactId == null || body.contactId === "" ? null : parseId(body.contactId, "contactId");
        if (contactId != null) {
          const [contact] = await tx.select({ id: contactsTable.id }).from(contactsTable)
            .where(and(eq(contactsTable.id, contactId), eq(contactsTable.customerId, current.customerId), isNull(contactsTable.archivedAt)));
          if (!contact) throw new AccountRelationError(400, "contactId does not belong to this account");
        }
        updateData.contactId = contactId;
      }
      if (body.isPrimary !== undefined) updateData.isPrimary = bool(body.isPrimary);
      const [channel] = await tx.update(contactChannelsTable).set(updateData)
        .where(eq(contactChannelsTable.id, id)).returning();
      let purposes: string[];
      try {
        const replacement = channelPurposePatch(body);
        if (replacement) {
          purposes = replacement;
          await tx.delete(contactChannelPurposesTable).where(eq(contactChannelPurposesTable.channelId, id));
          await tx.insert(contactChannelPurposesTable).values(purposes.map((purpose) => ({ channelId: id, purpose })));
        } else {
          purposes = (await tx.select({ purpose: contactChannelPurposesTable.purpose })
            .from(contactChannelPurposesTable)
            .where(eq(contactChannelPurposesTable.channelId, id))).map((row) => row.purpose);
        }
      } catch (error) {
        throw new AccountRelationError(400, error instanceof Error ? error.message : "Invalid channel purposes");
      }
      return { channel, purposes };
    });
    res.json({ ...updated.channel, type: updated.channel.channelType, purposes: updated.purposes, purpose: updated.purposes[0] });
  } catch (error) {
    respondError(res, error, "Failed to update contact channel");
  }
});

router.delete("/contact-channels/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const [current] = await db.select().from(contactChannelsTable).where(eq(contactChannelsTable.id, id));
    if (!current) throw new AccountRelationError(404, "Contact channel not found");
    await db.update(contactChannelsTable).set({
      archivedAt: new Date(),
      archivedBy: actor(req),
      updatedAt: new Date(),
    }).where(eq(contactChannelsTable.id, id));
    res.status(204).send();
  } catch (error) {
    respondError(res, error, "Failed to archive contact channel");
  }
});

router.put(["/customers/:id/custom-fields", "/prospects/:id/custom-fields"], async (req, res) => {
  try {
    const customerId = parseId(req.params.id);
    const supplied = Array.isArray(req.body?.customFields) ? req.body.customFields : [];
    await db.transaction(async (tx) => {
      const customer = await requireScopedAccount(tx, customerId, req.path.startsWith("/prospects/"));
      await lockAccount(tx, customerId);
      const profileTemplate = customer.clientType === "commercial" ? "commercial" : "residential";
      for (const raw of supplied) {
        const field = raw as Record<string, unknown>;
        const definitionId = parseId(field.definitionId ?? field.fieldId ?? field.id, "definitionId");
        const [definition] = await tx.select({ id: customFieldDefinitionsTable.id })
          .from(customFieldDefinitionsTable).where(and(
            eq(customFieldDefinitionsTable.id, definitionId),
            eq(customFieldDefinitionsTable.scope, "account"),
            inArray(customFieldDefinitionsTable.template, ["all", profileTemplate]),
          ));
        if (!definition) throw new AccountRelationError(400, "Custom field definition not found");
        await tx.insert(customFieldValuesTable).values({
          customerId,
          definitionId,
          value: text(field.value),
        }).onConflictDoUpdate({
          target: [customFieldValuesTable.customerId, customFieldValuesTable.definitionId],
          set: { value: text(field.value), updatedAt: new Date() },
        });
      }
    });
    const customer = await requireScopedAccount(db, customerId, req.path.startsWith("/prospects/"));
    res.json(await readCustomFields(
      customerId,
      customer.clientType === "commercial" ? "commercial" : "residential",
    ));
  } catch (error) {
    respondError(res, error, "Failed to save custom fields");
  }
});

router.get("/catalogs/:type", async (req, res) => {
  try {
    const type = catalogType(req.params.type);
    const includeInactive = req.query.includeInactive === "true";
    const where = includeInactive
      ? eq(profileCatalogItemsTable.catalogType, type)
      : and(eq(profileCatalogItemsTable.catalogType, type), eq(profileCatalogItemsTable.isActive, true));
    const rows = await db.select().from(profileCatalogItemsTable)
      .where(where)
      .orderBy(asc(profileCatalogItemsTable.sortOrder), asc(profileCatalogItemsTable.name));
    res.json(rows.map((row) => ({ ...row, label: row.name, value: row.name, active: row.isActive })));
  } catch (error) {
    respondError(res, error, "Failed to fetch catalog");
  }
});

router.post("/catalogs/:type", async (req, res) => {
  try {
    const type = catalogType(req.params.type);
    const body = req.body as Record<string, unknown>;
    const name = text(body.name ?? body.label);
    if (!name) throw new AccountRelationError(400, "name is required");
    const [created] = await db.insert(profileCatalogItemsTable).values({
      catalogType: type,
      code: text(body.code) ?? slugify(name),
      name,
      description: text(body.description),
      pricingType: text(body.pricingType),
      defaultPrice: text(body.defaultPrice),
      unit: text(body.unit),
      estimatedDuration: body.estimatedDuration == null ? null : Number(body.estimatedDuration),
      daysUntilDue: body.daysUntilDue == null ? null : Number(body.daysUntilDue),
      isDefault: bool(body.isDefault),
      isActive: body.active === undefined && body.isActive === undefined ? true : bool(body.active ?? body.isActive),
      sortOrder: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    }).returning();
    res.status(201).json({ ...created, label: created.name, value: created.name, active: created.isActive });
  } catch (error) {
    respondError(res, error, "Failed to create catalog item");
  }
});

router.patch("/catalogs/:type/:id", async (req, res) => {
  try {
    const type = catalogType(req.params.type);
    const id = parseId(req.params.id);
    const body = req.body as Record<string, unknown>;
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined || body.label !== undefined) {
      const name = text(body.name ?? body.label);
      if (!name) throw new AccountRelationError(400, "name is required");
      update.name = name;
    }
    if (body.description !== undefined) update.description = text(body.description);
    if (body.active !== undefined || body.isActive !== undefined) update.isActive = bool(body.active ?? body.isActive);
    if (body.sortOrder !== undefined) update.sortOrder = Number(body.sortOrder);
    if (body.isDefault !== undefined) update.isDefault = bool(body.isDefault);
    for (const field of ["pricingType", "unit"] as const) if (body[field] !== undefined) update[field] = text(body[field]);
    for (const field of ["estimatedDuration", "daysUntilDue"] as const) if (body[field] !== undefined) update[field] = body[field] == null ? null : Number(body[field]);
    if (body.defaultPrice !== undefined) update.defaultPrice = text(body.defaultPrice);
    const [row] = await db.update(profileCatalogItemsTable).set(update)
      .where(and(eq(profileCatalogItemsTable.id, id), eq(profileCatalogItemsTable.catalogType, type))).returning();
    if (!row) throw new AccountRelationError(404, "Catalog item not found");
    res.json({ ...row, label: row.name, value: row.name, active: row.isActive });
  } catch (error) {
    respondError(res, error, "Failed to update catalog item");
  }
});

router.delete("/catalogs/:type/:id", async (req, res) => {
  try {
    const type = catalogType(req.params.type);
    const id = parseId(req.params.id);
    const [row] = await db.update(profileCatalogItemsTable)
      .set({ isActive: false, isDefault: false, updatedAt: new Date() })
      .where(and(eq(profileCatalogItemsTable.id, id), eq(profileCatalogItemsTable.catalogType, type)))
      .returning();
    if (!row) throw new AccountRelationError(404, "Catalog item not found");
    res.status(204).send();
  } catch (error) {
    respondError(res, error, "Failed to deactivate catalog item");
  }
});

router.get("/custom-fields/definitions", async (_req, res) => {
  try {
    const rows = await db.select().from(customFieldDefinitionsTable)
      .orderBy(asc(customFieldDefinitionsTable.sortOrder), asc(customFieldDefinitionsTable.label));
    res.json(rows.map((row) => ({ ...row, active: row.isActive, required: row.isRequired })));
  } catch (error) {
    respondError(res, error, "Failed to fetch custom field definitions");
  }
});

router.post("/custom-fields/definitions", async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const label = text(body.label);
    if (!label) throw new AccountRelationError(400, "label is required");
    const fieldType = text(body.fieldType) ?? "text";
    if (!["text", "multiline", "number", "date", "boolean"].includes(fieldType)) {
      throw new AccountRelationError(400, "fieldType is invalid");
    }
    const scope = text(body.scope ?? body.entityType) ?? "account";
    if (scope !== "account") throw new AccountRelationError(400, "Only account-scoped custom fields are supported");
    const template = text(body.template) ?? "all";
    if (!["all", "residential", "commercial"].includes(template)) {
      throw new AccountRelationError(400, "template is invalid");
    }
    const [row] = await db.insert(customFieldDefinitionsTable).values({
      fieldKey: text(body.fieldKey) ?? slugify(label).replaceAll("-", "_"),
      label,
      fieldType,
      scope,
      template,
      isRequired: bool(body.required ?? body.isRequired),
      isActive: body.active === undefined && body.isActive === undefined ? true : bool(body.active ?? body.isActive),
      sortOrder: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    }).returning();
    res.status(201).json({ ...row, active: row.isActive, required: row.isRequired });
  } catch (error) {
    respondError(res, error, "Failed to create custom field definition");
  }
});

router.patch("/custom-fields/definitions/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const body = req.body as Record<string, unknown>;
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.label !== undefined) update.label = text(body.label);
    if (body.fieldKey !== undefined) update.fieldKey = text(body.fieldKey);
    if (body.fieldType !== undefined) update.fieldType = text(body.fieldType);
    if (body.scope !== undefined || body.entityType !== undefined) {
      const scope = text(body.scope ?? body.entityType);
      if (scope !== "account") throw new AccountRelationError(400, "Only account-scoped custom fields are supported");
      update.scope = scope;
    }
    if (body.template !== undefined) {
      const template = text(body.template);
      if (!template || !["all", "residential", "commercial"].includes(template)) {
        throw new AccountRelationError(400, "template is invalid");
      }
      update.template = template;
    }
    if (body.required !== undefined || body.isRequired !== undefined) update.isRequired = bool(body.required ?? body.isRequired);
    if (body.active !== undefined || body.isActive !== undefined) update.isActive = bool(body.active ?? body.isActive);
    if (body.sortOrder !== undefined) update.sortOrder = Number(body.sortOrder);
    const [row] = await db.update(customFieldDefinitionsTable).set(update)
      .where(eq(customFieldDefinitionsTable.id, id)).returning();
    if (!row) throw new AccountRelationError(404, "Custom field definition not found");
    res.json({ ...row, active: row.isActive, required: row.isRequired });
  } catch (error) {
    respondError(res, error, "Failed to update custom field definition");
  }
});

router.delete("/custom-fields/definitions/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const [row] = await db.update(customFieldDefinitionsTable).set({
      isActive: false,
      updatedAt: new Date(),
    }).where(eq(customFieldDefinitionsTable.id, id)).returning();
    if (!row) throw new AccountRelationError(404, "Custom field definition not found");
    res.status(204).send();
  } catch (error) {
    respondError(res, error, "Failed to deactivate custom field definition");
  }
});

function respondError(res: any, error: unknown, fallback: string): void {
  if (error instanceof AccountRelationError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : fallback;
  const status = message.includes("duplicate key") ? 409 : 500;
  res.status(status).json({ error: status === 500 ? fallback : message });
}

export default router;