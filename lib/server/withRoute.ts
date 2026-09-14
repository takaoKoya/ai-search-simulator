import { NextResponse } from "next/server";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@/lib/server/errors";

/**
 * Wraps a route handler body so every API route gets consistent error → HTTP
 * status mapping instead of leaking stack traces or defaulting to 500.
 */
export function withRoute<T>(handler: () => Promise<T>): Promise<NextResponse> {
  return handler()
    .then((data) => NextResponse.json(data satisfies T))
    .catch((error: unknown) => {
      if (error instanceof UnauthorizedError) {
        return NextResponse.json({ error: error.message }, { status: 401 });
      }
      if (error instanceof ForbiddenError) {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error instanceof NotFoundError) {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      if (error instanceof ValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      console.error(error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    });
}
