import { randomUUID } from "node:crypto";
import pg from "pg";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createMirror, ingestMirror, listMirrors } from "@/lib/channels/mirror/store";

const url = process.env.TEST_MIRROR_DB_URL ?? `postgres://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`;
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("test_database_must_be_local");
const pool = new pg.Pool({ connectionString: url, max: 8 });
const org = randomUUID(), otherOrg = randomUUID(), company = randomUUID();
const phones = ["+5511999998888", "+5511999997777"];
let token: string;
let mirrorId: string;
function event(direction = "FROM_HUB", phone = phones[0]!, id = randomUUID(), state = "DELIVERED", at = "2026-09-20T15:53:26Z") {
  return { eventType: direction === "FROM_HUB" ? "MESSAGE_RECEIVED" : "MESSAGE_SENT", date: at,
    content: { id, sessionId: "86005cd3-8122-4d39-a9d4-861b65b75ee3", companyId: company, timestamp: "2026-09-20T15:53:26Z", updatedAt: at, type: "TEXT", text: "Mensagem sintética de QA", direction, status: state,
      details: { from: direction === "FROM_HUB" ? "+5511988889999" : phone, to: direction === "FROM_HUB" ? phone : "+5511988889999" } } };
}
const CDN = "https://cdn.flw.chat/upload/abc/IMAGE/tok.jpg?AWSAccessKeyId=x&Expires=1&Signature=y";
function mediaEvent(id: ReturnType<typeof randomUUID>, type: string, at: string, details: Record<string, unknown> = {}, text: string | null = null) {
  const e = event("FROM_HUB", phones[0]!, id, "DELIVERED", at);
  return { ...e, content: { ...e.content, type, text, details: { ...e.content.details, ...details } } };
}
const rowOf = async (id: string) =>
  (await pool.query("select type,body,media_url,media_mime,media_size_bytes,media_storage_path from messages where organization_id=$1 and id=$2", [org, id])).rows[0];
