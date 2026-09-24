import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { mirrorConfigSchema } from "@/lib/channels/mirror/contract";
import { createMirror, listMirrors } from "@/lib/channels/mirror/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "channel_mirrors" });
  if (!auth.ok) return auth.response;
  try { return ok(await listMirrors(getRequestPool(), auth.org.orgId), { requestId }); }
  catch { return fail("internal_error", "Não foi possível consultar os espelhos.", 503, { requestId }); }
}

export async function POST(req: NextRequest) {
  const denied = await requireSupportWrite(); if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "channel_mirrors" });
  if (!auth.ok) return auth.response;
  const parsed = mirrorConfigSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("invalid_request", "Confira nome, empresa na origem e números com DDI.", 422, { requestId });
  try {
    const result = await createMirror(getRequestPool(), auth.org.orgId, parsed.data);
    void audit({ action: "channel.mirror_created", organizationId: auth.org.orgId, actorUserId: auth.user.id, resourceType: "channel_mirrors", resourceId: result.id, requestId });
    return ok({ id: result.id, webhook_path: `/api/v1/webhooks/mirror/${result.token}` }, { requestId });
  } catch { return fail("internal_error", "Não foi possível criar o espelho.", 503, { requestId }); }
}

export async function PATCH(req: NextRequest) {
  const denied = await requireSupportWrite(); if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole("admin", { requestId, resource: "channel_mirrors" });
  if (!auth.ok) return auth.response;
  const parsed = z.object({ id: z.string().uuid(), enabled: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("invalid_request", "Configuração inválida.", 422, { requestId });
  try {
    const result = await getRequestPool().query("update channel_mirrors set enabled=$3 where organization_id=$1 and id=$2 returning id", [auth.org.orgId, parsed.data.id, parsed.data.enabled]);
    if (!result.rowCount) return fail("not_found", "Espelho não encontrado.", 404, { requestId });
    void audit({ action: "channel.mirror_updated", organizationId: auth.org.orgId, actorUserId: auth.user.id, resourceType: "channel_mirrors", resourceId: parsed.data.id, requestId });
    return ok({ enabled: parsed.data.enabled }, { requestId });
  } catch { return fail("internal_error", "Não foi possível alterar o espelho.", 503, { requestId }); }
}
