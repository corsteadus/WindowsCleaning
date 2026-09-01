import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  chicagoAppointmentStartsAt,
  chicagoDateTimeLocalToIso,
  committedAppointmentMatches,
  hasAppointmentLocation,
  normalizedAppointmentPropertyIds,
  isoToChicagoDateTimeLocal,
} from "./chicago-time.ts";
import { committedJobScheduleMatches } from "./job-date-commit.ts";
import { submittedJobSchedule } from "./job-new-scheduled-date.ts";
import {
  committedTaskDueAtMatches,
  taskDueAtFromControl,
  taskDueAtToControl,
} from "./task-due-at.ts";
import { filterSelectableCrewTechnicians } from "./crew-technician-options.ts";
import {
  captureAndRetainSubmittedQuoteAppointment,
  prepareQuoteAppointment,
  submittedQuoteAppointment,
  submitAndConfirmQuoteAppointment,
} from "./quote-appointment-submission.ts";
import { submitTaskForm } from "./task-form-submission.ts";

test("Chicago wall times round-trip in standard time, daylight time, and at midnight", () => {
  for (const [wall, iso] of [
    ["2026-01-15T12:30", "2026-01-15T18:30:00.000Z"],
    ["2026-07-15T12:30", "2026-07-15T17:30:00.000Z"],
    ["2026-07-15T00:00", "2026-07-15T05:00:00.000Z"],
  ]) {
    assert.equal(chicagoDateTimeLocalToIso(wall), iso);
    assert.equal(isoToChicagoDateTimeLocal(iso), wall);
  }
});

test("Chicago helper rejects malformed, nonexistent, and ambiguous wall times", () => {
  assert.equal(chicagoDateTimeLocalToIso("not-a-date"), null);
  assert.equal(chicagoDateTimeLocalToIso("2026-02-30T09:00"), null);
  assert.equal(chicagoDateTimeLocalToIso("2026-03-08T02:30"), null);
  assert.equal(chicagoDateTimeLocalToIso("2026-11-01T01:30"), null);
});

test("appointment commitment verifies all returned temporal and scheduling fields", () => {
  const request = {
    startsAt: chicagoAppointmentStartsAt("2026-07-15", "09:00")!,
    durationMinutes: 60,
    propertyIds: [9, 4],
    assignedUserId: "tech-1",
    appointmentNotes: "Gate code",
    estimateNotes: "Inspect all windows",
  };
  assert.equal(committedAppointmentMatches(request, { ...request }), true);
  assert.equal(committedAppointmentMatches(request, { ...request, propertyIds: [4, 9, 9] }), true);
  assert.equal(committedAppointmentMatches(request, { ...request, propertyIds: [4] }), false);
  assert.equal(committedAppointmentMatches(request, { ...request, durationMinutes: 30 }), false);
  assert.equal(committedAppointmentMatches(request, { ...request, startsAt: "malformed" }), false);
});

test("appointment locations normalize duplicates but never accept an empty location set", () => {
  assert.deepEqual(normalizedAppointmentPropertyIds([7, 2, 7, 0, -1]), [2, 7]);
  assert.equal(hasAppointmentLocation([2]), true);
  assert.equal(hasAppointmentLocation([]), false);
  assert.equal(hasAppointmentLocation(undefined), false);
});

test("appointment technicians fail closed unless active canonical field technicians", () => {
  const employees = [
    { id: "field", role: "field_tech", isActive: true },
    { id: "alias", role: "team_tech", isActive: true },
    { id: "inactive", role: "field_tech", isActive: false },
    { id: "manager", role: "manager", isActive: true },
    { id: "missing-active", role: "field_tech" },
    { id: "missing-role", isActive: true },
  ];
  assert.deepEqual(
    filterSelectableCrewTechnicians(employees).map((employee) => employee.id),
    ["field", "alias"],
  );
});

test("task dueAt supports create, reload, clear, and DST-safe verification", () => {
  const dueAt = taskDueAtFromControl("2026-07-15T09:00");
  assert.equal(dueAt, "2026-07-15T14:00:00.000Z");
  assert.equal(taskDueAtToControl(dueAt), "2026-07-15T09:00");
  assert.equal(taskDueAtFromControl(""), null);
  assert.equal(taskDueAtFromControl("2026-03-08T02:30"), null);
  assert.equal(committedTaskDueAtMatches(dueAt, dueAt), true);
  assert.equal(committedTaskDueAtMatches(null, null), true);
  assert.equal(committedTaskDueAtMatches(dueAt, "2026-07-15T15:00:00.000Z"), false);
});

