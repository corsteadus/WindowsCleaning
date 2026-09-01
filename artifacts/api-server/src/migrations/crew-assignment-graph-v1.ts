import { createHash } from "node:crypto";
import type { MigrationDefinition, MigrationContext } from "./application-migrations.ts";

export const CREW_ASSIGNMENT_GRAPH_V1_ID = "crew_assignment_graph_v1";

const FK_DEFINITIONS = [
  ["jobs_crew_id_crews_id_restrict_fk", "jobs", "crew_id", "crews", "id"],
  ["jobs_assigned_technician_user_id_users_id_restrict_fk", "jobs", "assigned_technician_user_id", "users", "id"],
  ["crew_members_crew_id_crews_id_restrict_fk", "crew_members", "crew_id", "crews", "id"],
  ["crew_members_user_id_users_id_restrict_fk", "crew_members", "user_id", "users", "id"],
] as const;

const INDEX_DEFINITIONS = [
  ["idx_jobs_assigned_technician_user_id", "CREATE INDEX idx_jobs_assigned_technician_user_id ON jobs USING btree (assigned_technician_user_id)"],
  ["crew_members_crew_user_unique", "CREATE UNIQUE INDEX crew_members_crew_user_unique ON crew_members USING btree (crew_id, user_id)"],
  ["crew_members_one_lead_unique", "CREATE UNIQUE INDEX crew_members_one_lead_unique ON crew_members USING btree (crew_id) WHERE (role = 'lead'::text)"],
  ["crew_members_user_crew_idx", "CREATE INDEX crew_members_user_crew_idx ON crew_members USING btree (user_id, crew_id)"],
  ["crew_members_crew_role_idx", "CREATE INDEX crew_members_crew_role_idx ON crew_members USING btree (crew_id, role)"],
] as const;

// This is the actual declarative DDL contract, not a manually maintained
// version token. Changing it necessarily changes the migration checksum.
export const CREW_ASSIGNMENT_GRAPH_V1_CONTENT = JSON.stringify({
  assignedTechnicianColumn: "jobs.assigned_technician_user_id varchar",
  crewMembers: "id identity, crew_id, user_id, role, created_at, updated_at",
  foreignKeys: FK_DEFINITIONS,
  indexes: INDEX_DEFINITIONS,
  roleCheck: "crew_members_role_check: role IN ('lead','member')",
});
export const CREW_ASSIGNMENT_GRAPH_V1_CHECKSUM = createHash("sha256")
  .update(CREW_ASSIGNMENT_GRAPH_V1_CONTENT).digest("hex");

type Counts = {
  crewRows: number; jobRows: number; jobCrewOrphans: number;
  jobUserOrphans: number; memberCrewOrphans: number; memberUserOrphans: number;
};

