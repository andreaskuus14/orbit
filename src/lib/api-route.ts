import { errorResponse, logLine } from "./api-error-pure.ts";

/** Wrap a route handler: a throw becomes a JSON error (500/503/504) with a redacted log line, never a stack or a white page. */
export function guard<A extends unknown[]>(name: string, fn: (...a: A) => Response | Promise<Response>): (...a: A) => Promise<Response> {
  return async (...a: A) => {
    try { return await fn(...a); }
    catch (e) {
      console.error(logLine(name, e, process.env));
      const { status, body } = errorResponse(e, process.env);
      return Response.json(body, { status });
    }
  };
}
