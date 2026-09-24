# Espelho da Inbox somente leitura

Implementação optativa. A central externa continua dona do atendimento. O CRM
recebe mensagens novas por webhook adicional e apresenta cópias na Inbox.
Nenhuma conexão Meta é migrada. Nenhum webhook operacional existente é alterado.

## Contrato e limites

O administrador cadastra a fonte em Conexões → Espelho da Inbox. A rota
`/api/v1/channels/mirror` aplica RBAC administrativo e isolamento por organização.
O token aleatório de 256 bits aparece uma vez; somente SHA-256 fica no banco.
A autenticação do receptor usa a URL privada, não assinatura HMAC da origem.
Não publicar a URL em logs, documentos ou capturas. A empresa do evento e o
telefone de negócio precisam corresponder à fonte configurada. Limite de corpo
256 KiB e 120 eventos/minuto por token pelo rate limiter existente.

O contrato Attemics medido está em `lib/channels/mirror/contract.ts`:
MESSAGE_RECEIVED, MESSAGE_SENT e MESSAGE_UPDATED. Demais eventos são ignorados.
IDs de mensagem estáveis deduplicam status e reentregas. Datas mais antigas não
sobrescrevem edições recentes e ticks de entrega não retrocedem por QUEUED/SENT.
Um contato presente em dois números tem duas conversas. Texto é preservado.
Contatos novos aparecem pelo telefone; não há enriquecimento nem importação retroativa.
Eventos de atendimento não sincronizam fechamento/atribuição nesta etapa.

### Setor e atendente (informativo)

Eventos de sessão da origem (`SESSION_NEW`, `SESSION_UPDATE`, `SESSION_COMPLETE`)
anotam **setor** e **atendente** em `conversations.metadata.mirror_session`
(`department`, `agent`, `status`, `updated_at`) — só para a lista do Inbox
mostrar. Isso NÃO é atribuição: `assigned_to_user_id`, `assignee_kind`, status da
conversa, contato e mensagens não são tocados, e nenhum atendimento automático é
acionado. Só conversas que já existem no espelho são anotadas (o evento de
sessão não cria conversa). Um `userId` vazio/zerado limpa o atendente; campo
ausente no evento não apaga o que já estava guardado; evento mais antigo que o
já gravado é descartado. Formato de sessão que o CRM não entende é ignorado
(resposta de sucesso), nunca erro, para a origem não reenviar indefinidamente.

**Nomes vêm de um diretório, não do evento.** A sessão do Attemics traz só
`departmentId` e `userId` (`departmentDetails`/`agentDetails` vêm vazios — medido
em 75 sessões). O CRM traduz o id pelo diretório em
`organizations.settings.mirror_directory` (`{ departments: {id: nome}, agents:
{userId: nome} }`), preenchido a partir da API da origem e mantido à mão quando a
equipe muda. Id que o diretório não conhece **limpa** o campo em vez de manter o
nome antigo (mostrar a pessoa errada é pior que não mostrar).

### Anexos (mídia de ENTRADA)

Tipos de mensagem da origem viram `messages.type`: IMAGE→image, AUDIO→audio,
VIDEO→video, DOCUMENT→document, STICKER→sticker, LOCATION→image (o arquivo é a
imagem do mapa; corpo "📍 Localização" se não houver texto). TEXT, CONTACT, TRACK
e tipos desconhecidos ficam `text` (os dois últimos com o aviso de anexo).

Só vira mídia se o evento trouxer arquivo utilizável em `details.file` (ou
`details.files[0]`) com `publicUrl` — ou `publicUrlDownload` — em
`https://cdn.flw.chat/...` (allowlist estrita de host, https, sem credenciais
na URL, sem porta). Qualquer outra URL é ignorada e a mensagem segue com o
aviso "consulte na plataforma de origem". Campo ausente ou mal-formado nunca
rejeita o evento. O corpo de uma mídia é a legenda (`text` do evento). O
mime e o tamanho declarados vão para `media_mime`/`media_size_bytes`.

Se o evento é de tipo de mídia mas não trouxe arquivo, o receptor registra um
`console.warn` com o tipo e só os NOMES dos campos de `details` (e de
`details.file`) — nunca valores — para descobrir se o webhook os carrega. O CRM
não consulta a API da origem nem guarda token dela.

