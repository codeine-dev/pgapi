import type {
  GraphQLFieldConfigMap,
  GraphQLInputFieldConfigMap,
} from "graphql";
import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLInputObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLFloat,
  GraphQLBoolean,
  GraphQLList,
  GraphQLNonNull,
  GraphQLEnumType,
  GraphQLScalarType,
} from "graphql";
import type { SchemaModel, Table, Column, ForeignKey } from "./schema";
import type { ResolverContext } from "./resolver";
import {
  buildSelect,
  buildSelectByFk,
  buildInsert,
  buildUpdate,
  buildDelete,
} from "./sql";

const scalarMap: Record<string, () => GraphQLScalarType> = {
  int: () => GraphQLInt,
  int2: () => GraphQLInt,
  int4: () => GraphQLInt,
  int8: () => GraphQLInt,
  float4: () => GraphQLFloat,
  float8: () => GraphQLFloat,
  numeric: () => GraphQLFloat,
  text: () => GraphQLString,
  varchar: () => GraphQLString,
  char: () => GraphQLString,
  bpchar: () => GraphQLString,
  bool: () => GraphQLBoolean,
  boolean: () => GraphQLBoolean,
  uuid: () => GraphQLString,
  json: () => GraphQLString,
  jsonb: () => GraphQLString,
  date: () => GraphQLString,
  time: () => GraphQLString,
  timetz: () => GraphQLString,
  timestamp: () => GraphQLString,
  timestamptz: () => GraphQLString,
  bytea: () => GraphQLString,
  inet: () => GraphQLString,
  cidr: () => GraphQLString,
  macaddr: () => GraphQLString,
};

const builtEnumTypes = new Map<string, GraphQLEnumType>();

const getEnumType = (typeName: string, values: { label: string; value: string }[]) => {
  const existing = builtEnumTypes.get(typeName);
  if (existing) return existing;

  const enumType = new GraphQLEnumType({
    name: typeName,
    values: Object.fromEntries(values.map((v) => [v.label, { value: v.value }])),
  });
  builtEnumTypes.set(typeName, enumType);
  return enumType;
};

const resolveScalarType = (typeName: string): GraphQLScalarType =>
  (scalarMap[typeName.toLowerCase()] ?? (() => GraphQLString))();

const getGraphQLType = (column: Column) => {
  let baseType: GraphQLScalarType | GraphQLEnumType;

  if (column.enumValues && column.enumValues.length > 0) {
    baseType = getEnumType(`${column.name}_enum`, column.enumValues);
  } else {
    baseType = resolveScalarType(column.type);
  }

  return column.nullable ? baseType : new GraphQLNonNull(baseType);
};

const getGraphQLInputType = (column: Column) => getGraphQLType(column);

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const buildEnumType = (name: string, values: string[]) =>
  new GraphQLEnumType({
    name,
    values: Object.fromEntries(values.map((v) => [v, { value: v }])),
  });

const buildWhereInputType = (table: Table): GraphQLInputObjectType => {
  const fields: GraphQLInputFieldConfigMap = {};

  for (const col of table.columns) {
    const baseType = resolveScalarType(col.type);
    fields[col.name] = { type: baseType };
    fields[`${col.name}_eq`] = { type: baseType };
    fields[`${col.name}_neq`] = { type: baseType };
    fields[`${col.name}_gt`] = { type: baseType };
    fields[`${col.name}_gte`] = { type: baseType };
    fields[`${col.name}_lt`] = { type: baseType };
    fields[`${col.name}_lte`] = { type: baseType };
    fields[`${col.name}_like`] = { type: GraphQLString };
    fields[`${col.name}_in`] = { type: new GraphQLList(baseType) };
  }

  return new GraphQLInputObjectType({
    name: `${capitalize(table.name)}Where`,
    fields,
  });
};

const buildOrderByInputType = (table: Table): GraphQLInputObjectType => {
  const directionEnum = buildEnumType(`${capitalize(table.name)}Direction`, ["ASC", "DESC"]);

  const fields: GraphQLInputFieldConfigMap = Object.fromEntries(
    table.columns.map((col) => [col.name, { type: directionEnum }])
  );

  return new GraphQLInputObjectType({
    name: `${capitalize(table.name)}OrderBy`,
    fields,
  });
};

