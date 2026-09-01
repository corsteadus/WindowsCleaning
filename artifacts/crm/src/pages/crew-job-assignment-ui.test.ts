import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { filterSelectableCrewTechnicians } from "../lib/crew-technician-options.ts";

const crewsSource = readFileSync(new URL("./Crews.tsx", import.meta.url), "utf8");
const jobNewSource = readFileSync(new URL("./JobNew.tsx", import.meta.url), "utf8");
const jobDetailSource = readFileSync(new URL("./JobDetail.tsx", import.meta.url), "utf8");

test("Crews UI manages normalized user selectors and lifecycle actions", () => {
  // Crew schemas and create/edit wiring
  assert.match(crewsSource, /leadUserId: z\.string\(\)\.min\(1/);
  assert.match(crewsSource, /memberUserIds: z\.array\(z\.string\(\)\)\.default\(\[\]\)/);
  
  // Auth-scoped active-team-user query key
  assert.match(crewsSource, /queryKey: authScopedQueryKey\(user, \["\/api\/team-users\/active"\]\)/);
  
  // UI Selectors and members checklist
  assert.match(crewsSource, /Select value=\{field\.value\} onValueChange=\{field\.onChange\}/);
  assert.match(crewsSource, /Checkbox\s+checked=\{isLead \|\| field\.value\?\.includes\(u\.id\)\}\s+disabled=\{isLead\}/);
  
  // Lifecycle flows (Deactivate/Reactivate, Edit, Delete)
  assert.match(crewsSource, /<PowerOff/);
  assert.match(crewsSource, /<Power /);
  assert.match(crewsSource, /handleToggleActive/);
  assert.match(crewsSource, /deleteMutation\.mutate\(\{ id:/);
  
  // No jobs current/historical explanation
  assert.match(crewsSource, /Deletion only succeeds if there are <strong>no current or historical jobs<\/strong>/);
  assert.match(crewsSource, /server will block it and you should <strong>deactivate<\/strong> the crew instead/);

  // Fallback to legacy context explicitly
  assert.match(crewsSource, /crew\.legacyDisplay\?\.leadTechnician/);
  assert.match(crewsSource, /crew\.legacyDisplay\?\.members/);
  
  // Dead manage schedule button removed
  assert.doesNotMatch(crewsSource, /Manage Schedule/);
});

test("every Crew and Job technician picker includes only active Field Tech role aliases", () => {
  const options = filterSelectableCrewTechnicians([
    { id: "admin", role: "super_admin", isActive: true, displayName: "Team Administrator" },
    { id: "office", role: "office_admin", isActive: true, displayName: "Team Office" },
    { id: "owner", role: "admin", isActive: true, displayName: "Info" },
    { id: "tech", role: "field_tech", isActive: true, displayName: "Team Technician" },
    { id: "legacy-tech", role: "team_tech", isActive: true, displayName: "Legacy Technician" },
    { id: "disabled-tech", role: "field_tech", isActive: false, displayName: "Disabled Technician" },
  ]);

  assert.deepEqual(options.map((user) => user.id), ["tech", "legacy-tech"]);
  assert.match(crewsSource, /const teamUsers = filterSelectableCrewTechnicians\(teamUsersData \|\| \[\]\)/);
  assert.equal((crewsSource.match(/\{teamUsers\.map\(/g) ?? []).length, 2);
  assert.match(jobNewSource, /const teamUsers = filterSelectableCrewTechnicians\(teamUsersData \?\? \[\]\)/);
  assert.match(jobNewSource, /<Label>Assign Direct Tech<\/Label>/);
  assert.equal((jobNewSource.match(/\{teamUsers\.map\(/g) ?? []).length, 1);
  assert.match(jobDetailSource, /const teamUsers = filterSelectableCrewTechnicians\(teamUsersData \?\? \[\]\)/);
  assert.match(jobDetailSource, /<Label>Direct Tech<\/Label>/);
  assert.equal((jobDetailSource.match(/\{teamUsers\.map\(/g) ?? []).length, 1);
});

test("JobNew handles direct+crew assignment payload/null behavior", () => {
  // Auth-scoped active-team-user query key
  assert.match(jobNewSource, /queryKey: authScopedQueryKey\(user, \["\/api\/team-users\/active"\]\)/);
  assert.match(jobNewSource, /\.filter\(\(c\) => c\.isActive\)/);
  assert.doesNotMatch(jobNewSource, /c\.status !== "inactive"/);

  // Radix sentinels for both
  assert.match(jobNewSource, /const CREW_UNASSIGNED = "unassigned";/);
  assert.match(jobNewSource, /const TECH_UNASSIGNED = "unassigned";/);
  
  // Form assignments
  assert.match(jobNewSource, /assignedTechnicianUserId: assignedTechnicianUserId \? assignedTechnicianUserId : null/);
  assert.match(jobNewSource, /crewId:\s+crewId \? Number\(crewId\) : null/);
  
  // Exact date string / null persistence
  assert.match(jobNewSource, /scheduledDate:\s*submittedSchedule\.date \|\| null/);
  assert.match(jobNewSource, /scheduledStartTime:\s*submittedSchedule\.startTime \|\| null/);
  assert.match(jobNewSource, /scheduledEndTime:\s*submittedSchedule\.endTime \|\| null/);
});

test("JobDetail edit mode sends explicit null on edit, not undefined, and blocks future-dates", () => {
  // Auth-scoped active-team-user query key
  assert.match(jobDetailSource, /queryKey: authScopedQueryKey\(user, \["\/api\/team-users\/active"\]\)/);

  // Future dates
  assert.match(jobDetailSource, /Scheduled for <strong>\{formatDate\(job\?\.scheduledDate\)\}<\/strong> — Start Job and Mark Complete are unavailable until that date arrives./);
  
  // Block start / complete (desktop and mobile)
  const blockMatches = jobDetailSource.match(/disabled=\{updateMutation\.isPending \|\| isFutureJob\}/g);
  assert.ok(blockMatches && blockMatches.length >= 4, "Expected Start Job and Mark Complete to be blocked on both desktop and mobile");

  const startTitleMatches = jobDetailSource.match(/title=\{isFutureJob \? `Scheduled for \$\{job\?\.scheduledDate\} — not yet startable` : undefined\}/g);
  assert.ok(startTitleMatches && startTitleMatches.length >= 2, "Expected Start Job title on both desktop and mobile");
  
  const completeTitleMatches = jobDetailSource.match(/title=\{isFutureJob \? `Scheduled for \$\{job\?\.scheduledDate\} — not yet completable` : undefined\}/g);
  assert.ok(completeTitleMatches && completeTitleMatches.length >= 2, "Expected Mark Complete title on both desktop and mobile");

  // Exact dates edit (not parsed via UTC)
  assert.match(jobDetailSource, /scheduledDate: submittedEditDate \|\| null/);
  assert.match(jobDetailSource, /scheduledStartTime: submittedStartTime \|\| null/);
  assert.match(jobDetailSource, /scheduledEndTime: submittedEndTime \|\| null/);
  
  // Unassigned / null logic
  assert.match(jobDetailSource, /crewId: editCrewId === "" \? null : Number\(editCrewId\)/);
  assert.match(jobDetailSource, /assignedTechnicianUserId: editAssignedTechnicianUserId === "" \? null : editAssignedTechnicianUserId/);
  
  // Gating schedule manage via capability
  assert.match(jobDetailSource, /canManageSchedule && \(/);
});

test("JobDetail renders the committed PATCH record and never false-confirms a date mismatch", () => {
  assert.match(jobDetailSource, /liveDateControlValue\(\s*editDateInputRef\.current,\s*editDate,/);
  assert.match(jobDetailSource, /queryClient\.setQueryData\(detailQueryKey, committedJob\)/);
  assert.match(jobDetailSource, /committedJobScheduleMatches\(variables\.data, committedJob\)/);
  assert.match(jobDetailSource, /title: "Save not confirmed"/);
  assert.match(jobDetailSource, /The editor remains open/);
  assert.match(jobDetailSource, /return;\s*}\s*queryClient\.invalidateQueries/);
});
