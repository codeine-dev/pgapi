import { describe, it, expect } from "vitest";
import { authenticate, formatAuthError } from "./auth";

describe("authenticate", () => {
  describe("none mode", () => {
    it("returns unauthenticated for any request", () => {
      const result = authenticate({ authMode: "none" }, {});
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(false);
      }
    });
  });

  describe("JWT authentication", () => {
    const createJwt = (payload: Record<string, unknown>): string => {
      const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
      const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
      return `${header}.${body}.`;
    };

    it("authenticates valid JWT", () => {
      const token = createJwt({ sub: "user123", name: "Test User" });
      const result = authenticate(
        { jwtSecret: "secret", authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(true);
        expect(result.right.user).toEqual({ sub: "user123", name: "Test User" });
      }
    });

    it("rejects expired JWT", () => {
      const token = createJwt({ sub: "user123", exp: Math.floor(Date.now() / 1000) - 100 });
      const result = authenticate(
        { jwtSecret: "secret", authMode: "required" },
        { authorization: `Bearer ${token}` }
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("InvalidToken");
      }
    });

    it("rejects invalid JWT format", () => {
      const result = authenticate(
        { jwtSecret: "secret", authMode: "required" },
        { authorization: "Bearer invalid-token" }
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("InvalidToken");
      }
    });

    it("returns error when required and no token", () => {
      const result = authenticate(
        { jwtSecret: "secret", authMode: "required" },
        {}
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("AuthRequired");
      }
    });

    it("returns unauthenticated when optional and no token", () => {
      const result = authenticate(
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
    it("authenticates valid API key", () => {
      const result = authenticate(
        { apiKeyHeader: "x-api-key", authMode: "required" },
        { "x-api-key": "my-secret-key" }
      );
      expect(result._tag).toBe("Right");
      if (result._tag === "Right") {
        expect(result.right.isAuthenticated).toBe(true);
        expect(result.right.apiKey).toBe("my-secret-key");
      }
    });

    it("returns error when required and no API key", () => {
      const result = authenticate(
        { apiKeyHeader: "x-api-key", authMode: "required" },
        {}
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("AuthRequired");
      }
    });

    it("returns unauthenticated when optional and no API key", () => {
      const result = authenticate(
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
    it("prefers JWT over API key", () => {
      const createJwt = (payload: Record<string, unknown>): string => {
        const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
        const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
        return `${header}.${body}.`;
      };

      const token = createJwt({ sub: "user123" });
      const result = authenticate(
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

    it("falls back to API key when no JWT", () => {
      const result = authenticate(
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
