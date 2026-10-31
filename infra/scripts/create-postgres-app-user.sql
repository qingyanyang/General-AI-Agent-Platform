-- Create / rotate least-privilege runtime role for FastAPI.
-- Do NOT put a real password in this file.
--
-- Invoke via create-postgres-app-user.sh (preferred), which passes:
--   psql -v app_password="$POSTGRES_APP_PASSWORD"
--
-- :'app_password' is interpolated by the psql client as a quoted literal;
-- format('%L', ...) produces a safely escaped SQL string for CREATE/ALTER ROLE.

\set ON_ERROR_STOP on

SELECT format('CREATE ROLE eap_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eap_app')
\gexec

SELECT format('ALTER ROLE eap_app WITH PASSWORD %L', :'app_password')
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'eap_app')
\gexec

GRANT CONNECT ON DATABASE agent_platform_db TO eap_app;
GRANT USAGE ON SCHEMA public TO eap_app;

-- After Alembic creates tables, grant DML (re-run or include in a post-migrate step):
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eap_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eap_app;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eap_app;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO eap_app;
