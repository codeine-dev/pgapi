import { GraphQLSchema, graphql } from "graphql";
import { createServer, IncomingMessage, ServerResponse } from "http";
import * as TE from "fp-ts/TaskEither";
import * as O from "fp-ts/Option";
import { pipe } from "fp-ts/function";
import type { ResolverContext } from "./resolver";
import { log, logRequest } from "./logger";

export interface ServerEnv {
  host: string;
  port: number;
  schema: GraphQLSchema;
  enableConsole: boolean;
  resolverContext: ResolverContext;
}

type RequestError =
  | { _tag: "ParseError"; message: string }
  | { _tag: "GraphqlError"; message: string };

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

const parseJson = (body: string): TE.TaskEither<RequestError, { query?: string; variables?: Record<string, unknown> }> =>
  TE.tryCatch(
    () => Promise.resolve(JSON.parse(body) as { query?: string; variables?: Record<string, unknown> }),
    (e) => ({ _tag: "ParseError" as const, message: String(e) })
  );

const parseQueryParams = (url: string): { query?: string; variables?: Record<string, unknown> } => {
  const questionMark = url.indexOf("?");
  if (questionMark === -1) return {};

  const searchParams = new URLSearchParams(url.slice(questionMark + 1));
  const query = searchParams.get("query") ?? undefined;
  const variablesStr = searchParams.get("variables") ?? undefined;

  let variables: Record<string, unknown> | undefined;
  if (variablesStr) {
    try {
      variables = JSON.parse(variablesStr) as Record<string, unknown>;
    } catch {
      // ignore invalid variables
    }
  }

  return { query, variables };
};

const executeGraphql = (env: ServerEnv) => (parsed: { query?: string; variables?: Record<string, unknown> }): TE.TaskEither<RequestError, unknown> =>
  TE.tryCatch(
    () =>
      graphql({
        schema: env.schema,
        source: parsed.query ?? "",
        variableValues: parsed.variables,
        contextValue: env.resolverContext,
      }),
    (e) => ({ _tag: "GraphqlError" as const, message: String(e) })
  );

const handleGraphqlPost = (env: ServerEnv, req: IncomingMessage, res: ServerResponse): void => {
  pipe(
    readBody(req),
    TE.chain(parseJson),
    TE.chain(executeGraphql(env)),
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

const handleGraphqlGet = (env: ServerEnv, req: IncomingMessage, res: ServerResponse): void => {
  const url = req.url ?? "/";
  const parsed = parseQueryParams(url);

  if (!parsed.query) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "query parameter is required" }));
    return;
  }

  pipe(
    executeGraphql(env)(parsed),
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

const handleConsoleRequest = (res: ServerResponse): void => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!DOCTYPE html>
<html>
<head><title>GraphiQL</title>
<link href="https://unpkg.com/graphiql/graphiql.min.css" rel="stylesheet" />
</head>
<body style="margin:0"><div id="graphiql" style="height:100vh;"></div>
<script crossorigin src="https://unpkg.com/react/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom/umd/react-dom.production.min.js"></script>
<script crossorigin src="https://unpkg.com/graphiql/graphiql.min.js"></script>
<script>
const fetcher = GraphiQL.createFetcher({ url: '/graphql' });
ReactDOM.render(React.createElement(GraphiQL, { fetcher }), document.getElementById('graphiql'));
</script></body></html>`);
};

const handleRequest = (env: ServerEnv) => (req: IncomingMessage, res: ServerResponse) => {
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
  } else if (path === "/graphql" && req.method === "GET") {
    handleGraphqlGet(env, req, res);
  } else if (path === "/console" && env.enableConsole) {
    handleConsoleRequest(res);
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }
};

export const startServer = (env: ServerEnv): TE.TaskEither<Error, void> =>
  TE.tryCatch(
    () =>
      new Promise<void>((resolve, reject) => {
        const server = createServer(handleRequest(env));

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
