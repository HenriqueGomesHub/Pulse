ALTER TABLE social_snapshots ADD COLUMN mentions_24h INTEGER;
ALTER TABLE social_snapshots ADD COLUMN upvotes_24h INTEGER;

ALTER TABLE features ADD COLUMN mentions_24h NUMERIC;
ALTER TABLE features ADD COLUMN upvotes_24h NUMERIC;
ALTER TABLE features ADD COLUMN mention_growth_24h NUMERIC;
