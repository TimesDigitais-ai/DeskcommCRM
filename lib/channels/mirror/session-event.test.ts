import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { lerDiretorio, parseMirrorEvent, parseMirrorSessionEvent, resolverNomesDaSessao } from "./contract";

const company = randomUUID();
const phones = ["+5511999998888", "+5511999997777"];
const date = "2026-09-21T12:00:00.000Z";
const sessao = randomUUID();

function evento(eventType: string, content: Record<string, unknown> = {}) {
  return { eventType, date, content: { companyId: company, ...content } };
}

describe("eventos de sessão do espelho", () => {
  it("lê setor, atendente e status de SESSION_UPDATE", () => {
    const e = evento("SESSION_UPDATE", {
      id: sessao,
      status: "in_progress",
      userId: randomUUID(),
      updatedAt: "2026-09-21T12:05:00Z",
      departmentDetails: { name: " Comercial " },
      agentDetails: { name: "Maria Souza" },
    });
    expect(parseMirrorSessionEvent(e, company)).toEqual({
      sessionId: sessao,
      department: "Comercial",
      agent: "Maria Souza",
      departmentId: null,
      agentId: expect.any(String),
      departmentCleared: false,
      agentCleared: false,
      status: "IN_PROGRESS",
      updatedAt: "2026-09-21T12:05:00Z",
    });
  });

  it("aceita o id da sessão em sessionId ou em id", () => {
    expect(parseMirrorSessionEvent(evento("SESSION_NEW", { sessionId: sessao }), company)?.sessionId).toBe(sessao);
    expect(parseMirrorSessionEvent(evento("SESSION_COMPLETE", { id: sessao }), company)?.sessionId).toBe(sessao);
  });

  it("userId zerado ou vazio diz 'sem atendente'; ausente NÃO apaga o que já existe", () => {
    const zero = "00000000-0000-0000-0000-000000000000";
    expect(parseMirrorSessionEvent(evento("SESSION_UPDATE", { id: sessao, userId: zero }), company)?.agentCleared).toBe(true);
    expect(parseMirrorSessionEvent(evento("SESSION_UPDATE", { id: sessao, userId: null }), company)?.agentCleared).toBe(true);
    expect(parseMirrorSessionEvent(evento("SESSION_UPDATE", { id: sessao }), company)?.agentCleared).toBe(false);
  });

  it("sem nomes no evento, devolve nulos (o banco mantém os valores antigos)", () => {
    expect(parseMirrorSessionEvent(evento("SESSION_UPDATE", { id: sessao, departmentId: randomUUID() }), company)).toMatchObject({
      department: null,
      agent: null,
    });
  });

  it("formato que não entende vira null, nunca erro — a origem não pode reenviar para sempre", () => {
    expect(parseMirrorSessionEvent(evento("SESSION_UPDATE", { id: "nao-e-uuid" }), company)).toBeNull();
    expect(parseMirrorSessionEvent(evento("SESSION_UPDATE", {}), company)).toBeNull();
    expect(parseMirrorSessionEvent({ qualquer: "coisa" }, company)).toBeNull();
    expect(parseMirrorSessionEvent(null, company)).toBeNull();
  });

  it("ignora outros tipos de evento", () => {
    expect(parseMirrorSessionEvent(evento("MESSAGE_RECEIVED", { id: sessao }), company)).toBeNull();
    expect(parseMirrorSessionEvent(evento("CONTACT_UPDATE", { id: sessao }), company)).toBeNull();
  });

  it("recusa empresa diferente", () => {
    const outra = evento("SESSION_UPDATE", { id: sessao });
    (outra.content as Record<string, unknown>).companyId = randomUUID();
    expect(() => parseMirrorSessionEvent(outra, company)).toThrow("company_mismatch");
  });

  it("o parser de mensagem continua ignorando sessão (devolve null)", () => {
    expect(parseMirrorEvent(evento("SESSION_UPDATE", { id: sessao }), company, phones)).toBeNull();
  });
});

