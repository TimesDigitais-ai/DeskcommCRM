import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { parseMirrorEvent, mirrorConfigSchema } from "./contract";
import { mirrorAdapter } from "./adapter";
import { canalSomenteLeitura } from "./policy";
import { transportaMensagem, canalConhecidoSemMensagem } from "../capabilities";

const company = randomUUID();
const phones = ["+5511999998888", "+5511999997777"];
const date = "2026-09-20T15:53:26.134229Z";
function event(inbound = true, businessPhone = phones[0]!) {
  return { eventType: inbound ? "MESSAGE_RECEIVED" : "MESSAGE_SENT", date,
    content: { id: randomUUID(), sessionId: randomUUID(), companyId: company, timestamp: date, updatedAt: date, type: "TEXT", text: "Olá teste", direction: inbound ? "FROM_HUB" : "TO_HUB", status: "DELIVERED", details: { from: inbound ? "+5511988889999" : businessPhone, to: inbound ? businessPhone : "+5511988889999" } } };
}
describe("contrato do espelho", () => {
  it("aceita os dois números nas duas direções e mantém o ID de origem", () => {
    for (const phone of phones) for (const inbound of [true, false]) {
      const payload = event(inbound, phone);
      expect(parseMirrorEvent(payload, company, phones)).toMatchObject({ businessPhone: phone, externalId: payload.content.id, direction: inbound ? "inbound" : "outbound" });
    }
  });
  it("recusa empresa, número, direção e identidade de origem incompatíveis", () => {
    expect(() => parseMirrorEvent(event(), randomUUID(), phones)).toThrow("company_mismatch");
    expect(() => parseMirrorEvent(event(), company, ["+5511888888888"])).toThrow("channel_mismatch");
    const wrong = event(); wrong.content.direction = "TO_HUB";
    expect(() => parseMirrorEvent(wrong, company, phones)).toThrow();
    expect(() => parseMirrorEvent({ ...event(), content: {} }, company, phones)).toThrow();
  });
  it("inventaria somente mensagens; evento de sessão não cria conversa fantasma", () => {
    expect(parseMirrorEvent({ eventType: "SESSION_NEW", date, content: { companyId: company } }, company, phones)).toBeNull();
  });
  it("mídia não validada aparece como aviso, sem URL ou download externo", () => {
    const payload = event(); payload.content.type = "IMAGE";
    expect(parseMirrorEvent(payload, company, phones)?.body).toContain("consulte na plataforma de origem");
  });
  it("não aceita canais repetidos", () => {
    expect(mirrorConfigSchema.safeParse({ name: "Teste", company_id: company, channels: phones.map(() => ({ name: "Canal", phone_number: phones[0] })) }).success).toBe(false);
  });
  it("não pode ser escolhido como transporte nem enviar texto ou template", async () => {
    expect(canalSomenteLeitura("mirror")).toBe(true);
    expect(transportaMensagem("mirror")).toBe(false);
    expect(canalConhecidoSemMensagem("mirror")).toBe(true);
    expect(mirrorAdapter.isConfigured()).toBe(false);
    await expect(mirrorAdapter.send({ organizationId: "org", sessionRef: "session", to: "recipient", kind: "text" })).rejects.toThrow("channel_read_only");
    await expect(mirrorAdapter.sendTemplate!({ organizationId: "org", sessionRef: "session", to: "recipient", name: "modelo", language: "pt_BR", values: {} })).rejects.toThrow("channel_read_only");
  });
});
