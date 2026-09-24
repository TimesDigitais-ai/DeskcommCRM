/**
 * `emLotes` — quebra de `.in()` grande em lotes menores.
 *
 * Medido em produção (cliente, 16/09/2026): um `.in("contact_id", [...416
 * ids])` virou uma URL de ~16KB que o PostgREST recusou na hora (`fetch
 * failed`, ~300ms — recusa, não timeout de query lenta). O board inteiro
 * caía com "Não consegui carregar este funil" assim que o pipeline passou de
 * ~400 leads. Este teste cobre só a função pura — a integração real (que as 4
 * chamadas em withScores/withConversas/withNextActions usam) precisa de banco
 * e fica coberta pelo smoke manual pós-deploy.
 */
import { describe, expect, it } from "vitest";

import { emLotes } from "./route";

describe("emLotes", () => {
  it("divide em lotes do tamanho pedido", () => {
    const itens = Array.from({ length: 10 }, (_, i) => i);
    expect(emLotes(itens, 3)).toEqual([[0, 1, 2], [3, 4, 5], [6, 7, 8], [9]]);
  });

  it("reconstrói a lista original sem perder nem duplicar item (o bug seria silencioso)", () => {
    const itens = Array.from({ length: 416 }, (_, i) => `id-${i}`);
    const lotes = emLotes(itens, 150);
    expect(lotes.flat()).toEqual(itens);
    expect(lotes.length).toBe(3); // 150 + 150 + 116
  });

  it("lista vazia devolve zero lotes, não um lote vazio", () => {
    expect(emLotes([])).toEqual([]);
  });

  it("lista menor que o tamanho do lote devolve um lote só", () => {
    expect(emLotes([1, 2], 150)).toEqual([[1, 2]]);
  });

  it("exatamente no limite do lote não cria um lote extra vazio", () => {
    const itens = Array.from({ length: 150 }, (_, i) => i);
    expect(emLotes(itens, 150).length).toBe(1);
  });
});
