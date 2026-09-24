import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * A conversa SELECIONADA na lista do Inbox tem de continuar legível nos dois
 * temas.
 *
 * `accent-50` é quase branco (#f3f6f1) e a escala NÃO inverte no tema escuro —
 * o nome da conversa (texto claro) sumia em cima dele. O fundo de "selecionado"
 * que cada tema define é `accent-soft` (claro no claro, verde translúcido no
 * escuro). Foi visto ao vivo, num print do Inbox em tema escuro.
 */
describe("linha selecionada da lista do Inbox", () => {
  const fonte = readFileSync("components/inbox/ConversationListItem.tsx", "utf8");

  it("usa o fundo de seleção do tema (accent-soft)", () => {
    expect(fonte).toMatch(/isSelected\s*&&\s*"bg-accent-soft/);
  });

  it("não usa accent-50 como fundo — some no tema escuro", () => {
    expect(fonte).not.toMatch(/bg-accent-50/);
  });
});
