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
});
