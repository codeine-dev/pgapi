import * as TE from "fp-ts/TaskEither";
import * as A from "fp-ts/Array";
import { pipe } from "fp-ts/function";
import type { DbEnv } from "./db";
import { withClient } from "./db";

export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface Table {
  schema: string;
  name: string;
  columns: Column[];
}

export interface ForeignKey {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export interface SchemaModel {
  tables: Table[];
  foreignKeys: ForeignKey[];
}

const readTables = withClient(async (client) => {
  const result = await client.query(`
    SELECT 
      t.table_schema,
      t.table_name,
      c.column_name,
      c.udt_name as type,
      c.is_nullable = 'YES' as nullable,
      EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = t.table_schema
          AND tc.table_name = t.table_name
          AND kcu.column_name = c.column_name
      ) as is_primary_key
    FROM information_schema.tables t
    JOIN information_schema.columns c 
      ON t.table_schema = c.table_schema 
      AND t.table_name = c.table_name
    WHERE t.table_type = 'BASE TABLE'
    ORDER BY t.table_schema, t.table_name, c.ordinal_position
  `);

  const tables: Record<string, { schema: string; name: string; columns: Column[] }> = {};

  for (const row of result.rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    if (!tables[key]) {
      tables[key] = { schema: row.table_schema, name: row.table_name, columns: [] };
    }
    tables[key].columns.push({
      name: row.column_name,
      type: row.type,
      nullable: row.nullable,
      isPrimaryKey: row.is_primary_key,
    });
  }

  return Object.values(tables);
});

const readForeignKeys = withClient(async (client) => {
  const result = await client.query(`
    SELECT
      kcu.table_name as from_table,
      kcu.column_name as from_column,
      ccu.table_name as to_table,
      ccu.column_name as to_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
  `);

  return result.rows.map((row) => ({
    fromTable: row.from_table,
    fromColumn: row.from_column,
    toTable: row.to_table,
    toColumn: row.to_column,
  }));
});

export const readSchema = (
  env: DbEnv
): TE.TaskEither<Error, SchemaModel> =>
  pipe(
    TE.Do,
    TE.bind("tables", () => readTables(env)),
    TE.bind("foreignKeys", () => readForeignKeys(env)),
    TE.map(({ tables, foreignKeys }) => ({ tables, foreignKeys }))
  );
