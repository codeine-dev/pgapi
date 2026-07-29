import { describe, it, expect } from "vitest";
import { parseArgs } from "./cli";

describe("parseArgs", () => {
  it("returns error when no connection string", () => {
    const result = parseArgs(["node", "index.ts"]);
    expect(result._tag).toBe("Left");
  });

  it("parses connection string", () => {
    const result = parseArgs([
      "node",
      "index.ts",
      "--connection-string",
      "postgres://localhost/test",
    ]);
    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right.connectionString).toBe("postgres://localhost/test");
      expect(result.right.port).toBe(3000);
      expect(result.right.host).toBe("127.0.0.1");
      expect(result.right.console).toBe(false);
      expect(result.right.schemas).toEqual([]);
    }
  });

  it("parses all options", () => {
    const result = parseArgs([
      "node",
      "index.ts",
      "--connection-string",
      "postgres://localhost/test",
      "--port",
      "4000",
      "--host",
      "0.0.0.0",
      "--console",
    ]);
    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right.port).toBe(4000);
      expect(result.right.host).toBe("0.0.0.0");
      expect(result.right.console).toBe(true);
    }
  });

  it("parses single --schema flag", () => {
    const result = parseArgs([
      "node",
      "index.ts",
      "--connection-string",
      "postgres://localhost/test",
      "--schema",
      "public",
    ]);
    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right.schemas).toEqual(["public"]);
    }
  });

  it("parses multiple --schema flags", () => {
    const result = parseArgs([
      "node",
      "index.ts",
      "--connection-string",
      "postgres://localhost/test",
      "--schema",
      "public",
      "--schema",
      "inventory",
    ]);
    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right.schemas).toEqual(["public", "inventory"]);
    }
  });

  it("returns error on unknown argument", () => {
    const result = parseArgs(["node", "index.ts", "--foo"]);
    expect(result._tag).toBe("Left");
  });

  it("returns error when port is not a number", () => {
    const result = parseArgs([
      "node",
      "index.ts",
      "--connection-string",
      "postgres://localhost/test",
      "--port",
      "abc",
    ]);
    expect(result._tag).toBe("Left");
  });

  it("returns error when --schema has no value", () => {
    const result = parseArgs([
      "node",
      "index.ts",
      "--connection-string",
      "postgres://localhost/test",
      "--schema",
    ]);
    expect(result._tag).toBe("Left");
  });

  it("parses --oauth-issuer", () => {
    const result = parseArgs([
      "node",
      "index.ts",
      "--connection-string",
      "postgres://localhost/test",
      "--oauth-issuer",
      "https://auth.example.com",
    ]);
    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right.oauthIssuer).toBe("https://auth.example.com");
      expect(result.right.authMode).toBe("required");
    }
  });

  it("returns error when --oauth-issuer has no value", () => {
    const result = parseArgs([
      "node",
      "index.ts",
      "--connection-string",
      "postgres://localhost/test",
      "--oauth-issuer",
    ]);
    expect(result._tag).toBe("Left");
  });

  it("parses --oauth-audience", () => {
    const result = parseArgs([
      "node",
      "index.ts",
      "--connection-string",
      "postgres://localhost/test",
      "--oauth-issuer",
      "https://auth.example.com",
      "--oauth-audience",
      "my-app",
    ]);
    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right.oauthAudience).toBe("my-app");
    }
  });

  it("parses --oauth-clock-skew", () => {
    const result = parseArgs([
      "node",
      "index.ts",
      "--connection-string",
      "postgres://localhost/test",
      "--oauth-issuer",
      "https://auth.example.com",
      "--oauth-clock-skew",
      "30",
    ]);
    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right.oauthClockSkew).toBe(30);
    }
  });

  it("returns error when --oauth-audience has no value", () => {
    const result = parseArgs([
      "node",
      "index.ts",
      "--connection-string",
      "postgres://localhost/test",
      "--oauth-audience",
    ]);
    expect(result._tag).toBe("Left");
  });

  it("returns error when --oauth-clock-skew is not a number", () => {
    const result = parseArgs([
      "node",
      "index.ts",
      "--connection-string",
      "postgres://localhost/test",
      "--oauth-clock-skew",
      "abc",
    ]);
    expect(result._tag).toBe("Left");
  });
});
