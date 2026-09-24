import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import type { z } from "zod";
import { phoneLookupVariants } from "../phone-variants";
import { MirrorReject, lerDiretorio, parseMirrorEvent, parseMirrorSessionEvent, resolverNomesDaSessao, type mirrorConfigSchema } from "./contract";

export const hashMirrorToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export async function createMirror(pool: pg.Pool, org: string, config: z.infer<typeof mirrorConfigSchema>) {
  const db = await pool.connect();
  const token = randomBytes(32).toString("base64url");
  try {
    await db.query("begin");
    const { rows: [mirror] } = await db.query<{ id: string }>(
      "insert into channel_mirrors(organization_id,name,company_id,token_hash) values($1,$2,$3,$4) returning id",
      [org, config.name, config.company_id, hashMirrorToken(token)],
    );
    if (!mirror) throw new Error("mirror_create_failed");
    for (const channel of config.channels) {
      const { rows: [session] } = await db.query<{ id: string }>(
        `insert into channel_sessions(organization_id,provider,phone_number,display_name,webhook_secret_encrypted,status,metadata)
         values($1,'mirror',$2,$3,'\\x'::bytea,'WORKING','{"ai_gate":"allowlist","ai_gate_mode":"pre_go_live","ai_test_phone_numbers":[]}'::jsonb) returning id`,
        [org, channel.phone_number, channel.name],
      );
      if (!session) throw new Error("mirror_channel_create_failed");
      await db.query("insert into channel_mirror_sessions(organization_id,mirror_id,channel_session_id) values($1,$2,$3)", [org, mirror.id, session.id]);
    }
    await db.query("commit");
    return { id: mirror.id, token };
  } catch (err) { await db.query("rollback"); throw err; }
  finally { db.release(); }
}

export async function listMirrors(pool: pg.Pool, org: string) {
  const { rows } = await pool.query(
    `select m.id,m.name,m.enabled,m.last_received_at,m.last_error_code,
       coalesce(jsonb_agg(jsonb_build_object('name',s.display_name,'phone_number',s.phone_number)) filter(where s.id is not null),'[]'::jsonb) channels
     from channel_mirrors m left join channel_mirror_sessions ms on ms.mirror_id=m.id and ms.organization_id=m.organization_id
     left join channel_sessions s on s.id=ms.channel_session_id and s.organization_id=m.organization_id
     where m.organization_id=$1 group by m.id order by m.created_at`, [org],
  );
  return rows;
}

/** Transação única: recibo só depois de contato, conversa e mensagem persistidos.
 * Não chama pós-entrada, agente, lead ou follow-up. O trigger SQL reconhece o canal.
 */
