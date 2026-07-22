import { describe, it, expect } from "vitest";
import {
  quoteIdentifier,
  buildWhere,
  buildSelect,
  buildSelectByFk,
  buildInsert,
  buildUpdate,
  buildDelete,
} from "./sql";

describe("quoteIdentifier", () => {
  it("quotes a simple identifier", () => {
    expect(quoteIdentifier("name")).toBe('"name"');
  });

  it("handles identifiers with special characters", () => {
    expect(quoteIdentifier("my-table")).toBe('"my-table"');
  });
});

describe("buildWhere", () => {
  it("builds empty where clause", () => {
    const result = buildWhere({});
    expect(result.sql).toBe("");
    expect(result.params).toEqual([]);
  });

  it("builds equality condition", () => {
    const result = buildWhere({ name: "John" });
    expect(result.sql).toBe('WHERE "name" = $1');
    expect(result.params).toEqual(["John"]);
  });

  it("builds null condition", () => {
    const result = buildWhere({ deleted_at: null });
    expect(result.sql).toBe('WHERE "deleted_at" IS NULL');
    expect(result.params).toEqual([]);
  });

  it("builds multiple conditions with AND", () => {
    const result = buildWhere({ name: "John", age: 30 });
    expect(result.sql).toContain("AND");
    expect(result.params).toEqual(["John", 30]);
  });

  it("supports custom start index", () => {
    const result = buildWhere({ name: "John" }, 5);
    expect(result.sql).toBe('WHERE "name" = $5');
    expect(result.params).toEqual(["John"]);
  });

  it("builds neq operator", () => {
    const result = buildWhere({ status: { _operator: "neq", value: "deleted" } });
    expect(result.sql).toBe('WHERE "status" != $1');
    expect(result.params).toEqual(["deleted"]);
  });

  it("builds gt operator", () => {
    const result = buildWhere({ age: { _operator: "gt", value: 18 } });
    expect(result.sql).toBe('WHERE "age" > $1');
    expect(result.params).toEqual([18]);
  });

  it("builds in operator", () => {
    const result = buildWhere({ id: { _operator: "in", value: [1, 2, 3] } });
    expect(result.sql).toBe('WHERE "id" IN ($1, $2, $3)');
    expect(result.params).toEqual([1, 2, 3]);
  });

  it("skips empty in operator", () => {
    const result = buildWhere({ id: { _operator: "in", value: [] } });
    expect(result.sql).toBe("");
    expect(result.params).toEqual([]);
  });

  it("builds like operator", () => {
    const result = buildWhere({ name: { _operator: "like", value: "%John%" } });
    expect(result.sql).toBe('WHERE "name" LIKE $1');
    expect(result.params).toEqual(["%John%"]);
  });
});

describe("buildSelect", () => {
  it("builds simple select", () => {
    const result = buildSelect("public", "users", ["id", "name"]);
    expect(result.sql).toBe('SELECT "id", "name" FROM "public"."users"');
    expect(result.params).toEqual([]);
  });

  it("builds select with where", () => {
    const result = buildSelect("public", "users", ["id", "name"], {
      where: { active: true },
    });
    expect(result.sql).toContain('WHERE "active" = $1');
    expect(result.params).toEqual([true]);
  });

  it("builds select with limit and offset", () => {
    const result = buildSelect("public", "users", ["id"], {
      limit: 10,
      offset: 20,
    });
    expect(result.sql).toContain("LIMIT $1");
    expect(result.sql).toContain("OFFSET $2");
    expect(result.params).toEqual([10, 20]);
  });

  it("builds select with order by", () => {
    const result = buildSelect("public", "users", ["id"], {
      orderBy: { column: "name", direction: "ASC" },
    });
    expect(result.sql).toContain('ORDER BY "name" ASC');
  });

  it("builds select with desc order", () => {
    const result = buildSelect("public", "users", ["id"], {
      orderBy: { column: "created_at", direction: "DESC" },
    });
    expect(result.sql).toContain('ORDER BY "created_at" DESC');
  });
});

describe("buildSelectByFk", () => {
  it("builds select by foreign key", () => {
    const result = buildSelectByFk("public", "posts", ["id", "title"], "user_id", 42);
    expect(result.sql).toContain('WHERE "user_id" = $1');
    expect(result.params).toEqual([42]);
  });

  it("builds select by fk with limit", () => {
    const result = buildSelectByFk("public", "posts", ["id"], "user_id", 42, {
      limit: 5,
    });
    expect(result.sql).toContain("LIMIT $2");
    expect(result.params).toEqual([42, 5]);
  });
});

describe("buildInsert", () => {
  it("builds insert query", () => {
    const result = buildInsert("public", "users", { name: "John", age: 30 });
    expect(result.sql).toBe(
      'INSERT INTO "public"."users" ("name", "age") VALUES ($1, $2) RETURNING *'
    );
    expect(result.params).toEqual(["John", 30]);
  });
});

describe("buildUpdate", () => {
  it("builds update query", () => {
    const result = buildUpdate("public", "users", { column: "id", value: 1 }, { name: "Jane" });
    expect(result.sql).toBe(
      'UPDATE "public"."users" SET "name" = $1 WHERE "id" = $2 RETURNING *'
    );
    expect(result.params).toEqual(["Jane", 1]);
  });
});

describe("buildDelete", () => {
  it("builds delete query", () => {
    const result = buildDelete("public", "users", { column: "id", value: 1 });
    expect(result.sql).toBe('DELETE FROM "public"."users" WHERE "id" = $1 RETURNING *');
    expect(result.params).toEqual([1]);
  });
});
