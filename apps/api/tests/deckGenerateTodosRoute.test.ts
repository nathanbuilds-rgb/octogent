import { describe, expect, it } from "vitest";
import { handleDeckGenerateTodosRoute } from "../src/createApiServer/deckRoutes";

// Minimal fake ServerResponse capturing status + JSON body.
const makeResponse = () => {
  const res: {
    statusCode?: number;
    body?: unknown;
    writeHead: (status: number, headers?: unknown) => typeof res;
    end: (chunk?: string) => void;
  } = {
    writeHead(status) {
      res.statusCode = status;
      return res;
    },
    end(chunk) {
      res.body = chunk ? JSON.parse(chunk) : undefined;
    },
  };
  return res;
};

const makeRequest = (method: string, jsonBody: unknown) => {
  const body = JSON.stringify(jsonBody);
  return {
    method,
    headers: { "content-type": "application/json" },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(body);
    },
  } as never;
};

describe("handleDeckGenerateTodosRoute", () => {
  it("returns false for a non-matching path", async () => {
    const handled = await handleDeckGenerateTodosRoute(
      {
        request: makeRequest("POST", {}),
        response: makeResponse() as never,
        requestUrl: new URL("http://x/api/deck/tentacles"),
        corsOrigin: null,
      },
      { workspaceCwd: "/tmp" } as never,
    );
    expect(handled).toBe(false);
  });

  it("400s when description is missing", async () => {
    const res = makeResponse();
    const handled = await handleDeckGenerateTodosRoute(
      {
        request: makeRequest("POST", { name: "auth" }),
        response: res as never,
        requestUrl: new URL("http://x/api/deck/tentacles/generate-todos"),
        corsOrigin: null,
      },
      { workspaceCwd: "/tmp" } as never,
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
  });
});
