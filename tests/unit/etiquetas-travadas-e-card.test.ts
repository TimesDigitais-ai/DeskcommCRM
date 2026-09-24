import { describe, expect, it } from "vitest";

import { applyFilters } from "@/lib/kanban/filters";
import { buildCardInput } from "@/lib/kanban/card-state";
import { etiquetasDoCard, repartirEtiquetas, unirTags } from "@/lib/tags/etiquetas-do-card";
import {
  estaTravada,
  ofertaDoSettings,
  operacaoBloqueada,
  travadasDoSettings,
} from "@/lib/tags/travadas";
import type { Lead } from "@/lib/types/leads";

const travadas = ["régua d4", "toques esgotados"];

describe("travadasDoSettings / estaTravada", () => {
  it("lê `settings.tags_travadas`, normaliza e tira repetição", () => {
    expect(travadasDoSettings({ tags_travadas: [" Régua D4 ", "régua d4", 3, "", "Reengajado"] })).toEqual([
      "régua d4",
      "reengajado",
    ]);
  });

  it("settings ausente, nulo ou com a chave em outro formato: nenhuma travada", () => {
    expect(travadasDoSettings(null)).toEqual([]);
    expect(travadasDoSettings({})).toEqual([]);
    expect(travadasDoSettings({ tags_travadas: "régua d4" })).toEqual([]);
  });

  it("compara sem caixa e sem espaço nas pontas", () => {
    expect(estaTravada("  RÉGUA D4", travadas)).toBe(true);
    expect(estaTravada("instagram", travadas)).toBe(false);
  });
});

describe("ofertaDoSettings — o que o seletor oferece", () => {
  it("junta as duas formas de entrada do vocabulário (string e objeto) e marca as travadas", () => {
    const oferta = ofertaDoSettings({
      tags: ["Vip", { tag: "instagram", cor: "#FAA1F1" }, { tag: "régua d4", cor: "#ff642e" }, { tag: 7 }],
      tags_travadas: ["régua d4"],
    });
    expect(oferta).toEqual([
      { tag: "vip", cor: null, travada: false },
      { tag: "instagram", cor: "#faa1f1", travada: false },
      { tag: "régua d4", cor: "#ff642e", travada: true },
    ]);
  });

  it("uma travada que ainda não está no vocabulário é oferecida mesmo assim", () => {
    expect(ofertaDoSettings({ tags: [], tags_travadas: ["reengajado"] })).toEqual([
      { tag: "reengajado", cor: null, travada: true },
    ]);
  });
});

describe("operacaoBloqueada — a etiqueta travada só muda de cor", () => {
  it.each(["renomear", "juntar", "excluir"])("%s a travada é recusado", (acao) => {
    expect(operacaoBloqueada({ acao, tag: "Régua D4", destino: "outra" }, travadas)).toBe(true);
  });

  it("definir_cor na travada é o que continua permitido", () => {
    expect(operacaoBloqueada({ acao: "definir_cor", tag: "régua d4" }, travadas)).toBe(false);
  });

  it("operar numa etiqueta do time não é bloqueado", () => {
    expect(operacaoBloqueada({ acao: "excluir", tag: "instagram" }, travadas)).toBe(false);
    expect(operacaoBloqueada({ acao: "renomear", tag: "insta", destino: "instagram" }, travadas)).toBe(false);
  });

  it("renomear PARA o nome de uma travada é recusado; JUNTAR para ela é o conserto legítimo", () => {
    expect(operacaoBloqueada({ acao: "renomear", tag: "regua", destino: "régua d4" }, travadas)).toBe(true);
    expect(operacaoBloqueada({ acao: "juntar", tag: "regua d4", destino: "régua d4" }, travadas)).toBe(false);
  });

  it("sem nenhuma travada, nada é bloqueado", () => {
    expect(operacaoBloqueada({ acao: "excluir", tag: "régua d4" }, [])).toBe(false);
  });
});

describe("unirTags", () => {
  it("junta sem repetir por caixa e ignora vazio/nulo", () => {
    expect(unirTags(["Renovação", "x"], ["renovação", " ", "y"], null, undefined)).toEqual(["Renovação", "x", "y"]);
  });
});

describe("etiquetasDoCard — até 3 + '+N', automáticas primeiro", () => {
  it("com mais de 3, mostra 3 e conta o resto", () => {
    const r = etiquetasDoCard({
      leadTags: ["régua d4"],
      contatoTags: ["instagram", "contrato", "google", "cliente"],
      travadas,
    });
    expect(r.visiveis).toHaveLength(3);
    expect(r.extras).toBe(2);
  });

  it("as automáticas do agente vêm antes das do time, mesmo gravadas depois", () => {
    const r = etiquetasDoCard({
      leadTags: ["toques esgotados"],
      contatoTags: ["instagram", "contrato"],
      travadas,
    });
    expect(r.visiveis).toEqual(["toques esgotados", "instagram", "contrato"]);
    expect(r.extras).toBe(0);
  });

  it("a mesma etiqueta no lead e no contato (ou 'Renovação'/'renovação') conta uma vez só", () => {
    const r = etiquetasDoCard({ leadTags: ["Renovação"], contatoTags: ["renovação"], travadas });
    expect(r.visiveis).toEqual(["Renovação"]);
    expect(r.extras).toBe(0);
  });

  it("sem etiqueta nenhuma: nada a desenhar", () => {
    expect(etiquetasDoCard({ leadTags: [], contatoTags: undefined, travadas })).toEqual({ visiveis: [], extras: 0 });
  });

  it("lista de travadas ainda não carregou: as etiquetas aparecem na ordem de gravação, não somem", () => {
    const r = etiquetasDoCard({ leadTags: ["régua d4"], contatoTags: ["instagram"], travadas: [] });
    expect(r.visiveis).toEqual(["régua d4", "instagram"]);
  });
});

