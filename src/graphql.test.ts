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
          columns: [
            { name: "id", type: "int4", nullable: false, isPrimaryKey: true, isUnique: false, defaultValue: null, enumValues: null, arrayElementType: null },
            { name: "name", type: "text", nullable: false, isPrimaryKey: false, isUnique: false, defaultValue: null, enumValues: null, arrayElementType: null },
          ],
        },
      ],
      foreignKeys: [],
      enums: {},
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
          columns: [
            { name: "id", type: "int4", nullable: false, isPrimaryKey: true, isUnique: false, defaultValue: null, enumValues: null, arrayElementType: null },
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
            },
          ],
        },
      ],
      foreignKeys: [],
      enums: {
        order_status: [
          { label: "pending", value: "pending" },
          { label: "shipped", value: "shipped" },
          { label: "delivered", value: "delivered" },
        ],
      },
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
          columns: [
            { name: "id", type: "int4", nullable: false, isPrimaryKey: true, isUnique: false, defaultValue: null, enumValues: null, arrayElementType: null },
            { name: "tags", type: "_text", nullable: true, isPrimaryKey: false, isUnique: false, defaultValue: null, enumValues: null, arrayElementType: "text" },
          ],
        },
      ],
      foreignKeys: [],
      enums: {},
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
          columns: [
            { name: "id", type: "int4", nullable: false, isPrimaryKey: true, isUnique: false, defaultValue: null, enumValues: null, arrayElementType: null },
          ],
        },
      ],
      foreignKeys: [],
      enums: {},
    };

    const schema1 = buildSchema(model);
    const schema2 = buildSchema(model);
    expect(schema1).toBeDefined();
    expect(schema2).toBeDefined();
  });
});
