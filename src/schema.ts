import * as TE from "fp-ts/TaskEither";
import * as O from "fp-ts/Option";
import { pipe } from "fp-ts/function";
import type { DbEnv } from "./db";
import { withClient } from "./db";

export interface EnumValue {
  label: string;
  value: string;
}

export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  defaultValue: string | null;
  enumValues: EnumValue[] | null;
  arrayElementType: string | null;
  description: string | null;
}

export interface Table {
  schema: string;
  name: string;
  columns: Column[];
  type: "table" | "view" | "materialized_view";
  description: string | null;
}

export interface ForeignKey {
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
}

export interface SchemaModel {
  tables: Table[];
  views: Table[];
  foreignKeys: ForeignKey[];
  enums: Record<string, EnumValue[]>;
}

const readEnums = withClient(async (client) => {
  const result = await client.query(`
    SELECT 
      t.typname as enum_name,
      e.enumlabel as label,
      e.enumsortorder as sort_order
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typtype = 'e'
    ORDER BY t.typname, e.enumsortorder
  `);

  const enums: Record<string, EnumValue[]> = {};
  for (const row of result.rows) {
    const key: string = row.enum_name;
    const values = pipe(
      O.fromNullable(enums[key]),
      O.getOrElse(() => {
        const fresh: EnumValue[] = [];
        enums[key] = fresh;
        return fresh;
      })
    );
    values.push({ label: row.label, value: row.label });
  }
  return enums;
});

const readColumnDescriptions = (schemas: string[]) =>
  withClient(async (client) => {
    const schemaFilter =
      schemas.length > 0
        ? `AND n.nspname = ANY($1)`
        : `AND n.nspname NOT IN ('pg_catalog', 'information_schema')`;
    const params = schemas.length > 0 ? [schemas] : [];

    const result = await client.query(
      `
      SELECT 
        n.nspname as schema_name,
        c.relname as table_name,
        a.attname as column_name,
        pg_description.description as description
      FROM pg_description
      JOIN pg_class c ON pg_description.objoid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = pg_description.objsubid
      WHERE c.relkind IN ('r', 'v', 'm')
        AND pg_description.objsubid > 0
        ${schemaFilter}
      ORDER BY n.nspname, c.relname, a.attnum
    `,
      params
    );

    const descriptions: Record<string, string> = {};
    for (const row of result.rows) {
      if (row.description) {
        descriptions[`${row.schema_name}.${row.table_name}.${row.column_name}`] = row.description;
      }
    }
    return descriptions;
  });

const readTableDescriptions = (schemas: string[]) =>
  withClient(async (client) => {
    const schemaFilter =
      schemas.length > 0
        ? `AND n.nspname = ANY($1)`
        : `AND n.nspname NOT IN ('pg_catalog', 'information_schema')`;
    const params = schemas.length > 0 ? [schemas] : [];

    const result = await client.query(
      `
      SELECT 
        n.nspname as schema_name,
        c.relname as table_name,
        pg_description.description as description
      FROM pg_description
      JOIN pg_class c ON pg_description.objoid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE c.relkind IN ('r', 'v', 'm')
        AND pg_description.objsubid = 0
        ${schemaFilter}
      ORDER BY n.nspname, c.relname
    `,
      params
    );

    const descriptions: Record<string, string> = {};
    for (const row of result.rows) {
      if (row.description) {
        descriptions[`${row.schema_name}.${row.table_name}`] = row.description;
      }
    }
    return descriptions;
  });

const readTables = (schemas: string[]) =>
  withClient(async (client) => {
    const schemaFilter =
      schemas.length > 0
        ? `AND t.table_schema = ANY($1)`
        : `AND t.table_schema NOT IN ('pg_catalog', 'information_schema')`;
    const params = schemas.length > 0 ? [schemas] : [];

    const result = await client.query(
      `
      SELECT 
        t.table_schema,
        t.table_name,
        c.column_name,
        c.udt_name as type,
        c.is_nullable = 'YES' as nullable,
        c.column_default as default_value,
        EXISTS (
          SELECT 1 FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu 
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = t.table_schema
            AND tc.table_name = t.table_name
            AND kcu.column_name = c.column_name
        ) as is_primary_key,
        EXISTS (
          SELECT 1 FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu 
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'UNIQUE'
            AND tc.table_schema = t.table_schema
            AND tc.table_name = t.table_name
            AND kcu.column_name = c.column_name
        ) as is_unique,
        CASE 
          WHEN c.udt_name LIKE '_%' THEN pg_catalog.format_type(
            (SELECT atttypid FROM pg_attribute WHERE attrelid = (
              SELECT oid FROM pg_class WHERE relname = c.table_name 
              AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = c.table_schema)
            ) AND attname = c.column_name), NULL
          )
          ELSE NULL
        END as array_element_type
      FROM information_schema.tables t
      JOIN information_schema.columns c 
        ON t.table_schema = c.table_schema 
        AND t.table_name = c.table_name
      WHERE t.table_type = 'BASE TABLE'
        ${schemaFilter}
      ORDER BY t.table_schema, t.table_name, c.ordinal_position
    `,
      params
    );

    const tables: Record<string, { schema: string; name: string; columns: Column[]; type: "table"; description: string | null }> = {};

    for (const row of result.rows) {
      const key = `${row.table_schema}.${row.table_name}`;
      const table = pipe(
        O.fromNullable(tables[key]),
        O.getOrElse(() => {
          const fresh = { schema: row.table_schema, name: row.table_name, columns: [] as Column[], type: "table" as const, description: null as string | null };
          tables[key] = fresh;
          return fresh;
        })
      );

      const isEnumType = row.type.startsWith("_");
      const arrayElement = isEnumType ? row.type.slice(1) : null;

      table.columns.push({
        name: row.column_name,
        type: row.type,
        nullable: row.nullable,
        isPrimaryKey: row.is_primary_key,
        isUnique: row.is_unique,
        defaultValue: row.default_value,
        enumValues: null,
        arrayElementType: arrayElement,
        description: null,
      });
    }

    return Object.values(tables);
  });

