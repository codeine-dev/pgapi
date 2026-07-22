import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import { pipe } from "fp-ts/function";

export interface AuthContext {
  isAuthenticated: boolean;
  user?: Record<string, unknown>;
  apiKey?: string;
}

export interface AuthConfig {
  jwtSecret?: string;
  apiKeyHeader?: string;
  authMode: "none" | "optional" | "required";
}

type AuthError =
  | { _tag: "MissingToken"; message: string }
  | { _tag: "InvalidToken"; message: string }
  | { _tag: "InvalidApiKey"; message: string }
  | { _tag: "AuthRequired"; message: string };

const extractBearerToken = (authHeader: string | undefined): O.Option<string> =>
  pipe(
    O.fromNullable(authHeader),
    O.filter((h) => h.startsWith("Bearer ")),
    O.map((h) => h.slice(7))
  );

const extractApiKey = (headers: Record<string, string | undefined>, headerName: string): O.Option<string> =>
  pipe(
    O.fromNullable(headers[headerName.toLowerCase()]),
    O.filter((key) => key.length > 0)
  );

const verifyJwt = (token: string, secret: string): E.Either<AuthError, Record<string, unknown>> =>
  E.tryCatch(
    () => {
      const parts = token.split(".");
      if (parts.length !== 3) {
        throw new Error("Invalid JWT format");
      }

      const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString());
      const now = Math.floor(Date.now() / 1000);

      if (payload.exp && payload.exp < now) {
        throw new Error("Token expired");
      }

      if (payload.iat && payload.iat > now) {
        throw new Error("Token issued in the future");
      }

      return payload as Record<string, unknown>;
    },
    (e) => ({
      _tag: "InvalidToken" as const,
      message: e instanceof Error ? e.message : String(e),
    })
  );

export const authenticate = (
  config: AuthConfig,
  headers: Record<string, string | undefined>
): E.Either<AuthError, AuthContext> => {
  if (config.authMode === "none") {
    return E.right({ isAuthenticated: false });
  }

  if (config.jwtSecret) {
    const tokenOption = extractBearerToken(headers.authorization);
    if (O.isSome(tokenOption)) {
      return pipe(
        verifyJwt(tokenOption.value, config.jwtSecret),
        E.map((payload) => ({
          isAuthenticated: true,
          user: payload,
        }))
      );
    }
  }

  if (config.apiKeyHeader) {
    const apiKeyOption = extractApiKey(headers, config.apiKeyHeader);
    if (O.isSome(apiKeyOption)) {
      return E.right({
        isAuthenticated: true,
        apiKey: apiKeyOption.value,
      });
    }
  }

  if (config.authMode === "required") {
    return E.left({
      _tag: "AuthRequired",
      message: "Authentication required",
    });
  }

  return E.right({ isAuthenticated: false });
};

export const formatAuthError = (error: AuthError): string => {
  switch (error._tag) {
    case "MissingToken":
      return error.message;
    case "InvalidToken":
      return error.message;
    case "InvalidApiKey":
      return error.message;
    case "AuthRequired":
      return error.message;
  }
};
