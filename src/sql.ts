export const quoteIdentifier = (name: string): string => `"${name}"`;

export interface WhereClause {
  sql: string;
  params: unknown[];
}

export const buildWhere = (
  conditions: Record<string, unknown>,
  startIndex: number = 1
): WhereClause => {
  const parts: string[] = [];
  const params: unknown[] = [];
  let paramIndex = startIndex;

  for (const [column, value] of Object.entries(conditions)) {
    if (value === null) {
      parts.push(`${quoteIdentifier(column)} IS NULL`);
    } else if (typeof value === "object" && value !== null && "_operator" in value) {
      const op = value as { _operator: string; value: unknown };
      switch (op._operator) {
        case "neq":
          parts.push(`${quoteIdentifier(column)} != $${paramIndex}`);
          params.push(op.value);
          paramIndex++;
          break;
        case "gt":
          parts.push(`${quoteIdentifier(column)} > $${paramIndex}`);
          params.push(op.value);
          paramIndex++;
          break;
        case "gte":
          parts.push(`${quoteIdentifier(column)} >= $${paramIndex}`);
          params.push(op.value);
          paramIndex++;
          break;
        case "lt":
          parts.push(`${quoteIdentifier(column)} < $${paramIndex}`);
          params.push(op.value);
          paramIndex++;
          break;
        case "lte":
          parts.push(`${quoteIdentifier(column)} <= $${paramIndex}`);
          params.push(op.value);
          paramIndex++;
          break;
        case "in":
          if (Array.isArray(op.value) && op.value.length > 0) {
            const placeholders = op.value.map((_, i) => `$${paramIndex + i}`).join(", ");
            parts.push(`${quoteIdentifier(column)} IN (${placeholders})`);
            params.push(...op.value);
            paramIndex += op.value.length;
          }
          break;
        case "like":
          parts.push(`${quoteIdentifier(column)} LIKE $${paramIndex}`);
          params.push(op.value);
          paramIndex++;
          break;
        default:
          parts.push(`${quoteIdentifier(column)} = $${paramIndex}`);
          params.push(op.value);
          paramIndex++;
      }
    } else {
      parts.push(`${quoteIdentifier(column)} = $${paramIndex}`);
      params.push(value);
      paramIndex++;
    }
  }

  return {
    sql: parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "",
    params,
  };
};

export interface SelectQuery {
  sql: string;
  params: unknown[];
}

export const buildSelect = (
  schema: string,
  table: string,
  columns: string[],
  options: {
    where?: Record<string, unknown>;
    limit?: number;
    offset?: number;
    orderBy?: { column: string; direction: "ASC" | "DESC" };
  } = {}
): SelectQuery => {
  const selectList = columns.map(quoteIdentifier).join(", ");
  const from = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

  let paramIndex = 1;
  const params: unknown[] = [];
  const clauses: string[] = [];

  if (options.where) {
    const where = buildWhere(options.where, paramIndex);
    if (where.sql) {
      clauses.push(where.sql);
      params.push(...where.params);
      paramIndex += where.params.length;
    }
  }

  if (options.orderBy) {
    const dir = options.orderBy.direction === "DESC" ? "DESC" : "ASC";
    clauses.push(`ORDER BY ${quoteIdentifier(options.orderBy.column)} ${dir}`);
  }

  if (options.limit !== undefined) {
    clauses.push(`LIMIT $${paramIndex}`);
    params.push(options.limit);
    paramIndex++;
  }

  if (options.offset !== undefined) {
    clauses.push(`OFFSET $${paramIndex}`);
    params.push(options.offset);
    paramIndex++;
  }

  return {
    sql: `SELECT ${selectList} FROM ${from} ${clauses.join(" ")}`.trim(),
    params,
  };
};

export const buildSelectByFk = (
  schema: string,
  table: string,
  columns: string[],
  fkColumn: string,
  parentValue: unknown,
  options: {
    limit?: number;
    offset?: number;
    orderBy?: { column: string; direction: "ASC" | "DESC" };
  } = {}
): SelectQuery => {
  const selectList = columns.map(quoteIdentifier).join(", ");
  const from = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const fkCol = quoteIdentifier(fkColumn);

  let paramIndex = 1;
  const params: unknown[] = [];
  const clauses: string[] = [];

  clauses.push(`WHERE ${fkCol} = $${paramIndex}`);
  params.push(parentValue);
  paramIndex++;

  if (options.orderBy) {
    const dir = options.orderBy.direction === "DESC" ? "DESC" : "ASC";
    clauses.push(`ORDER BY ${quoteIdentifier(options.orderBy.column)} ${dir}`);
  }

  if (options.limit !== undefined) {
    clauses.push(`LIMIT $${paramIndex}`);
    params.push(options.limit);
    paramIndex++;
  }

  if (options.offset !== undefined) {
    clauses.push(`OFFSET $${paramIndex}`);
    params.push(options.offset);
    paramIndex++;
  }

  return {
    sql: `SELECT ${selectList} FROM ${from} ${clauses.join(" ")}`,
    params,
  };
};

export const buildInsert = (
  schema: string,
  table: string,
  values: Record<string, unknown>
): { sql: string; params: unknown[] } => {
  const columns = Object.keys(values);
  const qualifiedColumns = columns.map(quoteIdentifier);
  const paramPlaceholders = columns.map((_, i) => `$${i + 1}`);
  const params = Object.values(values);
  const from = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

  return {
    sql: `INSERT INTO ${from} (${qualifiedColumns.join(", ")}) VALUES (${paramPlaceholders.join(", ")}) RETURNING *`,
    params,
  };
};