beforeAll(async () => {
  await pool.query("insert into organizations(id,slug,legal_name,display_name) values($1,$2,'QA espelho','QA espelho'),($3,$4,'Outro QA','Outro QA')", [org, `mirror-${org}`, otherOrg, `mirror-${otherOrg}`]);
  const result = await createMirror(pool, org, { name: "QA espelho", company_id: company, channels: phones.map(phone_number => ({ phone_number, name: "Canal QA" })) });
  token = result.token; mirrorId = result.id;
});
afterAll(async () => { await pool.end(); });
describe("espelho no banco real", () => {
  it("cria uma única bolha mesmo com reentregas concorrentes e nenhum evento operacional", async () => {
    const payload = event();
    const results = await Promise.all(Array.from({ length: 5 }, () => ingestMirror(pool, token, payload)));
    expect(new Set(results.map(r => r.messageId)).size).toBe(1);
    await pool.query("select fn_wake_channel_routing($1)", [org]);
    expect((await pool.query("select count(*)::int n from messages where organization_id=$1", [org])).rows[0].n).toBe(1);
    expect((await pool.query("select count(*)::int n from event_log where organization_id=$1 and (event_type like 'message.%' or event_type='conversation.routing_requested')", [org])).rows[0].n).toBe(0);
    expect((await pool.query("select unread_count_for_assignee n from conversations where organization_id=$1", [org])).rows[0].n).toBe(1);
  });
  it("mesmo contato em dois canais fica com duas conversas e um contato", async () => {
    await ingestMirror(pool, token, event("FROM_HUB", phones[1]));
    expect((await pool.query("select count(*)::int n from conversations where organization_id=$1", [org])).rows[0].n).toBe(2);
    expect((await pool.query("select count(*)::int n from contacts where organization_id=$1", [org])).rows[0].n).toBe(1);
  });
  it("atualizações de saída preservam identidade e não rebaixam o status", async () => {
    const id = randomUUID();
    const sent = await ingestMirror(pool, token, event("TO_HUB", phones[0], id, "SENT"));
    const delivered = await ingestMirror(pool, token, event("TO_HUB", phones[0], id, "DELIVERED", "2026-09-20T15:54:07Z"));
    await ingestMirror(pool, token, event("TO_HUB", phones[0], id, "QUEUED", "2026-09-20T15:53:00Z"));
    expect(sent.messageId).toBe(delivered.messageId);
    expect((await pool.query("select status from messages where organization_id=$1 and id=$2", [org, sent.messageId])).rows[0].status).toBe("delivered");
  });
  it("chave, empresa e número inválidos não persistem dados", async () => {
    const before = (await pool.query("select count(*)::int n from messages where organization_id=$1", [org])).rows[0].n;
    await expect(ingestMirror(pool, "wrong-token", event())).rejects.toThrow("unknown_mirror");
    const wrong = event(); wrong.content.companyId = randomUUID();
    await expect(ingestMirror(pool, token, wrong)).rejects.toThrow("company_mismatch");
    await expect(ingestMirror(pool, token, event("FROM_HUB", "+5511111111111"))).rejects.toThrow("channel_mismatch");
    expect((await pool.query("select count(*)::int n from messages where organization_id=$1", [org])).rows[0].n).toBe(before);
    expect(await listMirrors(pool, otherOrg)).toEqual([]);
  });
  it("banco barra saída do CRM inclusive quando o handler é contornado", async () => {
    const { rows: [m] } = await pool.query("select * from messages where organization_id=$1 limit 1", [org]);
    await expect(pool.query("insert into messages(organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,body,sent_via) values($1,$2,$3,$4,'text','outbound','sending','não enviar','crm')", [org, m.conversation_id, m.channel_session_id, m.contact_id])).rejects.toThrow("channel_read_only");
  });
  it("credenciais não são legíveis pelo browser e o vínculo entre tenants é recusado", async () => {
    const db = await pool.connect();
    try {
      for (const role of ["anon", "authenticated"]) {
        await db.query(`set role ${role}`);
        for (const table of ["channel_mirrors", "channel_mirror_sessions"]) {
          await expect(db.query(`select * from ${table}`)).rejects.toThrow("permission denied");
          await expect(db.query(`update ${table} set organization_id=$1`, [otherOrg])).rejects.toThrow("permission denied");
        }
        await db.query("reset role");
      }
    } finally { await db.query("reset role"); db.release(); }
    const { rows: [s] } = await pool.query("insert into channel_sessions(organization_id,provider,phone_number,webhook_secret_encrypted,status) values($1,'mirror','+5511888887777','\\x'::bytea,'WORKING') returning id", [otherOrg]);
    await expect(pool.query("insert into channel_mirror_sessions(organization_id,mirror_id,channel_session_id) values($1,$2,$3)", [otherOrg, mirrorId, s.id])).rejects.toMatchObject({ code: "23503" });
  });
  it("anexo com arquivo da allowlist vira mídia do tipo certo, sem acordar nada operacional", async () => {
    const r = await ingestMirror(pool, token, mediaEvent(randomUUID(), "IMAGE", "2026-09-20T16:00:00Z", { file: { mimeType: "image/jpeg", size: 999, publicUrl: CDN } }, "legenda"));
    expect(await rowOf(r.messageId!)).toMatchObject({ type: "image", body: "legenda", media_url: CDN, media_mime: "image/jpeg", media_storage_path: null });
    expect(Number((await rowOf(r.messageId!)).media_size_bytes)).toBe(999);
    expect((await pool.query("select count(*)::int n from event_log where organization_id=$1 and event_type like 'media.%'", [org])).rows[0].n).toBe(0);
  });
  it("anexo sem arquivo ou com host proibido continua texto com o aviso", async () => {
    const semArquivo = await ingestMirror(pool, token, mediaEvent(randomUUID(), "AUDIO", "2026-09-20T16:01:00Z"));
    const hostRuim = await ingestMirror(pool, token, mediaEvent(randomUUID(), "IMAGE", "2026-09-20T16:02:00Z", { file: { publicUrl: "https://evil.example/a.jpg" } }));
    for (const r of [semArquivo, hostRuim]) {
      expect(await rowOf(r.messageId!)).toMatchObject({ type: "text", media_url: null, body: expect.stringContaining("consulte na plataforma de origem") });
    }
  });
  it("o arquivo que chega num evento posterior preenche a mídia; nunca sobrescreve nem rebaixa", async () => {
    const id = randomUUID();
    const first = await ingestMirror(pool, token, mediaEvent(id, "IMAGE", "2026-09-20T16:03:00Z"));
    expect(await rowOf(first.messageId!)).toMatchObject({ type: "text", media_url: null });
    // O mesmo evento agora com o arquivo (status/edição posterior).
    await ingestMirror(pool, token, mediaEvent(id, "IMAGE", "2026-09-20T16:03:30Z", { file: { mimeType: "image/png", publicUrl: CDN } }));
    expect(await rowOf(first.messageId!)).toMatchObject({ type: "image", body: "", media_url: CDN, media_mime: "image/png" });
    // O worker persistiu: o caminho do Storage é dele e não pode ser tocado.
    await pool.query("update messages set media_storage_path='org/conv/m.png' where organization_id=$1 and id=$2", [org, first.messageId]);
    await ingestMirror(pool, token, mediaEvent(id, "IMAGE", "2026-09-20T16:04:00Z", { file: { mimeType: "image/gif", publicUrl: CDN.replace("tok.jpg", "outro.gif") } }));
    // Evento sem arquivo depois: não rebaixa o tipo nem troca a legenda pelo aviso.
    await ingestMirror(pool, token, mediaEvent(id, "IMAGE", "2026-09-20T16:05:00Z"));
    expect(await rowOf(first.messageId!)).toMatchObject({ type: "image", body: "", media_url: CDN, media_mime: "image/png", media_storage_path: "org/conv/m.png" });
    expect((await pool.query("select count(*)::int n from messages where organization_id=$1 and external_id like $2", [org, `%:${id}`])).rows[0].n).toBe(1);
  });
  // Por último: pausar a fonte impede qualquer ingestão nos testes seguintes.
  it("pausar a recepção impede novas mensagens sem apagar conversas", async () => {
    await pool.query("update channel_mirrors set enabled=false where organization_id=$1 and id=$2", [org, mirrorId]);
    await expect(ingestMirror(pool, token, event())).rejects.toThrow("unknown_mirror");
    expect((await listMirrors(pool, org))[0].enabled).toBe(false);
  });
});
