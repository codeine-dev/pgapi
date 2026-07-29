import * as E from "fp-ts/Either";
import { pipe } from "fp-ts/function";
import * as t from "io-ts";
import { CliArgsCodec } from "./codecs";

export type CliArgs = t.TypeOf<typeof CliArgsCodec>;

export const parseArgs = (args: string[]): E.Either<string, CliArgs> => {
  const raw: Record<string, unknown> = {
    connectionString: "",
    port: 3000,
    host: "127.0.0.1",
    console: false,
    schemas: [],
    jwtSecret: undefined,
    apiKeyHeader: undefined,
    oauthIssuer: undefined,
    oauthAudience: undefined,
    oauthClockSkew: undefined,
    authMode: "none",
  };

  for (let i = 2; i < args.length; i++) {
    switch (args[i]) {
      case "--connection-string": {
        i++;
        if (i >= args.length) return E.left("--connection-string requires a value");
        const val = args[i];
        if (val === undefined) return E.left("--connection-string requires a value");
        raw.connectionString = val;
        break;
      }
      case "--port": {
        i++;
        if (i >= args.length) return E.left("--port requires a value");
        const portVal = args[i];
        if (portVal === undefined) return E.left("--port requires a value");
        const port = parseInt(portVal, 10);
        if (isNaN(port)) return E.left("--port must be a number");
        raw.port = port;
        break;
      }
      case "--host": {
        i++;
        if (i >= args.length) return E.left("--host requires a value");
        const hostVal = args[i];
        if (hostVal === undefined) return E.left("--host requires a value");
        raw.host = hostVal;
        break;
      }
      case "--console":
        raw.console = true;
        break;
      case "--schema": {
        i++;
        if (i >= args.length) return E.left("--schema requires a value");
        const schemaVal = args[i];
        if (schemaVal === undefined) return E.left("--schema requires a value");
        (raw.schemas as string[]).push(schemaVal);
        break;
      }
      case "--jwt-secret": {
        i++;
        if (i >= args.length) return E.left("--jwt-secret requires a value");
        const jwtVal = args[i];
        if (jwtVal === undefined) return E.left("--jwt-secret requires a value");
        raw.jwtSecret = jwtVal;
        raw.authMode = "required";
        break;
      }
      case "--api-key-header": {
        i++;
        if (i >= args.length) return E.left("--api-key-header requires a value");
        const apiKeyVal = args[i];
        if (apiKeyVal === undefined) return E.left("--api-key-header requires a value");
        raw.apiKeyHeader = apiKeyVal;
        raw.authMode = "required";
        break;
      }
      case "--oauth-issuer": {
        i++;
        if (i >= args.length) return E.left("--oauth-issuer requires a value");
        const oauthVal = args[i];
        if (oauthVal === undefined) return E.left("--oauth-issuer requires a value");
        raw.oauthIssuer = oauthVal;
        raw.authMode = "required";
        break;
      }
      case "--oauth-audience": {
        i++;
        if (i >= args.length) return E.left("--oauth-audience requires a value");
        const audVal = args[i];
        if (audVal === undefined) return E.left("--oauth-audience requires a value");
        raw.oauthAudience = audVal;
        break;
      }
      case "--oauth-clock-skew": {
        i++;
        if (i >= args.length) return E.left("--oauth-clock-skew requires a value");
        const skewVal = args[i];
        if (skewVal === undefined) return E.left("--oauth-clock-skew requires a value");
        const skew = parseInt(skewVal, 10);
        if (isNaN(skew)) return E.left("--oauth-clock-skew must be a number");
        raw.oauthClockSkew = skew;
        break;
      }
      case "--auth": {
        i++;
        if (i >= args.length) return E.left("--auth requires a value");
        const authVal = args[i];
        if (authVal !== "none" && authVal !== "optional" && authVal !== "required") {
          return E.left("--auth must be none, optional, or required");
        }
        raw.authMode = authVal;
        break;
      }
      default:
        return E.left(`Unknown argument: ${args[i]}`);
    }
  }

  if (!raw.connectionString) {
    return E.left("--connection-string is required");
  }

  const validation = CliArgsCodec.validate(raw, []);
  if (validation._tag === "Left") {
    const errors = validation.left.map((e) => e.message).join(", ");
    return E.left(`Invalid arguments: ${errors}`);
  }

  return E.right(validation.right);
};
