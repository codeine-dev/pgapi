import { describe, it, expect, beforeAll } from "vitest";
import { authenticate, formatAuthError, refreshOidcJwks, hashKey, normalizeServiceAccounts } from "./auth";
import type { AuthConfig, OidcConfig } from "./auth";
import { signHs256Jwt } from "./test-support";

describe("authenticate", () => {
  describe("none mode", () => {
    it("returns unauthenticated for any request", async () => {
      const result = await authenticate({ authMode: "none" }, {});
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(false);
      }
    });
  });

  describe("JWT authentication", () => {
    it("authenticates valid JWT", async () => {
      const token = signHs256Jwt({ sub: "user123", name: "Test User" }, "secret");
      const result = await authenticate(
        { jwtSecret: "secret", authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(true);
        expect(result.right.user).toEqual({ sub: "user123", name: "Test User" });
      }
    });

    it("rejects expired JWT", async () => {
      const token = signHs256Jwt({ sub: "user123", exp: Math.floor(Date.now() / 1000) - 100 }, "secret");
      const result = await authenticate(
        { jwtSecret: "secret", authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("InvalidToken");
      }
    });

    it("rejects JWT signed with the wrong secret", async () => {
      const token = signHs256Jwt({ sub: "user123" }, "wrong-secret");
      const result = await authenticate(
        { jwtSecret: "secret", authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("InvalidToken");
        expect(result.left.message).toMatch(/signature/i);
      }
    });

    it("rejects JWT with alg=none", async () => {
      const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
      const body = Buffer.from(JSON.stringify({ sub: "user123" })).toString("base64url");
      const token = `${header}.${body}.`;
      const result = await authenticate(
        { jwtSecret: "secret", authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("InvalidToken");
        expect(result.left.message).toMatch(/none/i);
      }
    });

    it("rejects tampered JWT payload", async () => {
      const token = signHs256Jwt({ sub: "user123" }, "secret");
      const [header, , sig] = token.split(".");
      const tamperedBody = Buffer.from(JSON.stringify({ sub: "attacker" })).toString("base64url");
      const result = await authenticate(
        { jwtSecret: "secret", authMode: "required" },
        { authorization: `Bearer ${header}.${tamperedBody}.${sig}` }
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("InvalidToken");
      }
    });

    it("rejects invalid JWT format", async () => {
      const result = await authenticate(
        { jwtSecret: "secret", authMode: "required" },
        { authorization: "Bearer invalid-token" }
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("InvalidToken");
      }
    });

    it("returns error when required and no token", async () => {
      const result = await authenticate(
        { jwtSecret: "secret", authMode: "required" },
        {}
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("AuthRequired");
      }
    });

    it("returns unauthenticated when optional and no token", async () => {
      const result = await authenticate(
        { jwtSecret: "secret", authMode: "optional" },
        {}
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(false);
      }
    });
  });

  describe("API key authentication", () => {
    it("authenticates valid API key", async () => {
      const result = await authenticate(
        { apiKeyHeader: "x-api-key", authMode: "required" },
        { "x-api-key": "my-secret-key" }
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(true);
        expect(result.right.apiKey).toBe("my-secret-key");
      }
    });

    it("returns error when required and no API key", async () => {
      const result = await authenticate(
        { apiKeyHeader: "x-api-key", authMode: "required" },
        {}
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("AuthRequired");
      }
    });

    it("returns unauthenticated when optional and no API key", async () => {
      const result = await authenticate(
        { apiKeyHeader: "x-api-key", authMode: "optional" },
        {}
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(false);
      }
    });
  });

  describe("combined authentication", () => {
    it("prefers JWT over API key", async () => {
      const token = signHs256Jwt({ sub: "user123" }, "secret");
      const result = await authenticate(
        { jwtSecret: "secret", apiKeyHeader: "x-api-key", authMode: "required" },
        { authorization: `Bearer ${token}`, "x-api-key": "my-key" }
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(true);
        expect(result.right.user).toEqual({ sub: "user123" });
        expect(result.right.apiKey).toBeUndefined();
      }
    });

    it("falls back to API key when no JWT", async () => {
      const result = await authenticate(
        { jwtSecret: "secret", apiKeyHeader: "x-api-key", authMode: "required" },
        { "x-api-key": "my-key" }
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(true);
        expect(result.right.apiKey).toBe("my-key");
      }
    });
  });

  describe("service account authentication", () => {
    const accounts = [{ name: "svc-a", keyHash: hashKey("secret-key-a") }];

    it("authenticates a known service account key", async () => {
      const result = await authenticate(
        { serviceAccounts: accounts, authMode: "required" },
        { "x-api-key": "secret-key-a" }
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(true);
        expect(result.right.service).toEqual({ name: "svc-a" });
      }
    });

    it("uses the default x-api-key header when none configured", async () => {
      const result = await authenticate(
        { serviceAccounts: accounts, authMode: "required" },
        { "x-api-key": "secret-key-a" }
      );
      expect(result._tag).toBe("Right");
    });

    it("honors a custom api key header", async () => {
      const result = await authenticate(
        { apiKeyHeader: "x-svc-key", serviceAccounts: accounts, authMode: "required" },
        { "x-svc-key": "secret-key-a" }
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.service).toEqual({ name: "svc-a" });
      }
    });

    it("rejects an unknown service account key", async () => {
      const result = await authenticate(
        { serviceAccounts: accounts, authMode: "required" },
        { "x-api-key": "wrong-key" }
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("InvalidApiKey");
      }
    });

    it("rejects when required and key missing", async () => {
      const result = await authenticate(
        { serviceAccounts: accounts, authMode: "required" },
        {}
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("AuthRequired");
      }
    });

    it("returns unauthenticated when optional and key missing", async () => {
      const result = await authenticate(
        { serviceAccounts: accounts, authMode: "optional" },
        {}
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(false);
      }
    });

    it("matches against a pre-hashed key", async () => {
      const hashed = [{ name: "svc-b", keyHash: hashKey("raw-key-b") }];
      const result = await authenticate(
        { serviceAccounts: hashed, authMode: "required" },
        { "x-api-key": "raw-key-b" }
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.service).toEqual({ name: "svc-b" });
      }
    });

    it("prefers JWT over a service account key", async () => {
      const token = signHs256Jwt({ sub: "user123" }, "secret");
      const result = await authenticate(
        { jwtSecret: "secret", serviceAccounts: accounts, authMode: "required" },
        { authorization: `Bearer ${token}`, "x-api-key": "secret-key-a" }
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.user).toEqual({ sub: "user123" });
        expect(result.right.service).toBeUndefined();
      }
    });
  });

  describe("normalizeServiceAccounts", () => {
    it("hashes plaintext keys", () => {
      const normalized = normalizeServiceAccounts([{ name: "svc-a", key: "plain-key" }]);
      expect(normalized).toEqual([{ name: "svc-a", keyHash: hashKey("plain-key") }]);
    });

    it("keeps sha256-prefixed hashes", () => {
      const normalized = normalizeServiceAccounts([{ name: "svc-a", key: `sha256:${hashKey("raw")}` }]);
      expect(normalized).toEqual([{ name: "svc-a", keyHash: hashKey("raw") }]);
    });
  });

  describe("OIDC authentication", () => {
    let keyPair: CryptoKeyPair;
    let publicJwk: { [key: string]: unknown };
    let oidcConfig: OidcConfig;

    beforeAll(async () => {
      keyPair = await crypto.subtle.generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: { name: "SHA-256" },
        },
        true,
        ["sign", "verify"]
      );

      publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey) as any;
      publicJwk.kid = "test-key-1";

      oidcConfig = {
        issuer: "https://issuer.example.com",
        jwks: [publicJwk],
        jwksUri: "https://issuer.example.com/.well-known/jwks",
      };
    });

    const signJwt = async (
      payload: Record<string, unknown>,
      headers?: Record<string, unknown>
    ): Promise<string> => {
      const header = {
        alg: "RS256",
        kid: "test-key-1",
        typ: "JWT",
        ...headers,
      };
      const encHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
      const encPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");

      const data = new TextEncoder().encode(`${encHeader}.${encPayload}`);
      const sig = await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        keyPair.privateKey,
        data
      );
      const encSig = Buffer.from(sig).toString("base64url");
      return `${encHeader}.${encPayload}.${encSig}`;
    };

    it("authenticates valid RS256 JWT with JWKS", async () => {
      const token = await signJwt({ sub: "user123", iss: "https://issuer.example.com" });
      const result = await authenticate(
        { oauthConfig: oidcConfig, authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(true);
        expect(result.right.user).toEqual({ sub: "user123", iss: "https://issuer.example.com" });
      }
    });

    it("rejects invalid signature", async () => {
      const encHeader = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key-1" })).toString("base64url");
      const encPayload = Buffer.from(JSON.stringify({ sub: "user123" })).toString("base64url");
      const badSig = Buffer.from("invalid-signature").toString("base64url");
      const token = `${encHeader}.${encPayload}.${badSig}`;

      const result = await authenticate(
        { oauthConfig: oidcConfig, authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("InvalidToken");
      }
    });

    it("rejects alg=none", async () => {
      const encHeader = Buffer.from(JSON.stringify({ alg: "none", kid: "test-key-1" })).toString("base64url");
      const encPayload = Buffer.from(JSON.stringify({ sub: "user123" })).toString("base64url");
      const token = `${encHeader}.${encPayload}.`;

      const result = await authenticate(
        { oauthConfig: oidcConfig, authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("InvalidToken");
      }
    });

    it("rejects expired token", async () => {
      const token = await signJwt({
        sub: "user123",
        exp: Math.floor(Date.now() / 1000) - 100,
      });
      const result = await authenticate(
        { oauthConfig: oidcConfig, authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("InvalidToken");
      }
    });

    it("rejects wrong issuer", async () => {
      const token = await signJwt({
        sub: "user123",
        iss: "https://evil.example.com",
      });
      const result = await authenticate(
        { oauthConfig: oidcConfig, authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("InvalidToken");
      }
    });

    it("rejects unknown kid", async () => {
      const token = await signJwt(
        { sub: "user123" },
        { kid: "unknown-key" }
      );
      const result = await authenticate(
        { oauthConfig: oidcConfig, authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("InvalidToken");
      }
    });

    it("returns AuthRequired when no token and mode is required", async () => {
      const result = await authenticate(
        { oauthConfig: oidcConfig, authMode: "required" },
        {}
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("AuthRequired");
      }
    });

    it("returns unauthenticated when no token and mode is optional", async () => {
      const result = await authenticate(
        { oauthConfig: oidcConfig, authMode: "optional" },
        {}
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(false);
      }
    });

    it("prefers OIDC over jwtSecret", async () => {
      const token = await signJwt({ sub: "user123", iss: "https://issuer.example.com" });
      const result = await authenticate(
        {
          oauthConfig: oidcConfig,
          jwtSecret: "secret",
          authMode: "required",
        },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(true);
        expect(result.right.user).toEqual({ sub: "user123", iss: "https://issuer.example.com" });
      }
    });

    it("returns error for unknown kid when refresh also fails", async () => {
      const token = await signJwt(
        { sub: "user123" },
        { kid: "nonexistent-key" }
      );
      const result = await authenticate(
        { oauthConfig: oidcConfig, authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("InvalidToken");
      }
    });

    it("rejects token with wrong audience", async () => {
      const token = await signJwt({
        sub: "user123",
        aud: "wrong-app",
      });
      const configWithAud = { ...oidcConfig, audience: "my-app" };
      const result = await authenticate(
        { oauthConfig: configWithAud, authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("InvalidToken");
        expect(result.left.message).toMatch(/audience/i);
      }
    });

    it("accepts token with matching audience string", async () => {
      const token = await signJwt({
        sub: "user123",
        aud: "my-app",
      });
      const configWithAud = { ...oidcConfig, audience: "my-app" };
      const result = await authenticate(
        { oauthConfig: configWithAud, authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(true);
      }
    });

    it("accepts token with matching audience array", async () => {
      const token = await signJwt({
        sub: "user123",
        aud: ["api-a", "my-app", "api-b"],
      });
      const configWithAud = { ...oidcConfig, audience: "my-app" };
      const result = await authenticate(
        { oauthConfig: configWithAud, authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(true);
      }
    });

    it("accepts token with clock skew", async () => {
      const futureIat = Math.floor(Date.now() / 1000) + 30;
      const token = await signJwt({
        sub: "user123",
        iat: futureIat,
        exp: futureIat + 3600,
      });
      const result = await authenticate(
        { oauthConfig: { ...oidcConfig, clockSkew: 60 }, authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(true);
      }
    });

    it("rejects token beyond clock skew", async () => {
      const futureIat = Math.floor(Date.now() / 1000) + 120;
      const token = await signJwt({
        sub: "user123",
        iat: futureIat,
        exp: futureIat + 3600,
      });
      const result = await authenticate(
        { oauthConfig: { ...oidcConfig, clockSkew: 60 }, authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("InvalidToken");
      }
    });

    it("authenticates valid ES256 JWT with JWKS", async () => {
      const ecKeyPair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"]
      );
      const ecPublicJwk = await crypto.subtle.exportKey("jwk", ecKeyPair.publicKey) as any;
      ecPublicJwk.kid = "ec-key-1";

      const ecConfig: OidcConfig = {
        issuer: "https://issuer.example.com",
        jwks: [ecPublicJwk],
        jwksUri: "https://issuer.example.com/.well-known/jwks",
      };

      const header = { alg: "ES256", kid: "ec-key-1", typ: "JWT" };
      const encHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
      const encPayload = Buffer.from(JSON.stringify({ sub: "user123" })).toString("base64url");
      const data = new TextEncoder().encode(`${encHeader}.${encPayload}`);
      const derSig = await crypto.subtle.sign(
        { name: "ECDSA", hash: { name: "SHA-256" } },
        ecKeyPair.privateKey,
        data
      );

      const sigBytes = new Uint8Array(derSig);
      let rBytes: Uint8Array;
      let sBytes: Uint8Array;
      if (sigBytes[0] === 0x30) {
        const readDerLen = (start: number): { length: number; next: number } => {
          const first = sigBytes[start]!;
          if (first < 0x80) return { length: first, next: start + 1 };
          const num = first & 0x7f;
          let len = 0;
          for (let i = 0; i < num; i++) len = (len << 8) | sigBytes[start + 1 + i]!;
          return { length: len, next: start + 1 + num };
        };
        let pos = 1;
        const seqLen = readDerLen(pos);
        pos = seqLen.next;
        const seqEnd = pos + seqLen.length;
        const readInt = (): Uint8Array => {
          if (pos >= seqEnd || sigBytes[pos] !== 0x02) throw new Error("Expected INTEGER");
          pos++;
          const intLen = readDerLen(pos);
          pos = intLen.next;
          const val = sigBytes.slice(pos, pos + intLen.length);
          pos += intLen.length;
          return val;
        };
        rBytes = readInt();
        sBytes = readInt();
      } else {
        rBytes = sigBytes.slice(0, 32);
        sBytes = sigBytes.slice(32);
      }

      const rawR = new Uint8Array(32);
      const rawS = new Uint8Array(32);
      rawR.set(rBytes.slice(Math.max(0, rBytes.length - 32)));
      rawS.set(sBytes.slice(Math.max(0, sBytes.length - 32)));
      const rawSig = new Uint8Array(64);
      rawSig.set(rawR, 0);
      rawSig.set(rawS, 32);

      const token = `${encHeader}.${encPayload}.${Buffer.from(rawSig).toString("base64url")}`;

      const result = await authenticate(
        { oauthConfig: ecConfig, authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(true);
        expect(result.right.user).toEqual({ sub: "user123" });
      }
    });

    it("succeeds after refreshOidcJwks adds the right key", async () => {
      const oidcCfg: OidcConfig = {
        issuer: "https://issuer.example.com",
        jwks: [],
        jwksUri: "https://issuer.example.com/.well-known/jwks",
      };

      let result = await authenticate(
        { oauthConfig: oidcCfg, authMode: "required" },
        { authorization: `Bearer ${await signJwt({ sub: "user123" })}` }
      );
      expect(result._tag).toBe("Left");

      oidcCfg.jwks.push(publicJwk);

      result = await authenticate(
        { oauthConfig: oidcCfg, authMode: "required" },
        { authorization: `Bearer ${await signJwt({ sub: "user123" })}` }
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(true);
      }
    });
  });
});

describe("formatAuthError", () => {
  it("formats auth required error", () => {
    const error = { _tag: "AuthRequired" as const, message: "Authentication required" };
    expect(formatAuthError(error)).toBe("Authentication required");
  });

  it("formats invalid token error", () => {
    const error = { _tag: "InvalidToken" as const, message: "Token expired" };
    expect(formatAuthError(error)).toBe("Token expired");
  });
});