O evento repete por status: se a mensagem ainda não tem `media_url` nem
`media_storage_path`, um evento posterior com arquivo PREENCHE a mídia (só
`text` sobe de tipo; nunca sobrescreve `media_storage_path`, nunca rebaixa mídia
para texto, nunca troca a legenda pelo aviso).

**Leitura do arquivo.** A tela pede `/api/v1/messages/{id}/media`. Sem cópia no
Storage, a rota usa `mirrorAdapter.fetchInboundMedia`: GET server-side, SOMENTE
para `https://cdn.flw.chat`, sem credenciais, sem seguir redirect para outro
host, prazo de 15 s, teto `MAX_MEDIA_BYTES`, e nunca serve `text/html`/SVG/XML
(executariam script na origem do CRM). O navegador nunca vê a URL de origem.
A frase antiga "sem download remoto" deixou de valer para MÍDIA DE ENTRADA e só
para ela: leitura de anexo é proxy/persistência de entrada por allowlist; o
espelho continua sem enviar nada (`send`/`sendTemplate` recusam, sem capacidade
de envio de mídia, presença ou reação).

A URL assinada da origem vale ~1 ano (áudios até 5). O receptor NÃO pede a
persistência no Storage (`media.persist_requested`): o Storage do cliente é uma
cota única de 1 GB dividida com `whatsapp-media`, e copiar todo anexo de uma
central inteira é decisão de capacidade, não de contrato. O worker
`workers/media-persist-worker.ts` já funciona para linhas do espelho se alguém
emitir o evento (o ref de sessão do espelho é liberado só para leitura de mídia
por `resolveSessionRefDeMidia`).

## Isolamento operacional

O provider mirror fica fora dos seletores de transporte. Adapter recusa envio
e template; handler de mensagens recusa o canal; trigger SQL recusa mensagens
originadas no CRM. O trigger de eventos de mensagens não emite message.* para
cópias. Nenhum pós-entrada, agente ou follow-up é disparado pelo receptor.
A Inbox substitui controles de atendimento e compositor por orientação de leitura.
O estado WORKING do registro técnico não atesta saúde do canal externo; a tela
mostra última entrega recebida e erro, sem declarar o atendimento externo saudável.

## Jornada e validação

1. Em Conexões, cadastrar nome, companyId da central e números com DDI.
2. Registrar a URL privada em webhook adicional da origem; selecionar mensagens
   recebidas, enviadas e atualizadas e os mesmos números. Preservar produção.
3. Enviar teste pelo WhatsApp do operador para cada número e aguardar a resposta
   normal da central. Conferir ambas as direções na Inbox e indicador somente leitura.
4. Atualizações/reentregas devem manter uma única bolha por ID de origem.
5. Se falhar, consultar erro em Conexões e histórico da origem; corrigir configuração
   ou pausar recepção. Não reenviar eventos históricos sem autorização.

Gates: `lib/channels/mirror/contract.test.ts` e
`tests/invariants/mirror-ingest.test.ts` exercitam o handler transacional com
Postgres real, concorrência, identidade, isolamento, ACL, pausa e bloqueio de envio.
A prova de tela e o teste real nos dois números são etapas de implantação;
unitários e banco sintético não os substituem.

## Living System Checklist

1. Entrada: webhook adicional → `app/api/v1/webhooks/mirror/[token]/route.ts`.
2. Saída: `store.ts` → contacts/conversations/messages → InboxLayout.
3. Registro: channel.mirror_created/updated/received em api_audit_log.
4. Tela: Inbox e InboxMirrorClient com última entrega/erro visível.
5. Porta: navegação Conexões existente → aba Espelho da Inbox; Inbox existente.
6. Anti-morte: cópia somente leitura; continuidade e follow-up pertencem à origem.
7. Configuração: InboxMirrorClient cria/lista/pausa; vazio convida a cadastrar;
   URL criada não é tratada como prova de entrega.
8. Continuidade IA↔humano: permanece na central externa; CRM exibe contexto.
9. Retorno: erro atualiza last_error_code; operador corrige/pausa na tela e nova
   entrega confirmada limpa erro. Silêncio sem eventos não prova disponibilidade.
10. Mapa: `docs/architecture/inbox-mirror.architecture.json`.
