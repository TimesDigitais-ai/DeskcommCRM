"use client";
import { useId, useMemo, useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { Input } from "@/components/ui/input";
import { ChipDeEtiqueta } from "@/components/tags/ChipDeEtiqueta";
import { cn } from "@/lib/utils";
import { chaveDaEtiqueta } from "@/lib/tags/cor-da-etiqueta";
import { unirTags } from "@/lib/tags/etiquetas-do-card";
import { estaTravada, type EtiquetaOferecida } from "@/lib/tags/travadas";

interface Props {
  /** O vocabulário oferecido (`useOfertaDeEtiquetas`): nome, cor e se é travada. */
  oferta: readonly EtiquetaOferecida[];
  /** Nomes travados — só o agente aplica; o seletor as mostra e não as muda. */
  travadas: readonly string[];
  /** Etiquetas atuais (texto normalizado ou antigo) — inclusive as travadas. */
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** Esconde a seção "Automáticas" — no contato ela não faz sentido. */
  mostrarAutomaticas?: boolean;
  /** Limite do backend: `conversationTagSchema` / lead aceitam até 20. */
  max?: number;
}

/**
 * Escolher etiqueta na lista da empresa, em vez de digitar texto. A lista é o
 * vocabulário do upstream (Configurações → Tags) e a cor é a do `ChipDeEtiqueta`.
 *
 * REGRAS QUE ESTE COMPONENTE GARANTE (o PATCH de tags substitui o array
 * inteiro, então errar aqui apaga dado do agente):
 *   - travada nunca muda de estado: aparece travada, marcada se já estava no
 *     `value`, e `onChange` devolve o `value` com o MESMO conjunto delas;
 *   - etiqueta que está no `value` mas fora do vocabulário (texto livre antigo)
 *     continua visível e removível — só sai se o usuário tirar.
 */
export function TagPicker({ oferta, travadas, value, onChange, disabled, mostrarAutomaticas = true, max = 20 }: Props) {
  const t = useT();
  const buscaId = useId();
  const [busca, setBusca] = useState("");

  const atuais = useMemo(() => unirTags(value), [value]);
  const marcadas = useMemo(() => new Set(atuais.map(chaveDaEtiqueta)), [atuais]);
  const noVocabulario = useMemo(() => new Set(oferta.map((o) => chaveDaEtiqueta(o.tag))), [oferta]);
  const foraDoVocabulario = atuais.filter((tag) => !noVocabulario.has(chaveDaEtiqueta(tag)));
  const doTime = oferta.filter((o) => !o.travada);
  const automaticas = oferta.filter((o) => o.travada);
  const cheio = atuais.length >= max;

  const termo = chaveDaEtiqueta(busca);
  const passa = (nome: string) => !termo || chaveDaEtiqueta(nome).includes(termo);

  function alternar(tag: string) {
    const chave = chaveDaEtiqueta(tag);
    if (estaTravada(tag, travadas) || disabled) return;
    if (marcadas.has(chave)) {
      onChange(value.filter((v) => chaveDaEtiqueta(v) !== chave));
    } else if (!cheio) {
      onChange([...value, chave]);
    }
  }

  return (
    <div className="space-y-2">
      <div
        className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-border p-2"
        aria-label={t("Etiquetas escolhidas")}
      >
        {atuais.length === 0 && (
          <span className="text-xs text-text-muted">{t("Nenhuma etiqueta escolhida.")}</span>
        )}
        {atuais.map((tag) => {
          const travada = estaTravada(tag, travadas);
          return (
            <ChipDeEtiqueta key={chaveDaEtiqueta(tag)} tag={tag} className="h-5 gap-1 px-1.5 text-[10px]">
              {!travada && !disabled && (
                <button
                  type="button"
                  onClick={() => alternar(tag)}
                  aria-label={`${t("Remover etiqueta")} ${tag}`}
                  className="-mr-0.5 shrink-0 rounded-sm px-0.5 text-[11px] leading-none opacity-70 hover:opacity-100"
                >
                  ×
                </button>
              )}
            </ChipDeEtiqueta>
          );
        })}
      </div>

      <label htmlFor={buscaId} className="sr-only">
        {t("Buscar etiqueta")}
      </label>
      <Input
        id={buscaId}
        value={busca}
        onChange={(ev) => setBusca(ev.target.value)}
        placeholder={t("Buscar etiqueta…")}
        disabled={disabled}
        className="h-8 text-sm"
      />

      <div className="max-h-56 overflow-y-auto rounded-md border border-border">
        {doTime.filter((o) => passa(o.tag)).map((o) => (
          <Linha
            key={o.tag}
            tag={o.tag}
            cor={o.cor}
            marcada={marcadas.has(chaveDaEtiqueta(o.tag))}
            bloqueada={disabled || (!marcadas.has(chaveDaEtiqueta(o.tag)) && cheio)}
            onToggle={() => alternar(o.tag)}
          />
        ))}

        {foraDoVocabulario.filter((tag) => passa(tag)).length > 0 && (
          <>
            <Secao>{t("Fora do cadastro")}</Secao>
            {foraDoVocabulario.filter((tag) => passa(tag)).map((tag) => (
              <Linha
                key={chaveDaEtiqueta(tag)}
                tag={tag}
                marcada
                bloqueada={disabled}
                onToggle={() => alternar(tag)}
              />
            ))}
          </>
        )}

        {mostrarAutomaticas && automaticas.filter((o) => passa(o.tag)).length > 0 && (
          <>
            <Secao>{t("Automáticas")}</Secao>
            {automaticas.filter((o) => passa(o.tag)).map((o) => (
              <Linha
                key={o.tag}
                tag={o.tag}
                cor={o.cor}
                marcada={marcadas.has(chaveDaEtiqueta(o.tag))}
                travada
                onToggle={() => undefined}
              />
            ))}
          </>
        )}

        {doTime.length === 0 && automaticas.length === 0 && foraDoVocabulario.length === 0 && (
          <p className="p-3 text-xs text-text-muted">
            {t("Nenhuma etiqueta cadastrada. Cadastre em Configurações → Tags.")}
          </p>
        )}
      </div>
      {cheio && <p className="text-xs text-text-muted">{t("Limite de etiquetas atingido.")}</p>}
    </div>
  );
}

function Secao({ children }: { children: string }) {
  return (
    <div className="border-y border-border bg-surface-elevated px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
      {children}
    </div>
  );
}

function Linha({
  tag,
  cor,
  marcada,
  bloqueada,
  travada,
  onToggle,
}: {
  tag: string;
  /** `undefined` = usa a cor do provider (a do vocabulário), como o resto do app. */
  cor?: string | null;
  marcada: boolean;
  bloqueada?: boolean;
  travada?: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const inativa = bloqueada || travada;
  return (
    <label
      className={cn(
        "flex items-center gap-2.5 border-b border-border px-2.5 py-1.5 text-sm last:border-b-0",
        inativa ? "cursor-not-allowed" : "cursor-pointer hover:bg-surface-elevated",
      )}
    >
      <input
        type="checkbox"
        checked={marcada}
        disabled={inativa}
        onChange={onToggle}
        aria-label={tag}
        className="size-3.5 shrink-0 accent-accent"
      />
      <ChipDeEtiqueta tag={tag} cor={cor ?? undefined} className="h-5 px-1.5 text-[10px]" />
      {travada && <span className="ml-auto text-[11px] text-text-muted">{t("só o agente")}</span>}
    </label>
  );
}
