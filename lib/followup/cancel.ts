/**
 * Cancelamento de um enrollment vivo.
 *
 * Extraído de POST /api/v1/ai/followups/enrollments/[id]/cancel para o mesmo
 * caminho servir a ferramenta MCP (`crm_cancel_followup_flow`) — mesma regra
 * pra pessoa pela tela e pro agente pela API, igual `enroll.ts` já fazia pro
 * lado da inscrição.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";

// `paused_manual` (0145) é cancelável: quem pausou tem o direito de desistir sem
// ter de retomar antes só para poder encerrar — retomar reagendaria o próximo
// passo, e entre o retomar e o cancelar o motor poderia mandar a mensagem.
const LIVE_STATUSES = ["active", "waiting_reply", "paused_handoff", "paused_manual"];

export type CancelFollowupEnrollmentInput = {
  organizationId: string;
  enrollmentId: string;
  actorUserId: string | null;
  requestId: string;
};

export type CancelFollowupEnrollmentOk = { ok: true; enrollment: Record<string, unknown> };
export type CancelFollowupEnrollmentErr = {
  ok: false;
  code: "not_found" | "already_terminal" | "internal_error";
  message: string;
  status: number;
  status_atual?: string;
};
export type CancelFollowupEnrollmentResult = CancelFollowupEnrollmentOk | CancelFollowupEnrollmentErr;

export async function cancelFollowupEnrollment(
  supabase: SupabaseClient,
  input: CancelFollowupEnrollmentInput,
): Promise<CancelFollowupEnrollmentResult> {
  const { organizationId, enrollmentId, requestId } = input;

  const { data: existing, error: fetchErr } = await supabase
    .from("followup_enrollments")
    .select("id, status, current_node_id")
    .eq("id", enrollmentId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (fetchErr) return { ok: false, code: "internal_error", message: fetchErr.message, status: 500 };
  if (!existing) {
    return { ok: false, code: "not_found", message: "Enrollment não encontrado.", status: 404 };
  }

  if (!LIVE_STATUSES.includes(existing.status)) {
    return {
      ok: false,
      code: "already_terminal",
      message: "Enrollment já está encerrado.",
      status: 409,
      status_atual: existing.status,
    };
  }

  const { data: updated, error: updErr } = await supabase
    .from("followup_enrollments")
    .update({
      status: "cancelled",
      cancel_reason: "manual",
      next_eval_at: null,
      outcome: null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", enrollmentId)
    .eq("organization_id", organizationId)
    .select("id, status, cancel_reason, updated_at, contact_id, pointer_id")
    .single();
  if (updErr || !updated) {
    return {
      ok: false,
      code: "internal_error",
      message: updErr?.message ?? "followup_enrollment_cancel_failed",
      status: 500,
    };
  }

  const { error: eventErr } = await supabase.from("followup_enrollment_events").insert({
    organization_id: organizationId,
    enrollment_id: enrollmentId,
    node_id: existing.current_node_id,
    event_type: "cancelled_manual",
    payload: input.actorUserId
      ? { actor_user_id: input.actorUserId }
      : { actor_type: "api_token", requestId },
  });
  if (eventErr) {
    // Não falha o cancelamento por causa do log de evento — mesma postura do
    // route.ts original (logger.error, segue o fluxo).
    console.error("[followup.enrollment.cancel] event insert failed:", eventErr.message);
  }

  if (input.actorUserId) {
    void audit({
      action: "followup_enrollment.cancelled",
      actorUserId: input.actorUserId,
      organizationId,
      resourceType: "followup_enrollment",
      resourceId: enrollmentId,
      requestId,
      metadata: { previous_status: existing.status },
    });
  }

  return { ok: true, enrollment: updated as Record<string, unknown> };
}
