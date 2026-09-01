import {
  committedTaskDueAtMatches,
  taskDueAtFromControl,
} from "./task-due-at.ts";

export type TaskFormDraft = {
  title: string;
  description: string;
  status: string;
  priority: string;
  assignedTo: string;
  relatedType: string;
  relatedId: string;
};

type SavedTask = {
  id: number;
  dueAt?: string | null;
};

export type TaskFormSubmissionResult =
  | { kind: "invalidDueAt" }
  | { kind: "unconfirmed"; committedTask: SavedTask }
  | { kind: "saved"; committedTask: SavedTask };

export async function submitTaskForm(input: {
  draft: TaskFormDraft;
  dueAtControlValue: string;
  editingId: number | null;
  create: (payload: Record<string, unknown>) => Promise<SavedTask>;
  update: (id: number, payload: Record<string, unknown>) => Promise<SavedTask>;
  refresh: () => Promise<readonly SavedTask[] | undefined>;
}): Promise<TaskFormSubmissionResult> {
  const requestedDueAt = taskDueAtFromControl(input.dueAtControlValue);
  if (input.dueAtControlValue && !requestedDueAt) return { kind: "invalidDueAt" };

  const payload = {
    ...input.draft,
    dueAt: requestedDueAt,
    relatedId: input.draft.relatedId ? Number(input.draft.relatedId) : undefined,
  };
  const committedTask = input.editingId === null
    ? await input.create(payload)
    : await input.update(input.editingId, payload);
  const refreshedTasks = await input.refresh();
  const refreshedTask = refreshedTasks?.find((task) => task.id === committedTask.id);

  if (
    !committedTaskDueAtMatches(requestedDueAt, committedTask.dueAt)
    || !refreshedTask
    || !committedTaskDueAtMatches(requestedDueAt, refreshedTask.dueAt)
  ) {
    return { kind: "unconfirmed", committedTask };
  }
  return { kind: "saved", committedTask };
}