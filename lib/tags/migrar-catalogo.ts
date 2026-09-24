/**
 * Tradução PURA do catálogo antigo do fork (`organizations.settings.tag_catalog`)
 * para o vocabulário do upstream (`settings.tags`) + a lista de travadas
 * (`settings.tags_travadas`, `lib/tags/travadas.ts`).
 *
 * Existe separada do script (`scripts/migrar-etiquetas-para-vocabulario.ts`) para
 * a REGRA ser testável sem banco: o script só lê o `settings`, chama isto e grava
 * o que isto devolve. Nada aqui toca em rede.
 *
 * ── Formato de origem (fork, etapa 1 das etiquetas) ─────────────────────────
 *   tag_catalog: [{ slug, nome, cor: "#rrggbb", automatica: boolean }]
 *   `slug` = `nome.trim().toLowerCase()` — o MESMO valor que sempre foi gravado
 *   em `contacts.tags` / `crm_leads.tags`, e igual a `normalizarTag` do upstream.
 *   Por isso NENHUMA linha de contato/lead precisa mudar.
 *
 * ── Formato de destino (upstream, migrations 0264/0336) ────────────────────
 *   tags: [ "string antiga" | { tag, cor?: "#rrggbb", descricao? } ]
 *   O upstream aceita QUALQUER hex `#rrggbb` (a paleta de 8 tons é só oferta de
 *   tela — ver `lib/tags/cor-da-etiqueta.ts`), então as cores do Atemix migram
 *   EXATAS, sem aproximação.
 *
 * ── O que se perde, dito ────────────────────────────────────────────────────
 *   `nome` (a caixa/acentuação de exibição, ex.: "CIDADE EXEMPLO", "Régua D1"): o
 *   upstream não separa nome de slug — o chip mostra o texto gravado no contato,
 *   que é o slug em minúsculo. O cartão do funil desenha em CAIXA ALTA por CSS,
 *   então o visual do Atemix se mantém ali; nas outras telas a etiqueta aparece
 *   em minúsculo.
 */
import { chaveDaEtiqueta, normalizarCorDeEtiqueta } from "@/lib/tags/cor-da-etiqueta";
import { CHAVE_DAS_TAGS_TRAVADAS, ETIQUETAS_AUTOMATICAS_DO_AGENTE } from "@/lib/tags/travadas";

export const DESCRICAO_DA_AUTOMATICA =
  "Aplicada automaticamente pelo agente (follow-up). O nome exato é o contrato com o agente — só a cor pode mudar.";

/** Uma linha do relatório: o que aconteceu com UMA etiqueta do catálogo. */
export interface LinhaDoRelatorio {
  tag: string;
  cor: string | null;
  automatica: boolean;
  /** `criada` entrou no vocabulário; `cor_adicionada` já existia sem cor; `mantida` já tinha cor própria. */
  resultado: "criada" | "cor_adicionada" | "mantida" | "cor_invalida_sem_cor";
  /** Só quando `mantida` e a cor do vocabulário difere da do catálogo. */
  corDoCatalogo?: string;
}

export interface ResultadoDaMigracao {
  /** O novo `settings.tags`. */
  tags: Array<string | Record<string, unknown>>;
  /** O novo `settings.tags_travadas` (união com o que já existia). */
  travadas: string[];
  relatorio: LinhaDoRelatorio[];
  /** Entradas do catálogo que não deram para ler (item corrompido) — nunca em silêncio. */
  ignoradas: unknown[];
}

interface ItemDoCatalogo {
  slug: string;
  cor: string | null;
  automatica: boolean;
}

function lerItem(bruto: unknown): ItemDoCatalogo | null {
  if (typeof bruto !== "object" || bruto === null) return null;
  const o = bruto as Record<string, unknown>;
  const nome = typeof o["slug"] === "string" ? o["slug"] : typeof o["nome"] === "string" ? o["nome"] : null;
  if (nome === null) return null;
  const slug = chaveDaEtiqueta(nome);
  if (!slug) return null;
  return { slug, cor: normalizarCorDeEtiqueta(o["cor"]), automatica: o["automatica"] === true };
}