const count = (result: { rows: Record<string, unknown>[] }) => Number(result.rows[0]?.count ?? 0);
const normalized = (value: string) => value.replace(/\s+/g, " ").trim()
  .replace(/::text/g, "").replace(/(?:\"[^\"]+\"|[a-z_][\w$]*)\./gi, "").replace(/[()]/g, "");

async function orphanCounts(context: MigrationContext): Promise<Counts> {
  // A MigrationContext owns one pg client. Keep its queries sequential; pg
  // does not support concurrent client.query calls and pg@9 will reject them.
  const crews = await context.client.query("SELECT count(*)::int AS count FROM crews");
  const jobs = await context.client.query("SELECT count(*)::int AS count FROM jobs");
  const jobCrew = await context.client.query(
    `SELECT count(*)::int AS count
       FROM jobs j
       LEFT JOIN crews c ON c.id = j.crew_id
      WHERE j.crew_id IS NOT NULL AND c.id IS NULL`,
  );
  const assignedUserColumn = await context.client.query(
    `SELECT EXISTS (
       SELECT 1
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'jobs'
          AND column_name = 'assigned_technician_user_id'
     ) AS exists`,
  );
  const jobUser = assignedUserColumn.rows[0]?.exists
    ? await context.client.query(
      `SELECT count(*)::int AS count
         FROM jobs j
         LEFT JOIN users u ON u.id = j.assigned_technician_user_id
        WHERE j.assigned_technician_user_id IS NOT NULL AND u.id IS NULL`,
    )
    : { rows: [{ count: 0 }] };
  const membershipTable = await context.client.query(
    "SELECT to_regclass('crew_members') AS table_name",
  );
  const memberCrew = membershipTable.rows[0]?.table_name
    ? await context.client.query(
      `SELECT count(*)::int AS count
         FROM crew_members cm
         LEFT JOIN crews c ON c.id = cm.crew_id
        WHERE c.id IS NULL`,
    )
    : { rows: [{ count: 0 }] };
  const memberUser = membershipTable.rows[0]?.table_name
    ? await context.client.query(
      `SELECT count(*)::int AS count
         FROM crew_members cm
         LEFT JOIN users u ON u.id = cm.user_id
        WHERE u.id IS NULL`,
    )
    : { rows: [{ count: 0 }] };
  return {
    crewRows: count(crews), jobRows: count(jobs), jobCrewOrphans: count(jobCrew),
    jobUserOrphans: count(jobUser), memberCrewOrphans: count(memberCrew), memberUserOrphans: count(memberUser),
  };
}

function hasOrphans(counts: Counts) {
  return counts.jobCrewOrphans + counts.jobUserOrphans + counts.memberCrewOrphans + counts.memberUserOrphans > 0;
}

async function verifyCatalog(context: MigrationContext): Promise<{ columns: number; indexes: number; foreignKeys: number; roleChecks: number }> {
  const columns = await context.client.query(`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema = current_schema() AND (table_name, column_name) IN (('jobs','assigned_technician_user_id'),('crew_members','id'),('crew_members','crew_id'),('crew_members','user_id'),('crew_members','role'),('crew_members','created_at'),('crew_members','updated_at'))`);
  const indexes = await context.client.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ANY($1::text[])`, [INDEX_DEFINITIONS.map(([name]) => name)]);
  const roleChecks = await context.client.query(`SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'crew_members'::regclass AND contype='c' AND conname='crew_members_role_check'`);
  const expectedIndexes = new Map<string, string>(
    INDEX_DEFINITIONS.map(([name, definition]) => [name, definition]),
  );
  const exactIndexes = indexes.rows.filter((row) => {
    const indexName = typeof row.indexname === "string" ? row.indexname : null;
    const indexDefinition = typeof row.indexdef === "string" ? row.indexdef : null;
    return indexName !== null && indexDefinition !== null
      && normalized(indexDefinition) === normalized(expectedIndexes.get(indexName) ?? "");
  }).length;
  let exactFks = 0;
  for (const [name, source, sourceColumn, target, targetColumn] of FK_DEFINITIONS) {
    const result = await context.client.query(
      `SELECT count(*)::int AS count
         FROM pg_constraint con
         JOIN pg_class source_rel ON source_rel.oid = con.conrelid
         JOIN pg_class target_rel ON target_rel.oid = con.confrelid
         JOIN pg_attribute source_att
           ON source_att.attrelid = con.conrelid
          AND source_att.attnum = con.conkey[1]
         JOIN pg_attribute target_att
           ON target_att.attrelid = con.confrelid
          AND target_att.attnum = con.confkey[1]
        WHERE con.contype = 'f'
          AND con.conname = $1
          AND source_rel.relname = $2
          AND source_att.attname = $3
          AND target_rel.relname = $4
          AND target_att.attname = $5
          AND array_length(con.conkey, 1) = 1
          AND array_length(con.confkey, 1) = 1
          AND con.confdeltype = 'r'`,
      [name, source, sourceColumn, target, targetColumn],
    );
    exactFks += count(result);
  }
  const exactRoleCheck = roleChecks.rows.filter((row) => normalized(String(row.definition))
    .includes(normalized("CHECK ((role = ANY (ARRAY['lead'::text, 'member'::text])))"))).length;
  return { columns: count(columns), indexes: exactIndexes, foreignKeys: exactFks, roleChecks: exactRoleCheck };
}

function assertNoOrphans(counts: Counts) {
  if (hasOrphans(counts)) {
    throw new Error("Crew assignment graph migration refused: orphan references exist; no rows were modified");
  }
}

function assertCatalogVerified(verified: {
  columns: number;
  indexes: number;
  foreignKeys: number;
  roleChecks: number;
}): void {
  if (
    verified.columns !== 7
    || verified.indexes !== INDEX_DEFINITIONS.length
    || verified.foreignKeys !== FK_DEFINITIONS.length
    || verified.roleChecks !== 1
  ) {
    throw new Error(
      `Crew assignment graph schema catalog verification failed: ${JSON.stringify(verified)}`,
    );
  }
}

async function addForeignKey(context: MigrationContext, name: string, table: string, column: string, target: string) {
  await context.client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN ALTER TABLE ${table} ADD CONSTRAINT ${name} FOREIGN KEY (${column}) REFERENCES ${target}(id) ON DELETE RESTRICT; END IF; END $$`);
}

export const crewAssignmentGraphV1Migration: MigrationDefinition<Counts> = {
  id: CREW_ASSIGNMENT_GRAPH_V1_ID,
  checksum: CREW_ASSIGNMENT_GRAPH_V1_CHECKSUM,
  description: "Add attested normalized crew membership and RESTRICT assignment graph",
  required: true,
  preflight: orphanCounts,
  backup: async (_context, preflight) => ({ ...preflight, legacyIdentityRowsCopied: 0, backupKind: "additive_schema_only" }),
  apply: async (context, preflight) => {
    assertNoOrphans(preflight);
    await context.client.query("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS assigned_technician_user_id varchar");
    await context.client.query(`CREATE TABLE IF NOT EXISTS crew_members (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, crew_id integer NOT NULL, user_id varchar NOT NULL, role text NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(), CONSTRAINT crew_members_role_check CHECK (role IN ('lead', 'member')))`);
    const postTableOrphans = await orphanCounts(context);
    assertNoOrphans(postTableOrphans);
    for (const [name, table, column, target] of FK_DEFINITIONS) await addForeignKey(context, name, table, column, target);
    await context.client.query("CREATE UNIQUE INDEX IF NOT EXISTS crew_members_crew_user_unique ON crew_members(crew_id, user_id)");
    await context.client.query("CREATE UNIQUE INDEX IF NOT EXISTS crew_members_one_lead_unique ON crew_members(crew_id) WHERE role = 'lead'");
    await context.client.query("CREATE INDEX IF NOT EXISTS crew_members_user_crew_idx ON crew_members(user_id, crew_id)");
    await context.client.query("CREATE INDEX IF NOT EXISTS crew_members_crew_role_idx ON crew_members(crew_id, role)");
    await context.client.query("CREATE INDEX IF NOT EXISTS idx_jobs_assigned_technician_user_id ON jobs(assigned_technician_user_id)");
    return { additive: true, copiedLegacyTextIdentities: 0 };
  },
  postflight: async (context, preflight) => {
    const after = await orphanCounts(context);
    assertNoOrphans(after);
    if (after.crewRows !== preflight.crewRows || after.jobRows !== preflight.jobRows) throw new Error("Additive crew assignment migration must preserve all source rows");
    const verified = await verifyCatalog(context);
    assertCatalogVerified(verified);
    return { ...verified, orphans: 0, sourceRowsPreserved: true };
  },
  verify: async (context) => {
    const counts = await orphanCounts(context);
    assertNoOrphans(counts);
    const verified = await verifyCatalog(context);
    assertCatalogVerified(verified);
    return { ...verified, orphans: 0 };
  },
  rollback: async (context) => {
    const counts = await orphanCounts(context);
    const members = await context.client.query("SELECT count(*)::int AS count FROM crew_members");
    if (count(members) > 0 || counts.jobUserOrphans > 0 || counts.memberCrewOrphans > 0 || counts.memberUserOrphans > 0) throw new Error("Rollback refused: normalized crew or direct-assignment data would be lost");
    const direct = await context.client.query("SELECT count(*)::int AS count FROM jobs WHERE assigned_technician_user_id IS NOT NULL");
    if (count(direct) > 0) throw new Error("Rollback refused: normalized crew or direct-assignment data would be lost");
    for (const [name] of FK_DEFINITIONS) await context.client.query(`ALTER TABLE ${name.startsWith("jobs_") ? "jobs" : "crew_members"} DROP CONSTRAINT IF EXISTS ${name}`);
    await context.client.query("DROP INDEX IF EXISTS idx_jobs_assigned_technician_user_id");
    await context.client.query("DROP TABLE IF EXISTS crew_members");
    await context.client.query("ALTER TABLE jobs DROP COLUMN IF EXISTS assigned_technician_user_id");
    return { removedEmptySchema: true, dataRowsChanged: 0 };
  },
};