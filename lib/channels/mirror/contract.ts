import { z } from "zod";
import { camposDoEvento, extrairMidiaDoEvento, tipoDeMidiaDoEspelho, type MirrorMessageType } from "./media";

const phone = z.string().regex(/^\+[1-9][0-9]{7,14}$/);
export const mirrorConfigSchema = z.object({
  name: z.string().trim().min(1).max(100),
  company_id: z.string().uuid(),
  channels: z.array(z.object({ phone_number: phone, name: z.string().trim().min(1).max(100) })).min(1).max(10),
}).refine(v => new Set(v.channels.map(c => c.phone_number)).size === v.channels.length, "Números repetidos");

const envelope = z.object({ eventType: z.string().max(64), date: z.iso.datetime({ offset: true }), content: z.object({ companyId: z.string().uuid() }).passthrough() });
const message = z.object({
  id: z.string().uuid(), sessionId: z.string().uuid(), companyId: z.string().uuid(),
  timestamp: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
  type: z.string().max(64), text: z.string().max(65536).nullish(),
  direction: z.enum(["FROM_HUB", "TO_HUB"]),
  status: z.enum(["QUEUED", "SENT", "DELIVERED", "READ", "FAILED"]),
  details: z.object({ from: phone, to: phone }),
});

export class MirrorReject extends Error {
  constructor(public code: string, public status = 422) { super(code); }
}
export type MirrorMessage = {
  externalId: string; threadId: string; businessPhone: string; contactPhone: string;
  direction: "inbound" | "outbound"; status: string; body: string;
  sentAt: string; updatedAt: string; sourceType: string;
  /** `messages.type` do CRM. Só vira mídia quando o evento trouxe arquivo utilizável; senão `text` + aviso. */
  type: MirrorMessageType;
  /** Anexo já validado (host permitido). `null` = sem anexo utilizável. */
  media: { url: string; mime: string; sizeBytes: number | null } | null;
};

/**
 * O que os eventos de SESSÃO do Attemics dizem sobre uma conversa: em que setor
 * ela está e quem atende. É INFORMAÇÃO para a tela — nunca vira atribuição nem
 * status da conversa no CRM (o espelho é somente leitura e não aciona ninguém).
 */
export type MirrorSessionInfo = {
  sessionId: string;
  department: string | null;
  agent: string | null;
  /**
   * Os ids que o evento carrega. A sessão do Attemics NÃO traz o nome do setor
   * nem do atendente (`departmentDetails`/`agentDetails` vêm vazios — medido em
   * 75 sessões); só `departmentId` e `userId`. O nome sai do diretório do CRM.
   */
  departmentId: string | null;
  agentId: string | null;
  /** O setor mudou para um id que o diretório não conhece: melhor não mostrar do que mostrar o antigo. */
  departmentCleared: boolean;
  /** O evento disse explicitamente que não há atendente (userId vazio/zerado). */
  agentCleared: boolean;
  status: string | null;
  updatedAt: string;
};

const SESSION_EVENTS = ["SESSION_NEW", "SESSION_UPDATE", "SESSION_COMPLETE"];
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const sessionId = z.string().uuid();
const idOuNulo = (v: unknown): string | null => {
  const r = sessionId.safeParse(v);
  return r.success && r.data !== ZERO_UUID ? r.data : null;
};
const nomeCurto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : null);
const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/**
 * Lê um evento de sessão. Diferente da mensagem, um formato que não entendemos
 * vira `null` (ignorado) e NUNCA um erro: o formato desses eventos varia entre
 * SESSION_NEW / SESSION_UPDATE / SESSION_COMPLETE, e responder erro faria a
 * origem reenviar o mesmo evento indefinidamente.
 *
 * Campo ausente NÃO apaga o que já foi guardado — só `userId` vazio/zerado limpa
 * o atendente, porque é o jeito de o Attemics dizer "sem atendente".
 */
export function parseMirrorSessionEvent(payload: unknown, companyId: string): MirrorSessionInfo | null {
  const parsed = envelope.safeParse(payload);
  if (!parsed.success) return null;
  if (parsed.data.content.companyId !== companyId) throw new MirrorReject("company_mismatch", 403);
  if (!SESSION_EVENTS.includes(parsed.data.eventType)) return null;
  const c = parsed.data.content as Record<string, unknown>;
  const id = sessionId.safeParse(c.sessionId ?? c.id);
  if (!id.success) return null;
  const temUserId = "userId" in c;
  const updated = z.iso.datetime({ offset: true }).safeParse(c.updatedAt);
  return {
    sessionId: id.data,
    department: nomeCurto(objeto(c.departmentDetails).name),
    agent: nomeCurto(objeto(c.agentDetails).name),
    departmentId: idOuNulo(c.departmentId),
    agentId: idOuNulo(c.userId),
    departmentCleared: false,
    agentCleared: temUserId && (c.userId == null || c.userId === "" || c.userId === ZERO_UUID),
    status: typeof c.status === "string" && c.status.trim() ? c.status.trim().toUpperCase().slice(0, 32) : null,
    updatedAt: updated.success ? updated.data : parsed.data.date,
  };
}

