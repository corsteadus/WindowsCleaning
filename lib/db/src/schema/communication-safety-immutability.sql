-- Apply alongside the additive communication-safety schema.
-- History and eligibility decisions are append-only by design; application
-- code never updates or deletes them, and these triggers enforce that rule at
-- the database boundary as well.
CREATE OR REPLACE FUNCTION communication_safety_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS communication_preference_history_append_only ON communication_preference_history;
CREATE TRIGGER communication_preference_history_append_only
  BEFORE UPDATE OR DELETE ON communication_preference_history
  FOR EACH ROW EXECUTE FUNCTION communication_safety_append_only();

DROP TRIGGER IF EXISTS communication_eligibility_decisions_append_only ON communication_eligibility_decisions;
CREATE TRIGGER communication_eligibility_decisions_append_only
  BEFORE UPDATE OR DELETE ON communication_eligibility_decisions
  FOR EACH ROW EXECUTE FUNCTION communication_safety_append_only();