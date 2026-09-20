/**
 * GET /api/race-window — thin Next.js App Router route (SERVER-ONLY).
 *
 * Handler logic lives in handler.ts; Next.js type-checks Route exports
 * strictly, so route.ts keeps only runtime/dynamic/GET.
 */

import { createRaceWindowHandler } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createRaceWindowHandler();

export async function GET(request: Request): Promise<Response> {
  return handler(request);
}