export function migrarCatalogoParaVocabulario(settings: unknown): ResultadoDaMigracao {
  const s = (settings ?? {}) as Record<string, unknown>;
  const catalogo = Array.isArray(s["tag_catalog"]) ? (s["tag_catalog"] as unknown[]) : [];
  const existentes = Array.isArray(s["tags"]) ? (s["tags"] as Array<string | Record<string, unknown>>) : [];
  const travadasAntes = Array.isArray(s[CHAVE_DAS_TAGS_TRAVADAS]) ? (s[CHAVE_DAS_TAGS_TRAVADAS] as unknown[]) : [];

  const tags = existentes.map((e) => (typeof e === "object" && e !== null ? { ...e } : e));
  const indicePorChave = new Map<string, number>();
  tags.forEach((e, i) => {
    const nome = typeof e === "string" ? e : typeof e?.["tag"] === "string" ? (e["tag"] as string) : null;
    if (nome !== null) indicePorChave.set(chaveDaEtiqueta(nome), i);
  });

  const relatorio: LinhaDoRelatorio[] = [];
  const ignoradas: unknown[] = [];
  const travadas = new Set<string>(
    travadasAntes.filter((t): t is string => typeof t === "string").map(chaveDaEtiqueta).filter(Boolean),
  );

  for (const bruto of catalogo) {
    const item = lerItem(bruto);
    if (!item) {
      ignoradas.push(bruto);
      continue;
    }
    if (item.automatica) travadas.add(item.slug);
    const descricao = item.automatica ? DESCRICAO_DA_AUTOMATICA : undefined;
    const i = indicePorChave.get(item.slug);

    if (i === undefined) {
      const entrada: Record<string, unknown> = { tag: item.slug };
      if (item.cor) entrada["cor"] = item.cor;
      if (descricao) entrada["descricao"] = descricao;
      indicePorChave.set(item.slug, tags.length);
      tags.push(entrada);
      relatorio.push({
        tag: item.slug,
        cor: item.cor,
        automatica: item.automatica,
        resultado: item.cor ? "criada" : "cor_invalida_sem_cor",
      });
      continue;
    }

    const atual = tags[i];
    // Entrada antiga em forma de string → vira objeto, preservando a grafia.
    const objeto: Record<string, unknown> = typeof atual === "string" ? { tag: atual } : { ...(atual as Record<string, unknown>) };
    const corAtual = normalizarCorDeEtiqueta(objeto["cor"]);
    if (corAtual) {
      // Cor que já estava no vocabulário do upstream VENCE: alguém a escolheu lá,
      // e sobrescrever seria desfazer uma decisão. O relatório mostra a diferença.
      tags[i] = objeto;
      relatorio.push({
        tag: item.slug,
        cor: corAtual,
        automatica: item.automatica,
        resultado: "mantida",
        ...(item.cor && item.cor !== corAtual ? { corDoCatalogo: item.cor } : {}),
      });
      continue;
    }
    if (item.cor) objeto["cor"] = item.cor;
    if (descricao && typeof objeto["descricao"] !== "string") objeto["descricao"] = descricao;
    tags[i] = objeto;
    relatorio.push({
      tag: item.slug,
      cor: item.cor,
      automatica: item.automatica,
      resultado: item.cor ? "cor_adicionada" : "cor_invalida_sem_cor",
    });
  }

  return { tags, travadas: [...travadas], relatorio, ignoradas };
}

/**
 * As sete automáticas do agente que o catálogo NÃO trouxe como `automatica: true`
 * (catálogo incompleto ou nunca semeado). O script avisa — não as trava por
 * conta própria, porque "quais são automáticas" é decisão de quem opera.
 */
export function automaticasDoAgenteForaDasTravadas(travadas: readonly string[]): string[] {
  const t = new Set(travadas.map(chaveDaEtiqueta));
  return ETIQUETAS_AUTOMATICAS_DO_AGENTE.filter((n) => !t.has(chaveDaEtiqueta(n)));
}
