import type { Server } from "http";
import { execute, getOperationAST, parse, subscribe } from "graphql";
import type { ExecutionResult } from "graphql";
import { WebSocket, WebSocketServer } from "ws";
import type { ServerEnv } from "./server";
import type { AuthContext } from "./auth";
import { authenticate, formatAuthError } from "./auth";
import { setSessionVariables } from "./permissions";
import { log } from "./logger";

const SUBPROTOCOL = "graphql-transport-ws";
const KEEPALIVE_INTERVAL_MS = 30_000;

interface SubscribePayload {
  query: string;
  operationName?: string;
  variables?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

type IncomingMessage =
  | { type: "connection_init"; payload?: Record<string, unknown> }
  | { type: "ping"; payload?: unknown }
  | { type: "pong"; payload?: unknown }
  | { type: "subscribe"; id?: string; payload?: SubscribePayload }
  | { type: "complete"; id?: string }
  | { type: "connection_terminate" };

type OutgoingMessage =
  | { type: "connection_ack"; payload?: Record<string, unknown> }
  | { type: "connection_error"; payload: unknown }
  | { type: "ping"; payload?: unknown }
  | { type: "pong"; payload?: unknown }
  | { type: "next"; id: string; payload: ExecutionResult }
  | { type: "error"; id: string; payload: unknown }
  | { type: "complete"; id: string };

interface Connection {
  ws: WebSocket;
  env: ServerEnv;
  auth: AuthContext | null;
  operations: Map<string, AsyncIterableIterator<unknown>>;
  closed: boolean;
}

const send = (ws: WebSocket, message: OutgoingMessage): void => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
};

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  typeof value === "object" && value !== null && Symbol.asyncIterator in value;

const extractHeaders = (payload?: Record<string, unknown>): Record<string, string | undefined> => {
  const headers: Record<string, string | undefined> = {};
  if (!payload) return headers;

  const rawHeaders = payload.headers;
  if (rawHeaders && typeof rawHeaders === "object") {
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (typeof value === "string") {
        headers[key.toLowerCase()] = value;
      }
    }
  }

  const authorization = payload.authorization;
  if (typeof authorization === "string") {
    headers.authorization = authorization;
  }

  return headers;
};

const handleConnectionInit = async (conn: Connection, payload?: Record<string, unknown>): Promise<void> => {
  const authResult = await authenticate(conn.env.authConfig, extractHeaders(payload));

  if (authResult._tag === "Left") {
    send(conn.ws, { type: "connection_error", payload: formatAuthError(authResult.left) });
    conn.ws.close(4401, "Unauthorized");
    return;
  }

  conn.auth = authResult.right;
  send(conn.ws, { type: "connection_ack" });

  if (conn.env.resolverContext.model.hasPermissions) {
    await setSessionVariables(conn.env.resolverContext.client, conn.auth);
  }
};

const runSubscription = async (conn: Connection, id: string, iterator: AsyncIterableIterator<unknown>): Promise<void> => {
  try {
    for await (const value of iterator) {
      if (conn.closed) break;
      send(conn.ws, { type: "next", id, payload: value as ExecutionResult });
    }
  } catch (e) {
    if (!conn.closed) {
      send(conn.ws, { type: "error", id, payload: [{ message: String(e) }] });
    }
  } finally {
    conn.operations.delete(id);
    if (!conn.closed) {
      send(conn.ws, { type: "complete", id });
    }
  }
};

const handleSubscribe = async (conn: Connection, id: string, payload: SubscribePayload): Promise<void> => {
  if (!conn.auth) {
    send(conn.ws, { type: "error", id, payload: [{ message: "Connection not established" }] });
    return;
  }

  const existing = conn.operations.get(id);
  if (existing) {
    existing.return?.();
    conn.operations.delete(id);
  }

  let document;
  try {
    document = parse(payload.query);
  } catch (e) {
    send(conn.ws, { type: "error", id, payload: [{ message: String(e) }] });
    return;
  }

  const operation = getOperationAST(document, payload.operationName);
  if (!operation) {
    send(conn.ws, { type: "error", id, payload: [{ message: "Could not determine the operation to execute" }] });
    return;
  }

  const contextValue = { ...conn.env.resolverContext, auth: conn.auth };

  if (operation.operation === "subscription") {
    if (!contextValue.subscriptions) {
      send(conn.ws, { type: "error", id, payload: [{ message: "Subscriptions are not enabled on this server" }] });
      return;
    }

    if (conn.env.resolverContext.model.hasPermissions) {
      await setSessionVariables(conn.env.resolverContext.client, conn.auth);
    }

    const result = await subscribe({
      schema: conn.env.schema,
      document,
      variableValues: payload.variables,
      operationName: payload.operationName,
      contextValue,
    });

    if (isAsyncIterable(result)) {
      conn.operations.set(id, result);
      void runSubscription(conn, id, result);
    } else {
      send(conn.ws, { type: "error", id, payload: result.errors ?? [] });
    }
    return;
  }

  const result = await execute({
    schema: conn.env.schema,
    document,
    variableValues: payload.variables,
    operationName: payload.operationName,
    contextValue,
  });
  send(conn.ws, { type: "next", id, payload: result });
  send(conn.ws, { type: "complete", id });
};

const handleComplete = (conn: Connection, id?: string): void => {
  if (!id) return;
  const iterator = conn.operations.get(id);
  if (iterator) {
    iterator.return?.();
    conn.operations.delete(id);
  }
};

const closeConnection = (conn: Connection): void => {
  conn.closed = true;
  for (const iterator of conn.operations.values()) {
    iterator.return?.();
  }
  conn.operations.clear();
};

const handleMessage = async (conn: Connection, message: IncomingMessage): Promise<void> => {
  switch (message.type) {
    case "connection_init":
      await handleConnectionInit(conn, message.payload);
      break;
    case "subscribe":
      if (message.id && message.payload) {
        await handleSubscribe(conn, message.id, message.payload);
      }
      break;
    case "complete":
      handleComplete(conn, message.id);
      break;
    case "ping":
      send(conn.ws, { type: "pong", payload: message.payload });
      break;
    case "pong":
      break;
    case "connection_terminate":
      conn.ws.close();
      break;
    default:
      break;
  }
};

export const attachWebSocketServer = (server: Server, env: ServerEnv): void => {
  const wss = new WebSocketServer({
    server,
    path: "/graphql",
    handleProtocols: (protocols) => (protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false),
  });

  wss.on("connection", (ws) => {
    const conn: Connection = {
      ws,
      env,
      auth: null,
      operations: new Map(),
      closed: false,
    };

    const keepAlive = setInterval(() => {
      send(ws, { type: "ping" });
    }, KEEPALIVE_INTERVAL_MS);

    ws.on("message", (data) => {
      let message: IncomingMessage;
      try {
        message = JSON.parse(data.toString()) as IncomingMessage;
      } catch {
        ws.close(1002, "Invalid message");
        return;
      }
      void handleMessage(conn, message);
    });

    ws.on("close", () => {
      clearInterval(keepAlive);
      closeConnection(conn);
    });

    ws.on("error", () => {
      clearInterval(keepAlive);
      closeConnection(conn);
    });
  });

  log.info("GraphQL WebSocket subscription endpoint ready", { path: "/graphql", subprotocol: SUBPROTOCOL });
};
