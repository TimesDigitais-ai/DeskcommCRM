/**
 * Ferramenta MCP para o motor de fluxos de acompanhamento (Follow-up Flows,
 * `app/app/ai/followups/`) — o construtor visual de nós/arestas, DIFERENTE do
 * "retorno" simples de `retencao.ts` (`crm_schedule_followup`).
 *
 * RECONCILIAÇÃO COM O UPSTREAM v1.44.0: este arquivo nasceu no fork com DUAS
 * ferramentas, `crm_enroll_followup_flow` e `crm_cancel_followup_flow`. O upstream
 * passou a ter a sua própria `crm_enroll_followup_flow` (em `retencao.ts`, mesma
 * função `enrollFollowupFlow` por baixo) — então a de inscrever ficou lá, com o
 * `pointer_id` do fork aceito como apelido de `flow_id` (o agente do cliente
 * chama com `pointer_id`), e aqui sobrou só a de CANCELAR, que o upstream não tem.
 *
 * ⚠️ FACHADA FINA: nenhuma regra nova nasce aqui. Inscrever usa
 * `enrollFollowupFlow` (lib/followup/enroll.ts, a MESMA função de
 * POST /api/v1/ai/followups/enrollments); cancelar usa
 * `cancelFollowupEnrollment` (lib/followup/cancel.ts, extraída da rota
 * .../[id]/cancel nesta mesma leva). Reimplementar faria a IA e a pessoa
 * pela tela operarem por regras diferentes.
 *
 * ⚠️ PAPEL: as rotas equivalentes pela tela exigem `manager` — um atendente
 * humano não mexe manualmente no motor de fluxo. `ai_operator` dá ao agente
 * publicado o alcance que a pessoa não tem pela tela, pelo mesmo motivo do
 * pacote `reter`: sem isso a IA não consegue marcar o próprio próximo passo,
 * e a demanda fica sem dono (doutrina `sistema-vivo.md`, invariante 4).
 *
 * ⚠️ ISTO NUNCA ENVIA MENSAGEM. O grafo publicado que o agente aponta aqui
 * (`pointer_id`) precisa ser construído SEM nó `action` — um enrollment que
 * alcança um nó de ação enfileira um envio de verdade pelo canal conectado
 * NESTE CRM (ver `node-handlers.ts` case "action"). Quem usa esta ferramenta
 * para espelhar uma régua que já entrega por outro canal (o caso de um cliente:
 * o agente entrega pelo WhatsApp próprio, o CRM só mostra em que etapa cada
 * cliente está) precisa publicar o fluxo só com trigger → wait → end.
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { cancelFollowupEnrollment } from "@/lib/followup/cancel";
import type { McpToolDefinition } from "../types";

/** Payload de auditoria a partir do ator do ctx (user humano ou agente). */
function actorAudit(ctx: { actor: { type: string; id: string } }): {
  actorUserId: string | null;
  metadataActor: Record<string, unknown>;
} {
  if (ctx.actor.type === "user") {
    return { actorUserId: ctx.actor.id, metadataActor: { actor_type: "user" } };
  }
  return {
    actorUserId: null,
    metadataActor: { actor_type: ctx.actor.type, actor_id: ctx.actor.id },
  };
}

// ---------------------------------------------------------------------------
// crm_cancel_followup_flow
// ---------------------------------------------------------------------------

const cancelShape = {
  enrollment_id: z.string().uuid(),
};

export const crmCancelFollowupFlow: McpToolDefinition<typeof cancelShape> = {
  name: "crm_cancel_followup_flow",
  description:
    "Tira um cliente do fluxo de acompanhamento em que ele está (por exemplo, porque ele respondeu, " +
    "ou porque você vai inscrevê-lo na próxima etapa). Enrollment já encerrado ou inexistente devolve " +
    "cancelado=false, e isso não é erro.",
  inputSchema: cancelShape,
  category: "write",
  requiresRole: "ai_operator",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const resultado = await cancelFollowupEnrollment(ctx.supabase, {
      organizationId: ctx.organizationId,
      enrollmentId: input.enrollment_id,
      actorUserId: ctx.actor.type === "user" ? ctx.actor.id : null,
      requestId: ctx.requestId,
    });

    if (!resultado.ok) {
      return {
        cancelado: false,
        motivo: resultado.code,
        mensagem:
          resultado.code === "not_found"
            ? "não existe fluxo de acompanhamento com esse identificador nesta organização."
            : "este fluxo já tinha sido encerrado — não há o que cancelar.",
      };
    }

    const a = actorAudit(ctx);
    await audit({
      action: "followup_enrollment.cancelled",
      actorUserId: a.actorUserId,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "followup_enrollment",
      resourceId: input.enrollment_id,
      requestId: ctx.requestId,
      metadata: { ...a.metadataActor, via: "mcp" },
    });

    return { cancelado: true, enrollment_id: input.enrollment_id };
  },
};
