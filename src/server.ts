import { GraphQLSchema } from "graphql";
import { createServer, IncomingMessage, ServerResponse } from "http";
import * as TE from "fp-ts/TaskEither";

export interface ServerEnv {
  host: string;
  port: number;
  schema: GraphQLSchema;
  enableConsole: boolean;
}

const handleRequest = (env: ServerEnv) => async (
  req: IncomingMessage,
  res: ServerResponse
) => {
  const url = req.url || "/";

  if (url === "/graphql" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }
    try {
      const { graphql } = await import("graphql");
      const parsed = JSON.parse(body);
      const result = await graphql({ schema: env.schema, source: parsed.query, variableValues: parsed.variables });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
  } else if (url === "/console" && env.enableConsole) {
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
