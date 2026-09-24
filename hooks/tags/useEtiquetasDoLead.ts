"use client";
import { useState } from "react";

import { useContact } from "@/hooks/contacts/useContact";
import { useUpdateContact } from "@/hooks/contacts/useUpdateContact";
import { useOfertaDeEtiquetas } from "@/hooks/tags/useOfertaDeEtiquetas";
import { repartirEtiquetas, unirTags } from "@/lib/tags/etiquetas-do-card";
import type { Lead } from "@/lib/types/leads";

/**
 * As etiquetas na edição de um lead — compartilhado pelo diálogo do card e pelo
 * dossiê, que têm formulários separados mas a MESMA regra.
 *
 * ONDE MORA CADA UMA: as do time no CONTATO (como no Atemix), as automáticas do
 * agente (travadas — `lib/tags/travadas.ts`) no LEAD. O PATCH de tags SUBSTITUI o array inteiro, então:
 *   - o contato é lido AGORA, não confiamos no que veio no board — gravar só
 *     o que o formulário conhece apagaria etiqueta do contato;
 *   - `edicao === null` significa "ninguém mexeu nas etiquetas": `planejar()`
 *     devolve `tagsDoLead: undefined` e o PATCH nem leva `tags`. Salvar só o
 *     título jamais toca em etiqueta nenhuma;
 *   - a divisão (automáticas sempre preservadas) está em `repartirEtiquetas`.
 */
export function useEtiquetasDoLead(lead: Pick<Lead, "id" | "tags" | "contact_id">, ativo = true) {
  const { oferta, travadas } = useOfertaDeEtiquetas();
  const contatoId = lead.contact_id ?? "";
  // `ativo` existe para o diálogo do card, que fica montado em TODO card do
  // funil: sem isso, abrir o board dispararia uma leitura de contato por card.
  const contato = useContact(ativo ? contatoId : "");
  const atualizaContato = useUpdateContact(contatoId);
  const [edicao, setEdicao] = useState<string[] | null>(null);

  const contatoTags = contato.data?.data.tags ?? [];
  const pronto = !ativo || !contatoId || contato.isSuccess;
  const atuais = unirTags(lead.tags, contatoTags);

  /** O que gravar ao salvar. `undefined`/`null` = não tocar. */
  function planejar(): { tagsDoLead: string[] | undefined; tagsDoContato: string[] | null } {
    if (edicao === null || !pronto) return { tagsDoLead: undefined, tagsDoContato: null };
    const partes = repartirEtiquetas({
      selecionadas: edicao,
      leadTags: lead.tags ?? [],
      contatoTags,
      travadas,
      temContato: !!contatoId,
    });
    const mudouContato = !!contatoId && partes.contatoTags.join("\u0000") !== contatoTags.join("\u0000");
    return { tagsDoLead: partes.leadTags, tagsDoContato: mudouContato ? partes.contatoTags : null };
  }

  return {
    oferta,
    travadas,
    valor: edicao ?? atuais,
    setEdicao,
    zerar: () => setEdicao(null),
    carregando: !pronto && !contato.isError,
    erro: contato.isError,
    ocupado: atualizaContato.isPending,
    desabilitado: !pronto || atualizaContato.isPending,
    planejar,
    gravarContato: (tags: string[]) => atualizaContato.mutateAsync({ tags }),
  };
}
