import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLFloat,
  GraphQLBoolean,
  GraphQLList,
  GraphQLNonNull,
} from "graphql";
import type { SchemaModel, Table, Column } from "./schema";

const typeMap: Record<string, () => any> = {
  int: () => GraphQLInt,
  int4: () => GraphQLInt,
  int8: () => GraphQLInt,
  float4: () => GraphQLFloat,
  float8: () => GraphQLFloat,
  numeric: () => GraphQLFloat,
  text: () => GraphQLString,
  varchar: () => GraphQLString,
  char: () => GraphQLString,
  bool: () => GraphQLBoolean,
  boolean: () => GraphQLBoolean,
  uuid: () => GraphQLString,
  json: () => GraphQLString,
  jsonb: () => GraphQLString,
  date: () => GraphQLString,
  timestamp: () => GraphQLString,
  timestamptz: () => GraphQLString,
};

const getGraphQLType = (column: Column) => {
  const factory = typeMap[column.type.toLowerCase()];
  const baseType = factory ? factory() : GraphQLString;
  return column.nullable ? baseType : new GraphQLNonNull(baseType);
};

const buildTableType = (table: Table): GraphQLObjectType =>
  new GraphQLObjectType({
    name: table.name,
    fields: () =>
      Object.fromEntries(
        table.columns.map((col) => [col.name, { type: getGraphQLType(col) }])
      ),
  });

const buildQueryType = (model: SchemaModel): GraphQLObjectType => {
  const fields: Record<string, any> = {};

  for (const table of model.tables) {
    const tableType = buildTableType(table);
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

export const buildSchema = (model: SchemaModel): GraphQLSchema =>
  new GraphQLSchema({
    query: buildQueryType(model),
  });