describe("nomes por id (a sessão do Attemics só traz ids)", () => {
  const dep = randomUUID();
  const ag = randomUUID();
  const dir = lerDiretorio({ departments: { [dep]: "Comercial" }, agents: { [ag]: "Maria Souza" } });

  it("lê departmentId e userId do evento", () => {
    const e = evento("SESSION_UPDATE", { id: sessao, departmentId: dep, userId: ag });
    expect(parseMirrorSessionEvent(e, company)).toMatchObject({ departmentId: dep, agentId: ag, department: null, agent: null });
  });

  it("userId zerado não vira agentId", () => {
    const zero = "00000000-0000-0000-0000-000000000000";
    expect(parseMirrorSessionEvent(evento("SESSION_UPDATE", { id: sessao, userId: zero }), company)?.agentId).toBeNull();
  });

  it("resolve setor e atendente pelo diretório", () => {
    const info = parseMirrorSessionEvent(evento("SESSION_UPDATE", { id: sessao, departmentId: dep, userId: ag }), company)!;
    expect(resolverNomesDaSessao(info, dir)).toMatchObject({
      department: "Comercial",
      agent: "Maria Souza",
      departmentCleared: false,
      agentCleared: false,
    });
  });

  it("o nome que vier no próprio evento tem prioridade sobre o diretório", () => {
    const info = parseMirrorSessionEvent(
      evento("SESSION_UPDATE", { id: sessao, departmentId: dep, departmentDetails: { name: "Vendas" } }),
      company,
    )!;
    expect(resolverNomesDaSessao(info, dir).department).toBe("Vendas");
  });

  it("id que o diretório não conhece LIMPA em vez de manter o nome antigo (senão mostra a pessoa errada)", () => {
    const info = parseMirrorSessionEvent(
      evento("SESSION_UPDATE", { id: sessao, departmentId: randomUUID(), userId: randomUUID() }),
      company,
    )!;
    expect(resolverNomesDaSessao(info, dir)).toMatchObject({
      department: null,
      agent: null,
      departmentCleared: true,
      agentCleared: true,
    });
  });

  it("evento sem ids não limpa nada (campo ausente não apaga o guardado)", () => {
    const info = parseMirrorSessionEvent(evento("SESSION_UPDATE", { id: sessao, status: "IN_PROGRESS" }), company)!;
    expect(resolverNomesDaSessao(info, dir)).toMatchObject({ departmentCleared: false, agentCleared: false });
  });

  it("lerDiretorio descarta o que não é texto e aceita ausência", () => {
    expect(lerDiretorio(undefined)).toEqual({ departments: {}, agents: {} });
    expect(lerDiretorio({ departments: { a: "  Geral ", b: 3, c: "" }, agents: "x" })).toEqual({
      departments: { a: "Geral" },
      agents: {},
    });
  });
});

describe("gravação da sessão no espelho (guarda de fonte)", () => {
  const fonte = readFileSync("lib/channels/mirror/store.ts", "utf8");
  // O recorte do UPDATE de sessão: entre a chamada do parser e o commit.
  const trecho = fonte.slice(fonte.indexOf("parseMirrorSessionEvent(payload"), fonte.indexOf('return { status: "ignored"'));

  it("só escreve em metadata.mirror_session, e só de conversa do espelho", () => {
    expect(trecho).toContain("update conversations set metadata");
    expect(trecho).toContain("'{mirror_session}'");
    expect(trecho).toContain("metadata->>'read_only_mirror'='true'");
  });

  it("nunca mexe em atribuição, status, mensagens ou contato", () => {
    expect(trecho).not.toMatch(/assigned_to|assignee_kind|status\s*=|force_human|bot_silenced|insert into|delete from/i);
  });

  it("não aplica evento mais antigo por cima de um mais novo", () => {
    expect(trecho).toMatch(/updated_at'\)::timestamptz,'epoch'\) <= \$7::timestamptz/);
  });
});
