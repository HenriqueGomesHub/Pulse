CREATE TABLE system_warnings (
  kind       TEXT NOT NULL,
  subject    TEXT NOT NULL,
  detail     TEXT NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL,
  last_seen  TIMESTAMPTZ NOT NULL,
  cleared_at TIMESTAMPTZ,
  PRIMARY KEY (kind, subject)
);

CREATE INDEX system_warnings_standing_idx ON system_warnings (kind, first_seen) WHERE cleared_at IS NULL;

COMMENT ON TABLE system_warnings IS 'Conditions the system knows are wrong with itself, held where they can be read. Written because the month-one review found the two warnings that mattered most had been firing correctly the entire time and reached nobody: warnInactiveSeeds warned on every boot that seeds 2 and 4 would never be evaluated, and reconcileFirability logged FLOOR BREACHED for the whole month at 2 active against a floor of 3. Both went to Railway logs, so neither existed as far as the database, the dashboard or any review could tell. A warning that is only ever printed has no reader.';
COMMENT ON COLUMN system_warnings.kind IS 'The class of condition, e.g. inactive_seed or floor_breached. Stable across raises so a condition keeps one identity rather than accumulating rows.';
COMMENT ON COLUMN system_warnings.subject IS 'What within that kind the warning is about: a strategy name for inactive_seed, active_strategies for floor_breached. Together with kind it is the primary key, so a condition that stays true for a month is one row that keeps being re-stamped, not 8,640 rows.';
COMMENT ON COLUMN system_warnings.first_seen IS 'When this condition last became true. Reset when a cleared warning is raised again, so the age shown is the age of the current episode and not of the first one ever.';
COMMENT ON COLUMN system_warnings.last_seen IS 'The most recent tick that re-asserted it. A standing warning whose last_seen has stopped advancing means the code that raises it has stopped running, which is itself worth seeing.';
COMMENT ON COLUMN system_warnings.cleared_at IS 'When the condition stopped being true, or NULL while it still is. Cleared rows are kept rather than deleted: that a floor breach ended on a particular day is the evidence that it was ever fixed.';
