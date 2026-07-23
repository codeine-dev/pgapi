import type { Client } from "pg";
import type { AuthContext } from "./auth";
import type { Table } from "./schema";
import { quoteIdentifier } from "./sql";

export const setSessionVariables = async (client: Client, auth: AuthContext): Promise<void> => {
  if (auth.isAuthenticated && auth.user) {
    const sub = auth.user.sub != null ? String(auth.user.sub) : "";
    const role = auth.user.role != null ? String(auth.user.role) : "";
    await client.query(`SET "x_pgapi.sub" = ${quoteLiteral(sub)}`);
    await client.query(`SET "x_pgapi.role" = ${quoteLiteral(role)}`);
  } else {
    await client.query(`SET "x_pgapi.sub" = ''`);
    await client.query(`SET "x_pgapi.role" = ''`);
  }
};

const quoteLiteral = (value: string): string => {
  return "'" + value.replace(/'/g, "''") + "'";
};

const TRIGGER_FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION pgapi_check_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  _check_result boolean;
  _schema_name text := TG_TABLE_SCHEMA;
  _func_name text := TG_TABLE_NAME || '_' || lower(TG_OP) || '_check';
BEGIN
  EXECUTE format(
    'SELECT %I.%I(current_setting(''x_pgapi.sub''), current_setting(''x_pgapi.role''), $1)',
    _schema_name,
    _func_name
  ) INTO _check_result USING ROW_TO_JSON(NEW)::jsonb;

  IF NOT _check_result THEN
    RAISE EXCEPTION 'Permission denied: % check failed for %', TG_OP, TG_TABLE_NAME;
  END IF;

  RETURN NEW;
END;
$function$;
`;

export const ensureCheckTriggers = async (client: Client, tables: Table[]): Promise<void> => {
  const tablesWithChecks = tables.filter(
    (t) => t.permissions?.insertCheck || t.permissions?.updateCheck
  );

  if (tablesWithChecks.length === 0) return;

  await client.query(TRIGGER_FUNCTION_SQL);

  for (const table of tablesWithChecks) {
    const qualifiedTable = `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`;

    if (table.permissions?.insertCheck) {
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_trigger WHERE tgname = 'pgapi_insert_check' AND tgrelid = '${qualifiedTable}'::regclass
          ) THEN
            CREATE TRIGGER pgapi_insert_check
              BEFORE INSERT ON ${qualifiedTable}
              FOR EACH ROW EXECUTE FUNCTION pgapi_check_trigger();
          END IF;
        END $$;
      `);
    }

    if (table.permissions?.updateCheck) {
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_trigger WHERE tgname = 'pgapi_update_check' AND tgrelid = '${qualifiedTable}'::regclass
          ) THEN
            CREATE TRIGGER pgapi_update_check
              BEFORE UPDATE ON ${qualifiedTable}
              FOR EACH ROW EXECUTE FUNCTION pgapi_check_trigger();
          END IF;
        END $$;
      `);
    }
  }
};