const buildInsertInputType = (table: Table): GraphQLInputObjectType => {
  const fields: GraphQLInputFieldConfigMap = {};

  for (const col of table.columns) {
    if (col.isPrimaryKey) continue;
    const baseType = getGraphQLType(col);
    fields[col.name] = { type: baseType };
  }

  return new GraphQLInputObjectType({
    name: `${capitalize(table.name)}InsertInput`,
    fields,
  });
};

const buildUpdateInputType = (table: Table): GraphQLInputObjectType | null => {
  const pk = table.columns.find((c) => c.isPrimaryKey);
  if (!pk) return null;

  const fields: GraphQLInputFieldConfigMap = {};

  for (const col of table.columns) {
    const baseType = resolveScalarType(col.type);
    fields[col.name] = {
      type: col.nullable || col.isPrimaryKey ? baseType : new GraphQLNonNull(baseType),
    };
  }

  return new GraphQLInputObjectType({
    name: `${capitalize(table.name)}UpdateInput`,
    fields,
  });
};

const buildColumnsSelect = (table: Table): string[] =>
  table.columns.map((c) => c.name);

const listResolver = (table: Table) =>
  async (parent: unknown, args: Record<string, unknown>, ctx: ResolverContext) => {
    const where = args.where as Record<string, unknown> | undefined;
    const orderBy = args.orderBy as { column: string; direction: string } | undefined;
    const selectQuery = buildSelect(table.schema, table.name, buildColumnsSelect(table), {
      where,
      limit: args.limit as number | undefined,
      offset: args.offset as number | undefined,
      orderBy: orderBy ? { column: orderBy.column, direction: orderBy.direction === "DESC" ? "DESC" as const : "ASC" as const } : undefined,
    });
    const result = await ctx.client.query(selectQuery.sql, selectQuery.params);
    return result.rows;
  };

const byPkResolver = (table: Table, pk: Column) =>
  async (parent: unknown, args: Record<string, unknown>, ctx: ResolverContext) => {
    const selectQuery = buildSelect(table.schema, table.name, buildColumnsSelect(table), {
      where: { [pk.name]: args[pk.name] },
    });
    const result = await ctx.client.query(selectQuery.sql, selectQuery.params);
    return result.rows[0] ?? null;
  };

const insertResolver = (table: Table) =>
  async (parent: unknown, args: Record<string, unknown>, ctx: ResolverContext) => {
    const input = args.input as Record<string, unknown>;
    const insertQuery = buildInsert(table.schema, table.name, input);
    const result = await ctx.client.query(insertQuery.sql, insertQuery.params);
    return result.rows[0] ?? null;
  };

const updateResolver = (table: Table, pk: Column) =>
  async (parent: unknown, args: Record<string, unknown>, ctx: ResolverContext) => {
    const input = args.input as Record<string, unknown>;
    const pkValue = input[pk.name];
    const values = { ...input };
    delete values[pk.name];
    const updateQuery = buildUpdate(table.schema, table.name, { column: pk.name, value: pkValue }, values);
    const result = await ctx.client.query(updateQuery.sql, updateQuery.params);
    return result.rows[0] ?? null;
  };

const deleteResolver = (table: Table, pk: Column) =>
  async (parent: unknown, args: Record<string, unknown>, ctx: ResolverContext) => {
    const pkValue = args[pk.name];
    const deleteQuery = buildDelete(table.schema, table.name, { column: pk.name, value: pkValue });
    const result = await ctx.client.query(deleteQuery.sql, deleteQuery.params);
    return result.rows[0] ?? null;
  };

const fkResolver = (fk: ForeignKey, targetTable: Table, isToOne: boolean) =>
  async (parent: unknown, args: Record<string, unknown>, ctx: ResolverContext) => {
    const parentRecord = parent as Record<string, unknown>;
    const parentValue = parentRecord[fk.fromColumn];
    if (parentValue === null || parentValue === undefined) return null;

    const targetColumns = buildColumnsSelect(targetTable);
    const selectQuery = buildSelectByFk(
      targetTable.schema,
      targetTable.name,
      targetColumns,
      fk.toColumn,
      parentValue,
      {
        limit: args.limit as number | undefined,
        offset: args.offset as number | undefined,
      }
    );
    const result = await ctx.client.query(selectQuery.sql, selectQuery.params);

    if (isToOne) {
      return result.rows[0] ?? null;
    }
    return result.rows;
  };

