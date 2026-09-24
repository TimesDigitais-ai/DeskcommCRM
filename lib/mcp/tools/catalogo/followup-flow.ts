/**
 * Capacidade do motor de fluxos de acompanhamento (Follow-up Flows) que o
 * upstream não tem: CANCELAR a inscrição. A de inscrever (`crm_enroll_followup_flow`)
 * é do upstream e mora em `./retencao` — ver a nota em `../followup-flow.ts`.
 *
 * ⚠️ Igual a `retencao.ts`: "follow-up" não aparece no texto do humano — pra
 * quem configura o agente isto é uma SEQUÊNCIA/RÉGUA DE ACOMPANHAMENTO, e o
 * gate `tests/unit/catalogo-tools-leigo-friendly.test.ts` reprova o jargão.
 */
import { declararTools } from "./tipos";

export const TOOLS_FOLLOWUP_FLOW = declararTools([
  {
    name: "crm_cancel_followup_flow",
    category: "write",
    rotulo: "Tirar o cliente de uma sequência de acompanhamento",
    explicacao:
      "Encerra o registro do cliente numa sequência de acompanhamento, por exemplo quando ele já " +
      "respondeu ou vai passar pra próxima etapa.",
    oQueToca: "Sequências de acompanhamento",
    risco: "atencao",
    pacotes: ["reter"],
  },
]);
