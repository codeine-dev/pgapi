import type { Client } from "pg";
import type { Table } from "./schema";
import { quoteIdentifier } from "./sql";

export type ChangeOperation = "INSERT" | "UPDATE" | "DELETE";

export interface ChangeEvent {
  schema: string;
  table: string;
  operation: ChangeOperation;
  row: Record<string, unknown>;
}

export type ChangeListener = (event: ChangeEvent) => void;

const CHANNEL = "pgapi_changes";
const TRIGGER_NAME = "pgapi_change_notify";
const TRIGGER_FUNCTION_NAME = "pgapi_change_notify";

const TRIGGER_FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION ${TRIGGER_FUNCTION_NAME}()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  _payload jsonb;
BEGIN
  _payload := jsonb_build_object(
    'schema', TG_TABLE_SCHEMA,
    'table', TG_TABLE_NAME,
    'operation', TG_OP,
    'row', CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END
  );
  PERFORM pg_notify('${CHANNEL}', _payload::text);
  RETURN COALESCE(NEW, OLD);
END;
$function$;
`;

export const ensureChangeTriggers = async (client: Client, tables: Table[]): Promise<void> => {
  const triggerable = tables.filter((t) => t.type === "table");
  if (triggerable.length === 0) return;

  await client.query(TRIGGER_FUNCTION_SQL);

  for (const table of triggerable) {
    const qualified = `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`;
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = '${TRIGGER_NAME}'
            AND tgrelid = '${qualified}'::regclass
        ) THEN
          CREATE TRIGGER ${TRIGGER_NAME}
            AFTER INSERT OR UPDATE OR DELETE ON ${qualified}
            FOR EACH ROW EXECUTE FUNCTION ${TRIGGER_FUNCTION_NAME}();
        END IF;
      END $$;
    `);
  }
};

export class SubscriptionManager {
  private readonly listeners = new Map<string, Set<ChangeListener>>();

  constructor(private readonly client: Client) {}

  async start(): Promise<void> {
    await this.client.query(`LISTEN ${quoteIdentifier(CHANNEL)}`);
    this.client.on("notification", this.handleNotification);
  }

  async stop(): Promise<void> {
    this.client.removeAllListeners("notification");
    try {
      await this.client.query(`UNLISTEN ${quoteIdentifier(CHANNEL)}`);
    } catch {
      // ignore errors during shutdown
    }
  }

  subscribe(tableKey: string, listener: ChangeListener): () => void {
    let set = this.listeners.get(tableKey);
    if (!set) {
      set = new Set<ChangeListener>();
      this.listeners.set(tableKey, set);
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(tableKey);
      if (current) {
        current.delete(listener);
        if (current.size === 0) this.listeners.delete(tableKey);
      }
    };
  }

  private readonly handleNotification = (msg: { channel: string; payload?: string }): void => {
    if (msg.channel !== CHANNEL || !msg.payload) return;

    let event: ChangeEvent;
    try {
      event = JSON.parse(msg.payload) as ChangeEvent;
    } catch {
      return;
    }

    if (typeof event.schema !== "string" || typeof event.table !== "string") return;

    const set = this.listeners.get(`${event.schema}.${event.table}`);
    if (!set) return;

    for (const listener of Array.from(set)) {
      try {
        listener(event);
      } catch {
        // a failing listener must not prevent delivery to others
      }
    }
  };
}