/**
 * Diretório de setores e atendentes da origem, guardado em
 * `organizations.settings.mirror_directory` ({ departments: {id: nome}, agents: {userId: nome} }).
 * Existe porque o evento só traz ids.
 */
export type MirrorDirectory = { departments: Record<string, string>; agents: Record<string, string> };

/** Lê o diretório sem confiar no formato do jsonb: o que não for texto é descartado. */
export function lerDiretorio(raw: unknown): MirrorDirectory {
  const mapa = (v: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(objeto(v))) {
      const nome = nomeCurto(val);
      if (nome) out[k] = nome;
    }
    return out;
  };
  const d = objeto(raw);
  return { departments: mapa(d.departments), agents: mapa(d.agents) };
}

/**
 * Completa os nomes que o evento não trouxe, pelo id. O nome que o próprio evento
 * trouxer (se um dia trouxer) tem prioridade; id sem entrada no diretório fica
 * `null` — e `null` NÃO apaga o que já estava guardado.
 */
export function resolverNomesDaSessao(info: MirrorSessionInfo, dir: MirrorDirectory): MirrorSessionInfo {
  const department = info.department ?? (info.departmentId ? (dir.departments[info.departmentId] ?? null) : null);
  const agent = info.agent ?? (info.agentId ? (dir.agents[info.agentId] ?? null) : null);
  return {
    ...info,
    department,
    agent,
    // Id novo que o diretório não conhece: limpar, porque manter o nome antigo
    // mostraria o setor/atendente ERRADO.
    departmentCleared: info.departmentCleared || (info.departmentId != null && department == null),
    agentCleared: info.agentCleared || (info.agentId != null && agent == null),
  };
}

/** Contrato medido no webhook Attemics. Não é o modelo do endpoint de consulta. */
export function parseMirrorEvent(payload: unknown, companyId: string, phones: readonly string[]): MirrorMessage | null {
  const parsed = envelope.safeParse(payload);
  if (!parsed.success) throw new MirrorReject("invalid_envelope");
  if (parsed.data.content.companyId !== companyId) throw new MirrorReject("company_mismatch", 403);
  if (!["MESSAGE_RECEIVED", "MESSAGE_SENT", "MESSAGE_UPDATED"].includes(parsed.data.eventType)) return null;
  const m = message.safeParse(parsed.data.content);
  if (!m.success) throw new MirrorReject("invalid_message");
  const c = m.data;
  const inbound = c.direction === "FROM_HUB";
  const businessPhone = inbound ? c.details.to : c.details.from;
  const contactPhone = inbound ? c.details.from : c.details.to;
  if (!phones.includes(businessPhone) || phones.includes(contactPhone)) throw new MirrorReject("channel_mismatch", 403);
  if ((parsed.data.eventType === "MESSAGE_RECEIVED" && !inbound) || (parsed.data.eventType === "MESSAGE_SENT" && inbound)) throw new MirrorReject("direction_mismatch");
  const sourceType = c.type.replace(/[^A-Z_]/g, "").slice(0, 32) || "outro";
  const tipo = tipoDeMidiaDoEspelho(c.type);
  // `details` chega passthrough no `content`: o schema acima só exige `from/to`,
  // e um `file` ausente ou torto NUNCA rejeita o evento (mesmo princípio dos eventos de sessão).
  const details = (parsed.data.content as Record<string, unknown>).details;
  const media = tipo ? extrairMidiaDoEvento(details, tipo, c.type) : null;
  if (tipo && !media) {
    // Diagnóstico: diz, depois do deploy, se o webhook traz `details.file`. Só NOMES de campo.
    const campos = camposDoEvento(details);
    console.warn(`[mirror] anexo ${sourceType} sem arquivo utilizável; details=[${campos.details.join(",")}] file=${campos.file ? `[${campos.file.join(",")}]` : "ausente"}`);
  }
  const aviso = `[Anexo (${sourceType}) — consulte na plataforma de origem]`;
  const legenda = c.text ?? "";
  return {
    externalId: c.id, threadId: c.sessionId, businessPhone, contactPhone,
    direction: inbound ? "inbound" : "outbound", status: inbound ? "received" : c.status.toLowerCase(),
    type: media && tipo ? tipo : "text",
    media,
    // Mídia: o corpo é a LEGENDA. Sem mídia: texto puro, ou o aviso de anexo.
    body: media ? (legenda || (c.type === "LOCATION" ? "📍 Localização" : "")) : c.type === "TEXT" ? legenda : aviso,
    sourceType: c.type, sentAt: c.timestamp, updatedAt: c.updatedAt,
  };
}
