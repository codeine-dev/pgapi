import { describe, it, expect } from "vitest";
import { parse, subscribe } from "graphql";
import { buildSchema } from "./graphql";
import type { SchemaModel } from "./schema";
import { createFakeSubscriptionManager, publishChange } from "./test-support";

const usersModel = (): SchemaModel => ({
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
});

const modelWithSubscriptions = (tables: SchemaModel["tables"]): SchemaModel => ({
  tables,
  views: [],
  foreignKeys: [],
  enums: {},
  hasPermissions: false,
});

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

describe("Subscription schema", () => {
  it("builds a Subscription type with a Changed field per table", () => {
    const schema = buildSchema(usersModel());
    const subscriptionType = schema.getSubscriptionType();
    expect(subscriptionType).toBeDefined();
    expect(subscriptionType?.getFields()["usersChanged"]).toBeDefined();
    expect(subscriptionType?.getFields()["usersByPkChanged"]).toBeUndefined();
  });

  it("exposes event and where arguments on the Changed field", () => {
    const schema = buildSchema(usersModel());
    const field = schema.getSubscriptionType()?.getFields()["usersChanged"];
    expect(field).toBeDefined();
    expect(field?.args.map((a) => a.name).sort()).toEqual(["event", "where"]);

    const eventType = field?.args.find((a) => a.name === "event")?.type;
    const enumType = schema.getType("UsersEvent");
    expect(enumType).toBeDefined();
    const values = (enumType as unknown as { getValues: () => Array<{ name: string; value: string }> }).getValues().map((v) => v.name);
    expect(values).toEqual(["INSERT", "UPDATE", "DELETE"]);
    expect(eventType?.toString()).toContain("UsersEvent");
  });

  it("omits the Subscription type when there are no tables", () => {
    const schema = buildSchema({ tables: [], views: [], foreignKeys: [], enums: {}, hasPermissions: false });
    expect(schema.getSubscriptionType()).toBeUndefined();
  });
});

describe("Subscription resolvers", () => {
  const runSubscription = async (
    model: SchemaModel,
    document: string,
    args: { variables?: Record<string, unknown>; event?: unknown } = {}
  ) => {
    const schema = buildSchema(model);
    const { manager, client } = await createFakeSubscriptionManager();
    const contextValue = {
      client: client as never,
      model,
      auth: { isAuthenticated: false },
      subscriptions: manager,
    };
    const iterator = (await subscribe({
      schema,
      document: parse(document),
      variableValues: args.variables,
      contextValue,
    })) as AsyncIterableIterator<{ data?: Record<string, unknown>; errors?: Array<{ message: string }> }>;
    return { iterator, client };
  };

  const nextValue = (iterator: AsyncIterableIterator<{ data?: Record<string, unknown> }>) =>
    iterator.next().then((res) => res.value);

  it("yields inserted rows to subscribers", async () => {
    const { iterator, client } = await runSubscription(
      usersModel(),
      `subscription { usersChanged { id name } }`
    );

    const pending = nextValue(iterator);

    publishChange(client, {
      schema: "public",
      table: "users",
      operation: "INSERT",
      row: { id: 1, name: "Alice" },
    });

    const result = await pending;
    expect(result.errors).toBeUndefined();
    expect(result.data).toEqual({ usersChanged: { id: 1, name: "Alice" } });
  });

  it("filters by event type", async () => {
    const { iterator, client } = await runSubscription(
      usersModel(),
      `subscription { usersChanged(event: UPDATE) { id } }`
    );

    const pending = nextValue(iterator);

    publishChange(client, {
      schema: "public",
      table: "users",
      operation: "INSERT",
      row: { id: 1, name: "Alice" },
    });

    let resolved = false;
    const winner = await Promise.race([
      pending.then((value) => ({ value })).catch(() => ({ value: undefined })),
      new Promise<{ timedOut: boolean }>((resolve) => setTimeout(() => resolve({ timedOut: true }), 100)),
    ]);
    if ("timedOut" in winner) resolved = false;
    else resolved = true;

    expect(resolved).toBe(false);

    publishChange(client, {
      schema: "public",
      table: "users",
      operation: "UPDATE",
      row: { id: 2, name: "Bob" },
    });

    const result = await pending;
    expect(result.data).toEqual({ usersChanged: { id: 2 } });
  });

  it("filters by where conditions", async () => {
    const { iterator, client } = await runSubscription(
      usersModel(),
      `subscription { usersChanged(where: { name_eq: "Alice" }) { id name } }`
    );

    const pending = nextValue(iterator);

    publishChange(client, {
      schema: "public",
      table: "users",
      operation: "INSERT",
      row: { id: 1, name: "Bob" },
    });

    publishChange(client, {
      schema: "public",
      table: "users",
      operation: "INSERT",
      row: { id: 2, name: "Alice" },
    });

    const result = await pending;
    expect(result.data).toEqual({ usersChanged: { id: 2, name: "Alice" } });
  });

  it("cleans up the subscription listener on complete", async () => {
    const schema = buildSchema(usersModel());
    const spyManager = {
      subscribeCalls: 0,
      unsubscribeCalls: 0,
      subscribe: () => {
        spyManager.subscribeCalls++;
        return () => {
          spyManager.unsubscribeCalls++;
        };
      },
    };

    const iterator = (await subscribe({
      schema,
      document: parse(`subscription { usersChanged { id } }`),
      contextValue: {
        client: {} as never,
        model: usersModel(),
        auth: { isAuthenticated: false },
        subscriptions: spyManager as never,
      },
    })) as AsyncIterableIterator<{ data?: Record<string, unknown> }>;

    const pending = iterator.next();
    expect(spyManager.subscribeCalls).toBe(1);

    await iterator.return?.(undefined);
    expect(spyManager.unsubscribeCalls).toBe(1);
    void pending;
  });
});

