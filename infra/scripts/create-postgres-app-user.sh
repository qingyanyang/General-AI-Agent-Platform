#!/usr/bin/env bash
# Create or rotate the least-privilege eap_app role without writing a password into git.
#
# Required env:
#   POSTGRES_HOST            Flexible Server FQDN
#   POSTGRES_ADMIN_PASSWORD  Server admin password (for this connection only)
#   POSTGRES_APP_PASSWORD    Password assigned to eap_app
#
# Optional:
#   POSTGRES_ADMIN_USER      default pgadmin
#   POSTGRES_DB              default agent_platform_db
#   POSTGRES_PORT            default 5432
#
# Example:
#   export POSTGRES_HOST="$(az deployment group show ... --query properties.outputs.postgresFqdn.value -o tsv)"
#   export POSTGRES_ADMIN_PASSWORD='...'
#   export POSTGRES_APP_PASSWORD='...'
#   ./infra/scripts/create-postgres-app-user.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="${SCRIPT_DIR}/create-postgres-app-user.sql"

: "${POSTGRES_HOST:?Set POSTGRES_HOST to the Flexible Server FQDN}"
: "${POSTGRES_ADMIN_PASSWORD:?Set POSTGRES_ADMIN_PASSWORD (admin login only; not used by the app)}"
: "${POSTGRES_APP_PASSWORD:?Set POSTGRES_APP_PASSWORD (runtime eap_app password)}"

POSTGRES_ADMIN_USER="${POSTGRES_ADMIN_USER:-pgadmin}"
POSTGRES_DB="${POSTGRES_DB:-agent_platform_db}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

if [[ ! -f "${SQL_FILE}" ]]; then
  echo "SQL file not found: ${SQL_FILE}" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required (install PostgreSQL client tools)." >&2
  exit 1
fi

# Admin password for the psql session only — never echo POSTGRES_APP_PASSWORD.
export PGPASSWORD="${POSTGRES_ADMIN_PASSWORD}"

# -v app_password=... keeps the value out of the SQL file and out of process argv
# when possible; format('%L') in the SQL escapes it for CREATE/ALTER ROLE.
psql \
  "host=${POSTGRES_HOST} port=${POSTGRES_PORT} dbname=${POSTGRES_DB} user=${POSTGRES_ADMIN_USER} sslmode=require" \
  -v ON_ERROR_STOP=1 \
  -v "app_password=${POSTGRES_APP_PASSWORD}" \
  -f "${SQL_FILE}"

echo "Role eap_app created/updated on ${POSTGRES_DB}@${POSTGRES_HOST} (password not logged)."
