/**
 * ETIQUETA TRAVADA (automática) — o conceito que o vocabulário do upstream não
 * tem, e que é NOSSO (fork).
 *
 * ─── O que é ────────────────────────────────────────────────────────────────
 *
 * Etiqueta que só um sistema externo aplica — hoje as sete do follow-up do agente
 * (`follow-up 1`, `follow-up 2`, `régua d1`, `régua d4`, `régua d7`, `toques
 * esgotados`, `reengajado`). O nome exato, em minúsculo, é o CONTRATO com o
 * agente: `crm_manage_tags` grava esse texto e o plugin dele lê esse texto. Se o
 * time renomear ou juntar uma delas na tela de Tags, o agente continua escrevendo
 * o nome velho e a cadência quebra em silêncio. Por isso, nessas etiquetas, a tela
 * só deixa mudar a COR.
 *
 * ─── Onde a lista mora, e por que NÃO na estrutura do upstream ───────────────
 *
 * `organizations.settings.tags_travadas` — um array de nomes (jsonb, já existente:
 * `settings` é o jsonb da organização). Escolhido em vez de uma chave extra dentro
 * de `settings.tags[]` porque a função de banco do upstream
 * (`fn_vocabulario_de_tags_operar`, migrations 0264/0336) REESCREVE `settings.tags`:
 * `juntar` descarta os metadados da entrada que sai e `excluir` remove a entrada
 * inteira. Uma chave irmã não é tocada por ela — o vocabulário do upstream fica
 * intacto, sem migration nova, sem tabela nova, sem copiar as ~400 linhas da função.
 *
 * ─── Onde o bloqueio vale, e o que ele NÃO é ────────────────────────────────────
 *
 * - servidor: `POST /api/v1/tags/vocabulario` recusa renomear/juntar/excluir uma
 *   etiqueta travada (`tag_travada`, 422) — `operacaoBloqueada` abaixo;
 * - tela: `/app/settings/tags` esconde esses três botões nas linhas travadas e o
 *   seletor de etiquetas do lead as mostra travadas.
 *
 * NÃO é fronteira de segurança: um gerente (`manager`+) que chame a RPC
 * `fn_vocabulario_de_tags_operar` direto do navegador ainda passa — a função é do
 * upstream e este fork não a reescreve. É trilho contra o ACIDENTE (o clique num
 * botão), que é o que quebrou o agente no desenho; um guard dentro da função de
 * banco seria a camada seguinte, ao custo de copiar a função inteira e perder o
 * guard na próxima migration do upstream que a redefinir. Ver a descrição do PR.
 *
 * Funções PURAS: recebem o `settings` já lido, não tocam em banco nem em rede.
 */
import { chaveDaEtiqueta, normalizarCorDeEtiqueta } from "@/lib/tags/cor-da-etiqueta";

/** A chave de `organizations.settings` que guarda os nomes travados. */
export const CHAVE_DAS_TAGS_TRAVADAS = "tags_travadas";

/**
 * As sete etiquetas automáticas do cliente, como o plugin do agente as escreve
 * (`ESTAGIO_FUP` em `crm-tags-fup.js`; `crm_manage_tags` grava em minúsculo).
 * Só é lida por `scripts/migrar-etiquetas-para-vocabulario.mjs`, que grava a
 * lista em `settings.tags_travadas` — em runtime a fonte é o dado da
 * organização, nunca esta constante.
 */
export const ETIQUETAS_AUTOMATICAS_DO_AGENTE: readonly string[] = [
  "follow-up 1",
  "follow-up 2",
  "régua d1",
  "régua d4",
  "régua d7",
  "toques esgotados",
  "reengajado",
];

/** Os nomes travados de `settings`, normalizados e sem repetição. */
export function travadasDoSettings(settings: unknown): string[] {
  const bruto = (settings as Record<string, unknown> | null | undefined)?.[CHAVE_DAS_TAGS_TRAVADAS];
  if (!Array.isArray(bruto)) return [];
  const vistos = new Set<string>();
  for (const item of bruto) {
    if (typeof item !== "string") continue;
    const chave = chaveDaEtiqueta(item);
    if (chave) vistos.add(chave);
  }
  return [...vistos];
}

/** Esta etiqueta está travada? Comparação pela chave canônica (caixa e pontas). */
export function estaTravada(tag: string, travadas: readonly string[]): boolean {
  const chave = chaveDaEtiqueta(tag);
  return travadas.some((t) => chaveDaEtiqueta(t) === chave);
}

/** Uma etiqueta oferecida para escolha: nome, cor (se tem) e se está travada. */
export interface EtiquetaOferecida {
  tag: string;
  cor: string | null;
  travada: boolean;
}

/**
 * O vocabulário CURADO da organização (`settings.tags`, as duas formas de
 * entrada — string e objeto `{tag, cor, descricao}`), mais as travadas que ainda
 * não estejam nele. É o que o seletor oferece: escolher na lista, não digitar.
 *
 * Diferente de `etiquetasComCor` (que devolve só as entradas COM cor, para o
 * chip): aqui entra a etiqueta sem cor também — ela existe e é escolhível.
 */
export function ofertaDoSettings(settings: unknown): EtiquetaOferecida[] {
  const travadas = travadasDoSettings(settings);
  const lista = (settings as Record<string, unknown> | null | undefined)?.["tags"];
  const saida: EtiquetaOferecida[] = [];
  const vistos = new Set<string>();

  const acrescentar = (tag: string, cor: string | null) => {
    const nome = tag.trim();
    const chave = chaveDaEtiqueta(nome);
    if (!chave || vistos.has(chave)) return;
    vistos.add(chave);
    saida.push({ tag: chave, cor, travada: estaTravada(chave, travadas) });
  };

  if (Array.isArray(lista)) {
    for (const entrada of lista) {
      if (typeof entrada === "string") {
        acrescentar(entrada, null);
      } else if (typeof entrada === "object" && entrada !== null) {
        const objeto = entrada as Record<string, unknown>;
        if (typeof objeto["tag"] === "string") {
          acrescentar(objeto["tag"], normalizarCorDeEtiqueta(objeto["cor"]));
        }
      }
    }
  }
  for (const travada of travadas) acrescentar(travada, null);
  return saida;
}

/** Ações do vocabulário que mudam o NOME/EXISTÊNCIA da etiqueta (a cor não). */
const ACOES_QUE_QUEBRAM_O_CONTRATO = new Set(["renomear", "juntar", "excluir"]);

/**
 * A operação pedida quebraria o contrato de uma etiqueta travada?
 *
 * - origem travada em `renomear`/`juntar`/`excluir`: sim (o agente perderia o
 *   nome que ele escreve);
 * - `renomear` PARA o nome de uma travada: sim (na prática seria uma junção
 *   disfarçada; para isso existe `juntar`);
 * - `juntar` PARA uma travada: não — é o conserto legítimo de uma grafia errada
 *   ("regua d1" → "régua d1"): o nome travado fica e ninguém o perde;
 * - `definir_cor`: nunca bloqueia — é a única coisa que a tela deixa mudar nelas.
 */
export function operacaoBloqueada(
  op: { acao: string; tag: string; destino?: string | null },
  travadas: readonly string[],
): boolean {
  if (!ACOES_QUE_QUEBRAM_O_CONTRATO.has(op.acao)) return false;
  if (estaTravada(op.tag, travadas)) return true;
  if (op.acao === "renomear" && op.destino && estaTravada(op.destino, travadas)) return true;
  return false;
}
