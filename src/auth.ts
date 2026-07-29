import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import * as TE from "fp-ts/TaskEither";
import { pipe } from "fp-ts/function";
import { log } from "./logger";

interface Jwk {
  kty?: string;
  kid?: string;
  alg?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
  [key: string]: unknown;
}

export interface AuthContext {
  isAuthenticated: boolean;
  user?: Record<string, unknown>;
  apiKey?: string;
}

export interface OidcConfig {
  issuer: string;
  jwks: Jwk[];
  jwksUri: string;
  audience?: string;
  clockSkew?: number;
}

export interface AuthConfig {
  jwtSecret?: string;
  apiKeyHeader?: string;
  authMode: "none" | "optional" | "required";
  oauthConfig?: OidcConfig;
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

      const exp = payload.exp as number | undefined;
      if (exp !== undefined && exp < now) {
        throw new Error("Token expired");
      }

      const iat = payload.iat as number | undefined;
      if (iat !== undefined && iat > now) {
        throw new Error("Token issued in the future");
      }

      return payload as Record<string, unknown>;
    },
    (e) => ({
      _tag: "InvalidToken" as const,
      message: e instanceof Error ? e.message : String(e),
    })
  );

const hashForAlg = (alg: string): string => {
  switch (alg) {
    case "RS256": case "ES256": return "SHA-256";
    case "RS384": case "ES384": return "SHA-384";
    case "RS512": case "ES512": return "SHA-512";
    default: throw new Error(`Unsupported algorithm: ${alg}`);
  }
};

const curveForAlg = (alg: string): string => {
  switch (alg) {
    case "ES256": return "P-256";
    case "ES384": return "P-384";
    case "ES512": return "P-521";
    default: throw new Error(`Unsupported ECDSA algorithm: ${alg}`);
  }
};

const curveOrderLength = (crv: string): number => {
  switch (crv) {
    case "P-256": return 32;
    case "P-384": return 48;
    case "P-521": return 66;
    default: throw new Error(`Unsupported curve: ${crv}`);
  }
};

const encodeDerInteger = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  const trimmed = bytes.slice(i);

  if ((trimmed[0]! & 0x80) !== 0) {
    const result = new Uint8Array(2 + trimmed.length + 1);
    result[0] = 0x02;
    result[1] = trimmed.length + 1;
    result[2] = 0x00;
    result.set(trimmed, 3);
    return result as Uint8Array<ArrayBuffer>;
  }

  const result = new Uint8Array(2 + trimmed.length);
  result[0] = 0x02;
  result[1] = trimmed.length;
  result.set(trimmed, 2);
  return result as Uint8Array<ArrayBuffer>;
};

const rawSignatureToDer = (raw: Uint8Array, orderLen: number): Uint8Array<ArrayBuffer> => {
  const r = raw.slice(0, orderLen);
  const s = raw.slice(orderLen);

  const rDer = encodeDerInteger(r);
  const sDer = encodeDerInteger(s);

  const contents = new Uint8Array(rDer.length + sDer.length);
  contents.set(rDer, 0);
  contents.set(sDer, rDer.length);

  const result = new Uint8Array(2 + contents.length);
  result[0] = 0x30;
  result[1] = contents.length;
  result.set(contents, 2);
  return result as Uint8Array<ArrayBuffer>;
};

const importVerifyKey = (alg: string, jwk: Jwk): Promise<CryptoKey> => {
  if (alg.startsWith("RS")) {
    const hashName = hashForAlg(alg);
    return crypto.subtle.importKey(
      "jwk",
      jwk as any,
      { name: "RSASSA-PKCS1-v1_5", hash: { name: hashName } },
      false,
      ["verify"]
    );
  }

  if (alg.startsWith("ES")) {
    const curveName = curveForAlg(alg);
    return crypto.subtle.importKey(
      "jwk",
      jwk as any,
      { name: "ECDSA", namedCurve: curveName },
      false,
      ["verify"]
    );
  }

  throw new Error(`Unsupported algorithm: ${alg}`);
};

