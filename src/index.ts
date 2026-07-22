import { Client } from "pg";
import { pipe } from "fp-ts/function";
import * as E from "fp-ts/Either";
import * as TE from "fp-ts/TaskEither";
import { parseArgs } from "./cli";
import { readSchema } from "./schema";
import { buildSchema } from "./graphql";
import { startServer } from "./server";
import { createClient } from "./db";
import { log, setLogLevel } from "./logger";
import type { SchemaModel } from "./schema";
import type { AuthConfig } from "./auth";

const run = (): TE.TaskEither<Error, void> => {
  setLogLevel("info");

  return pipe(
    TE.fromEither(pipe(
      parseArgs(process.argv),
      E.mapLeft((msg: string) => new Error(msg)),
    )),
    TE.chain((args) => {
      const dbEnv = { connectionString: args.connectionString };
      const authConfig: AuthConfig = {
        jwtSecret: args.jwtSecret,
        apiKeyHeader: args.apiKeyHeader,
        authMode: args.authMode,
      };
      log.info("pgapi - Postgres GraphQL API");

      let client: Client | undefined;

      return pipe(
        TE.Do,
        TE.bind("schemaModel", () => readSchema(dbEnv, args.schemas)),
        TE.bind("client", () => createClient(dbEnv)),
        TE.bind("graphqlSchema", ({ schemaModel }) => TE.right(buildSchema(schemaModel))),
        TE.chain(({ graphqlSchema, client: c, schemaModel }) => {
          client = c;
          return startServer({
            host: args.host,
            port: args.port,
            schema: graphqlSchema,
            enableConsole: args.console,
            resolverContext: { client: c, model: schemaModel, auth: { isAuthenticated: false } },
            authConfig,
          });
        }),
        TE.orElse((error): TE.TaskEither<Error, void> =>
          TE.fromIO(() => {
            log.error("Startup failed", { error: error.message || String(error) });
            if (client) {
              client.end().catch(() => {});
            }
            process.exit(1);
          })
        )
      );
    }),
    TE.orElse((error): TE.TaskEither<Error, void> =>
      TE.fromIO(() => {
        log.error("Startup failed", { error: error.message || String(error) });
        process.exit(1);
      })
    )
  );
};

run()();