const readForeignKeys = (schemas: string[]) =>
  withClient(async (client) => {
    const schemaFilter =
      schemas.length > 0
        ? `AND tc.table_schema = ANY($1)`
        : `AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')`;
    const params = schemas.length > 0 ? [schemas] : [];

    const result = await client.query(
      `
      SELECT
        kcu.table_schema as from_schema,
        kcu.table_name as from_table,
        kcu.column_name as from_column,
        ccu.table_schema as to_schema,
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
        ${schemaFilter}
    `,
      params
    );

    return result.rows.map((row) => ({
      fromSchema: row.from_schema,
      fromTable: row.from_table,
      fromColumn: row.from_column,
      toSchema: row.to_schema,
      toTable: row.to_table,
      toColumn: row.to_column,
    }));
  });

const readViews = (schemas: string[]) =>
  withClient(async (client) => {
    const schemaFilter =
      schemas.length > 0
        ? `AND v.table_schema = ANY($1)`
        : `AND v.table_schema NOT IN ('pg_catalog', 'information_schema')`;
    const params = schemas.length > 0 ? [schemas] : [];

    const result = await client.query(
      `
      SELECT 
        v.table_schema,
        v.table_name,
        v.view_definition,
        CASE 
          WHEN v.view_definition ILIKE '%materialized%' THEN 'materialized_view'
          ELSE 'view'
        END as view_type,
        c.column_name,
        c.udt_name as type,
        c.is_nullable = 'YES' as nullable,
        c.column_default as default_value,
        CASE 
          WHEN c.udt_name LIKE '_%' THEN pg_catalog.format_type(
            (SELECT atttypid FROM pg_attribute WHERE attrelid = (
              SELECT oid FROM pg_class WHERE relname = v.table_name 
              AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = v.table_schema)
            ) AND attname = c.column_name), NULL
          )
          ELSE NULL
        END as array_element_type
      FROM information_schema.views v
      JOIN information_schema.columns c 
        ON v.table_schema = c.table_schema 
        AND v.table_name = c.table_name
      WHERE 1=1
        ${schemaFilter}
      ORDER BY v.table_schema, v.table_name, c.ordinal_position
    `,
      params
    );

    const views: Record<string, { schema: string; name: string; columns: Column[]; type: "view" | "materialized_view"; description: string | null }> = {};

    for (const row of result.rows) {
      const key = `${row.table_schema}.${row.table_name}`;
      const view = pipe(
        O.fromNullable(views[key]),
        O.getOrElse(() => {
          const fresh = { schema: row.table_schema, name: row.table_name, columns: [] as Column[], type: row.view_type as "view" | "materialized_view", description: null as string | null };
          views[key] = fresh;
          return fresh;
        })
      );

      const isEnumType = row.type.startsWith("_");
      const arrayElement = isEnumType ? row.type.slice(1) : null;

      view.columns.push({
        name: row.column_name,
        type: row.type,
        nullable: row.nullable,
        isPrimaryKey: false, // Views don't have primary keys
        isUnique: false,
        defaultValue: row.default_value,
        enumValues: null,
        arrayElementType: arrayElement,
        description: null,
      });
    }

    return Object.values(views);
  });

const attachEnumValues = (tables: Table[], enums: Record<string, EnumValue[]>): Table[] =>
  tables.map((table) => ({
    ...table,
    columns: table.columns.map((col) => {
      const enumKey = col.type.startsWith("_") ? col.type.slice(1) : col.type;
      const enumVals = enums[enumKey] ?? null;
      return { ...col, enumValues: enumVals };
    }),
  }));

export const readSchema = (
  env: DbEnv,
  schemas: string[] = []
): TE.TaskEither<Error, SchemaModel> =>
  pipe(
    TE.Do,
    TE.bind("enums", () => readEnums(env)),
    TE.bind("tables", () => readTables(schemas)(env)),
    TE.bind("views", () => readViews(schemas)(env)),
    TE.bind("foreignKeys", () => readForeignKeys(schemas)(env)),
    TE.bind("tableDescriptions", () => readTableDescriptions(schemas)(env)),
    TE.bind("columnDescriptions", () => readColumnDescriptions(schemas)(env)),
    TE.map(({ tables, views, foreignKeys, enums, tableDescriptions, columnDescriptions }) => ({
      tables: attachEnumValues(tables, enums).map((t) => ({
        ...t,
        description: tableDescriptions[`${t.schema}.${t.name}`] ?? null,
        columns: t.columns.map((c) => ({
          ...c,
          description: columnDescriptions[`${t.schema}.${t.name}.${c.name}`] ?? null,
        })),
      })),
      views: attachEnumValues(views, enums).map((v) => ({
        ...v,
        description: tableDescriptions[`${v.schema}.${v.name}`] ?? null,
        columns: v.columns.map((c) => ({
          ...c,
          description: columnDescriptions[`${v.schema}.${v.name}.${c.name}`] ?? null,
        })),
      })),
      foreignKeys,
      enums,
    }))
  );
