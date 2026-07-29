import { GraphQLSchema, graphql, parse, type OperationDefinitionNode } from "graphql";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import * as TE from "fp-ts/TaskEither";
import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import { pipe } from "fp-ts/function";
import type { ResolverContext } from "./resolver";
import { log, logRequest } from "./logger";
import { authenticate, formatAuthError, type AuthConfig, type AuthContext } from "./auth";
import { setSessionVariables } from "./permissions";

export interface ServerEnv {
  host: string;
  port: number;
  schema: GraphQLSchema;
  enableConsole: boolean;
  resolverContext: ResolverContext;
  authConfig: AuthConfig;
}

type RequestError =
  | { _tag: "ParseError"; message: string }
  | { _tag: "GraphqlError"; message: string }
  | { _tag: "MutationError"; message: string };

const readBody = (req: IncomingMessage): TE.TaskEither<RequestError, string> =>
  TE.tryCatch(
    async () => {
      let body = "";
      for await (const chunk of req) {
        body += chunk as string;
      }
      return body;
    },
    (e) => ({ _tag: "ParseError" as const, message: String(e) })
  );

const parseJson = (body: string): TE.TaskEither<RequestError, { query?: string; variables?: Record<string, unknown>; operationName?: string }> =>
  TE.tryCatch(
    () => Promise.resolve(JSON.parse(body) as { query?: string; variables?: Record<string, unknown>; operationName?: string }),
    (e) => ({ _tag: "ParseError" as const, message: String(e) })
  );

const parseQueryParams = (url: string): { query?: string; variables?: Record<string, unknown>; operationName?: string } => {
  const questionMark = url.indexOf("?");
  if (questionMark === -1) return {};

  const searchParams = new URLSearchParams(url.slice(questionMark + 1));
  const query = searchParams.get("query") ?? undefined;
  const variablesStr = searchParams.get("variables") ?? undefined;
  const operationName = searchParams.get("operationName") ?? undefined;

  let variables: Record<string, unknown> | undefined;
  if (variablesStr) {
    try {
      variables = JSON.parse(variablesStr) as Record<string, unknown>;
    } catch {
      // ignore invalid variables
    }
  }

  return { query, variables, operationName };
};

const executeGraphql = (env: ServerEnv, authContext: AuthContext) => (parsed: { query?: string; variables?: Record<string, unknown>; operationName?: string }): TE.TaskEither<RequestError, unknown> =>
  TE.tryCatch(
    async () => {
      if (env.resolverContext.model.hasPermissions) {
        await setSessionVariables(env.resolverContext.client, authContext);
      }

      return graphql({
        schema: env.schema,
        source: parsed.query ?? "",
        variableValues: parsed.variables,
        operationName: parsed.operationName,
        contextValue: { ...env.resolverContext, auth: authContext },
      });
    },
    (e) => ({ _tag: "GraphqlError" as const, message: String(e) })
  );

const validateQueryOperation = (parsed: { query?: string }): E.Either<RequestError, void> => {
  if (!parsed.query) {
    return E.left({ _tag: "ParseError", message: "query is required" });
  }

  try {
    const document = parse(parsed.query);
    const operations = document.definitions.filter(
      (def): def is OperationDefinitionNode => def.kind === "OperationDefinition"
    );

    for (const op of operations) {
      if (op.operation !== "query") {
        return E.left({
          _tag: "MutationError",
          message: `QUERY method only supports query operations, not ${op.operation}`,
        });
      }
    }

    return E.right(undefined);
  } catch (e) {
    return E.left({ _tag: "ParseError", message: String(e) });
  }
};

const extractHeaders = (req: IncomingMessage): Record<string, string | undefined> => {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key] = Array.isArray(value) ? value[0] : value;
  }
  return headers;
};

const handleGraphqlPost = async (env: ServerEnv, req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const headers = extractHeaders(req);
  const authResult = await authenticate(env.authConfig, headers);

  if (E.isLeft(authResult)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: formatAuthError(authResult.left) }));
    return;
  }

  const authContext = authResult.right;

  pipe(
    readBody(req),
    TE.chain(parseJson),
    TE.chain(executeGraphql(env, authContext)),
    TE.match(
      (error) => {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      },
      (result) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      }
    )
  )();
};

const handleGraphqlGet = async (env: ServerEnv, req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = req.url ?? "/";
  const parsed = parseQueryParams(url);

  if (!parsed.query) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "query parameter is required" }));
    return;
  }

  const headers = extractHeaders(req);
  const authResult = await authenticate(env.authConfig, headers);

  if (E.isLeft(authResult)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: formatAuthError(authResult.left) }));
    return;
  }

  const authContext = authResult.right;

  pipe(
    executeGraphql(env, authContext)(parsed),
    TE.match(
      (error) => {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      },
      (result) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      }
    )
  )();
};

