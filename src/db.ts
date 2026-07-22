import { Client } from "pg";
import * as TE from "fp-ts/TaskEither";
import { pipe } from "fp-ts/function";

export interface DbEnv {
  connectionString: string;
}

export const withClient = <A>(
  f: (client: Client) => Promise<A>
): (env: DbEnv) => TE.TaskEither<Error, A> => (env) =>
  pipe(
    TE.tryCatch(
      async () => {
        const client = new Client({ connectionString: env.connectionString });
        await client.connect();
        try {
          return await f(client);
        } finally {
          await client.end();
        }
      },
      (e) => (e instanceof Error ? e : new Error(String(e)))
    )
  );
