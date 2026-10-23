import { describe, expect, spyOn, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createContext, publicProcedure, router } from "./init";

const testRouter = router({
  boom: publicProcedure.query(() => {
    throw new Error('Failed query: insert into "theater_membership" ...');
  }),
  missing: publicProcedure.query(() => {
    throw new TRPCError({ code: "NOT_FOUND", message: "Theater not found" });
  }),
});

const call = async (path: string) => {
  const res = await fetchRequestHandler({
    endpoint: "/trpc",
    req: new Request(`http://test/trpc/${path}`),
    router: testRouter,
    createContext: ({ req, resHeaders }) => createContext({ req, resHeaders, ip: "test" }),
  });
  return (await res.json()) as { error: { message: string } };
};

describe("error formatter", () => {
  test("internal errors reach the client as a generic message and are logged", async () => {
    const log = spyOn(console, "error").mockImplementation(() => undefined);
    const body = await call("boom");
    expect(body.error.message).toBe("Something went wrong");
    expect(JSON.stringify(body)).not.toContain("Failed query");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  test("expected errors keep their message", async () => {
    expect((await call("missing")).error.message).toBe("Theater not found");
  });
});
