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
import { ensureCheckTriggers } from "./permissions";
import { fetchOidcConfig, fetchJwks, refreshOidcJwks } from "./auth";
import type { SchemaModel } from "./schema";
import type { AuthConfig, OidcConfig } from "./auth";

const run = (): TE.TaskEither<Error, void> => {
  setLogLevel("info");

  return pipe(
    TE.fromEither(pipe(
      parseArgs(process.argv),
      E.mapLeft((msg: string) => new Error(msg)),
    )),
    TE.chain((args) => {
      const dbEnv = { connectionString: args.connectionString };
      log.info("pgapi - Postgres GraphQL API");

      let client: Client | undefined;

      const fetchOidc = (): TE.TaskEither<Error, OidcConfig | undefined> => {
        if (!args.oauthIssuer) return TE.right(undefined);
        return pipe(
          fetchOidcConfig(args.oauthIssuer),
          TE.chain(({ jwksUri, issuer }) =>
            pipe(
              fetchJwks(jwksUri),
              TE.map((jwks) => ({
                issuer,
                jwks,
                jwksUri,
                audience: args.oauthAudience,
                clockSkew: args.oauthClockSkew,
              }))
            )
          )
        );
      };

      return pipe(
        TE.Do,
        TE.bind("schemaModel", () => readSchema(dbEnv, args.schemas)),
        TE.bind("client", () => createClient(dbEnv)),
        TE.chain(({ schemaModel, client: c }) =>
          pipe(
            TE.tryCatch(
              () => ensureCheckTriggers(c, schemaModel.tables),
              (e) => (e instanceof Error ? e : new Error(String(e)))
            ),
            TE.map(() => ({ schemaModel, client: c }))
          )
        ),
        TE.bind("graphqlSchema", ({ schemaModel }) => TE.right(buildSchema(schemaModel))),
        TE.bind("oauthConfig", () => fetchOidc()),
        TE.chain(({ graphqlSchema, client: c, schemaModel, oauthConfig }) => {
          client = c;
          const authConfig: AuthConfig = {
            jwtSecret: args.jwtSecret,
            apiKeyHeader: args.apiKeyHeader,
            authMode: args.authMode,
            oauthConfig: oauthConfig ?? undefined,
          };

          if (oauthConfig) {
            const refreshInterval = 60 * 60 * 1000;
            setInterval(async () => {
              const result = await refreshOidcJwks(oauthConfig)();
              if (E.isLeft(result)) {
                log.warn("Failed to refresh JWKS", { error: result.left.message });
              } else {
                log.info("JWKS refreshed successfully");
              }
            }, refreshInterval);
            log.info("JWKS refresh scheduled", { intervalMs: refreshInterval });
          }

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