const verifySignature = async (
  alg: string,
  key: CryptoKey,
  data: Uint8Array,
  sigBytes: Uint8Array,
  crv?: string
): Promise<boolean> => {
  const bufSig = sigBytes as any;
  const bufData = data as any;

  if (alg.startsWith("RS")) {
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bufSig, bufData);
  }

  if (alg.startsWith("ES")) {
    const hashName = hashForAlg(alg);

    // Web Crypto spec uses DER, but some environments (Bun) use raw R||S.
    // Try raw first; if that fails, fall back to DER-converted.
    if (sigBytes[0] !== 0x30) {
      const ok = await crypto.subtle.verify(
        { name: "ECDSA", hash: { name: hashName } },
        key,
        bufSig,
        bufData
      );
      if (ok) return true;
    }

    const orderLen = curveOrderLength(crv ?? "P-256");
    const derSig = rawSignatureToDer(sigBytes, orderLen);
    return crypto.subtle.verify(
      { name: "ECDSA", hash: { name: hashName } },
      key,
      derSig as any,
      bufData
    );
  }

  throw new Error(`Unsupported algorithm: ${alg}`);
};

const verifyJwtWithJwks = async (
  token: string,
  config: OidcConfig
): Promise<E.Either<AuthError, Record<string, unknown>>> => {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return E.left({ _tag: "InvalidToken", message: "Invalid JWT format" });
    }

    const hdrStr = parts[0];
    const payStr = parts[1];
    const sigStr = parts[2] ?? "";
    if (hdrStr === undefined || payStr === undefined) {
      return E.left({ _tag: "InvalidToken", message: "Invalid JWT format" });
    }

    const header = JSON.parse(Buffer.from(hdrStr, "base64url").toString()) as Record<string, unknown>;
    const payload = JSON.parse(Buffer.from(payStr, "base64url").toString()) as Record<string, unknown>;

    if (header.alg === "none") {
      return E.left({ _tag: "InvalidToken", message: "Invalid algorithm: none" });
    }

    if (typeof header.alg !== "string" || (!header.alg.startsWith("RS") && !header.alg.startsWith("ES"))) {
      return E.left({ _tag: "InvalidToken", message: `Unsupported algorithm: ${header.alg}` });
    }

    const alg = header.alg;

    const kid = header.kid as string | undefined;
    let jwk: Jwk | undefined;
    if (kid) {
      jwk = config.jwks.find((k) => k.kid === kid);
      if (!jwk) {
        return E.left({ _tag: "InvalidToken", message: `Key not found: kid=${kid}` });
      }
    } else {
      jwk = config.jwks.find((k) => k.kty === "RSA" || k.kty === "EC" || !k.kty);
      if (!jwk) {
        return E.left({ _tag: "InvalidToken", message: "No matching JWK found" });
      }
    }

    const key = await importVerifyKey(alg, jwk);

    const data = new TextEncoder().encode(`${hdrStr}.${payStr}`);
    const sigBytes = Buffer.from(sigStr, "base64url");

    const valid = await verifySignature(alg, key, data, sigBytes, jwk.crv);

    if (!valid) {
      return E.left({ _tag: "InvalidToken", message: "Invalid signature" });
    }

    const skew = config.clockSkew ?? 10;
    const now = Math.floor(Date.now() / 1000);

    const exp = payload.exp as number | undefined;
    if (exp !== undefined && exp < now - skew) {
      return E.left({ _tag: "InvalidToken", message: "Token expired" });
    }

    const iat = payload.iat as number | undefined;
    if (iat !== undefined && iat > now + skew) {
      return E.left({ _tag: "InvalidToken", message: "Token issued in the future" });
    }

    if (payload.iss && payload.iss !== config.issuer) {
      return E.left({ _tag: "InvalidToken", message: "Invalid issuer" });
    }

    if (config.audience) {
      const tokenAud = payload.aud;
      if (tokenAud !== undefined) {
        const audMatch = Array.isArray(tokenAud)
          ? tokenAud.includes(config.audience)
          : tokenAud === config.audience;
        if (!audMatch) {
          return E.left({ _tag: "InvalidToken", message: "Invalid audience" });
        }
      }
    }

    return E.right(payload as Record<string, unknown>);
  } catch (e) {
    return E.left({
      _tag: "InvalidToken" as const,
      message: e instanceof Error ? e.message : String(e),
    });
  }
};

