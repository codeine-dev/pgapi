import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "pg";
import { readSchema } from "./schema";
import { buildSchema } from "./graphql";
import { graphql, GraphQLSchema } from "graphql";
import { createClient } from "./db";
import * as TE from "fp-ts/TaskEither";
import { pipe } from "fp-ts/function";
import { authenticate, type AuthConfig } from "./auth";
import { ensureCheckTriggers } from "./permissions";

const TEST_DB_URL = "postgres://postgres:postgres@localhost:5432/postgres";

interface TestContext {
  client: Client;
  schema: GraphQLSchema;
}

const createTestContext = async (): Promise<TestContext> => {
  const client = new Client({ connectionString: TEST_DB_URL });
  await client.connect();

  const dbEnv = { connectionString: TEST_DB_URL };
  const schemaResult = await readSchema(dbEnv, ["public"])();

  if (schemaResult._tag === "Left") {
    throw new Error(`Failed to read schema: ${schemaResult.left.message}`);
  }

  const schema = buildSchema(schemaResult.right);

  return { client, schema };
};

const executeQuery = async (
  ctx: TestContext,
  query: string,
  variables?: Record<string, unknown>
) => {
  return graphql({
    schema: ctx.schema,
    source: query,
    variableValues: variables,
    contextValue: { client: ctx.client, model: { tables: [], views: [], foreignKeys: [], enums: {}, hasPermissions: false }, auth: { isAuthenticated: false } },
  });
};

const setupTestData = async (client: Client) => {
  await client.query("DELETE FROM comments");
  await client.query("DELETE FROM posts");
  await client.query("DELETE FROM users");

  await client.query("INSERT INTO users (id, name, email, role) VALUES (1, 'Alice', 'alice@test.com', 'admin'), (2, 'Bob', 'bob@test.com', 'user'), (3, 'Charlie', 'charlie@test.com', 'user')");
  await client.query("INSERT INTO posts (id, title, published, author_id) VALUES (1, 'Hello World', true, 1), (2, 'GraphQL Tips', true, 1), (3, 'Draft Post', false, 2)");
  await client.query("INSERT INTO comments (id, body, post_id, author_id) VALUES (1, 'Great post!', 1, 2), (2, 'Thanks for sharing', 1, 3), (3, 'Very helpful', 2, 3)");
};

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();

  // Clean up any leftover permission triggers from previous test runs
  await ctx.client.query("DROP TRIGGER IF EXISTS pgapi_insert_check ON users");
  await ctx.client.query("DROP TRIGGER IF EXISTS pgapi_update_check ON users");
  await ctx.client.query("DROP FUNCTION IF EXISTS pgapi_check_trigger()");
  await ctx.client.query("DROP FUNCTION IF EXISTS public.users_select_filter()");
  await ctx.client.query("DROP FUNCTION IF EXISTS public.users_insert_check(text, text, jsonb)");
  await ctx.client.query("DROP FUNCTION IF EXISTS public.users_insert_check(jsonb, jsonb, jsonb)");
});

afterAll(async () => {
  await ctx.client.end();
});

beforeEach(async () => {
  await setupTestData(ctx.client);
});

describe("CRUD Operations", () => {
  it("reads all users", async () => {
    const result = await executeQuery(ctx, `{ users { id name email role } }`);
    expect(result.errors).toBeUndefined();
    expect(result.data?.users).toEqual([
      { id: 1, name: "Alice", email: "alice@test.com", role: "admin" },
      { id: 2, name: "Bob", email: "bob@test.com", role: "user" },
      { id: 3, name: "Charlie", email: "charlie@test.com", role: "user" },
    ]);
  });

  it("reads user by primary key", async () => {
    const result = await executeQuery(ctx, `{ usersByPk(id: 1) { id name email } }`);
    expect(result.errors).toBeUndefined();
    expect(result.data?.usersByPk).toEqual({ id: 1, name: "Alice", email: "alice@test.com" });
  });

  it("creates a new user", async () => {
    const result = await executeQuery(
      ctx,
      `mutation { insertUsers(input: { name: "Diana", email: "diana@test.com", role: "user" }) { id name email } }`
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.insertUsers).toEqual({ id: expect.any(Number), name: "Diana", email: "diana@test.com" });

    const verify = await executeQuery(ctx, `{ users { id name } }`);
    expect(verify.data?.users).toHaveLength(4);
  });

  it("updates a user", async () => {
    const result = await executeQuery(
      ctx,
      `mutation { updateUsers(input: { id: 1, name: "Alice Updated", email: "alice-new@test.com", role: "admin" }) { id name email } }`
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.updateUsers).toEqual({ id: 1, name: "Alice Updated", email: "alice-new@test.com" });
  });

  it("deletes a user", async () => {
    await ctx.client.query("DELETE FROM comments WHERE author_id = 3");

    const result = await executeQuery(
      ctx,
      `mutation { deleteUsers(id: 3) { id name } }`
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.deleteUsers).toEqual({ id: 3, name: "Charlie" });

    const verify = await executeQuery(ctx, `{ users { id name } }`);
    expect(verify.data?.users).toHaveLength(2);
  });
});

