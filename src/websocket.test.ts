import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "http";
import type { Server as HttpServer } from "http";
import { WebSocket } from "ws";
import type { Client } from "pg";
import { createRequestHandler, type ServerEnv } from "./server";
import { attachWebSocketServer } from "./websocket";
import { buildSchema } from "./graphql";
import type { SchemaModel } from "./schema";
import { createFakePgClient, createFakeSubscriptionManager, publishChange } from "./test-support";

const PORT = 9887;
const AUTH_PORT = 9888;

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

const model = usersModel();

interface WsClient {
  ws: WebSocket;
  send: (msg: unknown) => void;
  waitForMessage: (timeoutMs?: number) => Promise<Record<string, unknown>>;
  close: () => void;
}

const createWsClient = (port: number): WsClient => {
  const messages: Record<string, unknown>[] = [];
  const waiters: Array<(msg: Record<string, unknown>) => void> = [];

  const ws = new WebSocket(`ws://localhost:${port}/graphql`, ["graphql-transport-ws"]);
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as Record<string, unknown>;
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else messages.push(msg);
  });

  return {
    ws,
    send: (msg) => ws.send(JSON.stringify(msg)),
    waitForMessage: (timeoutMs = 2000) => {
      const queued = messages.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for websocket message")), timeoutMs);
        waiters.push((msg) => {
          clearTimeout(timer);
          resolve(msg);
        });
      });
    },
    close: () => ws.close(),
  };
};

const open = (client: WsClient): Promise<void> =>
  new Promise((resolve, reject) => {
    client.ws.once("open", resolve);
    client.ws.once("error", reject);
  });

const settle = (ms = 100): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let server: HttpServer;
let authServer: HttpServer;
let pgClient: ReturnType<typeof createFakePgClient>;

const buildEnv = (port: number, authConfig: ServerEnv["authConfig"]): ServerEnv => ({
  host: "localhost",
  port,
  schema: buildSchema(model),
  enableConsole: false,
  resolverContext: {
    client: pgClient as unknown as Client,
    model,
    auth: { isAuthenticated: false },
    subscriptions: undefined,
  },
  authConfig,
});

beforeAll(async () => {
  const { manager, client } = await createFakeSubscriptionManager();
  pgClient = client;

  const env = buildEnv(PORT, { authMode: "none" });
  env.resolverContext.subscriptions = manager;
  server = createServer(createRequestHandler(env));
  attachWebSocketServer(server, env);
  server.listen(PORT);

  const authEnv = buildEnv(AUTH_PORT, { authMode: "required", jwtSecret: "secret" });
  const authManager = manager;
  authEnv.resolverContext.subscriptions = authManager;
  authServer = createServer(createRequestHandler(authEnv));
  attachWebSocketServer(authServer, authEnv);
  authServer.listen(AUTH_PORT);
});

afterAll(() => {
  server?.close();
  authServer?.close();
});

describe("graphql-transport-ws protocol", () => {
  it("acknowledges connection_init", async () => {
    const client = createWsClient(PORT);
    await open(client);
    client.send({ type: "connection_init" });
    const ack = await client.waitForMessage();
    expect(ack.type).toBe("connection_ack");
    client.close();
  });

  it("delivers subscription events as next messages", async () => {
    const client = createWsClient(PORT);
    await open(client);
    client.send({ type: "connection_init" });
    await client.waitForMessage();

    client.send({
      type: "subscribe",
      id: "1",
      payload: { query: "subscription { usersChanged { id name } }" },
    });

    await settle();
    publishChange(pgClient, {
      schema: "public",
      table: "users",
      operation: "INSERT",
      row: { id: 5, name: "Eve" },
    });

    const next = await client.waitForMessage();
    expect(next.type).toBe("next");
    expect(next.id).toBe("1");
    expect(next.payload).toEqual({ data: { usersChanged: { id: 5, name: "Eve" } } });
    client.close();
  });

  it("filters events by the event argument over the wire", async () => {
    const client = createWsClient(PORT);
    await open(client);
    client.send({ type: "connection_init" });
    await client.waitForMessage();

    client.send({
      type: "subscribe",
      id: "1",
      payload: { query: "subscription { usersChanged(event: DELETE) { id } }" },
    });

    await settle();
    publishChange(pgClient, {
      schema: "public",
      table: "users",
      operation: "INSERT",
      row: { id: 1 },
    });

    publishChange(pgClient, {
      schema: "public",
      table: "users",
      operation: "DELETE",
      row: { id: 2 },
    });

    const next = await client.waitForMessage();
    expect(next.payload).toEqual({ data: { usersChanged: { id: 2 } } });
    client.close();
  });

  it("executes queries and mutations over the websocket", async () => {
    const client = createWsClient(PORT);
    await open(client);
    client.send({ type: "connection_init" });
    await client.waitForMessage();

    client.send({ type: "subscribe", id: "q1", payload: { query: "{ users { id } }" } });
    const next = await client.waitForMessage();
    expect(next.type).toBe("next");
    expect(next.payload).toEqual({ data: { users: [] } });
    const complete = await client.waitForMessage();
    expect(complete.type).toBe("complete");
    expect(complete.id).toBe("q1");
    client.close();
  });

  it("completes a subscription when the client requests it", async () => {
    const client = createWsClient(PORT);
    await open(client);
    client.send({ type: "connection_init" });
    await client.waitForMessage();

    client.send({
      type: "subscribe",
      id: "s1",
      payload: { query: "subscription { usersChanged { id } }" },
    });
    await settle();
    client.send({ type: "complete", id: "s1" });

    const complete = await client.waitForMessage();
    expect(complete.type).toBe("complete");
    expect(complete.id).toBe("s1");
    client.close();
  });

  it("responds to ping with pong", async () => {
    const client = createWsClient(PORT);
    await open(client);
    client.send({ type: "ping", payload: "hello" });
    const pong = await client.waitForMessage();
    expect(pong.type).toBe("pong");
    expect(pong.payload).toBe("hello");
    client.close();
  });

  it("returns an error for subscribe before connection_init", async () => {
    const client = createWsClient(PORT);
    await open(client);
    client.send({ type: "subscribe", id: "1", payload: { query: "{ users { id } }" } });
    const error = await client.waitForMessage();
    expect(error.type).toBe("error");
    client.close();
  });

  it("rejects invalid JSON with a protocol close", async () => {
    const client = createWsClient(PORT);
    await open(client);
    const closed = new Promise<number>((resolve) => client.ws.on("close", (code) => resolve(code)));
    client.ws.send("not json");
    const code = await closed;
    expect(code).toBe(1002);
  });
});

describe("websocket authentication", () => {
  const validToken = () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "u1" })).toString("base64url");
    return `${header}.${payload}.`;
  };

  it("rejects a connection without credentials when auth is required", async () => {
    const client = createWsClient(AUTH_PORT);
    await open(client);
    client.send({ type: "connection_init" });
    const error = await client.waitForMessage();
    expect(error.type).toBe("connection_error");
    const closed = await new Promise<number>((resolve) => client.ws.on("close", (code) => resolve(code)));
    expect(closed).toBe(4401);
  });

  it("authenticates from connection_init headers", async () => {
    const client = createWsClient(AUTH_PORT);
    await open(client);
    client.send({
      type: "connection_init",
      payload: { headers: { Authorization: `Bearer ${validToken()}` } },
    });
    const ack = await client.waitForMessage();
    expect(ack.type).toBe("connection_ack");
    client.close();
  });
});