export const buildUpdate = (
  schema: string,
  table: string,
  primaryKey: { column: string; value: unknown },
  values: Record<string, unknown>
): { sql: string; params: unknown[] } => {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  for (const [column, value] of Object.entries(values)) {
    setClauses.push(`${quoteIdentifier(column)} = $${paramIndex}`);
    params.push(value);
    paramIndex++;
  }

  params.push(primaryKey.value);
  const from = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

  return {
    sql: `UPDATE ${from} SET ${setClauses.join(", ")} WHERE ${quoteIdentifier(primaryKey.column)} = $${paramIndex} RETURNING *`,
    params,
  };
};

export const buildDelete = (
  schema: string,
  table: string,
  primaryKey: { column: string; value: unknown }
): { sql: string; params: unknown[] } => {
  const from = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;

  return {
    sql: `DELETE FROM ${from} WHERE ${quoteIdentifier(primaryKey.column)} = $1 RETURNING *`,
    params: [primaryKey.value],
  };
};

export const buildSelectWithFilter = (
  schema: string,
  table: string,
  filterSuffix: string,
  columns: string[],
  options: {
    where?: Record<string, unknown>;
    limit?: number;
    offset?: number;
    orderBy?: { column: string; direction: "ASC" | "DESC" };
  } = {}
): SelectQuery => {
  const selectList = columns.map(quoteIdentifier).join(", ");
  const filterFunc = `${quoteIdentifier(schema)}.${quoteIdentifier(`${table}_${filterSuffix}`)}()`;

  let paramIndex = 1;
  const params: unknown[] = [];
  const clauses: string[] = [];

  if (options.where) {
    const where = buildWhere(options.where, paramIndex);
    if (where.sql) {
      clauses.push(where.sql);
      params.push(...where.params);
      paramIndex += where.params.length;
    }
  }

  if (options.orderBy) {
    const dir = options.orderBy.direction === "DESC" ? "DESC" : "ASC";
    clauses.push(`ORDER BY ${quoteIdentifier(options.orderBy.column)} ${dir}`);
  }

  if (options.limit !== undefined) {
    clauses.push(`LIMIT $${paramIndex}`);
    params.push(options.limit);
    paramIndex++;
  }

  if (options.offset !== undefined) {
    clauses.push(`OFFSET $${paramIndex}`);
    params.push(options.offset);
    paramIndex++;
  }

  return {
    sql: `SELECT ${selectList} FROM ${filterFunc} ${clauses.join(" ")}`.trim(),
    params,
  };
};

export const buildSelectByFkWithFilter = (
  schema: string,
  table: string,
  filterSuffix: string,
  columns: string[],
  fkColumn: string,
  parentValue: unknown,
  options: {
    limit?: number;
    offset?: number;
    orderBy?: { column: string; direction: "ASC" | "DESC" };
  } = {}
): SelectQuery => {
  const selectList = columns.map(quoteIdentifier).join(", ");
  const filterFunc = `${quoteIdentifier(schema)}.${quoteIdentifier(`${table}_${filterSuffix}`)}()`;
  const fkCol = quoteIdentifier(fkColumn);

  let paramIndex = 1;
  const params: unknown[] = [];
  const clauses: string[] = [];

  clauses.push(`WHERE ${fkCol} = $${paramIndex}`);
  params.push(parentValue);
  paramIndex++;

  if (options.orderBy) {
    const dir = options.orderBy.direction === "DESC" ? "DESC" : "ASC";
    clauses.push(`ORDER BY ${quoteIdentifier(options.orderBy.column)} ${dir}`);
  }

  if (options.limit !== undefined) {
    clauses.push(`LIMIT $${paramIndex}`);
    params.push(options.limit);
    paramIndex++;
  }

  if (options.offset !== undefined) {
    clauses.push(`OFFSET $${paramIndex}`);
    params.push(options.offset);
    paramIndex++;
  }

  return {
    sql: `SELECT ${selectList} FROM ${filterFunc} ${clauses.join(" ")}`,
    params,
  };
};

export const buildDeleteWithFilter = (
  schema: string,
  table: string,
  filterSuffix: string,
  primaryKey: { column: string; value: unknown }
): { sql: string; params: unknown[] } => {
  const filterFunc = `${quoteIdentifier(schema)}.${quoteIdentifier(`${table}_${filterSuffix}`)}()`;
  const pkCol = quoteIdentifier(primaryKey.column);

  return {
    sql: `DELETE FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)} WHERE ${pkCol} = $1 AND ${pkCol} IN (SELECT ${pkCol} FROM ${filterFunc}) RETURNING *`,
    params: [primaryKey.value],
  };
};

export const buildUpdateWithFilter = (
  schema: string,
  table: string,
  filterSuffix: string,
  primaryKey: { column: string; value: unknown },
  values: Record<string, unknown>
): { sql: string; params: unknown[] } => {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  for (const [column, value] of Object.entries(values)) {
    setClauses.push(`${quoteIdentifier(column)} = $${paramIndex}`);
    params.push(value);
    paramIndex++;
  }

  params.push(primaryKey.value);
  const pkCol = quoteIdentifier(primaryKey.column);
  const filterFunc = `${quoteIdentifier(schema)}.${quoteIdentifier(`${table}_${filterSuffix}`)}()`;

  return {
    sql: `UPDATE ${quoteIdentifier(schema)}.${quoteIdentifier(table)} SET ${setClauses.join(", ")} WHERE ${pkCol} = $${paramIndex} AND ${pkCol} IN (SELECT ${pkCol} FROM ${filterFunc}) RETURNING *`,
    params,
  };
};
