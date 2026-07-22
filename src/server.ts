import { GraphQLSchema, graphql } from "graphql";
import { createServer, IncomingMessage, ServerResponse } from "http";
import * as TE from "fp-ts/TaskEither";
import * as O from "fp-ts/Option";
import { pipe } from "fp-ts/function";
import type { ResolverContext } from "./resolver";

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

const handleGraphqlRequest = (env: ServerEnv, req: IncomingMessage, res: ServerResponse): void => {
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
  const url = pipe(O.fromNullable(req.url), O.getOrElse(() => "/"));

  if (url === "/graphql" && req.method === "POST") {
    handleGraphqlRequest(env, req, res);
  } else if (url === "/console" && env.enableConsole) {
    handleConsoleRequest(res);
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
};

export const startServer = (env: ServerEnv): TE.TaskEither<Error, void> =>
  TE.tryCatch(
    () =>
      new Promise((resolve, reject) => {
        const server = createServer(handleRequest(env));
        server.listen(env.port, env.host, () => {
          console.log(`Server running at http://${env.host}:${env.port}`);
          console.log(`GraphQL endpoint: http://${env.host}:${env.port}/graphql`);
          if (env.enableConsole) {
            console.log(`GraphiQL console: http://${env.host}:${env.port}/console`);
          }
          resolve();
        });
        server.on("error", reject);
      }),
    (e) => (e instanceof Error ? e : new Error(String(e)))
  );
