/**
 * Regras puras de etiqueta no funil e no formulário do lead — o que aparece, em
 * que ordem e onde cada uma é gravada. Sem React, sem rede: é aqui que se decide,
 * e os componentes só desenham.
 *
 * (Este arquivo era `lib/tags/catalogo.ts`, que lia `organizations.settings.
 * tag_catalog`. Na reconciliação com o upstream v1.44.0 o catálogo saiu e o
 * vocabulário do upstream passou a ser a fonte: a cor vem do `ChipDeEtiqueta`
 * e "automática" vem de `lib/tags/travadas.ts`. As regras abaixo não mudaram —
 * só recebem a lista de travadas em vez do catálogo.)
 *
 * O que vai para `contacts.tags` / `crm_leads.tags` é a etiqueta NORMALIZADA
 * (minúscula, sem espaço nas pontas — `chaveDaEtiqueta`, a mesma de
 * `lib/contacts/tag-normalizada`).
 *
 * ONDE MORA CADA ETIQUETA (decisão do cliente, 20/09/2026):
 *   - as do TIME ficam no CONTATO, como no Atemix — aparecem na lista do Inbox
 *     e no card do funil;
 *   - as AUTOMÁTICAS (Follow-up, Régua…) ficam no LEAD e só o agente aplica.
 */
import { chaveDaEtiqueta } from "@/lib/tags/cor-da-etiqueta";
import { estaTravada } from "@/lib/tags/travadas";

/** Quantas etiquetas cabem no card do funil antes do "+N". */
export const MAX_ETIQUETAS_NO_CARD = 3;

/** Une listas sem repetir (case-insensitive), mantendo a 1ª grafia de cada. */
export function unirTags(...listas: ReadonlyArray<readonly string[] | null | undefined>): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const lista of listas) {
    for (const tag of lista ?? []) {
      const chave = chaveDaEtiqueta(tag);
      if (!chave || vistos.has(chave)) continue;
      vistos.add(chave);
      saida.push(tag);
    }
  }
  return saida;
}

/**
 * O que o card do funil mostra: automáticas do agente primeiro (dizem em que
 * momento o cliente está), depois as do time; até `max`, com o resto virando
 * "+N". A ordem dentro de cada grupo é a de gravação.
 */
export function etiquetasDoCard(opts: {
  leadTags: readonly string[];
  contatoTags?: readonly string[] | null;
  travadas: readonly string[];
  max?: number;
}): { visiveis: string[]; extras: number } {
  const max = opts.max ?? MAX_ETIQUETAS_NO_CARD;
  const todas = unirTags(opts.leadTags, opts.contatoTags);
  const ordenadas = [
    ...todas.filter((t) => estaTravada(t, opts.travadas)),
    ...todas.filter((t) => !estaTravada(t, opts.travadas)),
  ];
  return { visiveis: ordenadas.slice(0, max), extras: Math.max(0, ordenadas.length - max) };
}

/**
 * Divide o que o usuário deixou selecionado entre CONTATO e LEAD ao salvar o
 * lead. As regras existem porque o PATCH de tags SUBSTITUI o array inteiro:
 *
 *   - automáticas do lead NUNCA saem (o usuário não as vê destravadas, e o
 *     agente depende delas) — voltam sempre no array do lead;
 *   - quem já estava no lead continua no lead, quem já estava no contato
 *     continua no contato — nada muda de casa sem o usuário pedir;
 *   - etiqueta NOVA vai para o contato (onde o time etiqueta, como no Atemix);
 *     sem contato, cai no lead para não se perder;
 *   - o que o usuário desmarcou sai de onde estava, inclusive texto livre fora
 *     do vocabulário — só some se ele tirou.
 */
export function repartirEtiquetas(opts: {
  selecionadas: readonly string[];
  leadTags: readonly string[];
  contatoTags: readonly string[];
  travadas: readonly string[];
  temContato: boolean;
}): { leadTags: string[]; contatoTags: string[] } {
  const marcadas = new Set(opts.selecionadas.map(chaveDaEtiqueta));
  const automatica = (tag: string) => estaTravada(tag, opts.travadas);

  const leadFinal = opts.leadTags.filter((t) => automatica(t) || marcadas.has(chaveDaEtiqueta(t)));
  const contatoFinal = opts.contatoTags.filter((t) => marcadas.has(chaveDaEtiqueta(t)));

  const jaGravadas = new Set([...leadFinal, ...contatoFinal].map(chaveDaEtiqueta));
  for (const tag of opts.selecionadas) {
    const chave = chaveDaEtiqueta(tag);
    if (!chave || jaGravadas.has(chave) || automatica(tag)) continue;
    (opts.temContato ? contatoFinal : leadFinal).push(chave);
    jaGravadas.add(chave);
  }
  return { leadTags: leadFinal, contatoTags: contatoFinal };
}
