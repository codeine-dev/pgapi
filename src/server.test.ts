import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GraphQLSchema, GraphQLObjectType, GraphQLString } from "graphql";
import http from "http";
import { createRequestHandler } from "./server";
import { Client } from "pg";
import type { ResolverContext } from "./resolver";
import type { ServerEnv } from "./server";

const PORT = 9876;
const AUTH_PORT = 9877;
const CONSOLE_PORT = 9878;

const testSchema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: "Query",
    fields: {
      hello: {
        type: GraphQLString,
        resolve: () => "world",
      },
      echo: {
        type: GraphQLString,
        args: { message: { type: GraphQLString } },
        resolve: (_, args) => args.message as string,
      },
    },
  }),
  mutation: new GraphQLObjectType({
    name: "Mutation",
    fields: {
      setValue: {
        type: GraphQLString,
        args: { value: { type: GraphQLString } },
        resolve: (_, args) => args.value as string,
      },
    },
  }),
});

const resolverContext: ResolverContext = {
  client: {} as Client,
  model: { tables: [], views: [], foreignKeys: [], enums: {}, hasPermissions: false },
};

let server: http.Server;
let authServer: http.Server;
let consoleServer: http.Server;

const makeRequest = (
  method: string,
  port: number,
  path: string,
  body?: object,
  headers?: Record<string, string>
): Promise<{ status: number; headers: http.IncomingHttpHeaders; data: unknown }> =>
  new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = { ...headers };
    if (payload) {
      reqHeaders["Content-Type"] = "application/json";
      reqHeaders["Content-Length"] = Buffer.byteLength(payload).toString();
    }
    const req = http.request(
      `http://localhost:${port}${path}`,
      { method, headers: reqHeaders },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, data: parsed });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });

beforeAll(() => {
  const env: ServerEnv = {
    host: "localhost",
    port: PORT,
    schema: testSchema,
    enableConsole: false,
    resolverContext,
    authConfig: { authMode: "none" },
  };

  server = http.createServer(createRequestHandler(env));
  server.listen(PORT);

  const authEnv: ServerEnv = {
    host: "localhost",
    port: AUTH_PORT,
    schema: testSchema,
    enableConsole: false,
    resolverContext,
    authConfig: { authMode: "required", jwtSecret: "secret" },
  };

  authServer = http.createServer(createRequestHandler(authEnv));
  authServer.listen(AUTH_PORT);

  const consoleEnv: ServerEnv = {
    host: "localhost",
    port: CONSOLE_PORT,
    schema: testSchema,
    enableConsole: true,
    resolverContext,
    authConfig: { authMode: "none" },
  };

  consoleServer = http.createServer(createRequestHandler(consoleEnv));
  consoleServer.listen(CONSOLE_PORT);
});

afterAll(() => {
  server?.close();
  authServer?.close();
  consoleServer?.close();
});

