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
  buildSelectWithFilter,
  buildSelectByFkWithFilter,
  buildDeleteWithFilter,
  buildUpdateWithFilter,
} from "./sql";
import { WhereInputCodec, OrderByInputCodec, isRight } from "./codecs";

const TimestampScalar = new GraphQLScalarType({
  name: "Timestamp",
  description: "Unix epoch in milliseconds",
  serialize(value: unknown): number {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;
    if (typeof value === "string") return new Date(value).getTime();
    return 0;
  },
  parseValue(value: unknown): Date {
    if (typeof value === "number") return new Date(value);
    if (typeof value === "string") return new Date(value);
    return new Date(0);
  },
});

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
  timestamp: () => TimestampScalar,
  timestamptz: () => TimestampScalar,
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

const whereOperators = ["eq", "neq", "gt", "gte", "lt", "lte", "like", "in"] as const;

const parseWhereArgs = (whereArg: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
  if (!whereArg) return undefined;

  const validation = WhereInputCodec.validate(whereArg, []);
  if (!isRight(validation)) return undefined;

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(validation.right)) {
    if (value === undefined) continue;

    let matched = false;
    for (const op of whereOperators) {
      if (key.endsWith(`_${op}`)) {
        const column = key.slice(0, -(op.length + 1));
        result[column] = { _operator: op, value };
        matched = true;
        break;
      }
    }
    if (!matched) {
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

const parseOrderByArg = (orderByArg: Record<string, string> | undefined): { column: string; direction: "ASC" | "DESC" } | undefined => {
  if (!orderByArg) return undefined;

  const validation = OrderByInputCodec.validate(orderByArg, []);
  if (!isRight(validation)) return undefined;

  for (const [column, direction] of Object.entries(validation.right)) {
    return { column, direction };
  }
  return undefined;
};

const deriveRelationName = (fkColumn: string): string => {
  if (fkColumn.endsWith("_id")) {
    return fkColumn.slice(0, -3);
  }
  return `${fkColumn}_relation`;
};

const listResolver = (table: Table) =>
  async (parent: unknown, args: Record<string, unknown>, ctx: ResolverContext) => {
    const where = parseWhereArgs(args.where as Record<string, unknown> | undefined);
    const orderByArg = args.orderBy as Record<string, string> | undefined;
    const orderBy = parseOrderByArg(orderByArg);
    const columns = buildColumnsSelect(table);

    const selectQuery = table.permissions?.selectFilter
      ? buildSelectWithFilter(table.schema, table.name, "select_filter", columns, {
          where,
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
          orderBy,
        })
      : buildSelect(table.schema, table.name, columns, {
          where,
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
          orderBy,
        });

    const result = await ctx.client.query(selectQuery.sql, selectQuery.params);
    return result.rows;
  };

const byPkResolver = (table: Table, pk: Column) =>
  async (parent: unknown, args: Record<string, unknown>, ctx: ResolverContext) => {
    const columns = buildColumnsSelect(table);
    const selectQuery = table.permissions?.selectFilter
      ? buildSelectWithFilter(table.schema, table.name, "select_filter", columns, {
          where: { [pk.name]: args[pk.name] },
        })
      : buildSelect(table.schema, table.name, columns, {
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

    const updateQuery = table.permissions?.updateFilter
      ? buildUpdateWithFilter(table.schema, table.name, "update_filter", { column: pk.name, value: pkValue }, values)
      : buildUpdate(table.schema, table.name, { column: pk.name, value: pkValue }, values);

    const result = await ctx.client.query(updateQuery.sql, updateQuery.params);
    return result.rows[0] ?? null;
  };

const deleteResolver = (table: Table, pk: Column) =>
  async (parent: unknown, args: Record<string, unknown>, ctx: ResolverContext) => {
    const pkValue = args[pk.name];

    const deleteQuery = table.permissions?.deleteFilter
      ? buildDeleteWithFilter(table.schema, table.name, "delete_filter", { column: pk.name, value: pkValue })
      : buildDelete(table.schema, table.name, { column: pk.name, value: pkValue });

    const result = await ctx.client.query(deleteQuery.sql, deleteQuery.params);
    return result.rows[0] ?? null;
  };

const fkResolver = (fk: ForeignKey, targetTable: Table, isToOne: boolean) =>
  async (parent: unknown, args: Record<string, unknown>, ctx: ResolverContext) => {
    const parentRecord = parent as Record<string, unknown>;
    const parentValue = parentRecord[fk.fromColumn];
    if (parentValue === null || parentValue === undefined) return null;

    const targetColumns = buildColumnsSelect(targetTable);
    const selectQuery = targetTable.permissions?.selectFilter
      ? buildSelectByFkWithFilter(
          targetTable.schema,
          targetTable.name,
          "select_filter",
          targetColumns,
          fk.toColumn,
          parentValue,
          {
            limit: args.limit as number | undefined,
            offset: args.offset as number | undefined,
          }
        )
      : buildSelectByFk(targetTable.schema, targetTable.name, targetColumns, fk.toColumn, parentValue, {
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
        });

    const result = await ctx.client.query(selectQuery.sql, selectQuery.params);

    if (isToOne) {
      return result.rows[0] ?? null;
    }
    return result.rows;
  };

const reverseFkResolver = (fk: ForeignKey, sourceTable: Table) =>
  async (parent: unknown, args: Record<string, unknown>, ctx: ResolverContext) => {
    const parentRecord = parent as Record<string, unknown>;
    const pk = sourceTable.columns.find((c) => c.isPrimaryKey);
    if (!pk) return [];

    const parentValue = parentRecord[pk.name];
    if (parentValue === null || parentValue === undefined) return [];

    const sourceColumns = buildColumnsSelect(sourceTable);
    const selectQuery = sourceTable.permissions?.selectFilter
      ? buildSelectByFkWithFilter(
          sourceTable.schema,
          sourceTable.name,
          "select_filter",
          sourceColumns,
          fk.fromColumn,
          parentValue,
          {
            limit: args.limit as number | undefined,
            offset: args.offset as number | undefined,
          }
        )
      : buildSelectByFk(sourceTable.schema, sourceTable.name, sourceColumns, fk.fromColumn, parentValue, {
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
        });

    const result = await ctx.client.query(selectQuery.sql, selectQuery.params);
    return result.rows;
  };

let tableTypeCache: Map<string, GraphQLObjectType> = new Map();

const buildTableType = (table: Table, model: SchemaModel): GraphQLObjectType => {
  const cached = tableTypeCache.get(table.name);
  if (cached) return cached;

  const outgoingFks = model.foreignKeys.filter((fk) => fk.fromTable === table.name);
  const incomingFks = model.foreignKeys.filter((fk) => fk.toTable === table.name);

  const fields = (): GraphQLFieldConfigMap<unknown, ResolverContext> => {
    const colFields: GraphQLFieldConfigMap<unknown, ResolverContext> = {};

    for (const col of table.columns) {
      colFields[col.name] = { type: getGraphQLType(col), description: col.description ?? undefined };
    }

    for (const fk of outgoingFks) {
      const targetTable = [...model.tables, ...model.views].find((t) => t.name === fk.toTable);
      if (!targetTable) continue;

      const isToOne = targetTable.columns.some((c) => c.isPrimaryKey);
      const relationName = deriveRelationName(fk.fromColumn);
      colFields[relationName] = {
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

    for (const fk of incomingFks) {
      const sourceTable = [...model.tables, ...model.views].find((t) => t.name === fk.fromTable);
      if (!sourceTable) continue;

      colFields[sourceTable.name] = {
        type: new GraphQLList(buildTableType(sourceTable, model)),
        args: {
          limit: { type: GraphQLInt },
          offset: { type: GraphQLInt },
        },
        resolve: reverseFkResolver(fk, sourceTable),
      };
    }

    return colFields;
  };

  const type = new GraphQLObjectType({
    name: table.name,
    description: table.description ?? undefined,
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

  for (const view of model.views) {
    const viewType = buildTableType(view, model);
    const whereType = buildWhereInputType(view);
    const orderByType = buildOrderByInputType(view);

    fields[view.name] = {
      type: new GraphQLList(viewType),
      args: {
        where: { type: whereType },
        limit: { type: GraphQLInt },
        offset: { type: GraphQLInt },
        orderBy: { type: orderByType },
      },
      resolve: listResolver(view),
    };
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
