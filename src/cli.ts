import * as E from "fp-ts/Either";
import { pipe } from "fp-ts/function";

export interface CliArgs {
  connectionString: string;
  port: number;
  host: string;
  console: boolean;
}

export const parseArgs = (args: string[]): E.Either<string, CliArgs> => {
  const result: CliArgs = {
    connectionString: "",
    port: 3000,
    host: "127.0.0.1",
    console: false,
  };

  for (let i = 2; i < args.length; i++) {
    switch (args[i]) {
      case "--connection-string": {
        i++;
        if (i >= args.length) return E.left("--connection-string requires a value");
        const val = args[i];
        if (val === undefined) return E.left("--connection-string requires a value");
        result.connectionString = val;
        break;
      }
      case "--port": {
        i++;
        if (i >= args.length) return E.left("--port requires a value");
        const portVal = args[i];
        if (portVal === undefined) return E.left("--port requires a value");
        const port = parseInt(portVal, 10);
        if (isNaN(port)) return E.left("--port must be a number");
        result.port = port;
        break;
      }
      case "--host": {
        i++;
        if (i >= args.length) return E.left("--host requires a value");
        const hostVal = args[i];
        if (hostVal === undefined) return E.left("--host requires a value");
        result.host = hostVal;
        break;
      }
      case "--console":
        result.console = true;
        break;
      default:
        return E.left(`Unknown argument: ${args[i]}`);
    }
  }

  if (!result.connectionString) {
    return E.left("--connection-string is required");
  }

  return E.right(result);
};