test("actual task submission sends the live due control for create/edit and confirms refreshed hydration", async () => {
  for (const editingId of [null, 17]) {
    let sent: Record<string, unknown> | undefined;
    const result = await submitTaskForm({
      draft: {
        title: "QA task",
        description: "",
        status: "pending",
        priority: "normal",
        assignedTo: "",
        relatedType: "",
        relatedId: "",
      },
      dueAtControlValue: "2026-09-02T08:07",
      editingId,
      create: async (payload) => {
        sent = payload;
        return { id: 17, dueAt: payload.dueAt as string };
      },
      update: async (id, payload) => {
        assert.equal(id, 17);
        sent = payload;
        return { id, dueAt: payload.dueAt as string };
      },
      refresh: async () => [{ id: 17, dueAt: sent?.dueAt as string }],
    });
    assert.equal(result.kind, "saved");
    assert.equal(sent?.dueAt, "2026-09-02T13:07:00.000Z");
    assert.equal(taskDueAtToControl(sent?.dueAt as string), "2026-09-02T08:07");
  }
});

test("actual task submission persists explicit null clears and rejects false success", async () => {
  const base = {
    draft: {
      title: "QA task",
      description: "",
      status: "pending",
      priority: "normal",
      assignedTo: "",
      relatedType: "",
      relatedId: "",
    },
    editingId: 17,
    create: async () => ({ id: 17, dueAt: null }),
  };
  let clearedPayload: Record<string, unknown> | undefined;
  const cleared = await submitTaskForm({
    ...base,
    dueAtControlValue: "",
    update: async (_id, payload) => {
      clearedPayload = payload;
      return { id: 17, dueAt: null };
    },
    refresh: async () => [{ id: 17, dueAt: null }],
  });
  assert.equal(cleared.kind, "saved");
  assert.equal(clearedPayload?.dueAt, null);

  const mismatch = await submitTaskForm({
    ...base,
    dueAtControlValue: "2026-09-03T09:17",
    update: async () => ({ id: 17, dueAt: null }),
    refresh: async () => [{ id: 17, dueAt: null }],
  });
  assert.equal(mismatch.kind, "unconfirmed");
});

test("new quote appointment preparation blocks partial/unassigned input but permits a fully blank appointment", () => {
  const base = {
    duration: "60",
    durationTouched: false,
    assignedUserId: "unassigned",
    propertyIds: [],
    fallbackPropertyId: 41,
    availablePropertyIds: [41],
    selectableTechnicianIds: ["tech-1"],
    appointmentNotes: "",
    estimateNotes: "",
  };
  assert.deepEqual(prepareQuoteAppointment({ ...base, date: "", time: "" }), { kind: "blank" });
  assert.equal(prepareQuoteAppointment({
    ...base,
    date: "2026-09-04",
    time: "08:07",
  }).kind, "invalid");
  assert.match((prepareQuoteAppointment({
    ...base,
    date: "2026-09-04",
    time: "08:07",
    selectableTechnicianIds: [],
  }) as { message: string }).message, /No active Field or Team Technician/);
  assert.equal(prepareQuoteAppointment({
    ...base,
    date: "",
    time: "",
    durationTouched: true,
  }).kind, "invalid");
});

test("top quote save blocks Unassigned without a request and retains the exact live appointment draft", () => {
  const liveForm = new FormData();
  liveForm.set("appointmentDate", "2026-09-07");
  liveForm.set("appointmentTime", "14:27");
  liveForm.set("appointmentDuration", "75");
  liveForm.set("appointmentDurationTouched", "true");
  liveForm.set("assignedUserId", "unassigned");
  liveForm.set("appointmentFallbackPropertyId", "41");
  liveForm.append("appointmentPropertyIds", "42");
  liveForm.append("appointmentPropertyIds", "43");
  liveForm.set("appointmentNotes", "Use the side gate");
  liveForm.set("estimateNotes", "Measure upper panes");
  let retained: ReturnType<typeof submittedQuoteAppointment> | null = null;
  const draft = captureAndRetainSubmittedQuoteAppointment(liveForm, {
    date: "",
    time: "",
    duration: "60",
    durationTouched: false,
    assignedUserId: "unassigned",
    propertyIds: [],
    fallbackPropertyId: 41,
    availablePropertyIds: [41, 42, 43],
    selectableTechnicianIds: ["team-tech-1"],
    appointmentNotes: "",
    estimateNotes: "",
  }, (submitted) => {
    retained = submitted;
  });

  let quoteRequests = 0;
  const preparation = prepareQuoteAppointment(draft);
  if (preparation.kind === "blank" || preparation.kind === "ready") quoteRequests += 1;
  assert.equal(preparation.kind, "invalid");
  assert.equal(quoteRequests, 0);
  assert.deepEqual(retained, {
    date: "2026-09-07",
    time: "14:27",
    duration: "75",
    durationTouched: true,
    assignedUserId: "unassigned",
    propertyIds: [42, 43],
    fallbackPropertyId: 41,
    availablePropertyIds: [41, 42, 43],
    selectableTechnicianIds: ["team-tech-1"],
    appointmentNotes: "Use the side gate",
    estimateNotes: "Measure upper panes",
  });
});

