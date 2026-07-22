import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLFloat,
  GraphQLBoolean,
  GraphQLList,
  GraphQLNonNull,
  GraphQLEnumType,
  GraphQLScalarType,
} from "graphql";
import type { SchemaModel, Table, Column } from "./schema";

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

const getGraphQLType = (column: Column, model: SchemaModel) => {
  let baseType;

  if (column.enumValues && column.enumValues.length > 0) {
    baseType = getEnumType(`${column.name}_enum`, column.enumValues);
  } else if (column.arrayElementType) {
    const elemType = scalarMap[column.arrayElementType.toLowerCase()];
    baseType = new GraphQLList(elemType ? elemType() : GraphQLString);
  } else {
    const factory = scalarMap[column.type.toLowerCase()];
    baseType = factory ? factory() : GraphQLString;
  }

  return column.nullable ? baseType : new GraphQLNonNull(baseType);
};

const buildTableType = (table: Table, model: SchemaModel): GraphQLObjectType =>
  new GraphQLObjectType({
    name: table.name,
    fields: () =>
      Object.fromEntries(
        table.columns.map((col) => [col.name, { type: getGraphQLType(col, model) }])
      ),
  });

const buildQueryType = (model: SchemaModel): GraphQLObjectType => {
  const fields: Record<string, any> = {};

  for (const table of model.tables) {
    const tableType = buildTableType(table, model);
    fields[table.name] = {
      type: new GraphQLList(tableType),
      args: {
        limit: { type: GraphQLInt },
        offset: { type: GraphQLInt },
      },
      resolve: () => {
        throw new Error("Resolver not implemented");
      },
    };
  }

  return new GraphQLObjectType({
    name: "Query",
    fields,
  });
};

export const buildSchema = (model: SchemaModel): GraphQLSchema => {
  builtEnumTypes.clear();
  return new GraphQLSchema({
    query: buildQueryType(model),
  });
};
