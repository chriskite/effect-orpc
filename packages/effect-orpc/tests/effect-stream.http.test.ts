import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { eventIterator } from "@orpc/contract";
import { RPCHandler } from "@orpc/server/node";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import z from "zod";

import { makeEffectORPC, ORPCTaggedError } from "../src";

class NotFoundError extends ORPCTaggedError("NOT_FOUND", { status: 404 }) {}

const runtime = ManagedRuntime.make(Layer.empty);
const builder = makeEffectORPC(runtime);

const router = {
  numbers: builder
    .input(z.object({ count: z.number() }))
    .output(eventIterator(z.object({ value: z.number() })))
    .effect(({ input }) =>
      Stream.map(Stream.range(1, input.count), (value) => ({ value })),
    ),
  // Yields one value, then fails mid-stream so the error crosses the SSE wire.
  failsMidStream: builder
    .output(eventIterator(z.object({ value: z.number() })))
    .effect(() =>
      Stream.concat(
        Stream.make({ value: 1 }),
        Stream.fail(new NotFoundError()),
      ),
    ),
  // Emits one tick every 20ms forever — used to test client-side abort.
  infinite: builder
    .output(eventIterator(z.object({ tick: z.number() })))
    .effect(() =>
      Stream.map(
        Stream.repeatEffect(Effect.as(Effect.sleep("20 millis"), 1)),
        () => ({ tick: 1 }),
      ),
    ),
};

let server: Server;
let client: any;

beforeAll(async () => {
  const handler = new RPCHandler(router);
  server = createServer((req, res) => {
    void handler.handle(req, res, { context: {} });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const link = new RPCLink({ url: `http://127.0.0.1:${port}` });
  client = createORPCClient(link);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe("effect stream over HTTP/SSE", () => {
  it("streams yielded values to a real SSE client", async () => {
    const iterator = await client.numbers({ count: 3 });

    const values: { value: number }[] = [];
    for await (const value of iterator) {
      values.push(value);
    }

    expect(values).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }]);
  });

  it("propagates a mid-stream failure as an ORPCError over the wire", async () => {
    const iterator = await client.failsMidStream();

    const values: { value: number }[] = [];
    let caught: unknown;
    try {
      for await (const value of iterator) {
        values.push(value);
      }
    } catch (error) {
      caught = error;
    }

    expect(values).toEqual([{ value: 1 }]);
    expect(caught).toBeInstanceOf(ORPCError);
    expect((caught as ORPCError<string, unknown>).code).toBe("NOT_FOUND");
    expect((caught as ORPCError<string, unknown>).status).toBe(404);
  });

  it("stops the server stream when the client breaks early", async () => {
    const iterator = await client.infinite();

    const ticks: { tick: number }[] = [];
    for await (const value of iterator) {
      ticks.push(value);
      if (ticks.length >= 2) {
        break; // closes the SSE connection; server fiber should be interrupted
      }
    }

    expect(ticks.length).toBe(2);
  });
});
