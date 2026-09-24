import { chaveDaEtiqueta as slugDaEtiqueta } from "@/lib/tags/cor-da-etiqueta";
import { unirTags } from "@/lib/tags/etiquetas-do-card";

/**
 * Ajustes de LEITURA da linha da lista do Inbox — só o que se vê na lista, nada
 * do que é gravado ou do que aparece na conversa aberta.
 */

/**
 * Etiquetas que descrevem COMO o contato chegou, não o que ele é. Em toda
 * conversa do espelho do agente elas estão presentes, e um selo repetido em toda
 * linha vira ruído na mesma faixa dos avisos que importam (bloqueado, etiquetas
 * do time). Continuam no contato e no painel da conversa; só saem da lista.
 */
const OCULTAS_NA_LISTA: ReadonlySet<string> = new Set(["whatsapp-import"]);

/** As etiquetas do contato que valem um selo na lista (sem duplicata de caixa). */
export function etiquetasDaLista(tags: readonly string[] | null | undefined): string[] {
  return unirTags(tags).filter((t) => !OCULTAS_NA_LISTA.has(slugDaEtiqueta(t)));
}

export type SessaoDoEspelho = { setor: string | null; atendente: string | null };

/**
 * Setor e atendente que o espelho anotou em `conversations.metadata.mirror_session`
 * (vêm dos eventos de sessão do Attemics). Só para MOSTRAR: não é a atribuição do
 * CRM. Devolve `null` quando a conversa não é do espelho ou não há nada útil —
 * o `metadata` é jsonb livre, então nada aqui presume o formato.
 */
export function sessaoDoEspelho(metadata: unknown): SessaoDoEspelho | null {
  if (!metadata || typeof metadata !== "object") return null;
  const s = (metadata as Record<string, unknown>).mirror_session;
  if (!s || typeof s !== "object") return null;
  const campo = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const setor = campo((s as Record<string, unknown>).department);
  const atendente = campo((s as Record<string, unknown>).agent);
  return setor || atendente ? { setor, atendente } : null;
}

/** "Maria Silva Costa dos Santos" → "Maria Silva": cabe na linha e ainda distingue Carla de Carlos. */
export function nomeCurtoDoAtendente(nome: string): string {
  return nome.trim().split(/\s+/).slice(0, 2).join(" ");
}

/**
 * O WhatsApp marca negrito com `*texto*`. A prévia chega crua do espelho
 * ("*Maria Silva:* Qual a forma…") e mostrava os asteriscos na lista.
 *
 * Só desfaz o par que o WhatsApp de fato interpreta como negrito: o `*` de
 * abertura vem no começo ou depois de espaço/parêntese, e o de fechamento antes
 * de espaço ou pontuação — assim "2*3*4" e "5 * 3" ficam como estão.
 */
export function limparNegritoDoWhatsapp(texto: string): string {
  return texto.replace(
    /(^|[\s(])\*([^\s*](?:[^*\n]*[^\s*])?)\*(?=$|[\s.,;:!?)])/g,
    "$1$2",
  );
}