describe("QUERY method", () => {
  it("accepts a simple query via QUERY", async () => {
    const res = await makeRequest("QUERY", PORT, "/graphql", { query: "{ hello }" });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ data: { hello: "world" } });
  });

  it("sets Cache-Control header on QUERY responses", async () => {
    const res = await makeRequest("QUERY", PORT, "/graphql", { query: "{ hello }" });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, no-cache");
  });

  it("accepts variables in QUERY requests", async () => {
    const res = await makeRequest("QUERY", PORT, "/graphql", {
      query: "query ($msg: String!) { echo(message: $msg) }",
      variables: { msg: "hi" },
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ data: { echo: "hi" } });
  });

  it("accepts operationName in QUERY requests", async () => {
    const res = await makeRequest("QUERY", PORT, "/graphql", {
      query: "query MyQuery { hello }",
      operationName: "MyQuery",
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ data: { hello: "world" } });
  });

  it("rejects mutations via QUERY method", async () => {
    const res = await makeRequest("QUERY", PORT, "/graphql", {
      query: "mutation { setValue(value: \"test\") }",
    });
    expect(res.status).toBe(405);
    expect(res.data).toHaveProperty("error");
    expect((res.data as { error: string }).error).toContain("mutation");
  });

  it("rejects queries that contain a mix of query and mutation", async () => {
    const res = await makeRequest("QUERY", PORT, "/graphql", {
      query: "query Q1 { hello } mutation M1 { setValue(value: \"x\") }",
    });
    expect(res.status).toBe(405);
    expect((res.data as { error: string }).error).toContain("mutation");
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await new Promise<{ status: number; data: unknown }>((resolve, reject) => {
      const req = http.request(
        `http://localhost:${PORT}/graphql`,
        { method: "QUERY", headers: { "Content-Type": "application/json" } },
        (res) => {
          let data = "";
          res.on("data", (chunk: string) => (data += chunk));
          res.on("end", () => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = data;
            }
            resolve({ status: res.statusCode ?? 0, data: parsed });
          });
        }
      );
      req.on("error", reject);
      req.write("not valid json");
      req.end();
    });
    expect(res.status).toBe(400);
    expect(res.data).toHaveProperty("error");
  });

  it("returns 400 for empty body", async () => {
    const res = await makeRequest("QUERY", PORT, "/graphql", {});
    expect(res.status).toBe(400);
    expect(res.data).toHaveProperty("error");
  });

  it("returns 401 when auth is required and no credentials", async () => {
    const res = await makeRequest("QUERY", AUTH_PORT, "/graphql", { query: "{ hello }" });
    expect(res.status).toBe(401);
  });

  it("accepts authenticated QUERY with valid token", async () => {
    const token =
      Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url") +
      "." +
      Buffer.from(JSON.stringify({ sub: "u1" })).toString("base64url") +
      ".";

    const res = await makeRequest("QUERY", AUTH_PORT, "/graphql", { query: "{ hello }" }, {
      Authorization: `Bearer ${token}`,
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ data: { hello: "world" } });
  });
});

describe("GET method still works", () => {
  it("accepts queries via GET", async () => {
    const res = await makeRequest("GET", PORT, "/graphql?query={hello}");
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ data: { hello: "world" } });
  });
});

describe("console and static files", () => {
  const getText = async (path: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; data: string }> => {
    const res = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; data: string }>((resolve, reject) => {
      const req = http.request(`http://localhost:${CONSOLE_PORT}${path}`, { method: "GET" }, (res) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, data }));
      });
      req.on("error", reject);
      req.end();
    });
    return res;
  };

  it("/console returns HTML with GraphiQL references", async () => {
    const res = await getText("/console");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.data).toContain("GraphiQL");
    expect(res.data).toContain("/_static/react.js");
    expect(res.data).toContain("/_static/react-dom.js");
    expect(res.data).toContain("/_static/graphiql.css");
  });

  it("serves react.js static file", async () => {
    const res = await getText("/_static/react.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/javascript");
    expect(res.data.length).toBeGreaterThan(1000);
  });

  it("serves react-dom.js static file", async () => {
    const res = await getText("/_static/react-dom.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/javascript");
    expect(res.data.length).toBeGreaterThan(1000);
  });

  it("serves graphiql.js static file", async () => {
    const res = await getText("/_static/graphiql.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/javascript");
    expect(res.data.length).toBeGreaterThan(1000);
  });

  it("serves graphiql.css static file", async () => {
    const res = await getText("/_static/graphiql.css");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/css");
    expect(res.data).toContain("graphiql");
  });

  it("returns 404 for unknown static file", async () => {
    const res = await getText("/_static/nonexistent.js");
    expect(res.status).toBe(404);
  });

  it("/graphql still works with console enabled", async () => {
    const res = await makeRequest("GET", CONSOLE_PORT, "/graphql?query={hello}");
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ data: { hello: "world" } });
  });
});

describe("POST method still works", () => {
  it("accepts queries via POST", async () => {
    const res = await makeRequest("POST", PORT, "/graphql", { query: "{ hello }" });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ data: { hello: "world" } });
  });

  it("accepts mutations via POST", async () => {
    const res = await makeRequest("POST", PORT, "/graphql", {
      query: "mutation { setValue(value: \"hello\") }",
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ data: { setValue: "hello" } });
  });

  it("does not set Cache-Control on POST responses", async () => {
    const res = await makeRequest("POST", PORT, "/graphql", { query: "{ hello }" });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBeUndefined();
  });
});
