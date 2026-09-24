"use client";

import { copyToClipboard } from "@/lib/clipboard";
import { useT } from "@/hooks/i18n/useT";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Mirror = { id: string; name: string; enabled: boolean; last_received_at: string | null; last_error_code: string | null; channels: { name: string; phone_number: string }[] };

async function request(method = "GET", body?: unknown) {
  const res = await fetch("/api/v1/channels/mirror", { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message ?? "Não foi possível consultar o espelho.");
  return json.data;
}

export function InboxMirrorClient() {
  const t = useT();
  const query = useQuery<Mirror[]>({ queryKey: ["inbox-mirrors"], queryFn: () => request(), refetchInterval: 15000 });
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [numbers, setNumbers] = useState("");
  const [webhook, setWebhook] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setWebhook(null);
    try {
      const data = await request("POST", { name, company_id: company, channels: numbers.split(",").map(v => v.trim()).filter(Boolean).map(phone_number => ({ phone_number, name: `${name} · ${phone_number}` })) });
      setWebhook(`${window.location.origin}${data.webhook_path}`);
      await query.refetch();
      setName(""); setNumbers(""); setCompany("");
    } catch (e) { setError(e instanceof Error ? e.message : t("Falha ao criar espelho.")); }
    finally { setBusy(false); }
  }
  async function toggle(mirror: Mirror) {
    setBusy(true); setError(null);
    try { await request("PATCH", { id: mirror.id, enabled: !mirror.enabled }); await query.refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : t("Falha ao alterar espelho.")); }
    finally { setBusy(false); }
  }
  return <section className="max-w-3xl space-y-6">
    <div><h2 className="text-lg font-semibold">{t("Espelho da Inbox")}</h2>
      <p className="text-sm text-muted-foreground">{t("Acompanhe mensagens de uma central externa. O atendimento continua na origem; este CRM não envia respostas nem inicia automações nessas conversas.")}</p>
      <p className="mt-2 text-sm text-muted-foreground">{t("Compatível com eventos da Attemics. Nesta etapa, anexos aparecem como aviso para consultar na origem.")}</p>
    </div>
    {query.isPending && <p role="status">{t("Carregando espelhos…")}</p>}
    {(error || query.error) && <p role="alert" className="text-destructive">{t(error ?? query.error?.message ?? "Não foi possível consultar o espelho.")}</p>}
    {query.data?.map(m => <article key={m.id} className="space-y-2 rounded-lg border p-4">
      <h3 className="font-medium">{m.name} · {m.enabled ? t("Recepção habilitada") : t("Recepção pausada")}</h3>
      <p className="text-sm">{m.channels.map(c => c.phone_number).join(" · ")}</p>
      <p className="text-sm text-muted-foreground">{m.last_received_at ? `${t("Última mensagem recebida:")} ${new Date(m.last_received_at).toLocaleString()}` : t("Aguardando a primeira mensagem — configurar a URL não confirma a entrega.")}</p>
      {m.last_error_code && <p role="alert" className="text-sm text-destructive">{t("A última entrega falhou. Confira o histórico do webhook na origem antes de repetir o teste.")} ({m.last_error_code})</p>}
      <Button variant="outline" disabled={busy} onClick={() => toggle(m)}>{m.enabled ? t("Pausar recepção") : t("Retomar recepção")}</Button>
    </article>)}
    {webhook && <div className="space-y-2 rounded-lg border p-4" role="status">
      <p className="font-medium">{t("Espelho criado. Cadastre esta URL em um webhook adicional na origem.")}</p>
      <p className="text-sm">{t("A URL é privada e só aparece nesta criação. Preserve o webhook de atendimento atual.")}</p>
      <Input aria-label={t("URL privada do webhook")} value={webhook} readOnly />
      <Button variant="outline" onClick={() => copyToClipboard(webhook)}>{t("Copiar URL")}</Button>
      <p className="text-sm text-muted-foreground">{t("Selecione mensagem recebida, enviada e atualizada, filtrando pelos números cadastrados. Depois envie uma mensagem de teste pelo seu WhatsApp e confira a Inbox.")}</p>
    </div>}
    <form onSubmit={create} className="space-y-3 rounded-lg border p-4">
      <h3 className="font-medium">{t("Adicionar espelho")}</h3>
      <div className="space-y-1"><Label htmlFor="mirror-name">{t("Nome")}</Label><Input id="mirror-name" required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="mirror-company">{t("Identificador da empresa na origem")}</Label><Input id="mirror-company" required value={company} onChange={e => setCompany(e.target.value)} /><p className="text-xs text-muted-foreground">{t("Use o companyId do evento da sua central para impedir a mistura entre empresas.")}</p></div>
      <div className="space-y-1"><Label htmlFor="mirror-numbers">{t("Números atendidos, com DDI")}</Label><Input id="mirror-numbers" required placeholder="+5511999999999, +5511888888888" value={numbers} onChange={e => setNumbers(e.target.value)} /></div>
      <Button disabled={busy || query.isError} type="submit">{busy ? t("Salvando…") : t("Criar espelho somente leitura")}</Button>
    </form>
  </section>;
}
