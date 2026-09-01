import { useState, type FormEvent } from "react";
import { Layout } from "@/components/Layout";
import { useListTasks, useCreateTask, useUpdateTask, useDeleteTask } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { CheckSquare, Plus, Pencil, Trash2, Clock, CheckCircle2, Circle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  taskDueAtToControl,
} from "@/lib/task-due-at";
import { submitTaskForm } from "@/lib/task-form-submission";

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "text-red-600 bg-red-50",
  high: "text-orange-600 bg-orange-50",
  normal: "text-blue-600 bg-blue-50",
  low: "text-slate-500 bg-slate-50",
};

const emptyForm = {
  title: "",
  description: "",
  status: "pending",
  priority: "normal",
  dueAt: "",
  assignedTo: "",
  relatedType: "",
  relatedId: "",
};

function formatTaskDueAt(value: string): string {
  const chicagoValue = taskDueAtToControl(value);
  if (!chicagoValue) return "Invalid due date";
  return format(new Date(`${chicagoValue}:00`), "MMM d, h:mm a");
}

export default function Tasks() {
  const { data: tasks = [], refetch } = useListTasks();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({ ...emptyForm });
  const [filterStatus, setFilterStatus] = useState("all");

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setOpen(true);
  };

  const openEdit = (task: any) => {
    setEditing(task);
    setForm({
      title: task.title || "",
      description: task.description || "",
      status: task.status || "pending",
      priority: task.priority || "normal",
      dueAt: taskDueAtToControl(task.dueAt),
      assignedTo: task.assignedTo || "",
      relatedType: task.relatedType || "",
      relatedId: task.relatedId ? String(task.relatedId) : "",
    });
    setOpen(true);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const dueAtControlValue = String(new FormData(event.currentTarget).get("dueAt") ?? "");
    try {
      const result = await submitTaskForm({
        draft: form,
        dueAtControlValue,
        editingId: editing?.id ?? null,
        create: (payload) => createTask.mutateAsync({ data: payload as any }),
        update: (id, payload) => updateTask.mutateAsync({ id, data: payload as any }),
        refresh: async () => (await refetch()).data as any[],
      });
      if (result.kind === "invalidDueAt") {
        toast({
          title: "Invalid due date",
          description: "Choose an unambiguous, valid America/Chicago date and time.",
          variant: "destructive",
        });
        return;
      }
      if (result.kind === "unconfirmed") {
        toast({
          title: "Task save not confirmed",
          description: "The saved task and refreshed task list did not retain the exact due date you entered. The editor remains open.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: editing ? "Task updated" : "Task created" });
      setOpen(false);
    } catch {
      toast({ title: "Error saving task", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this task?")) return;
    await deleteTask.mutateAsync({ id });
    toast({ title: "Task deleted" });
    refetch();
  };

  const toggleComplete = async (task: any) => {
    const newStatus = task.status === "completed" ? "pending" : "completed";
    await updateTask.mutateAsync({ id: task.id, data: { title: task.title ?? "", status: newStatus, completedAt: newStatus === "completed" ? new Date().toISOString() : undefined } });
    refetch();
  };

  const filtered = (tasks as any[]).filter((t: any) => filterStatus === "all" || t.status === filterStatus);
  const pending = (tasks as any[]).filter((t: any) => t.status === "pending").length;
  const overdue = (tasks as any[]).filter((t: any) => t.status === "pending" && t.dueAt && new Date(t.dueAt) < new Date()).length;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Tasks</h1>
            <p className="text-slate-500 mt-1">Track follow-ups, lead activities, and action items</p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" /> New Task
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <Circle className="w-8 h-8 text-blue-500" />
                <div>
                  <p className="text-2xl font-bold">{pending}</p>
                  <p className="text-sm text-slate-500">Pending</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-8 h-8 text-red-500" />
                <div>
                  <p className="text-2xl font-bold">{overdue}</p>
                  <p className="text-sm text-slate-500">Overdue</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
                <div>
                  <p className="text-2xl font-bold">{(tasks as any[]).filter((t: any) => t.status === "completed").length}</p>
                  <p className="text-sm text-slate-500">Completed</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filter */}
        <div className="flex gap-2">
          {["all", "pending", "in_progress", "completed"].map((s) => (
            <Button
              key={s}
              variant={filterStatus === s ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus(s)}
              className="capitalize"
            >
              {s === "all" ? "All" : s.replace("_", " ")}
            </Button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <Card>
            <CardContent className="py-16 flex flex-col items-center gap-3">
              <CheckSquare className="w-12 h-12 text-slate-300" />
              <p className="text-slate-500 font-medium">No tasks found</p>
              <Button onClick={openCreate} variant="outline" className="mt-2">Add First Task</Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filtered.map((task: any) => {
              const isOverdue = task.status === "pending" && task.dueAt && new Date(task.dueAt) < new Date();
              return (
                <Card key={task.id} className={`hover:shadow-sm transition-shadow ${task.status === "completed" ? "opacity-60" : ""}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => toggleComplete(task)}
                        aria-label={task.status === "completed" ? `Reopen task ${task.title}` : `Complete task ${task.title}`}
                        className="mt-0.5 flex-shrink-0"
                      >
                        {task.status === "completed"
                          ? <CheckCircle2 className="w-5 h-5 text-green-500" />
                          : <Circle className="w-5 h-5 text-slate-300 hover:text-blue-400" />
                        }
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-medium ${task.status === "completed" ? "line-through text-slate-400" : "text-slate-900"}`}>
                            {task.title}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${PRIORITY_COLORS[task.priority] || "text-slate-500 bg-slate-50"}`}>
                            {task.priority}
                          </span>
                          {isOverdue && (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium text-red-700 bg-red-100">Overdue</span>
                          )}
                        </div>
                        {task.description && (
                          <p className="text-sm text-slate-500 mt-0.5 truncate">{task.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                          {task.dueAt && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                               Due {formatTaskDueAt(task.dueAt)} CT
                            </span>
                          )}
                          {task.assignedTo && <span>Assigned to: {task.assignedTo}</span>}
                          {task.relatedType && <span className="capitalize">{task.relatedType} #{task.relatedId}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                         <Button size="sm" variant="ghost" aria-label={`Edit task ${task.title}`} onClick={() => openEdit(task)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                         <Button size="sm" variant="ghost" aria-label={`Delete task ${task.title}`} onClick={() => handleDelete(task.id)} className="text-red-500 hover:text-red-700 hover:bg-red-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Task" : "New Task"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-2">
            <div>
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Follow up with prospect" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional details..." rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Due Date & Time</Label>
              <Input name="dueAt" type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
              <p className="mt-1 text-xs text-slate-400">America/Chicago time</p>
            </div>
            <div>
              <Label>Assigned To</Label>
              <Input value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} placeholder="Name or email" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Related To</Label>
                <Select value={form.relatedType || "none"} onValueChange={(v) => setForm({ ...form, relatedType: v === "none" ? "" : v, relatedId: "" })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="lead">Lead</SelectItem>
                    <SelectItem value="customer">Customer</SelectItem>
                    <SelectItem value="job">Job</SelectItem>
                    <SelectItem value="quote">Quote</SelectItem>
                    <SelectItem value="invoice">Invoice</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.relatedType && (
                <div>
                  <Label>Related ID</Label>
                  <Input type="number" value={form.relatedId} onChange={(e) => setForm({ ...form, relatedId: e.target.value })} placeholder="ID #" />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={!form.title || createTask.isPending || updateTask.isPending}>
              {editing ? "Save Changes" : "Create Task"}
            </Button>
          </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
