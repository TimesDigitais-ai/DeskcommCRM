import { describe, expect, it } from "vitest";

import { etiquetasDaLista, limparNegritoDoWhatsapp, nomeCurtoDoAtendente, sessaoDoEspelho } from "./lista-de-conversas";

describe("limparNegritoDoWhatsapp", () => {
  it("tira os asteriscos do nome da atendente, como chega do espelho", () => {
    expect(limparNegritoDoWhatsapp("*Maria Silva:* Qual a forma de pagamento por gentileza ?")).toBe(
      "Maria Silva: Qual a forma de pagamento por gentileza ?",
    );
    expect(limparNegritoDoWhatsapp("*Bia:* Qual seria? a opção A ou a B?")).toBe(
      "Bia: Qual seria? a opção A ou a B?",
    );
  });

  it("desfaz vários trechos em negrito na mesma mensagem", () => {
    expect(limparNegritoDoWhatsapp("Total *R$ 350* em *3x*, ok?")).toBe("Total R$ 350 em 3x, ok?");
  });

  it("não mexe no que o WhatsApp não trataria como negrito", () => {
    expect(limparNegritoDoWhatsapp("2*3*4")).toBe("2*3*4");
    expect(limparNegritoDoWhatsapp("5 * 3 = 15")).toBe("5 * 3 = 15");
    expect(limparNegritoDoWhatsapp("* item solto")).toBe("* item solto");
    expect(limparNegritoDoWhatsapp("** **")).toBe("** **");
  });

  it("texto sem asterisco passa igual", () => {
    expect(limparNegritoDoWhatsapp("Olá Ana, aqui é a Bia da Empresa.")).toBe(
      "Olá Ana, aqui é a Bia da Empresa.",
    );
    expect(limparNegritoDoWhatsapp("")).toBe("");
  });
});

describe("etiquetasDaLista", () => {
  it("esconde a etiqueta de importação, em qualquer caixa", () => {
    expect(etiquetasDaLista(["whatsapp-import"])).toEqual([]);
    expect(etiquetasDaLista(["WHATSAPP-IMPORT", "cliente"])).toEqual(["cliente"]);
  });

  it("mantém as etiquetas do time e a ordem em que foram gravadas", () => {
    expect(etiquetasDaLista(["cliente", "whatsapp-import", "oportunidade"])).toEqual([
      "cliente",
      "oportunidade",
    ]);
  });

  it("aceita lista vazia ou ausente", () => {
    expect(etiquetasDaLista([])).toEqual([]);
    expect(etiquetasDaLista(null)).toEqual([]);
    expect(etiquetasDaLista(undefined)).toEqual([]);
  });
});

describe("sessaoDoEspelho", () => {
  it("lê setor e atendente de metadata.mirror_session", () => {
    expect(
      sessaoDoEspelho({ read_only_mirror: true, mirror_session: { department: "Comercial", agent: "Maria Silva Costa dos Santos", status: "IN_PROGRESS" } }),
    ).toEqual({ setor: "Comercial", atendente: "Maria Silva Costa dos Santos" });
  });

  it("aceita só um dos dois", () => {
    expect(sessaoDoEspelho({ mirror_session: { department: "Geral" } })).toEqual({ setor: "Geral", atendente: null });
    expect(sessaoDoEspelho({ mirror_session: { agent: "Carla Beatriz Pereira" } })).toEqual({
      setor: null,
      atendente: "Carla Beatriz Pereira",
    });
  });

  it("devolve null quando não é do espelho ou não tem nada útil", () => {
    expect(sessaoDoEspelho({})).toBeNull();
    expect(sessaoDoEspelho(null)).toBeNull();
    expect(sessaoDoEspelho("texto")).toBeNull();
    expect(sessaoDoEspelho({ mirror_session: "x" })).toBeNull();
    expect(sessaoDoEspelho({ mirror_session: { department: "  ", agent: 3 } })).toBeNull();
  });
});

describe("nomeCurtoDoAtendente", () => {
  it("fica com os dois primeiros nomes", () => {
    expect(nomeCurtoDoAtendente("Maria Silva Costa dos Santos")).toBe("Maria Silva");
    expect(nomeCurtoDoAtendente("Carlos Eduardo Camargo Lima")).toBe("Carlos Eduardo");
    expect(nomeCurtoDoAtendente("Carla Beatriz Pereira")).toBe("Carla Beatriz");
  });

  it("nome único e espaços sobrando", () => {
    expect(nomeCurtoDoAtendente("  Agente  ")).toBe("Agente");
  });
});
