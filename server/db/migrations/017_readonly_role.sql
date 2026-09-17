-- A SELECT-only role for the monthly review routine. The review's own standard says read-only
-- access is sufficient and preferred, and the routine runs unattended in a cloud sandbox whose
-- environment is configured outside this repository, so the credential it holds must be incapable
-- of writing even if it leaks.
--
-- No password is set here, deliberately: a password in a migration is a password in git. The role
-- is created able to log in but with no password, which Railway's password authentication rejects,
-- so it cannot connect until the owner runs, once, from a psql session:
--
--   ALTER ROLE pulse_readonly PASSWORD '<generated secret>';
--
-- Idempotent on the role itself because a role may already exist from a manual attempt, and a
-- migration that fails halfway through leaves the grants unapplied.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pulse_readonly') THEN
    CREATE ROLE pulse_readonly LOGIN;
  END IF;
END
$$;

-- Never inheritable into anything privileged, and explicitly stripped of the three attributes that
-- would make "read-only" a lie.
ALTER ROLE pulse_readonly NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO pulse_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pulse_readonly;

-- CONNECT and the default privileges both need a literal name, so they are resolved at run time
-- rather than hard-coded to this deployment's database and migration user.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO pulse_readonly', current_database());
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO pulse_readonly',
    current_user
  );
END
$$;

-- SELECT on ALL TABLES covers views, so trade_excess is included. Sequences are deliberately not
-- granted: a reader has no use for nextval and granting USAGE on a sequence is a write capability.
COMMENT ON ROLE pulse_readonly IS 'SELECT-only reader, created 2026-09-18 for the monthly review routine (trig_01ErwjG4ofuJbh9bsRuLh8hi). Holds no password until one is set out of band; never grant it INSERT, UPDATE, DELETE or sequence USAGE. Default privileges are attached so tables created by later migrations are readable without revisiting this file.';
