import { describe, it, expect } from "vitest";
import { buildSchema } from "./graphql";
import type { SchemaModel } from "./schema";

describe("buildSchema", () => {
  it("builds schema from simple model", () => {
    const model: SchemaModel = {
      tables: [
        {
          schema: "public",
          name: "users",
          type: "table",
          description: null,
          permissions: null,
          columns: [
            { name: "id", type: "int4", nullable: false, isPrimaryKey: true, isUnique: false, defaultValue: null, enumValues: null, arrayElementType: null, description: null },
            { name: "name", type: "text", nullable: false, isPrimaryKey: false, isUnique: false, defaultValue: null, enumValues: null, arrayElementType: null, description: null },
          ],
        },
      ],
      views: [],
      foreignKeys: [],
      enums: {},
      hasPermissions: false,
    };

    const schema = buildSchema(model);
    expect(schema).toBeDefined();

    const queryType = schema.getQueryType();
    expect(queryType).toBeDefined();
    expect(queryType?.getFields()["users"]).toBeDefined();
  });

  it("builds enum types from column metadata", () => {
    const model: SchemaModel = {
      tables: [
        {
          schema: "public",
          name: "orders",
          type: "table",
          description: null,
          permissions: null,
          columns: [
            { name: "id", type: "int4", nullable: false, isPrimaryKey: true, isUnique: false, defaultValue: null, enumValues: null, arrayElementType: null, description: null },
            {
              name: "status",
              type: "order_status",
              nullable: false,
              isPrimaryKey: false,
              isUnique: false,
              defaultValue: null,
              enumValues: [
                { label: "pending", value: "pending" },
                { label: "shipped", value: "shipped" },
                { label: "delivered", value: "delivered" },
              ],
              arrayElementType: null,
              description: null,
            },
          ],
        },
      ],
      views: [],
      foreignKeys: [],
      enums: {
        order_status: [
          { label: "pending", value: "pending" },
          { label: "shipped", value: "shipped" },
          { label: "delivered", value: "delivered" },
        ],
      },
      hasPermissions: false,
    };

    const schema = buildSchema(model);
    expect(schema).toBeDefined();
  });

  it("handles array columns", () => {
    const model: SchemaModel = {
      tables: [
        {
          schema: "public",
          name: "posts",
          type: "table",
          description: null,
          permissions: null,
          columns: [
            { name: "id", type: "int4", nullable: false, isPrimaryKey: true, isUnique: false, defaultValue: null, enumValues: null, arrayElementType: null, description: null },
            { name: "tags", type: "_text", nullable: true, isPrimaryKey: false, isUnique: false, defaultValue: null, enumValues: null, arrayElementType: "text", description: null },
          ],
        },
      ],
      views: [],
      foreignKeys: [],
      enums: {},
      hasPermissions: false,
    };

    const schema = buildSchema(model);
    expect(schema).toBeDefined();
  });

  it("clears enum cache between builds", () => {
    const model: SchemaModel = {
      tables: [
        {
          schema: "public",
          name: "items",
          type: "table",
          description: null,
          permissions: null,
          columns: [
            { name: "id", type: "int4", nullable: false, isPrimaryKey: true, isUnique: false, defaultValue: null, enumValues: null, arrayElementType: null, description: null },
          ],
        },
      ],
      views: [],
      foreignKeys: [],
      enums: {},
      hasPermissions: false,
    };

    const schema1 = buildSchema(model);
    const schema2 = buildSchema(model);
    expect(schema1).toBeDefined();
    expect(schema2).toBeDefined();
  });
});
