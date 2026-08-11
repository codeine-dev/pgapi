import * as E from "fp-ts/Either";
import { randomBytes } from "node:crypto";
import { pipe } from "fp-ts/function";
import * as t from "io-ts";
import { CliArgsCodec, ServiceAccountsCodec } from "./codecs";
import type { ServiceAccountConfig } from "./codecs";
import { hashKey, SHA256_PREFIX } from "./auth";

export type CliArgs = t.TypeOf<typeof CliArgsCodec>;

export const USAGE = `pgapi - Automatic GraphQL API from your PostgreSQL schema

Usage:
  pgapi [options]
  pgapi --keygen

Options:
  -h, --help                      Show this help message and exit
      --connection-string <url>   Postgres connection string (required)
      --port <number>             Bind port (default: 3000)
      --host <address>            Bind address (default: 127.0.0.1)
      --console                   Serve the GraphiQL console at /console
      --schema <name>             Expose a schema (repeatable)
      --jwt-secret <string>       Verify HMAC JWTs with this secret
      --api-key-header <name>     Header carrying an API key (default: x-api-key)
      --service-account <a:k>     Service account name and key (repeatable)
      --keygen                    Generate a random service-account key and exit
      --oauth-issuer <url>        OIDC issuer for Bearer token validation
      --oauth-audience <string>   Expected JWT audience claim
      --oauth-clock-skew <n>      Clock skew tolerance in seconds (default: 10)
      --auth <mode>               Auth mode: none, optional, required (default: none)

Service accounts:
  Service accounts are verified API keys for machine-to-machine access. Each
  account gets identity x_pgapi.sub = "service:<name>" and x_pgapi.role =
  "service" in the permission functions. When any service account is
  configured, the API key header is strictly validated.

  Accounts are defined with the --service-account flag or the
  PGAPI_SERVICE_ACCOUNTS environment variable (JSON array of {name, key}).
  Keys may be plaintext or pre-hashed with "sha256:".

Endpoints:
  /graphql                        GraphQL API
  /console                        GraphiQL console (requires --console)
`;

export const parseArgs = (args: string[]): E.Either<string, CliArgs> => {
  const raw: Record<string, unknown> = {
    connectionString: "",
    port: 3000,
    host: "127.0.0.1",
    console: false,
    help: false,
    keygen: false,
    schemas: [],
    jwtSecret: undefined,
    apiKeyHeader: undefined,
    oauthIssuer: undefined,
    oauthAudience: undefined,
    oauthClockSkew: undefined,
    authMode: "none",
    serviceAccounts: [],
  };

  for (let i = 2; i < args.length; i++) {
    switch (args[i]) {
      case "--help":
      case "-h":
        raw.help = true;
        break;
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
      case "--keygen":
        raw.keygen = true;
        break;
      case "--service-account": {
        i++;
        if (i >= args.length) return E.left("--service-account requires a value");
        const accountVal = args[i];
        if (accountVal === undefined) return E.left("--service-account requires a value");
        const colon = accountVal.indexOf(":");
        if (colon === -1) return E.left("--service-account must be in name:key form");
        const name = accountVal.slice(0, colon);
        const key = accountVal.slice(colon + 1);
        if (!name || !key) return E.left("--service-account must be in name:key form");
        (raw.serviceAccounts as ServiceAccountConfig[]).push({ name, key });
        raw.authMode = "required";
        break;
      }
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

  const validation = CliArgsCodec.validate(raw, []);
  if (validation._tag === "Left") {
    const errors = validation.left.map((e) => e.message).join(", ");
    return E.left(`Invalid arguments: ${errors}`);
  }

  if (raw.help) {
    return E.right(validation.right);
  }

  if (raw.keygen) {
    return E.right(validation.right);
  }

  if (!raw.connectionString) {
    return E.left("--connection-string is required");
  }

  return E.right(validation.right);
};

export const parseServiceAccountsEnv = (env: Record<string, string | undefined>): E.Either<string, ServiceAccountConfig[]> => {
  const raw = env.PGAPI_SERVICE_ACCOUNTS;
  if (raw === undefined || raw === "") return E.right([]);

  return pipe(
    E.tryCatch<string, unknown>(
      () => JSON.parse(raw),
      () => "Invalid PGAPI_SERVICE_ACCOUNTS JSON"
    ),
    E.chain((parsed) => {
      const validation = ServiceAccountsCodec.validate(parsed, []);
      if (validation._tag === "Left") {
        return E.left("PGAPI_SERVICE_ACCOUNTS must be an array of { name, key } objects");
      }
      return E.right(validation.right);
    })
  );
};

export const mergeServiceAccounts = (accounts: ServiceAccountConfig[]): E.Either<string, ServiceAccountConfig[]> => {
  const seen = new Set<string>();
  for (const account of accounts) {
    if (!account.name) {
      return E.left("Service account name must not be empty");
    }
    if (seen.has(account.name)) {
      return E.left(`Duplicate service account: ${account.name}`);
    }
    seen.add(account.name);
    if (!account.key) {
      return E.left(`Service account ${account.name} must have a non-empty key`);
    }
    if (account.key.startsWith(SHA256_PREFIX)) {
      const hex = account.key.slice(SHA256_PREFIX.length);
      if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
        return E.left(`Service account ${account.name} has an invalid sha256: key hash`);
      }
    }
  }
  return E.right(accounts);
};

export const generateServiceAccountKey = (): { key: string; hash: string } => {
  const key = randomBytes(32).toString("base64url");
  return { key, hash: hashKey(key) };
};
