import { describe, it, expect } from "vitest";
import { SubscriptionManager } from "./realtime";
import { createFakePgClient, publishChange } from "./test-support";

describe("SubscriptionManager", () => {
  it("delivers change events to subscribers for the matching table", async () => {
    const client = createFakePgClient();
    const manager = new SubscriptionManager(client as never);
    await manager.start();

    const received: unknown[] = [];
    manager.subscribe("public.users", (event) => received.push(event));

    publishChange(client, {
      schema: "public",
      table: "users",
      operation: "INSERT",
      row: { id: 1, name: "Alice" },
    });

    publishChange(client, {
      schema: "public",
      table: "posts",
      operation: "INSERT",
      row: { id: 1, title: "Hello" },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      schema: "public",
      table: "users",
      operation: "INSERT",
      row: { id: 1, name: "Alice" },
    });
  });

  it("does not deliver after unsubscribe", async () => {
    const client = createFakePgClient();
    const manager = new SubscriptionManager(client as never);
    await manager.start();

    const received: unknown[] = [];
    const unsubscribe = manager.subscribe("public.users", (event) => received.push(event));
    unsubscribe();

    publishChange(client, {
      schema: "public",
      table: "users",
      operation: "UPDATE",
      row: { id: 1 },
    });

    expect(received).toHaveLength(0);
  });

  it("ignores notifications for other channels and malformed payloads", async () => {
    const client = createFakePgClient();
    const manager = new SubscriptionManager(client as never);
    await manager.start();

    const received: unknown[] = [];
    manager.subscribe("public.users", (event) => received.push(event));

    client.emit("notification", { channel: "other", payload: "{}" });
    client.emit("notification", { channel: "pgapi_changes", payload: "not json" });
    client.emit("notification", { channel: "pgapi_changes", payload: undefined });

    expect(received).toHaveLength(0);
  });

  it("issues LISTEN on start and UNLISTEN on stop", async () => {
    const client = createFakePgClient();
    const manager = new SubscriptionManager(client as never);
    await manager.start();
    await manager.stop();

    expect(client.queries).toContain('LISTEN "pgapi_changes"');
    expect(client.queries).toContain('UNLISTEN "pgapi_changes"');
  });

  it("stop removes notification listeners", async () => {
    const client = createFakePgClient();
    const manager = new SubscriptionManager(client as never);
    await manager.start();
    await manager.stop();

    const received: unknown[] = [];
    manager.subscribe("public.users", (event) => received.push(event));

    publishChange(client, {
      schema: "public",
      table: "users",
      operation: "INSERT",
      row: { id: 1 },
    });

    expect(received).toHaveLength(0);
  });
});