test("live Team Technician appointment produces one atomic create and one committed readback", async () => {
  const liveForm = new FormData();
  liveForm.set("appointmentDate", "2026-09-07");
  liveForm.set("appointmentTime", "14:27");
  liveForm.set("appointmentDuration", "60");
  liveForm.set("appointmentDurationTouched", "false");
  liveForm.set("assignedUserId", "team-tech-1");
  liveForm.set("appointmentFallbackPropertyId", "41");
  liveForm.set("appointmentPropertyIds", "41");
  const preparation = prepareQuoteAppointment(submittedQuoteAppointment(liveForm, {
    date: "",
    time: "",
    duration: "60",
    durationTouched: false,
    assignedUserId: "unassigned",
    propertyIds: [],
    fallbackPropertyId: 41,
    availablePropertyIds: [41],
    selectableTechnicianIds: ["team-tech-1"],
    appointmentNotes: "",
    estimateNotes: "",
  }));
  assert.equal(preparation.kind, "ready");
  if (preparation.kind !== "ready") return;

  let atomicCreates = 0;
  let readbacks = 0;
  assert.equal(await submitAndConfirmQuoteAppointment({
    request: preparation.request,
    submit: async () => {
      atomicCreates += 1;
      return { ...preparation.request, quoteId: 5 };
    },
    readback: async () => {
      readbacks += 1;
      return { ...preparation.request, quoteId: 5 };
    },
  }), true);
  assert.equal(atomicCreates, 1);
  assert.equal(readbacks, 1);
});

test("new quote appointment preparation emits the exact complete request and allows optional notes", () => {
  assert.deepEqual(prepareQuoteAppointment({
    date: "2026-09-04",
    time: "08:07",
    duration: "60",
    durationTouched: false,
    assignedUserId: "tech-1",
    propertyIds: [41],
    fallbackPropertyId: null,
    availablePropertyIds: [41],
    selectableTechnicianIds: ["tech-1"],
    appointmentNotes: "",
    estimateNotes: "",
  }), {
    kind: "ready",
    request: {
      startsAt: "2026-09-04T13:07:00.000Z",
      durationMinutes: 60,
      propertyIds: [41],
      assignedUserId: "tech-1",
      appointmentNotes: null,
      estimateNotes: null,
    },
  });
});

test("new quote appointment requires both committed response and independent full lifecycle readback", async () => {
  const request = {
    startsAt: "2026-09-04T13:07:00.000Z",
    durationMinutes: 60,
    propertyIds: [41],
    assignedUserId: "tech-1",
    appointmentNotes: null,
    estimateNotes: null,
  };
  assert.equal(await submitAndConfirmQuoteAppointment({
    request,
    submit: async () => ({ ...request }),
    readback: async () => ({ ...request }),
  }), true);

  for (const lifecycleMismatch of [
    { startsAt: "2026-09-04T13:08:00.000Z" },
    { durationMinutes: 75 },
    { propertyIds: [42] },
    { assignedUserId: "tech-2" },
    { appointmentNotes: "unexpected" },
    { estimateNotes: "unexpected" },
  ]) {
    assert.equal(await submitAndConfirmQuoteAppointment({
      request,
      submit: async () => ({ ...request }),
      readback: async () => ({ ...request, ...lifecycleMismatch }),
    }), false);
  }
});

test("new quote appointment does not confirm a mismatched immediate POST response", async () => {
  const request = {
    startsAt: "2026-09-04T13:07:00.000Z",
    durationMinutes: 60,
    propertyIds: [41],
    assignedUserId: "tech-1",
    appointmentNotes: null,
    estimateNotes: null,
  };
  let readbackCalled = false;
  assert.equal(await submitAndConfirmQuoteAppointment({
    request,
    submit: async () => ({ ...request, assignedUserId: "tech-2" }),
    readback: async () => {
      readbackCalled = true;
      return { ...request };
    },
  }), false);
  assert.equal(readbackCalled, false);
});

