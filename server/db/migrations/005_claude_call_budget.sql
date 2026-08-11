CREATE TABLE claude_call_budget (
  day   DATE PRIMARY KEY,
  calls INTEGER NOT NULL
);

COMMENT ON TABLE claude_call_budget IS 'Conviction calls made per America/New_York session date. Persisted rather than counted in memory so the daily cap survives restarts and redeploys.';
