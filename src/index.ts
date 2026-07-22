import { pipe } from "fp-ts/function";
import * as TE from "fp-ts/TaskEither";
import { parseArgs } from "./cli";
import { readSchema } from "./schema";
import { buildSchema } from "./graphql";
import { startServer } from "./server";
import { createClient } from "./db";
import type { SchemaModel } from "./schema";

const run = (): TE.TaskEither<Error, void> => {
  const parsed = parseArgs(process.argv);
  if (parsed._tag === "Left") return TE.left(new Error(parsed.left));

  const args = parsed.right;
  const dbEnv = { connectionString: args.connectionString };

  console.log("pgapi - Postgres GraphQL API");
  console.log("---");

  return pipe(
    TE.Do,
    TE.bind("schemaModel", () => readSchema(dbEnv, args.schemas)),
    TE.bind("client", () => createClient(dbEnv)),
    TE.bind("graphqlSchema", ({ schemaModel }) => TE.right(buildSchema(schemaModel))),
    TE.chain(({ graphqlSchema, client, schemaModel }) =>
      startServer({
        host: args.host,
        port: args.port,
        schema: graphqlSchema,
        enableConsole: args.console,
        resolverContext: { client, model: schemaModel },
      })
    ),
    TE.orElse((error): TE.TaskEither<Error, void> =>
      TE.fromIO(() => {
        console.error("Error:", error.message || error);
        process.exit(1);
      })
    )
  );
};

run();
