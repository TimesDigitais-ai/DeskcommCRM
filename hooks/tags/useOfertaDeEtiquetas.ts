"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { EtiquetaOferecida } from "@/lib/tags/travadas";

const VAZIO_TAGS: EtiquetaOferecida[] = [];
const VAZIO_TRAVADAS: string[] = [];

/**
 * As etiquetas que o seletor oferece e as que são travadas (só o agente aplica).
 * Muda pouco e é lida em todo card do funil (para ordenar as automáticas
 * primeiro) — `staleTime` alto e uma única chave, então o react-query serve todos
 * os componentes com UMA requisição.
 *
 * Substitui `useTagCatalog` (que lia o `tag_catalog` do fork). A COR não vem
 * daqui: o chip a lê do provider do upstream (`ProvedorDeCoresDasEtiquetas`).
 *
 * Falha silenciosa de propósito: sem a lista o card ainda mostra as etiquetas
 * (só sem a ordem "automáticas primeiro"). Um toast por card derrubaria a tela
 * por um enfeite.
 */
export function useOfertaDeEtiquetas() {
  const q = useQuery({
    queryKey: ["oferta-de-etiquetas"],
    staleTime: 2 * 60_000,
    retry: 1,
    queryFn: async (): Promise<{ tags: EtiquetaOferecida[]; travadas: string[] }> => {
      const res = await apiClient.get<{ data: { tags: EtiquetaOferecida[]; travadas: string[] } }>(
        "/api/v1/tags/oferta",
      );
      return res.data;
    },
  });
  return {
    oferta: q.data?.tags ?? VAZIO_TAGS,
    travadas: q.data?.travadas ?? VAZIO_TRAVADAS,
    isLoading: q.isLoading,
  };
}
