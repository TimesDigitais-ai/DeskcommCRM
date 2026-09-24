/**
 * `crm_enroll_followup_flow` / `crm_cancel_followup_flow` — ferramentas novas
 * pra um cliente do fork: o agente/orquestrador marcam em que etapa de acompanhamento
 * um cliente está, sem NUNCA mandar mensagem por aqui (quem entrega continua
 * sendo o canal próprio de cada um).
 *
 * O handler em si (enrollFollowupFlow/cancelFollowupEnrollment) já tem
 * cobertura própria via a rota REST equivalente — este teste cobre só o que é
 * NOVO: o contrato de wire da ferramenta (papel mínimo, shape do input) e que
 * ela está de fato registrada no agregador, porque um handler sem entrada no
 * catálogo (ou vice-versa) falha em silêncio até alguém tentar publicar um
 * agente com ela.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { crmCancelFollowupFlow } from "./followup-flow";
import { crmEnrollFollowupFlow } from "./retencao";
import { allTools } from "./index";
import { catalogEntry } from "./catalog";

describe("crm_enroll_followup_flow / crm_cancel_followup_flow — contrato", () => {
  it("exige ai_operator, nunca 'agent' puro nem 'manager' só — mesma faixa das outras capacidades de retenção", () => {
    // A rota equivalente pela tela (POST .../enrollments) exige `manager`; um
    // atendente humano não mexe nisso pela tela. `ai_operator` é o papel do
    // agente publicado, e é isto que dá à IA o alcance que a UI não dá a uma
    // pessoa do mesmo nível — controle negativo: `agent` sozinho não deveria bastar.
    expect(crmEnrollFollowupFlow.requiresRole).toBe("ai_operator");
    expect(crmCancelFollowupFlow.requiresRole).toBe("ai_operator");
    expect(crmEnrollFollowupFlow.requiresScope).toBe("mcp:write");
    expect(crmCancelFollowupFlow.requiresScope).toBe("mcp:write");
  });

  it("crm_enroll_followup_flow aceita o fluxo como flow_id (upstream) OU pointer_id (apelido do fork)", () => {
    // O agente do cliente chama com `pointer_id` desde antes de a ferramenta do
    // upstream existir; o apelido evita quebrá-lo na reconciliação com a v1.44.0.
    const schema = z.object(crmEnrollFollowupFlow.inputSchema);
    const contato = "22222222-2222-4222-8222-222222222222";
    const id = "11111111-1111-4111-8111-111111111111";
    expect(schema.safeParse({ pointer_id: "not-a-uuid", contact_id: contato }).success).toBe(false);
    expect(schema.safeParse({ flow_id: "not-a-uuid", contact_id: contato }).success).toBe(false);
    expect(schema.safeParse({ pointer_id: id, contact_id: contato }).success).toBe(true);
    expect(schema.safeParse({ flow_id: id, contact_id: contato }).success).toBe(true);
    expect(schema.safeParse({ flow_id: id, contact_id: "não é uuid" }).success).toBe(false);
  });

  it("crm_cancel_followup_flow exige enrollment_id como uuid", () => {
    const schema = z.object(crmCancelFollowupFlow.inputSchema);
    expect(schema.safeParse({ enrollment_id: "não é uuid" }).success).toBe(false);
    expect(schema.safeParse({ enrollment_id: "11111111-1111-4111-8111-111111111111" }).success).toBe(true);
  });

  it("está registrada nos dois lados: handlers (index.ts) e catálogo (rótulo pro humano)", () => {
    const nomes = allTools.map((t) => t.name);
    expect(nomes).toContain("crm_enroll_followup_flow");
    expect(nomes).toContain("crm_cancel_followup_flow");

    for (const nome of ["crm_enroll_followup_flow", "crm_cancel_followup_flow"]) {
      const entrada = catalogEntry(nome);
      expect(entrada, `catalogEntry(${nome}) não deveria ser undefined`).toBeDefined();
      // "follow-up"/"followup" não pode vazar pro texto que o dono do negócio lê
      // (mesma regra de retencao.ts) — o nome é contrato de wire, o resto não.
      const textoHumano = `${entrada!.rotulo} ${entrada!.explicacao} ${entrada!.oQueToca}`.toLowerCase();
      expect(textoHumano).not.toMatch(/follow.?up/);
    }
  });
});
