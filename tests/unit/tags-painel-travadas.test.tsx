/**
 * A tela de Tags com etiqueta TRAVADA (fork, `lib/tags/travadas.ts`).
 *
 * A linha de uma etiqueta automática só oferece a COR: renomear, juntar e excluir
 * nem aparecem (o nome exato é o contrato com o agente). A rota recusa o resto —
 * `tests/unit/tags-vocabulario-travadas-rota.test.ts` —, e este arquivo cobre a
 * metade da tela, que é o aviso antecipado.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LinhaDeVocabulario } from "@/lib/schemas/tags";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { PainelDeTags } from "@/app/app/settings/tags/_painel";

const base: LinhaDeVocabulario = {
  tag: "instagram",
  uso_em_contatos: 3,
  uso_em_leads: 0,
  uso_em_conversas: 0,
  em_regras: 0,
  cor: "#0091ff",
  descricao: null,
  no_vocabulario: true,
};
const TIME = base;
const AUTO: LinhaDeVocabulario = { ...base, tag: "régua d4", cor: "#e54d2e", uso_em_leads: 9 };

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PainelDeTags tags={[TIME, AUTO]} travadas={["régua d4"]} idioma="pt-BR" />
    </QueryClientProvider>,
  );
}

const linhaDe = (tag: string) => screen.getAllByText(tag)[0]!.closest("tr") as HTMLElement;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { alterou: true } }), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PainelDeTags — etiqueta travada", () => {
  it("a linha travada só tem o botão Cor e diz que é automática", () => {
    montar();
    const auto = within(linhaDe("régua d4"));
    expect(auto.getByRole("button", { name: "Cor" })).toBeInTheDocument();
    for (const nome of ["Renomear", "Juntar", "Excluir"]) {
      expect(auto.queryByRole("button", { name: nome })).toBeNull();
    }
    expect(auto.getByText("automática — só a cor muda")).toBeInTheDocument();
  });

  it("controle: a linha do time continua com as quatro ações", () => {
    montar();
    const time = within(linhaDe("instagram"));
    for (const nome of ["Cor", "Renomear", "Juntar", "Excluir"]) {
      expect(time.getByRole("button", { name: nome })).toBeInTheDocument();
    }
    expect(time.queryByText("automática — só a cor muda")).toBeNull();
  });

  it("a cor da travada ainda muda: manda definir_cor, sem destino", async () => {
    montar();
    fireEvent.click(within(linhaDe("régua d4")).getByRole("button", { name: "Cor" }));
    fireEvent.click(screen.getByRole("button", { name: "Roxo" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1) as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({ acao: "definir_cor", tag: "régua d4", destino: null, cor: "#ab4aba" });
  });

  it("'Nova etiqueta' cadastra pela ação definir_cor (a que já cria a entrada no vocabulário)", async () => {
    montar();
    fireEvent.click(screen.getByRole("button", { name: "Nova etiqueta" }));
    fireEvent.change(screen.getByLabelText("Nova etiqueta"), { target: { value: "Cidade Exemplo" } });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar" }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1) as [string, { body: string }];
    expect(url).toBe("/api/v1/tags/vocabulario");
    expect(JSON.parse(init.body)).toMatchObject({ acao: "definir_cor", tag: "Cidade Exemplo" });
  });
});
