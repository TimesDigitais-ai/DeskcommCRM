"use client";
import { useT } from "@/hooks/i18n/useT";
import { Label } from "@/components/ui/label";
import { TagPicker } from "@/components/tags/TagPicker";
import type { useEtiquetasDoLead } from "@/hooks/tags/useEtiquetasDoLead";

/** O campo "Etiquetas" dos formulários de lead: escolher na lista de etiquetas da empresa (Configurações → Tags). */
export function LeadTagsField({
  etiquetas,
  disabled,
}: {
  etiquetas: ReturnType<typeof useEtiquetasDoLead>;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <Label>{t("Etiquetas")}</Label>
      <TagPicker
        oferta={etiquetas.oferta}
        travadas={etiquetas.travadas}
        value={etiquetas.valor}
        onChange={etiquetas.setEdicao}
        disabled={etiquetas.desabilitado || disabled}
      />
      {etiquetas.carregando && (
        <p className="text-xs text-text-muted">{t("Carregando as etiquetas do contato…")}</p>
      )}
      {etiquetas.erro && (
        <p className="text-xs text-error-fg">
          {t("Não deu para ler as etiquetas do contato. Recarregue a página para editá-las.")}
        </p>
      )}
    </div>
  );
}
