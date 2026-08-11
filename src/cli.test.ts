import { describe, it, expect } from "vitest";
import { parseArgs, parseServiceAccountsEnv, mergeServiceAccounts, generateServiceAccountKey } from "./cli";
import { hashKey } from "./auth";

describe("parseArgs", () => {
  it("returns error when no connection string", () => {
    const result = parseArgs(["node", "index.ts"]);
    expect(result._tag).toBe("Left");
  });

  it("returns help without a connection string", () => {
    const result = parseArgs(["node", "index.ts", "--help"]);
    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right.help).toBe(true);
    }
  });

  it("returns help with short -h flag", () => {
    const result = parseArgs(["node", "index.ts", "-h"]);
    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right.help).toBe(true);
    }
  });

  it("returns help alongside other arguments", () => {
    const result = parseArgs([
      "node",
      "index.ts",
      "--connection-string",
      "postgres://localhost/test",
      "--port",
      "4000",
      "--help",
    ]);
    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right.help).toBe(true);
    }
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

  it("parses --service-account and sets authMode required", () => {
    const result = parseArgs([
      "node",
      "index.ts",
      "--connection-string",
      "postgres://localhost/test",
      "--service-account",
      "data-worker:secret-key",
    ]);
    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right.serviceAccounts).toEqual([{ name: "data-worker", key: "secret-key" }]);
      expect(result.right.authMode).toBe("required");
    }
  });

  it("parses multiple --service-account flags", () => {
    const result = parseArgs([
      "node",
      "index.ts",
      "--connection-string",
      "postgres://localhost/test",
      "--service-account",
      "svc-a:key-a",
      "--service-account",
      "svc-b:key-b",
    ]);
    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right.serviceAccounts).toEqual([
        { name: "svc-a", key: "key-a" },
        { name: "svc-b", key: "key-b" },
      ]);
    }
  });

  it("returns error when --service-account lacks a colon", () => {
    const result = parseArgs([
      "node",
      "index.ts",
      "--connection-string",
      "postgres://localhost/test",
      "--service-account",
      "no-colon-here",
    ]);
    expect(result._tag).toBe("Left");
  });

  it("returns error when --service-account has an empty key", () => {
    const result = parseArgs([
      "node",
      "index.ts",
      "--connection-string",
      "postgres://localhost/test",
      "--service-account",
      "svc-a:",
    ]);
    expect(result._tag).toBe("Left");
  });

  it("returns error when --service-account has no value", () => {
    const result = parseArgs([
      "node",
      "index.ts",
      "--connection-string",
      "postgres://localhost/test",
      "--service-account",
    ]);
    expect(result._tag).toBe("Left");
  });

  it("returns keygen without a connection string", () => {
    const result = parseArgs(["node", "index.ts", "--keygen"]);
    expect(result._tag).toBe("Right");
    if (result._tag === "Right") {
      expect(result.right.keygen).toBe(true);
    }
  });
});

describe("parseServiceAccountsEnv", () => {
  it("returns empty array when env var is unset", () => {
    const result = parseServiceAccountsEnv({});
    expect(result).toEqual({ _tag: "Right", right: [] });
  });

  it("parses valid JSON env var", () => {
    const result = parseServiceAccountsEnv({
      PGAPI_SERVICE_ACCOUNTS: JSON.stringify([{ name: "svc-a", key: "key-a" }]),
    });
    expect(result).toEqual({ _tag: "Right", right: [{ name: "svc-a", key: "key-a" }] });
  });

  it("returns error for invalid JSON", () => {
    const result = parseServiceAccountsEnv({ PGAPI_SERVICE_ACCOUNTS: "{not json" });
    expect(result._tag).toBe("Left");
  });

  it("returns error for non-array JSON", () => {
    const result = parseServiceAccountsEnv({ PGAPI_SERVICE_ACCOUNTS: JSON.stringify({ name: "svc" }) });
    expect(result._tag).toBe("Left");
  });
});

describe("mergeServiceAccounts", () => {
  it("accepts plaintext and sha256 keys", () => {
    const result = mergeServiceAccounts([
      { name: "svc-a", key: "plain-key" },
      { name: "svc-b", key: `sha256:${hashKey("raw-key")}` },
    ]);
    expect(result._tag).toBe("Right");
  });

  it("rejects duplicate names", () => {
    const result = mergeServiceAccounts([
      { name: "svc-a", key: "k1" },
      { name: "svc-a", key: "k2" },
    ]);
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toMatch(/Duplicate service account: svc-a/);
    }
  });

  it("rejects empty names and keys", () => {
    expect(mergeServiceAccounts([{ name: "", key: "k1" }])._tag).toBe("Left");
    expect(mergeServiceAccounts([{ name: "svc-a", key: "" }])._tag).toBe("Left");
  });

  it("rejects malformed sha256 prefix", () => {
    const result = mergeServiceAccounts([{ name: "svc-a", key: "sha256:not-hex" }]);
    expect(result._tag).toBe("Left");
  });
});

describe("generateServiceAccountKey", () => {
  it("produces a key and matching hash", () => {
    const { key, hash } = generateServiceAccountKey();
    expect(key.length).toBeGreaterThan(20);
    expect(hash).toBe(hashKey(key));
  });
});
