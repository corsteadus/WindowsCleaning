import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, servicesTable } from "@workspace/db";
import {
  CreateServiceBody,
  UpdateServiceBody,
} from "@workspace/api-zod";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  getIdempotencyContext,
  idempotencyConflictMessage,
  idempotencyInProgressMessage,
  markIdempotencyReplay,
} from "../lib/idempotency.ts";
import {
  mergeServiceUpdate,
  normalizeServiceInput,
  validateServiceInput,
  type CanonicalServiceInput,
} from "../lib/service-validation.ts";

const router: IRouter = Router();

router.get("/services", async (_req, res): Promise<void> => {
  const services = await db.select().from(servicesTable).orderBy(servicesTable.name);
  res.json(services.map(serialize));
});

router.post("/services", async (req, res): Promise<void> => {
  const parsed = CreateServiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join("; ") });
    return;
  }
  const body = normalizeServiceInput({
    ...parsed.data,
    description: parsed.data.description ?? null,
    unit: parsed.data.unit ?? null,
    estimatedDuration: parsed.data.estimatedDuration ?? null,
    isActive: parsed.data.isActive ?? true,
  });
  const validationError = validateServiceInput(body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  let idempotency;
  try {
    idempotency = getIdempotencyContext(req, "services.create", body);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid Idempotency-Key" });
    return;
  }
  if (!idempotency) {
    res.status(400).json({ error: "Idempotency-Key header is required" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const claim = await claimIdempotencyKey(tx, idempotency);
    if (claim.kind === "conflict") return { kind: "conflict" as const };
    if (claim.kind === "inProgress") return { kind: "inProgress" as const };
    if (claim.kind === "replay") {
      const [service] = await tx.select().from(servicesTable)
        .where(eq(servicesTable.id, claim.record.resourceId!));
      if (!service) throw new Error("Idempotent service result no longer exists");
      return { kind: "replay" as const, service };
    }

    const [service] = await tx.insert(servicesTable).values({
      name: body.name,
      description: body.description,
      category: body.category,
      pricingType: body.pricingType,
      basePrice: String(body.basePrice),
      unit: body.unit,
      estimatedDuration: body.estimatedDuration,
      isActive: body.isActive,
    }).returning();
    await completeIdempotencyKey(tx, claim.record.id, {
      resourceType: "service",
      resourceId: service.id,
      responseStatus: 201,
    });
    return { kind: "created" as const, service };
  });

  if (result.kind === "conflict") {
    res.status(409).json({ error: idempotencyConflictMessage() });
    return;
  }
  if (result.kind === "inProgress") {
    res.status(409).json({ error: idempotencyInProgressMessage() });
    return;
  }
  if (result.kind === "replay") markIdempotencyReplay(res);
  res.status(201).json(serialize(result.service));
});

router.patch("/services/:id", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const parsed = UpdateServiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join("; ") });
    return;
  }
  const [existing] = await db.select().from(servicesTable).where(eq(servicesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Service not found" });
    return;
  }
  const canonicalExisting: CanonicalServiceInput = {
    name: existing.name, description: existing.description, category: existing.category,
    pricingType: existing.pricingType, basePrice: Number(existing.basePrice), unit: existing.unit,
    estimatedDuration: existing.estimatedDuration, isActive: existing.isActive,
  };
  const merged = mergeServiceUpdate(canonicalExisting, parsed.data);
  const validationError = validateServiceInput(merged);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  const [service] = await db.update(servicesTable).set({
    ...merged,
    basePrice: String(merged.basePrice),
  }).where(eq(servicesTable.id, id)).returning();
  res.json(serialize(service));
});

router.delete("/services/:id", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const [service] = await db.delete(servicesTable).where(eq(servicesTable.id, id)).returning();
  if (!service) {
    res.status(404).json({ error: "Service not found" });
    return;
  }
  res.sendStatus(204);
});

function serialize(s: typeof servicesTable.$inferSelect) {
  return {
    ...s,
    basePrice: Number(s.basePrice),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export default router;
