CREATE TABLE evolution_rejections (
  id        BIGSERIAL PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL,
  candidate TEXT,
  reason    TEXT NOT NULL
);

CREATE INDEX evolution_rejections_ts_idx ON evolution_rejections (ts DESC);

COMMENT ON TABLE evolution_rejections IS 'Proposals the evolution loop threw out before they reached the database: a malformed side, an exit block that uses "all" logic, or one carrying no stop or no time bound. Deliberately a sibling of evolution_log rather than a fourth evolution_action: every evolution_log row is a decision about a strategy that exists and is keyed on its strategy_id, and a proposal rejected by paramsFromProposal never became one, so it has no id to key on. Until this table existed the reason lived only in a console line, which is why /api/weekly-recap could report the loop''s adopted changes but not what it refused.';
COMMENT ON COLUMN evolution_rejections.candidate IS 'The name the model gave the proposal, before uniqueName would have made it unique. NULL if the proposal came back without a usable name, which is itself one of the ways a proposal is rejected.';
COMMENT ON COLUMN evolution_rejections.reason IS 'The validator message thrown at rejection time, recorded verbatim. /api/weekly-recap reports it as written and never composes one after the fact.';