test("job schedule uses live date and both live time controls and verifies exact clears", () => {
  const controls: Record<string, unknown> = {
    scheduledDate: { type: "date", value: "2026-07-15" },
    scheduledStartTime: { type: "time", value: "00:00" },
    scheduledEndTime: { type: "time", value: "" },
  };
  const submitted = submittedJobSchedule(
    { elements: { namedItem: (name) => controls[name] } },
    { date: "stale", startTime: "stale", endTime: "stale" },
  );
  assert.deepEqual(submitted, { date: "2026-07-15", startTime: "00:00", endTime: "" });
  const request = {
    scheduledDate: submitted.date,
    scheduledStartTime: submitted.startTime,
    scheduledEndTime: null,
  };
  assert.equal(committedJobScheduleMatches(request, { ...request }), true);
  assert.equal(committedJobScheduleMatches(request, { ...request, scheduledEndTime: "01:00" }), false);
});

test("CRM forms wire temporal conversion, explicit clears, and commitment guards", () => {
  const page = (name: string) => readFileSync(new URL(`../pages/${name}`, import.meta.url), "utf8");
  const jobNew = page("JobNew.tsx");
  const jobDetail = page("JobDetail.tsx");
  const quoteNew = page("QuoteNew.tsx");
  const quoteDetail = page("QuoteDetail.tsx");
  const tasks = page("Tasks.tsx");

  assert.match(jobNew, /submittedJobSchedule\(e\.currentTarget/);
  assert.match(jobNew, /committedJobScheduleMatches\(variables\.data, job\)/);
  assert.match(jobDetail, /committedJobScheduleMatches\(variables\.data, committedJob\)/);
  assert.match(jobDetail, /scheduledStartTime: submittedStartTime \|\| null/);
  assert.match(jobDetail, /scheduledEndTime: submittedEndTime \|\| null/);

  assert.match(quoteNew, /prepareQuoteAppointment\(captureAndRetainSubmittedQuoteAppointment\(/);
  assert.match(quoteNew, /setAppointmentDate\(submitted\.date\)/);
  assert.match(quoteNew, /setAppointmentTime\(submitted\.time\)/);
  assert.match(quoteNew, /setAppointmentDuration\(submitted\.duration\)/);
  assert.match(quoteNew, /setAssignedUserId\(submitted\.assignedUserId\)/);
  assert.match(quoteNew, /setAppointmentPropertyIds\(submitted\.propertyIds\)/);
  assert.match(quoteNew, /setAppointmentNotes\(submitted\.appointmentNotes\)/);
  assert.match(quoteNew, /setEstimateNotes\(submitted\.estimateNotes\)/);
  assert.match(quoteNew, /submitAndConfirmQuoteAppointment\(\{/);
  assert.match(quoteNew, /<form onSubmit=\{handleSave\}/);
  assert.match(quoteNew, /new FormData\(event\.currentTarget\)/);
  assert.match(quoteNew, /type="submit"\s+data-testid="save-quote-top"/);
  assert.match(quoteNew, /type="submit"\s+data-testid="save-quote-bottom"/);
  assert.doesNotMatch(quoteNew, /onClick=\{handleSave\}/);
  assert.equal((quoteNew.match(/createScheduledMutation\.mutate/g) ?? []).length, 1);
  assert.doesNotMatch(quoteNew, /\/api\/quotes\/\$\{quote\.id\}\/appointment/);
  assert.match(quoteNew, /idempotencyRequest\(scheduledCreateIdempotencyKeyRef\.current\)/);
  assert.match(quoteNew, /Opening the committed quote without issuing another create/);
  assert.match(quoteNew, /filterSelectableCrewTechnicians\(estimateEmployees\)/);
  assert.match(quoteNew, /selectableTechnicianIds: selectableEstimateEmployees\.map/);
  assert.match(quoteNew, /No active Field or Team Technician is available/);
  assert.match(quoteNew, /submissionStartedRef\.current = true/);
  assert.match(quoteNew, /name="appointmentDurationTouched"/);
  assert.match(quoteNew, /name="appointmentFallbackPropertyId"/);
  assert.match(quoteDetail, /isoToChicagoDateTimeLocal\(appointment\.startsAt\)/);
  assert.match(quoteDetail, /propertyIds: retainedPropertyIds/);
  assert.match(quoteDetail, /hasAppointmentLocation\(retainedPropertyIds\)/);
  assert.match(quoteDetail, /filterSelectableCrewTechnicians\(estimateEmployees\)/);
  assert.match(quoteDetail, /selectableEstimateEmployees\.some\(\(employee\) => employee\.id === assignedUserId\)/);
  assert.match(quoteDetail, /committedAppointmentMatches\(requested, \{/);

  assert.match(tasks, /new FormData\(event\.currentTarget\)\.get\("dueAt"\)/);
  assert.match(tasks, /submitTaskForm\(\{/);
  assert.match(tasks, /name="dueAt"/);
  assert.match(tasks, /aria-label=\{task\.status === "completed" \? `Reopen task/);
  assert.match(tasks, /aria-label=\{`Edit task/);
  assert.match(tasks, /aria-label=\{`Delete task/);
});