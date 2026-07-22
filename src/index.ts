import { pipe } from "fp-ts/function";
import * as TE from "fp-ts/TaskEither";
import { parseArgs } from "./cli";
import { readSchema } from "./schema";
import { buildSchema } from "./graphql";
import { startServer } from "./server";

const run = (): TE.TaskEither<Error, void> => {
  const parsed = parseArgs(process.argv);
  if (parsed._tag === "Left") return TE.left(new Error(parsed.left));

  const args = parsed.right;
  console.log("pgapi - Postgres GraphQL API");
  console.log("---");

  return pipe(
    readSchema({ connectionString: args.connectionString }, args.schemas),
    TE.map((schemaModel) => buildSchema(schemaModel)),
    TE.chain((graphqlSchema) =>
      startServer({
        host: args.host,
        port: args.port,
        schema: graphqlSchema,
        enableConsole: args.console,
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
