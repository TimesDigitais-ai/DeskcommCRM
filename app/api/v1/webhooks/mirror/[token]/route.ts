import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { hashMirrorToken, ingestMirror } from "@/lib/channels/mirror/store";
import { MirrorReject } from "@/lib/channels/mirror/contract";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const MAX_BODY = 262144;

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const requestId = randomUUID();
  const token = tokenSchema.safeParse((await ctx.params).token);
  if (!token.success) return fail("not_found", "Webhook desconhecido.", 404, { requestId });
  const limit = await checkRateLimit(`mirror:${hashMirrorToken(token.data)}`, 120, 60);
  if (!limit.allowed) return fail("rate_limited", "Limite temporário de eventos.", 429, { requestId });
  if (!req.headers.get("content-type")?.startsWith("application/json")) return fail("invalid_request", "Use application/json.", 415, { requestId });
  const reader = req.body?.getReader();
  if (!reader) return fail("invalid_request", "Corpo ausente.", 400, { requestId });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); return fail("invalid_request", "Evento muito grande.", 413, { requestId }); }
      chunks.push(value);
    }
    const payload: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const result = await ingestMirror(getRequestPool(), token.data, payload);
    if (result.status !== "ignored") void audit({ action: "channel.mirror_received", organizationId: result.organizationId, resourceType: "messages", resourceId: result.messageId, requestId, bypassedRls: true, metadata: { outcome: result.status } });
    return ok({ status: result.status }, { requestId });
  } catch (err) {
    if (err instanceof MirrorReject) return fail("invalid_request", err.code, err.status, { requestId });
    if (err instanceof SyntaxError) return fail("invalid_request", "JSON inválido.", 400, { requestId });
    return fail("internal_error", "Não foi possível persistir o evento. A origem pode tentar novamente.", 503, { requestId });
  } finally { reader.releaseLock(); }
}
