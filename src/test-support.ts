import type { Client } from "pg";
import { SubscriptionManager } from "./realtime";

export interface FakePgClient {
  query: (sql: string) => Promise<{ rows: unknown[] }>;
  on: (event: string, cb: (msg: unknown) => void) => FakePgClient;
  removeAllListeners: (event?: string) => FakePgClient;
  emit: (event: string, msg: unknown) => void;
  queries: string[];
}

export const createFakePgClient = (): FakePgClient => {
  const listeners = new Map<string, Array<(msg: unknown) => void>>();

  const client: FakePgClient = {
    queries: [],
    async query(sql: string) {
      client.queries.push(sql);
      return { rows: [] };
    },
    on(event: string, cb: (msg: unknown) => void) {
      const arr = listeners.get(event) ?? [];
      arr.push(cb);
      listeners.set(event, arr);
      return client;
    },
    removeAllListeners(event?: string) {
      if (event) {
        listeners.delete(event);
      } else {
        listeners.clear();
      }
      return client;
    },
    emit(event: string, msg: unknown) {
      for (const cb of listeners.get(event) ?? []) cb(msg);
    },
  };

  return client;
};

export const createFakeSubscriptionManager = async (): Promise<{ manager: SubscriptionManager; client: FakePgClient }> => {
  const client = createFakePgClient();
  const manager = new SubscriptionManager(client as unknown as Client);
  await manager.start();
  return { manager, client };
};

export const publishChange = (client: FakePgClient, event: { schema: string; table: string; operation: string; row: Record<string, unknown> }): void => {
  client.emit("notification", {
    channel: "pgapi_changes",
    payload: JSON.stringify(event),
  });
};
