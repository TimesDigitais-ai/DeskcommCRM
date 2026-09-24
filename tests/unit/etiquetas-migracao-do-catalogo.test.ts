import { describe, expect, it } from "vitest";

import {
  automaticasDoAgenteForaDasTravadas,
  DESCRICAO_DA_AUTOMATICA,
  migrarCatalogoParaVocabulario,
} from "@/lib/tags/migrar-catalogo";
import { etiquetasComCor } from "@/lib/tags/cor-da-etiqueta";
import { travadasDoSettings } from "@/lib/tags/travadas";

const catalogo = [
  { slug: "cidade exemplo", nome: "CIDADE EXEMPLO", cor: "#f6ede2", automatica: false },
  { slug: "venda perdida", nome: "VENDA PERDIDA", cor: "#E2445C", automatica: false },
  { slug: "régua d1", nome: "Régua D1", cor: "#fdab3d", automatica: true },
  { slug: "reengajado", nome: "Reengajado", cor: "#00c875", automatica: true },
];

describe("migrarCatalogoParaVocabulario", () => {
  it("cada etiqueta do catálogo vira entrada {tag, cor} com a cor EXATA (hex, minúsculo)", () => {
    const r = migrarCatalogoParaVocabulario({ tag_catalog: catalogo });
    const cores = etiquetasComCor({ tags: r.tags });
    expect(cores).toContainEqual({ tag: "cidade exemplo", cor: "#f6ede2" });
    // a caixa do hex é normalizada, o valor é o mesmo
    expect(cores).toContainEqual({ tag: "venda perdida", cor: "#e2445c" });
    expect(cores).toHaveLength(4);
    expect(r.relatorio.every((l) => l.resultado === "criada")).toBe(true);
  });

  it("as automáticas viram a lista de travadas e ganham a descrição; as do time não", () => {
    const r = migrarCatalogoParaVocabulario({ tag_catalog: catalogo });
    expect(r.travadas.sort()).toEqual(["reengajado", "régua d1"]);
    expect(travadasDoSettings({ tags_travadas: r.travadas })).toHaveLength(2);
    const porTag = new Map(r.tags.map((e) => [(e as { tag: string }).tag, e as Record<string, unknown>]));
    expect(porTag.get("régua d1")?.["descricao"]).toBe(DESCRICAO_DA_AUTOMATICA);
    expect(porTag.get("cidade exemplo")).not.toHaveProperty("descricao");
  });

  it("entrada antiga em string vira objeto com a cor, sem perder a grafia", () => {
    const r = migrarCatalogoParaVocabulario({
      tags: ["Cidade Exemplo", "vip"],
      tag_catalog: catalogo,
    });
    expect(r.tags[0]).toEqual({ tag: "Cidade Exemplo", cor: "#f6ede2" });
    expect(r.tags[1]).toBe("vip");
    expect(r.relatorio.find((l) => l.tag === "cidade exemplo")?.resultado).toBe("cor_adicionada");
  });

  it("cor que já estava no vocabulário do upstream vence — e o relatório mostra a diferença", () => {
    const r = migrarCatalogoParaVocabulario({
      tags: [{ tag: "venda perdida", cor: "#0091ff", descricao: "minha" }],
      tag_catalog: catalogo,
    });
    expect(r.tags[0]).toEqual({ tag: "venda perdida", cor: "#0091ff", descricao: "minha" });
    expect(r.relatorio.find((l) => l.tag === "venda perdida")).toMatchObject({
      resultado: "mantida",
      corDoCatalogo: "#e2445c",
    });
  });

  it("é idempotente: rodar de novo sobre o resultado não muda nada", () => {
    const um = migrarCatalogoParaVocabulario({ tag_catalog: catalogo });
    const dois = migrarCatalogoParaVocabulario({ tag_catalog: catalogo, tags: um.tags, tags_travadas: um.travadas });
    expect(dois.tags).toEqual(um.tags);
    expect(dois.travadas.sort()).toEqual(um.travadas.sort());
  });

  it("item corrompido do catálogo não derruba a migração e aparece em `ignoradas`", () => {
    const r = migrarCatalogoParaVocabulario({ tag_catalog: [42, null, { slug: "ok", cor: "#123456", automatica: false }] });
    expect(r.ignoradas).toEqual([42, null]);
    expect(r.tags).toEqual([{ tag: "ok", cor: "#123456" }]);
  });

  it("hex inválido no catálogo entra SEM cor e é declarado no relatório, nunca inventado", () => {
    const r = migrarCatalogoParaVocabulario({ tag_catalog: [{ slug: "x", cor: "verde", automatica: false }] });
    expect(r.tags).toEqual([{ tag: "x" }]);
    expect(r.relatorio[0]?.resultado).toBe("cor_invalida_sem_cor");
  });

  it("sem tag_catalog: devolve o vocabulário como estava", () => {
    const r = migrarCatalogoParaVocabulario({ tags: ["a"] });
    expect(r.tags).toEqual(["a"]);
    expect(r.relatorio).toEqual([]);
  });
});

describe("automaticasDoAgenteForaDasTravadas", () => {
  it("aponta as das sete que ainda não estão travadas", () => {
    expect(automaticasDoAgenteForaDasTravadas(["régua d1", "Reengajado"])).toEqual([
      "follow-up 1",
      "follow-up 2",
      "régua d4",
      "régua d7",
      "toques esgotados",
    ]);
  });
});
