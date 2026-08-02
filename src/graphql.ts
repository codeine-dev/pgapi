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
import type { ChangeEvent, ChangeOperation, SubscriptionManager } from "./realtime";
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

const whereInputTypeCache = new Map<string, GraphQLInputObjectType>();
const orderByInputTypeCache = new Map<string, GraphQLInputObjectType>();

const getWhereInputType = (table: Table): GraphQLInputObjectType => {
  const cached = whereInputTypeCache.get(table.name);
  if (cached) return cached;
  const type = buildWhereInputType(table);
  whereInputTypeCache.set(table.name, type);
  return type;
};

const getOrderByInputType = (table: Table): GraphQLInputObjectType => {
  const cached = orderByInputTypeCache.get(table.name);
  if (cached) return cached;
  const type = buildOrderByInputType(table);
  orderByInputTypeCache.set(table.name, type);
  return type;
};

const buildInsertInputType = (table: Table): GraphQLInputObjectType => {
  const fields: GraphQLInputFieldConfigMap = {};

  for (const col of table.columns) {
    if (col.isPrimaryKey) continue;
    if (col.defaultValue) {
      fields[col.name] = { type: resolveScalarType(col.type) };
    } else {
      fields[col.name] = { type: getGraphQLType(col) };
    }
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

const patternToRegExp = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
  return new RegExp(`^${escaped}$`);
};

const compareScalar = (actual: unknown, expected: unknown): boolean => {
  if (expected === null || expected === undefined) {
    return actual === null || actual === undefined;
  }
  return String(actual) === String(expected);
};

const matchesRow = (where: Record<string, unknown>, row: Record<string, unknown>): boolean => {
  for (const [column, condition] of Object.entries(where)) {
    const actual = row[column];

    if (condition !== null && typeof condition === "object" && "_operator" in condition) {
      const op = (condition as { _operator: string; value: unknown })._operator;
      const expected = (condition as { _operator: string; value: unknown }).value;

      switch (op) {
        case "neq":
          if (compareScalar(actual, expected)) return false;
          break;
        case "gt":
          if (Number(actual) <= Number(expected)) return false;
          break;
        case "gte":
          if (Number(actual) < Number(expected)) return false;
          break;
        case "lt":
          if (Number(actual) >= Number(expected)) return false;
          break;
        case "lte":
          if (Number(actual) > Number(expected)) return false;
          break;
        case "in":
          if (!Array.isArray(expected) || !expected.map((v) => String(v)).includes(String(actual))) return false;
          break;
        case "like":
          if (!patternToRegExp(String(expected)).test(String(actual))) return false;
          break;
        default:
          if (!compareScalar(actual, expected)) return false;
      }
    } else if (condition === null) {
      if (actual !== null && actual !== undefined) return false;
    } else if (!compareScalar(actual, condition)) {
      return false;
    }
  }
  return true;
};

const subscribeResolver = (table: Table) =>
  (parent: unknown, args: Record<string, unknown>, ctx: ResolverContext): SubscriptionIterator => {
    const manager = ctx.subscriptions;
    if (!manager) {
      throw new Error("Subscriptions are not enabled on this server");
    }

    const where = parseWhereArgs(args.where as Record<string, unknown> | undefined);
    const event = args.event as ChangeOperation | undefined;

    return new SubscriptionIterator(manager, `${table.schema}.${table.name}`, where, event);
  };

class SubscriptionIterator implements AsyncIterableIterator<Record<string, unknown>> {
  private readonly queue: ChangeEvent[] = [];
  private readonly pending: Array<{ resolve: (result: IteratorResult<Record<string, unknown>>) => void }> = [];
  private closed = false;
  private readonly unsubscribe: () => void;

  constructor(
    manager: SubscriptionManager,
    private readonly tableKey: string,
    private readonly where: Record<string, unknown> | undefined,
    private readonly event: ChangeOperation | undefined
  ) {
    this.unsubscribe = manager.subscribe(tableKey, (change) => this.push(change));
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<Record<string, unknown>> {
    return this;
  }

  next(): Promise<IteratorResult<Record<string, unknown>>> {
    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    const nextChange = this.queue.shift();
    if (nextChange) {
      return Promise.resolve({ done: false, value: nextChange.row });
    }
    return new Promise((resolve) => this.pending.push({ resolve }));
  }

  return(): Promise<IteratorResult<Record<string, unknown>>> {
    this.close();
    return Promise.resolve({ done: true, value: undefined });
  }

  throw(error: unknown): Promise<IteratorResult<Record<string, unknown>>> {
    this.close();
    return Promise.reject(error);
  }

  private push(change: ChangeEvent): void {
    if (this.closed) return;
    if (this.event !== undefined && change.operation !== this.event) return;
    if (this.where && !matchesRow(this.where, change.row)) return;

    const waiter = this.pending.shift();
    if (waiter) {
      waiter.resolve({ done: false, value: change.row });
    } else {
      this.queue.push(change);
    }
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    for (const waiter of this.pending.splice(0)) {
      waiter.resolve({ done: true, value: undefined });
    }
  }
}

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
    const whereType = getWhereInputType(table);
    const orderByType = getOrderByInputType(table);
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
    const whereType = getWhereInputType(view);
    const orderByType = getOrderByInputType(view);

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

const buildEventEnumType = (tableName: string): GraphQLEnumType => {
  const typeName = `${capitalize(tableName)}Event`;
  const existing = builtEnumTypes.get(typeName);
  if (existing) return existing;

  const eventType = new GraphQLEnumType({
    name: typeName,
    values: {
      INSERT: { value: "INSERT" },
      UPDATE: { value: "UPDATE" },
      DELETE: { value: "DELETE" },
    },
  });
  builtEnumTypes.set(typeName, eventType);
  return eventType;
};

const buildSubscriptionType = (model: SchemaModel): GraphQLObjectType | null => {
  const fields: GraphQLFieldConfigMap<unknown, ResolverContext> = {};

  for (const table of model.tables) {
    const tableType = buildTableType(table, model);
    const whereType = getWhereInputType(table);

    fields[`${table.name}Changed`] = {
      type: tableType,
      description: `Subscribe to INSERT, UPDATE and DELETE changes on the ${table.name} table`,
      args: {
        event: { type: buildEventEnumType(table.name) },
        where: { type: whereType },
      },
      resolve: (source: unknown) => source,
      subscribe: subscribeResolver(table),
    };
  }

  if (Object.keys(fields).length === 0) return null;

  return new GraphQLObjectType({
    name: "Subscription",
    fields,
  });
};

export const buildSchema = (model: SchemaModel): GraphQLSchema => {
  builtEnumTypes.clear();
  tableTypeCache = new Map();
  whereInputTypeCache.clear();
  orderByInputTypeCache.clear();

  const subscriptionType = buildSubscriptionType(model);

  return new GraphQLSchema({
    query: buildQueryType(model),
    mutation: buildMutationType(model),
    subscription: subscriptionType ?? undefined,
  });
};