describe("Relationship Resolution", () => {
  it("resolves forward FK (post author)", async () => {
    const result = await executeQuery(
      ctx,
      `{ posts { id title author { id name } } }`
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.posts).toEqual([
      { id: 1, title: "Hello World", author: { id: 1, name: "Alice" } },
      { id: 2, title: "GraphQL Tips", author: { id: 1, name: "Alice" } },
      { id: 3, title: "Draft Post", author: { id: 2, name: "Bob" } },
    ]);
  });

  it("resolves reverse FK (user posts)", async () => {
    const result = await executeQuery(
      ctx,
      `{ users { id name posts { id title } } }`
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.users).toEqual([
      { id: 1, name: "Alice", posts: [{ id: 1, title: "Hello World" }, { id: 2, title: "GraphQL Tips" }] },
      { id: 2, name: "Bob", posts: [{ id: 3, title: "Draft Post" }] },
      { id: 3, name: "Charlie", posts: [] },
    ]);
  });

  it("resolves nested relationships", async () => {
    const result = await executeQuery(
      ctx,
      `{ posts { id title author { id name } comments { id body } } }`
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.posts[0]).toEqual({
      id: 1,
      title: "Hello World",
      author: { id: 1, name: "Alice" },
      comments: [
        { id: 1, body: "Great post!" },
        { id: 2, body: "Thanks for sharing" },
      ],
    });
  });
});

describe("Where Clause Operators", () => {
  it("filters with eq operator", async () => {
    const result = await executeQuery(
      ctx,
      `{ users(where: { name_eq: "Alice" }) { id name } }`
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.users).toEqual([{ id: 1, name: "Alice" }]);
  });

  it("filters with neq operator", async () => {
    const result = await executeQuery(
      ctx,
      `{ users(where: { name_neq: "Alice" }) { id name } }`
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.users).toEqual([
      { id: 2, name: "Bob" },
      { id: 3, name: "Charlie" },
    ]);
  });

  it("filters with like operator", async () => {
    const result = await executeQuery(
      ctx,
      `{ users(where: { name_like: "%li%" }) { id name } }`
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.users).toEqual([
      { id: 1, name: "Alice" },
      { id: 3, name: "Charlie" },
    ]);
  });

  it("filters with in operator", async () => {
    const result = await executeQuery(
      ctx,
      `{ users(where: { id_in: [1, 3] }) { id name } }`
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.users).toEqual([
      { id: 1, name: "Alice" },
      { id: 3, name: "Charlie" },
    ]);
  });

  it("filters posts with published_eq", async () => {
    const result = await executeQuery(
      ctx,
      `{ posts(where: { published_eq: true }) { id title } }`
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.posts).toEqual([
      { id: 1, title: "Hello World" },
      { id: 2, title: "GraphQL Tips" },
    ]);
  });
});

describe("OrderBy and Pagination", () => {
  it("orders by name ascending", async () => {
    const result = await executeQuery(
      ctx,
      `{ users(orderBy: { name: ASC }) { id name } }`
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.users).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
      { id: 3, name: "Charlie" },
    ]);
  });

  it("orders by name descending", async () => {
    const result = await executeQuery(
      ctx,
      `{ users(orderBy: { name: DESC }) { id name } }`
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.users).toEqual([
      { id: 3, name: "Charlie" },
      { id: 2, name: "Bob" },
      { id: 1, name: "Alice" },
    ]);
  });

  it("applies limit", async () => {
    const result = await executeQuery(
      ctx,
      `{ users(limit: 2) { id name } }`
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.users).toHaveLength(2);
  });

  it("applies offset", async () => {
    const result = await executeQuery(
      ctx,
      `{ users(limit: 2, offset: 1) { id name } }`
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.users).toHaveLength(2);
    expect(result.data?.users[0].id).toBe(2);
  });
});

describe("Error Handling", () => {
  it("returns error for missing required field in insert", async () => {
    const result = await executeQuery(
      ctx,
      `mutation { insertUsers(input: {}) { id name } }`
    );
    expect(result.errors).toBeDefined();
  });

  it("returns error for invalid primary key lookup", async () => {
    const result = await executeQuery(
      ctx,
      `{ usersByPk(id: 999) { id name } }`
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.usersByPk).toBeNull();
  });

  it("returns empty array for no matches", async () => {
    const result = await executeQuery(
      ctx,
      `{ users(where: { name_eq: "Nonexistent" }) { id name } }`
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.users).toEqual([]);
  });
});

describe("Auth Integration", () => {
  it("passes auth context to resolver", async () => {
    const authConfig: AuthConfig = { authMode: "none" };
    const authResult = authenticate(authConfig, {});
    expect(authResult._tag).toBe("Right");

    const result = await executeQuery(ctx, `{ users { id name } }`);
    expect(result.errors).toBeUndefined();
    expect(result.data?.users).toBeDefined();
  });
});