export async function ingestMirror(pool: pg.Pool, token: string, payload: unknown) {
  const db = await pool.connect();
  let source: { id: string; organization_id: string; company_id: string } | undefined;
  try {
    await db.query("begin");
    await db.query("set local statement_timeout='10s'");
    const { rows } = await db.query<{ id: string; organization_id: string; company_id: string }>(
      "select id,organization_id,company_id from channel_mirrors where token_hash=$1 and enabled=true for update", [hashMirrorToken(token)],
    );
    source = rows[0];
    if (!source) throw new MirrorReject("unknown_mirror", 404);
    const org = source.organization_id;
    const { rows: sessions } = await db.query<{ id: string; phone_number: string }>(
      `select s.id,s.phone_number from channel_mirror_sessions ms join channel_sessions s on s.id=ms.channel_session_id and s.organization_id=ms.organization_id
       where ms.mirror_id=$1 and ms.organization_id=$2 and s.provider='mirror' and s.archived_at is null`, [source.id, org],
    );
    const message = parseMirrorEvent(payload, source.company_id, sessions.map(s => s.phone_number));
    if (!message) {
      // Evento de SESSÃO (setor / atendente): só anota na conversa que já existe,
      // dentro de `metadata.mirror_session`, para a lista mostrar. Não toca em
      // atribuição, status, contato nem em nada que dispare atendimento — e
      // segue "ignored" para a rota: não é mensagem, não gera auditoria de mensagem.
      const bruta = parseMirrorSessionEvent(payload, source.company_id);
      if (bruta) {
        // O evento só traz ids: o nome sai do diretório de setores/atendentes da org.
        const { rows: [org_] } = await db.query<{ diretorio: unknown }>(
          "select settings->'mirror_directory' as diretorio from organizations where id=$1", [org],
        );
        const sessao = resolverNomesDaSessao(bruta, lerDiretorio(org_?.diretorio));
        await db.query(
          `update conversations set metadata = jsonb_set(metadata, '{mirror_session}',
             jsonb_strip_nulls(jsonb_build_object(
               'department', case when $8::boolean then null else coalesce($3::text, metadata->'mirror_session'->>'department') end,
               'agent', case when $6::boolean then null else coalesce($4::text, metadata->'mirror_session'->>'agent') end,
               'status', coalesce($5::text, metadata->'mirror_session'->>'status'),
               'updated_at', $7::text)), true)
           where organization_id=$1 and provider_conversation_id=$2 and metadata->>'read_only_mirror'='true'
             and coalesce((metadata->'mirror_session'->>'updated_at')::timestamptz,'epoch') <= $7::timestamptz`,
          [org, sessao.sessionId, sessao.department, sessao.agent, sessao.status, sessao.agentCleared, sessao.updatedAt, sessao.departmentCleared],
        );
      }
      await db.query("commit");
      return { status: "ignored", organizationId: org };
    }
    const session = sessions.find(s => s.phone_number === message.businessPhone)!;
    // Serializa criação + atualização do contato e a deduplicação dos eventos fora de ordem.
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`mirror:${org}`]);
    const externalId = `mirror:${source.id}:${session.id}:${message.externalId}`;
    const { rows: [existing] } = await db.query<{ id: string; conversation_id: string; direction: string }>(
      "select id,conversation_id,direction from messages where organization_id=$1 and external_id=$2", [org, externalId],
    );
    if (existing && existing.direction !== message.direction) throw new MirrorReject("identity_mismatch", 409);
    let conversationId = existing?.conversation_id;
    let messageId = existing?.id;
    if (!existing) {
      const variants = phoneLookupVariants(message.contactPhone);
      const { rows: contacts } = await db.query<{ id: string; is_anonymized: boolean }>(
        "select id,is_anonymized from contacts where organization_id=$1 and phone_number=any($2::text[]) and is_merged_into is null order by created_at limit 2", [org, variants],
      );
      if (contacts.length > 1) throw new MirrorReject("ambiguous_contact", 409);
      if (contacts[0]?.is_anonymized) throw new MirrorReject("anonymized_contact", 409);
      let contactId = contacts[0]?.id;
      if (!contactId) {
        const { rows: [contact] } = await db.query<{ id: string }>(
          "insert into contacts(organization_id,phone_number,source) values($1,$2,'inbox_mirror') returning id", [org, message.contactPhone],
        );
        contactId = contact!.id;
      }
      const { rows: conversations } = await db.query<{ id: string }>(
        "select id from conversations where organization_id=$1 and contact_id=$2 and channel_session_id=$3 and is_group=false order by created_at limit 2", [org, contactId, session.id],
      );
      if (conversations.length > 1) throw new MirrorReject("ambiguous_conversation", 409);
      conversationId = conversations[0]?.id;
      if (!conversationId) {
        const { rows: [conversation] } = await db.query<{ id: string }>(
          `insert into conversations(organization_id,contact_id,channel_session_id,status,assignee_kind,provider_conversation_id,metadata)
           values($1,$2,$3,'open',null,$4,'{"read_only_mirror":true}'::jsonb) returning id`, [org, contactId, session.id, message.threadId],
        );
        conversationId = conversation!.id;
      }
      const { rows: [inserted] } = await db.query<{ id: string }>(
        `insert into messages(organization_id,conversation_id,channel_session_id,contact_id,external_id,type,direction,status,body,sent_via,sent_at,metadata,media_url,media_mime,media_size_bytes)
         values($1,$2,$3,$4,$5,$11,$6,$7,$8,'external_device',$9,$10::jsonb,$12,$13,$14) returning id`,
        [org, conversationId, session.id, contactId, externalId, message.direction, message.status, message.body, message.sentAt,
          JSON.stringify({ mirror_updated_at: message.updatedAt, source_type: message.sourceType, source_thread_id: message.threadId }),
          message.type, message.media?.url ?? null, message.media?.mime ?? null, message.media?.sizeBytes ?? null],
      );
      messageId = inserted!.id;
      await db.query(
        `update conversations set last_message_preview=case when last_message_at is null or last_message_at<=$3 then left($4,280) else last_message_preview end,
          last_message_at=greatest(last_message_at,$3::timestamptz),
          last_inbound_at=case when $5='inbound' then greatest(last_inbound_at,$3::timestamptz) else last_inbound_at end,
          last_outbound_at=case when $5='outbound' then greatest(last_outbound_at,$3::timestamptz) else last_outbound_at end,
          unread_count_for_assignee=unread_count_for_assignee+case when $5='inbound' then 1 else 0 end
         where organization_id=$1 and id=$2`, [org, conversationId, message.sentAt, message.body || `[${message.type}]`, message.direction],
      );
    } else {
      // O payload inteiro se repete por status. Mesmo externalId -> mesma bolha.
      // Não retrocede ticks nem aplica edições mais antigas.
      await db.query(
        `update messages set
          status=case when status='read' or (status='delivered' and $3 in ('queued','sent')) or (status='sent' and $3='queued') then status else $3 end,
          body=case when $6::boolean and (media_url is not null or media_storage_path is not null) then body else $4 end,
          metadata=metadata||jsonb_build_object('mirror_updated_at',$5::text)
         where organization_id=$1 and id=$2 and coalesce((metadata->>'mirror_updated_at')::timestamptz,'epoch')<=$5::timestamptz`,
        [org, messageId, message.status, message.body, message.updatedAt, message.media === null && message.type === "text" && message.sourceType !== "TEXT"],
      );
      // O anexo pode chegar num evento posterior ao primeiro (o mesmo evento repete
      // por status). Preenche só quando a mensagem ainda não tem mídia nenhuma:
      // nunca sobrescreve `media_storage_path` (o worker pode já ter persistido) nem
      // troca uma mídia já gravada, e nunca rebaixa mídia para texto (só `text` sobe).
      // Fora do filtro de data de propósito: dado de anexo é idempotente, não é edição.
      if (message.media) {
        await db.query(
          `update messages set type=$3, media_url=$4, media_mime=$5, media_size_bytes=$6,
            body=case when body like '[Anexo (%) — consulte na plataforma de origem]' then $7 else body end
           where organization_id=$1 and id=$2 and type='text' and media_url is null and media_storage_path is null`,
          [org, messageId, message.type, message.media.url, message.media.mime, message.media.sizeBytes, message.body],
        );
      }
    }
    await db.query("update channel_mirrors set last_received_at=now(),last_error_code=null where organization_id=$1 and id=$2", [org, source.id]);
    await db.query("commit");
    return { status: existing ? "updated" : "ingested", conversationId, messageId, organizationId: org };
  } catch (err) {
    await db.query("rollback");
    if (source) await db.query("update channel_mirrors set last_error_code=$3 where organization_id=$1 and id=$2", [source.organization_id, source.id, err instanceof MirrorReject ? err.code : "storage_failed"]);
    throw err;
  } finally { db.release(); }
}