let tableTypeCache: Map<string, GraphQLObjectType> = new Map();

const buildTableType = (table: Table, model: SchemaModel): GraphQLObjectType => {
  const cached = tableTypeCache.get(table.name);
  if (cached) return cached;

  const outgoingFks = model.foreignKeys.filter((fk) => fk.fromTable === table.name);

  const fields = (): GraphQLFieldConfigMap<unknown, ResolverContext> => {
    const colFields: GraphQLFieldConfigMap<unknown, ResolverContext> = {};

    for (const col of table.columns) {
      colFields[col.name] = { type: getGraphQLType(col) };
    }

    for (const fk of outgoingFks) {
      const targetTable = model.tables.find((t) => t.name === fk.toTable);
      if (!targetTable) continue;

      const isToOne = targetTable.columns.some((c) => c.isPrimaryKey);
      colFields[fk.fromColumn] = {
        type: isToOne
          ? buildTableType(targetTable, model)
          : new GraphQLList(buildTableType(targetTable, model)),
        args: {
          limit: { type: GraphQLInt },
          offset: { type: GraphQLInt },
        },
        resolve: fkResolver(fk, targetTable, isToOne),
      };
    }

    return colFields;
  };

  const type = new GraphQLObjectType({
    name: table.name,
    fields,
  });

  tableTypeCache.set(table.name, type);
  return type;
};

const buildQueryType = (model: SchemaModel): GraphQLObjectType => {
  const fields: GraphQLFieldConfigMap<unknown, ResolverContext> = {};

  for (const table of model.tables) {
    const tableType = buildTableType(table, model);
    const whereType = buildWhereInputType(table);
    const orderByType = buildOrderByInputType(table);
    const pk = table.columns.find((c) => c.isPrimaryKey);

    fields[table.name] = {
      type: new GraphQLList(tableType),
      args: {
        where: { type: whereType },
        limit: { type: GraphQLInt },
        offset: { type: GraphQLInt },
        orderBy: { type: orderByType },
      },
      resolve: listResolver(table),
    };

    if (pk) {
      const pkType = resolveScalarType(pk.type);
      fields[`${table.name}ByPk`] = {
        type: tableType,
        args: {
          [pk.name]: { type: new GraphQLNonNull(pkType) },
        },
        resolve: byPkResolver(table, pk),
      };
    }
  }

  return new GraphQLObjectType({
    name: "Query",
    fields,
  });
};

const buildMutationType = (model: SchemaModel): GraphQLObjectType => {
  const fields: GraphQLFieldConfigMap<unknown, ResolverContext> = {};

  for (const table of model.tables) {
    const pk = table.columns.find((c) => c.isPrimaryKey);
    if (!pk) continue;

    const tableType = buildTableType(table, model);
    const insertInput = buildInsertInputType(table);
    const updateInput = buildUpdateInputType(table);
    const pkType = resolveScalarType(pk.type);

    fields[`insert${capitalize(table.name)}`] = {
      type: tableType,
      args: {
        input: { type: new GraphQLNonNull(insertInput) },
      },
      resolve: insertResolver(table),
    };

    if (updateInput) {
      fields[`update${capitalize(table.name)}`] = {
        type: tableType,
        args: {
          input: { type: new GraphQLNonNull(updateInput) },
        },
        resolve: updateResolver(table, pk),
      };
    }

    fields[`delete${capitalize(table.name)}`] = {
      type: tableType,
      args: {
        [pk.name]: { type: new GraphQLNonNull(pkType) },
      },
      resolve: deleteResolver(table, pk),
    };
  }

  return new GraphQLObjectType({
    name: "Mutation",
    fields,
  });
};

export const buildSchema = (model: SchemaModel): GraphQLSchema => {
  builtEnumTypes.clear();
  tableTypeCache = new Map();

  return new GraphQLSchema({
    query: buildQueryType(model),
    mutation: buildMutationType(model),
  });
};
