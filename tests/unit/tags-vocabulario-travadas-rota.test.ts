/**
 * A trava das etiquetas AUTOMÁTICAS na rota de vocabulário — executada.
 *
 * Fork (`lib/tags/travadas.ts`): renomear/juntar/excluir uma etiqueta
 * que o agente aplica quebraria a cadência do agente em silêncio; a rota recusa antes
 * da RPC e deixa passar só a cor. O upstream não tem esse conceito, então o
 * comportamento é nosso e precisa de prova própria — se a próxima reconciliação
 * reescrever `route.ts`, este arquivo é o que avisa que a trava se perdeu.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
let settings: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: settings === null ? null : { settings }, error: null }) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ ok: true, org: { orgId: "org-1" }, user: { id: "u-1" } }),
}));
vi.mock("@/lib/auth/server", () => ({ mfaEmDivida: async () => false }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { POST } from "@/app/api/v1/tags/vocabulario/route";

const chamar = (corpo: unknown) =>
  POST(
    new Request("http://x/api/v1/tags/vocabulario", {
      method: "POST",
      body: JSON.stringify(corpo),
    }) as never,
  );

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { alterou: true }, error: null });
  settings = { tags_travadas: ["régua d4"], tags: [{ tag: "régua d4", cor: "#ff642e" }] };
});

describe("POST /api/v1/tags/vocabulario — etiqueta travada", () => {
  it.each([
    { acao: "renomear", tag: "Régua D4", destino: "outro" },
    { acao: "juntar", tag: "régua d4", destino: "outro" },
    { acao: "excluir", tag: "régua d4" },
  ])("$acao a travada: 422 tag_travada e a RPC NEM É CHAMADA", async (corpo) => {
    const r = await chamar(corpo);
    expect(r.status).toBe(422);
    expect(JSON.stringify(await r.json())).toContain("tag_travada");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("definir_cor na travada passa — é a única coisa que ela aceita", async () => {
    const r = await chamar({ acao: "definir_cor", tag: "régua d4", cor: "#0091ff" });
    expect(r.status).toBe(200);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("etiqueta do time segue livre para renomear, juntar e excluir", async () => {
    for (const corpo of [
      { acao: "renomear", tag: "insta", destino: "instagram" },
      { acao: "juntar", tag: "insta", destino: "instagram" },
      { acao: "excluir", tag: "insta" },
    ]) {
      const r = await chamar(corpo);
      expect(r.status, JSON.stringify(corpo)).toBe(200);
    }
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("juntar PARA a travada passa (conserto de grafia), renomear PARA ela não", async () => {
    expect((await chamar({ acao: "juntar", tag: "regua d4", destino: "régua d4" })).status).toBe(200);
    expect((await chamar({ acao: "renomear", tag: "regua d4", destino: "régua d4" })).status).toBe(422);
  });

  it("organização sem `tags_travadas` (instalação do upstream): nada muda para ninguém", async () => {
    settings = { tags: ["a"] };
    const r = await chamar({ acao: "excluir", tag: "régua d4" });
    expect(r.status).toBe(200);
  });
});