describe("repartirEtiquetas — o PATCH de tags substitui o array inteiro", () => {
  const base = { travadas, temContato: true };

  it("NUNCA apaga as automáticas do lead, mesmo que a seleção não as traga", () => {
    const r = repartirEtiquetas({
      ...base,
      selecionadas: ["instagram"],
      leadTags: ["régua d4", "toques esgotados"],
      contatoTags: [],
    });
    expect(r.leadTags).toEqual(["régua d4", "toques esgotados"]);
    expect(r.contatoTags).toEqual(["instagram"]);
  });

  it("etiqueta NOVA do time vai para o contato, não para o lead", () => {
    const r = repartirEtiquetas({ ...base, selecionadas: ["contrato"], leadTags: ["régua d4"], contatoTags: [] });
    expect(r.contatoTags).toEqual(["contrato"]);
    expect(r.leadTags).toEqual(["régua d4"]);
  });

  it("quem já estava no lead continua no lead; quem já estava no contato, no contato", () => {
    const r = repartirEtiquetas({
      ...base,
      selecionadas: ["renovação", "google"],
      leadTags: ["renovação"],
      contatoTags: ["google"],
    });
    expect(r.leadTags).toEqual(["renovação"]);
    expect(r.contatoTags).toEqual(["google"]);
  });

  it("texto livre fora do vocabulário só some se o usuário tirou", () => {
    const mantido = repartirEtiquetas({ ...base, selecionadas: ["vip"], leadTags: ["vip"], contatoTags: [] });
    expect(mantido.leadTags).toEqual(["vip"]);
    const removido = repartirEtiquetas({ ...base, selecionadas: [], leadTags: ["vip"], contatoTags: ["antigo"] });
    expect(removido.leadTags).toEqual([]);
    expect(removido.contatoTags).toEqual([]);
  });

  it("desmarcar tira da casa onde estava, sem tocar nas automáticas", () => {
    const r = repartirEtiquetas({
      ...base,
      selecionadas: [],
      leadTags: ["régua d4", "renovação"],
      contatoTags: ["instagram"],
    });
    expect(r.leadTags).toEqual(["régua d4"]);
    expect(r.contatoTags).toEqual([]);
  });

  it("lead sem contato: a etiqueta nova cai no lead para não se perder", () => {
    const r = repartirEtiquetas({
      travadas,
      temContato: false,
      selecionadas: ["contrato"],
      leadTags: ["régua d4"],
      contatoTags: [],
    });
    expect(r.leadTags).toEqual(["régua d4", "contrato"]);
    expect(r.contatoTags).toEqual([]);
  });

  it("uma automática vinda na seleção não é duplicada nem migra para o contato", () => {
    const r = repartirEtiquetas({
      ...base,
      selecionadas: ["régua d4", "instagram"],
      leadTags: ["régua d4"],
      contatoTags: [],
    });
    expect(r.leadTags).toEqual(["régua d4"]);
    expect(r.contatoTags).toEqual(["instagram"]);
  });
});

describe("filtro do funil (upstream) enxerga o contato E o lead", () => {
  it("filtrar por 'contrato' pega o lead cujo CONTATO tem a etiqueta", () => {
    const l = (id: string, tags: string[], contact_tags?: string[]) =>
      ({ id, tags, contact_tags, status: "open", title: id, description: null, value_cents: null } as unknown as Lead);
    const r = applyFilters(
      [l("a", [], ["contrato"]), l("b", ["régua d4"]), l("c", ["contrato"])],
      { tag: "contrato" } as never,
    );
    expect(r.map((x) => x.id)).toEqual(["a", "c"]);
  });
});

describe("buildCardInput leva as etiquetas do contato", () => {
  it("contactTags vem do payload do board; ausente vira lista vazia", () => {
    const base = {
      id: "l1",
      title: "x",
      value_cents: null,
      currency: "BRL",
      tags: ["régua d4"],
      last_activity_at: null,
      created_at: "2026-07-20T10:00:00Z",
      owner_kind: null,
      owner_user_id: null,
      owner_agent_id: null,
    } as unknown as Lead;
    const opts = { stageName: "Sem resposta", ownerNames: new Map<string, string | null>() };
    expect(buildCardInput({ ...base, contact_tags: ["instagram"] }, opts).contactTags).toEqual(["instagram"]);
    expect(buildCardInput(base, opts).contactTags).toEqual([]);
  });
});
