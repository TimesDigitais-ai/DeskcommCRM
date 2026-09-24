import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * POST /api/v1/ai/followups/enrollments/:id/cancel (manager+) — encerra um
 *   enrollment VIVO (active|waiting_reply|paused_handoff) manualmente pela
 *   fila. 409 `already_terminal` se já tiver encerrado (completed/cancelled/
 *   dead) — cancelar 2x não é erro operacional, mas também não deve reescrever
 *   o desfecho de um enrollment que já fechou por conta própria.
 *
 * Promessas (`cron_jobs`) NÃO são canceláveis por aqui — fora de escopo desta
 *   task; só enrollments do motor.
 *
 * Regra extraída para `lib/followup/cancel.ts` — a mesma função também serve
 * a ferramenta MCP `crm_cancel_followup_flow`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { cancelFollowupEnrollment } from "@/lib/followup/cancel";
import { createClient } from "@/lib/supabase/server";
import { traduzir } from "@/lib/i18n/dicionario";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) {
    return fail("invalid_request", "id inválido.", 400, { requestId });
  }

  const authz = await requireRole("manager", { requestId, resource: "followup_enrollments" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const { user, org: activeOrg } = authz;

  const supabase = await createClient();
  const resultado = await cancelFollowupEnrollment(supabase, {
    organizationId: activeOrg.orgId,
    enrollmentId: id,
    actorUserId: user.id,
    requestId,
  });

  if (!resultado.ok) {
    return fail(
      resultado.code,
      resultado.code === "not_found" ? t("Enrollment não encontrado.") : t("Enrollment já está encerrado."),
      resultado.status,
      { requestId },
    );
  }

  return ok(resultado.enrollment, { requestId });
}
