import { Router, type IRouter, type RequestHandler } from "express";
import { db } from "@workspace/db";
import { tasksTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireCapability, type AppCapability } from "../lib/authorization.ts";
import { canonicalIsoInstant } from "../lib/date.ts";

export type TasksRepository = {
  list(filters: { relatedType?: string; relatedId?: number; status?: string }): Promise<any[]>;
  create(values: Record<string, unknown>): Promise<any>;
  update(id: number, values: Record<string, unknown>): Promise<any | null>;
  remove(id: number): Promise<void>;
};

export type TasksAuthorization = (capability: AppCapability) => RequestHandler;

const drizzleTasksRepository: TasksRepository = {
  async list(filters) {
    const conditions = [];
    if (filters.relatedType !== undefined) conditions.push(eq(tasksTable.relatedType, filters.relatedType));
    if (filters.relatedId !== undefined) conditions.push(eq(tasksTable.relatedId, filters.relatedId));
    if (filters.status !== undefined) conditions.push(eq(tasksTable.status, filters.status));
    return conditions.length
      ? db.select().from(tasksTable).where(and(...conditions))
      : db.select().from(tasksTable).orderBy(tasksTable.createdAt);
  },
  async create(values) {
    const [row] = await db.insert(tasksTable).values(values as any).returning();
    return row;
  },
  async update(id, values) {
    const [row] = await db.update(tasksTable).set(values as any)
      .where(eq(tasksTable.id, id)).returning();
    return row ?? null;
  },
  async remove(id) {
    await db.delete(tasksTable).where(eq(tasksTable.id, id));
  },
};

function canonicalInstant(value: unknown): string | null {
  if (value === null) return null;
  const canonical = canonicalIsoInstant(value);
  if (!canonical) throw new Error("invalid_date_time");
  return canonical;
}

export function createTasksRouter(
  repository: TasksRepository = drizzleTasksRepository,
  authorize: TasksAuthorization = requireCapability,
): IRouter {
  const router: IRouter = Router();

router.get("/tasks", authorize("tasks.view"), async (req, res) => {
  try {
    const { relatedType, relatedId, status } = req.query;
    const rows = await repository.list({
      relatedType: relatedType ? String(relatedType) : undefined,
      relatedId: relatedId ? Number(relatedId) : undefined,
      status: status ? String(status) : undefined,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

router.post("/tasks", authorize("tasks.manage"), async (req, res) => {
  try {
    const body = req.body;
    const row = await repository.create({
      relatedType: body.relatedType || null,
      relatedId: body.relatedId ? Number(body.relatedId) : null,
      title: body.title,
      description: body.description || null,
      status: body.status || "pending",
      priority: body.priority || "normal",
      dueAt: body.dueAt === undefined ? null : canonicalInstant(body.dueAt),
      completedAt: body.completedAt || null,
      assignedTo: body.assignedTo || null,
    });
    res.status(201).json(row);
  } catch (err) {
    if (err instanceof Error && err.message === "invalid_date_time") {
      res.status(400).json({ error: "dueAt must be a valid ISO date-time or null" });
      return;
    }
    res.status(500).json({ error: "Failed to create task" });
  }
});

router.patch("/tasks/:id", authorize("tasks.manage"), async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const body = req.body;
    const row = await repository.update(id, {
      relatedType: body.relatedType,
      relatedId: body.relatedId ? Number(body.relatedId) : undefined,
      title: body.title,
      description: body.description,
      status: body.status,
      priority: body.priority,
      dueAt: body.dueAt === undefined ? undefined : canonicalInstant(body.dueAt),
      completedAt: body.completedAt,
      assignedTo: body.assignedTo,
    });
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    if (err instanceof Error && err.message === "invalid_date_time") {
      res.status(400).json({ error: "dueAt must be a valid ISO date-time or null" });
      return;
    }
    res.status(500).json({ error: "Failed to update task" });
  }
});

router.delete("/tasks/:id", authorize("tasks.manage"), async (req, res) => {
  try {
    await repository.remove(Number(req.params.id));
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete task" });
  }
});

  return router;
}

export default createTasksRouter();