export const fetchOidcConfig = (issuer: string): TE.TaskEither<Error, { jwksUri: string; issuer: string }> =>
  TE.tryCatch(
    async () => {
      const baseUrl = issuer.replace(/\/+$/, "");
      const url = `${baseUrl}/.well-known/openid-configuration`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch OIDC config: ${res.status} ${res.statusText}`);
      const config = await res.json() as Record<string, unknown>;
      const jwksUri = config.jwks_uri;
      if (typeof jwksUri !== "string") throw new Error("OIDC config missing jwks_uri");
      const configuredIssuer = config.issuer;
      return { jwksUri, issuer: typeof configuredIssuer === "string" ? configuredIssuer : issuer };
    },
    (e) => (e instanceof Error ? e : new Error(String(e)))
  );

export const fetchJwks = (jwksUri: string): TE.TaskEither<Error, Jwk[]> =>
  TE.tryCatch(
    async () => {
      const res = await fetch(jwksUri);
      if (!res.ok) throw new Error(`Failed to fetch JWKS: ${res.status} ${res.statusText}`);
      const body = await res.json() as Record<string, unknown>;
      const keys = body.keys;
      if (!Array.isArray(keys)) throw new Error("JWKS response missing keys array");
      return keys as Jwk[];
    },
    (e) => (e instanceof Error ? e : new Error(String(e)))
  );

export const refreshOidcJwks = (config: OidcConfig): TE.TaskEither<Error, void> =>
  TE.tryCatch(
    async () => {
      const res = await fetch(config.jwksUri);
      if (!res.ok) throw new Error(`Failed to fetch JWKS: ${res.status} ${res.statusText}`);
      const body = await res.json() as Record<string, unknown>;
      const keys = body.keys;
      if (!Array.isArray(keys)) throw new Error("JWKS response missing keys array");
      const newJwks = keys as Jwk[];
      config.jwks.length = 0;
      config.jwks.push(...newJwks);
    },
    (e) => (e instanceof Error ? e : new Error(String(e)))
  );

const logAuthFailure = (config: AuthConfig, error: AuthError, headers: Record<string, string | undefined>): void => {
  if (!config.oauthConfig) return;

  const authHeader = headers.authorization ?? "";
  const tokenPrefix = authHeader.startsWith("Bearer ") ? authHeader.slice(7, 17) + "..." : "(none)";
  let kid = "(unknown)";
  try {
    const parts = authHeader.slice(7).split(".");
    if (parts.length === 3 && parts[0]) {
      const hdr = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as Record<string, unknown>;
      kid = typeof hdr.kid === "string" ? hdr.kid : "(missing)";
    }
  } catch {}

  log.warn("OIDC auth failure", {
    kid,
    tokenPrefix,
    error: error.message,
  });
};

export const authenticate = async (
  config: AuthConfig,
  headers: Record<string, string | undefined>
): Promise<E.Either<AuthError, AuthContext>> => {
  if (config.authMode === "none") {
    return E.right({ isAuthenticated: false });
  }

  if (config.oauthConfig) {
    const tokenOption = extractBearerToken(headers.authorization);
    if (O.isSome(tokenOption)) {
      let result = await verifyJwtWithJwks(tokenOption.value, config.oauthConfig);
      if (E.isLeft(result) && result.left.message.startsWith("Key not found:")) {
        const refreshEither = await refreshOidcJwks(config.oauthConfig)();
        if (E.isRight(refreshEither)) {
          result = await verifyJwtWithJwks(tokenOption.value, config.oauthConfig);
        }
      }
      if (E.isLeft(result)) {
        logAuthFailure(config, result.left, headers);
        return result;
      }
      return E.right({ isAuthenticated: true, user: result.right });
    }
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
