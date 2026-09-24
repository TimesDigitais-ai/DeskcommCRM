-- 0392 — renumerada de 0261 na reconciliação com o upstream v1.44.0: o número
-- 0261 já era de outra migration deles (titulo_do_evento_pessoal_sai_do_alcance).
-- Mesmo espírito da renumeração deles em #1498 (0388 → 0386): só muda nome de
-- arquivo, carimbo (novo, 20260923173045, depois da 0387) e o vocabulário do
-- CHECK abaixo, que precisa incluir TUDO que 0368 (zernio_social) e 0387
-- (datafy) já adicionaram, porque o drop+add desta migration roda DEPOIS das
-- duas na ordem de aplicação — conteúdo funcional idêntico ao resto do arquivo.
--
-- ⚠️ PARA A PRÓXIMA SINCRONIZAÇÃO COM O UPSTREAM: toda migration futura que
-- recriar `channel_sessions_provider_check` / `_ref_check` (provider novo, como
-- fizeram a 0368 e a 0387) tem de manter `'mirror'` no vocabulário e o ramo do
-- espelho no `_ref_check` — senão o `drop`+`add` dela derruba o espelho. O
-- baseline (`check-do-baseline-nao-diverge-da-cadeia`) acusa a divergência.
--
-- Espelhos não enviam e não emitem eventos operacionais de mensagem.
alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_check
  -- Vocabulário = o da 0387 (waha, meta_cloud, zernio, zernio_social, wacalls,
  -- datafy) mais 'mirror' — UM bloco só por constraint, doutrina de baseline
  -- (não duplicar drop+add por migration).
  check (provider = any (array['waha'::text, 'meta_cloud'::text, 'zernio'::text, 'zernio_social'::text, 'wacalls'::text, 'datafy'::text, 'mirror'::text]));

alter table public.channel_sessions
  drop constraint if exists channel_sessions_provider_ref_check;

alter table public.channel_sessions
  add constraint channel_sessions_provider_ref_check check (
    (provider = 'waha'       and waha_session_name    is not null) or
    (provider = 'meta_cloud' and meta_phone_number_id is not null) or
    (provider in ('zernio', 'zernio_social') and zernio_account_id is not null) or
    (provider = 'wacalls'    and wacalls_session_id    is not null) or
    (provider = 'datafy'     and datafy_phone_number_id is not null) or
    (provider = 'mirror'     and phone_number is not null and waha_session_name is null
      and meta_phone_number_id is null and zernio_account_id is null and wacalls_session_id is null)
  );


-- ---- Espelho da Inbox somente leitura (migration 0392, renumerada de 0261) ----
create table if not exists public.channel_mirrors (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null, company_id uuid not null,
 token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
 enabled boolean not null default true,
 last_received_at timestamptz, last_error_code text,
 created_at timestamptz not null default now(),
 unique (organization_id,id)
);
create unique index if not exists channel_sessions_org_id_mirror_key on public.channel_sessions(organization_id,id);
create table if not exists public.channel_mirror_sessions (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 mirror_id uuid not null,
 channel_session_id uuid not null unique,
 primary key (mirror_id,channel_session_id),
 foreign key (organization_id,mirror_id) references public.channel_mirrors(organization_id,id) on delete cascade,
 foreign key (organization_id,channel_session_id) references public.channel_sessions(organization_id,id) on delete cascade
);
alter table public.channel_mirrors enable row level security;
alter table public.channel_mirror_sessions enable row level security;
-- Secrets never go to browser queries. Configuration is through the admin route.
revoke all on public.channel_mirrors, public.channel_mirror_sessions from public,anon,authenticated;
grant all on public.channel_mirrors, public.channel_mirror_sessions to service_role;

create or replace function public.fn_guard_mirror_message() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if exists(select 1 from public.channel_sessions where id=new.channel_session_id and organization_id=new.organization_id and provider='mirror')
    and new.sent_via <> 'external_device' then
   raise exception 'channel_read_only' using errcode='42501';
 end if;
 return new;
end; $$;
revoke execute on function public.fn_guard_mirror_message() from public,anon,authenticated;
grant execute on function public.fn_guard_mirror_message() to service_role;
drop trigger if exists trg_guard_mirror_message on public.messages;
create trigger trg_guard_mirror_message before insert or update on public.messages
 for each row execute function public.fn_guard_mirror_message();

CREATE OR REPLACE FUNCTION "public"."fn_emit_message_event"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_event text;
begin
  if exists (select 1 from public.channel_sessions where id=new.channel_session_id and organization_id=new.organization_id and provider='mirror') then return new; end if;
  if new.direction = 'inbound' then
    v_event := 'message.received';
  else
    v_event := case new.status
                 when 'sending' then 'message.sending'
                 when 'sent' then 'message.sent'
                 when 'failed' then 'message.failed'
                 else 'message.outbound'
               end;
  end if;

  perform public.fn_log_event(
    new.organization_id, v_event,
    jsonb_build_object(
      'message_id', new.id, 'conversation_id', new.conversation_id,
      'contact_id', new.contact_id, 'direction', new.direction,
      'type', new.type, 'status', new.status, 'external_id', new.external_id,
      'channel_session_id', new.channel_session_id,
      'body_preview', "left"(new.body, 280)
    )
  );
  return new;
end$$;

revoke execute on function public.fn_emit_message_event() from public,anon;
grant execute on function public.fn_emit_message_event() to authenticated,service_role;

-- Cópia não entra na distribuição operacional da fila, inclusive por reativação.
create or replace function public.fn_request_channel_routing(p_org uuid,p_conversation uuid)
returns void language plpgsql security definer set search_path=public as $$
declare c public.conversations;
begin
 select * into c from public.conversations where organization_id=p_org and id=p_conversation;
 if not found or c.assigned_to_user_id is not null or c.status not in('open','pending','claimed','ai_handling') then return;end if;
 if exists(select 1 from public.channel_sessions where organization_id=p_org and id=c.channel_session_id and provider='mirror') then return;end if;
 insert into public.event_log(organization_id,event_type,entity_kind,entity_id,payload)
 values(p_org,'conversation.routing_requested','conversation',c.id,
  jsonb_build_object('organization_id',p_org,'conversation_id',c.id,'channel_session_id',c.channel_session_id))
 on conflict(organization_id,entity_id) where event_type='conversation.routing_requested' and status in('pending','processing')
 do update set next_attempt_at=case when event_log.status='pending' then now() else event_log.next_attempt_at end;
end;
$$;
revoke all on function public.fn_request_channel_routing(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fn_request_channel_routing(uuid,uuid) to service_role;