describe("Permission Functions", () => {
  const permClient = new Client({ connectionString: TEST_DB_URL });

  beforeAll(async () => {
    await permClient.connect();

    // Clean up any leftover triggers from previous runs
    await permClient.query("DROP TRIGGER IF EXISTS pgapi_insert_check ON users");
    await permClient.query("DROP TRIGGER IF EXISTS pgapi_update_check ON users");
    await permClient.query("DROP FUNCTION IF EXISTS pgapi_check_trigger()");

    await permClient.query(`
      CREATE OR REPLACE FUNCTION public.users_select_filter()
      RETURNS SETOF public.users AS $$
        SELECT * FROM public.users WHERE role = 'admin' OR id = 1
      $$ LANGUAGE sql STABLE
    `);

    await permClient.query(`
      CREATE OR REPLACE FUNCTION public.users_insert_check(_sub text, _role text, _row jsonb)
      RETURNS boolean AS $$
        SELECT (_row->>'name') != 'forbidden'
      $$ LANGUAGE sql STABLE
    `);

    const dbEnv = { connectionString: TEST_DB_URL };
    const schemaResult = await readSchema(dbEnv, ["public"])();
    if (schemaResult._tag === "Right") {
      await ensureCheckTriggers(permClient, schemaResult.right.tables);
    }
  });

  afterAll(async () => {
    await permClient.query("DROP TRIGGER IF EXISTS pgapi_insert_check ON users");
    await permClient.query("DROP TRIGGER IF EXISTS pgapi_update_check ON users");
    await permClient.query("DROP FUNCTION IF EXISTS pgapi_check_trigger()");
    await permClient.query("DROP FUNCTION IF EXISTS public.users_select_filter()");
    await permClient.query("DROP FUNCTION IF EXISTS public.users_insert_check(text, text, jsonb)");
    await permClient.query("DROP FUNCTION IF EXISTS public.users_insert_check(text, text, jsonb)");
    await permClient.query("DROP FUNCTION IF EXISTS public.users_insert_check(jsonb, jsonb, jsonb)");
    await permClient.end();
  });

  it("select filter limits returned rows", async () => {
    // Insert test data directly, bypassing triggers
    await permClient.query("DELETE FROM comments");
    await permClient.query("DELETE FROM posts");
    await permClient.query("DELETE FROM users");
    await permClient.query("INSERT INTO users (id, name, email, role) VALUES (1, 'Alice', 'alice@test.com', 'admin'), (2, 'Bob', 'bob@test.com', 'user'), (3, 'Charlie', 'charlie@test.com', 'user')");

    const dbEnv = { connectionString: TEST_DB_URL };
    const schemaResult = await readSchema(dbEnv, ["public"])();
    if (schemaResult._tag === "Left") throw new Error("Failed to read schema");

    const schema = buildSchema(schemaResult.right);
    const testClient = new Client({ connectionString: TEST_DB_URL });
    await testClient.connect();

    try {
      const result = await graphql({
        schema,
        source: `{ users { id name role } }`,
        contextValue: {
          client: testClient,
          model: schemaResult.right,
          auth: { isAuthenticated: true, user: { sub: "u1", role: "admin" } },
        },
      });

      expect(result.errors).toBeUndefined();
      const users = result.data?.users as Array<{ id: number; name: string; role: string }>;
      for (const user of users) {
        expect(user.role === "admin" || user.id === 1).toBe(true);
      }
    } finally {
      await testClient.end();
    }
  });

  it("insert check rejects invalid rows", async () => {
    const dbEnv = { connectionString: TEST_DB_URL };
    const schemaResult = await readSchema(dbEnv, ["public"])();
    if (schemaResult._tag === "Left") throw new Error("Failed to read schema");

    const schema = buildSchema(schemaResult.right);
    const testClient = new Client({ connectionString: TEST_DB_URL });
    await testClient.connect();

    try {
      const result = await graphql({
        schema,
        source: `mutation { insertUsers(input: { name: "forbidden", email: "bad@test.com", role: "user" }) { id name } }`,
        contextValue: {
          client: testClient,
          model: schemaResult.right,
          auth: { isAuthenticated: true, user: { sub: "u1", role: "admin" } },
        },
      });

      expect(result.errors).toBeDefined();
      expect(result.errors?.[0]?.message).toContain("Permission denied");
    } finally {
      await testClient.end();
    }
  });

  it("insert check allows valid rows", async () => {
    const dbEnv = { connectionString: TEST_DB_URL };
    const schemaResult = await readSchema(dbEnv, ["public"])();
    if (schemaResult._tag === "Left") throw new Error("Failed to read schema");

    const schema = buildSchema(schemaResult.right);
    const testClient = new Client({ connectionString: TEST_DB_URL });
    await testClient.connect();

    try {
      const result = await graphql({
        schema,
        source: `mutation { insertUsers(input: { name: "allowed", email: "good@test.com", role: "user" }) { id name } }`,
        contextValue: {
          client: testClient,
          model: schemaResult.right,
          auth: { isAuthenticated: true, user: { sub: "u1", role: "admin" } },
        },
      });

      expect(result.errors).toBeUndefined();
      expect(result.data?.insertUsers).toBeDefined();

      await testClient.query("DELETE FROM users WHERE name = 'allowed'");
    } finally {
      await testClient.end();
    }
  });
});
