/**
 * POST /api/decide — thin Next.js App Router route (SERVER-ONLY).
 *
 * Handler logic lives in handler.ts; Next.js type-checks Route exports
 * strictly, so route.ts keeps only runtime/dynamic/POST.
 */

import { createDecideHandler } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createDecideHandler();

export async function POST(request: Request): Promise<Response> {
  return handler(request);
}
