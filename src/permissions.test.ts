import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { setSessionVariables, ensureCheckTriggers } from "./permissions";
import type { AuthContext } from "./auth";
import type { Table } from "./schema";

const TEST_DB_URL = "postgres://postgres:postgres@localhost:5432/postgres";

let client: Client;

beforeAll(async () => {
  client = new Client({ connectionString: TEST_DB_URL });
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

describe("setSessionVariables", () => {
  it("sets sub and role from authenticated user", async () => {
    const auth: AuthContext = {
      isAuthenticated: true,
      user: { sub: "user-123", role: "admin" },
    };

    await setSessionVariables(client, auth);

    const result = await client.query("SELECT current_setting('x_pgapi.sub') as sub, current_setting('x_pgapi.role') as role");
    expect(result.rows[0].sub).toBe('"user-123"');
    expect(result.rows[0].role).toBe('"admin"');
  });

  it("clears variables for unauthenticated request", async () => {
    const auth: AuthContext = { isAuthenticated: false };

    await setSessionVariables(client, auth);

    const result = await client.query("SELECT current_setting('x_pgapi.sub') as sub, current_setting('x_pgapi.role') as role");
    expect(result.rows[0].sub).toBe("{}");
    expect(result.rows[0].role).toBe("{}");
  });

  it("handles missing sub/role in user claims", async () => {
    const auth: AuthContext = {
      isAuthenticated: true,
      user: { email: "test@test.com" },
    };

    await setSessionVariables(client, auth);

    const result = await client.query("SELECT current_setting('x_pgapi.sub') as sub, current_setting('x_pgapi.role') as role");
    expect(result.rows[0].sub).toBe("{}");
    expect(result.rows[0].role).toBe("{}");
  });
});

describe("ensureCheckTriggers", () => {
  beforeAll(async () => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _perm_test (
        id serial PRIMARY KEY,
        name text NOT NULL
      )
    `);
    await client.query(`
      CREATE OR REPLACE FUNCTION _perm_test_insert_check(_sub jsonb, _role jsonb, _row jsonb)
      RETURNS boolean AS $$ SELECT true $$ LANGUAGE sql STABLE
    `);
  });

  afterAll(async () => {
    await client.query("DROP TRIGGER IF EXISTS pgapi_insert_check ON _perm_test");
    await client.query("DROP FUNCTION IF EXISTS _perm_test_insert_check(jsonb, jsonb, jsonb)");
    await client.query("DROP TABLE IF EXISTS _perm_test");
  });

  it("creates BEFORE INSERT trigger for tables with insertCheck", async () => {
    const tables: Table[] = [
      {
        schema: "public",
        name: "_perm_test",
        type: "table",
        description: null,
        permissions: { selectFilter: false, deleteFilter: false, insertCheck: true, updateFilter: false, updateCheck: false },
        columns: [
          { name: "id", type: "int4", nullable: false, isPrimaryKey: true, isUnique: false, defaultValue: null, enumValues: null, arrayElementType: null, description: null },
          { name: "name", type: "text", nullable: false, isPrimaryKey: false, isUnique: false, defaultValue: null, enumValues: null, arrayElementType: null, description: null },
        ],
      },
    ];

    await ensureCheckTriggers(client, tables);

    const result = await client.query(
      "SELECT 1 FROM pg_trigger WHERE tgname = 'pgapi_insert_check' AND tgrelid = 'public._perm_test'::regclass"
    );
    expect(result.rows).toHaveLength(1);
  });

  it("is idempotent - does not fail on re-run", async () => {
    const tables: Table[] = [
      {
        schema: "public",
        name: "_perm_test",
        type: "table",
        description: null,
        permissions: { selectFilter: false, deleteFilter: false, insertCheck: true, updateFilter: false, updateCheck: false },
        columns: [],
      },
    ];

    await expect(ensureCheckTriggers(client, tables)).resolves.not.toThrow();
  });

  it("skips tables without check functions", async () => {
    const tables: Table[] = [
      {
        schema: "public",
        name: "_perm_test",
        type: "table",
        description: null,
        permissions: { selectFilter: true, deleteFilter: true, insertCheck: false, updateFilter: true, updateCheck: false },
        columns: [],
      },
    ];

    await ensureCheckTriggers(client, tables);

    const result = await client.query(
      "SELECT 1 FROM pg_trigger WHERE tgname = 'pgapi_update_check' AND tgrelid = 'public._perm_test'::regclass"
    );
    expect(result.rows).toHaveLength(0);
  });
});