const handleGraphqlQuery = async (env: ServerEnv, req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const headers = extractHeaders(req);
  const authResult = await authenticate(env.authConfig, headers);

  if (E.isLeft(authResult)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: formatAuthError(authResult.left) }));
    return;
  }

  const authContext = authResult.right;

  pipe(
    readBody(req),
    TE.chain(parseJson),
    TE.chainFirst((parsed) => TE.fromEither(validateQueryOperation(parsed))),
    TE.chain(executeGraphql(env, authContext)),
    TE.match(
      (error) => {
        const status = error._tag === "MutationError" ? 405 : 400;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      },
      (result) => {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "public, no-cache",
        });
        res.end(JSON.stringify(result));
      }
    )
  )();
};

function findNmdir(): string {
  const candidates: string[] = [];
  if (import.meta.dir) candidates.push(join(import.meta.dir, "..", "node_modules"));
  candidates.push(join(process.cwd(), "node_modules"));
  const binDir = process.argv[0] ? dirname(process.argv[0]) : undefined;
  if (binDir) candidates.push(join(binDir, "node_modules"));
  for (const dir of candidates) {
    if (existsSync(join(dir, "react", "package.json"))) {
      return dir;
    }
  }
  return candidates[0]!;
}

const nmDir = findNmdir();

const staticFiles: Record<string, { content: Buffer; contentType: string }> = {
  "/_static/react.js": {
    content: readFileSync(join(nmDir, "react", "umd", "react.production.min.js")),
    contentType: "application/javascript",
  },
  "/_static/react-dom.js": {
    content: readFileSync(join(nmDir, "react-dom", "umd", "react-dom.production.min.js")),
    contentType: "application/javascript",
  },
  "/_static/graphiql.js": {
    content: readFileSync(join(nmDir, "graphiql", "graphiql.min.js")),
    contentType: "application/javascript",
  },
  "/_static/graphiql.css": {
    content: readFileSync(join(nmDir, "graphiql", "graphiql.min.css")),
    contentType: "text/css",
  },
};

const handleStaticRequest = (res: ServerResponse, path: string): boolean => {
  const file = staticFiles[path];
  if (!file) return false;
  res.writeHead(200, { "Content-Type": file.contentType });
  res.end(file.content);
  return true;
};

const handleConsoleRequest = (res: ServerResponse): void => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html>
<html>
<head><title>GraphiQL</title>
<link rel="stylesheet" href="/_static/graphiql.css" />
</head>
<body style="margin:0"><div id="graphiql" style="height:100vh;"></div>
<script src="/_static/react.js"></script>
<script src="/_static/react-dom.js"></script>
<script src="/_static/graphiql.js"></script>
<script>
const fetcher = GraphiQL.createFetcher({ url: '/graphql' });
ReactDOM.render(React.createElement(GraphiQL, { fetcher, shouldPersistHeaders: true }), document.getElementById('graphiql'));
</script></body></html>`);
};

export const createRequestHandler = (env: ServerEnv) => (req: IncomingMessage, res: ServerResponse) => {
  const startTime = Date.now();
  const url = pipe(O.fromNullable(req.url), O.getOrElse(() => "/"));
  const path = url.split("?")[0] ?? url;

  const onFinish = () => {
    const duration = Date.now() - startTime;
    logRequest({ method: req.method ?? "UNKNOWN", path, status: res.statusCode, durationMs: duration });
  };

  res.on("finish", onFinish);

  if (path === "/graphql" && req.method === "POST") {
    handleGraphqlPost(env, req, res);
  } else if (path === "/graphql" && req.method === "QUERY") {
    handleGraphqlQuery(env, req, res);
  } else if (path === "/graphql" && req.method === "GET") {
    handleGraphqlGet(env, req, res);
  } else if (path === "/console" && env.enableConsole) {
    handleConsoleRequest(res);
  } else if (path.startsWith("/_static/")) {
    if (!handleStaticRequest(res, path)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }
};

export const startServer = (env: ServerEnv): TE.TaskEither<Error, void> =>
  TE.tryCatch(
    () =>
      new Promise<void>((resolve, reject) => {
        const server = createServer(createRequestHandler(env));

        const shutdown = () => {
          log.info("Shutting down...");
          server.close(() => {
            log.info("Server closed");
            resolve();
          });
          setTimeout(() => {
            log.error("Forced shutdown after timeout");
            process.exit(1);
          }, 5000);
        };

        process.on("SIGTERM", shutdown);
        process.on("SIGINT", shutdown);

        server.listen(env.port, env.host, () => {
          log.info("Server started", {
            host: env.host,
            port: env.port,
            graphql: `http://${env.host}:${env.port}/graphql`,
            console: env.enableConsole ? `http://${env.host}:${env.port}/console` : undefined,
          });
        });

        server.on("error", (err) => {
          log.error("Server error", { error: String(err) });
          reject(err);
        });
      }),
    (e) => (e instanceof Error ? e : new Error(String(e)))
  );
