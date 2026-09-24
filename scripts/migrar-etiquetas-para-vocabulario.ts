/**
 * MIGRA o catálogo de etiquetas do fork (`organizations.settings.tag_catalog`)
 * para o vocabulário nativo do upstream (`settings.tags`) e grava a lista das
 * etiquetas TRAVADAS (`settings.tags_travadas`).
 *
 * ─── Quando rodar ───────────────────────────────────────────────────────────
 *
 * UMA vez, DEPOIS de a reconciliação com o upstream v1.44.0 (PR
 * `chore/reconciliacao-upstream-v1.44.0`) estar aprovada e implantada, e ANTES
 * de o time abrir a tela de Tags. NÃO foi executado contra nenhum banco: a
 * reconciliação não toca produção. Quem roda é uma pessoa, com aprovação.
 *
 * Enquanto não rodar, nada quebra: o código novo lê `settings.tags` (vazio ou o
 * que já houver) — as etiquetas continuam nos contatos/leads (o que está gravado
 * em `contacts.tags` / `crm_leads.tags` NÃO muda), só aparecem sem cor e sem
 * a marca de travada até a migração.
 *
 * ─── O que ele faz (uma transação, `SELECT … FOR UPDATE` na organização) ─────
 *
 *  1. lê `settings.tag_catalog` (as 26 entradas: 17 do Atemix + 7 automáticas do
 *     agente + "equipe interna"), `settings.tags` e `settings.tags_travadas`;
 *  2. `lib/tags/migrar-catalogo.ts` (função pura, com teste) traduz:
 *       - cada etiqueta vira `{ tag: <slug>, cor: <hex EXATO> }` em `settings.tags`;
 *         cor que já existisse no vocabulário do upstream vence (e é reportada);
 *       - as `automatica: true` entram em `settings.tags_travadas` e ganham a
 *         descrição "Aplicada automaticamente pelo agente…";
 *  3. grava SÓ as chaves `tags` e `tags_travadas` (`jsonb_set`) — o resto de
 *     `settings` (inclusive `canonical_conversation_tags`) fica intacto;
 *  4. RELÊ e confere que toda etiqueta do catálogo está no vocabulário com o mesmo
 *     hex, e que toda automática está travada; qualquer divergência dá ROLLBACK;
 *  5. imprime o relatório. `--apply` faz COMMIT; sem ele, ROLLBACK (dry-run).
 *
 * `tag_catalog` NÃO é apagado (é a cópia de segurança). `--limpar-catalogo`, junto
 * de `--apply`, remove a chave depois da conferência — só faça isso quando a
 * o cliente estiver rodando estável na versão nova.
 *
 * ─── O que NÃO muda ─────────────────────────────────────────────────────────
 *
 *  - `contacts.tags`, `crm_leads.tags`, `conversations.tags`: o valor gravado
 *    sempre foi o slug minúsculo, idêntico ao `normalizarTag` do upstream;
 *  - o nome exato das etiquetas do agente (`crm_manage_tags` segue escrevendo o
 *    mesmo texto).
 *
 * ─── O que se perde (declarado, não escondido) ──────────────────────────────
 *
 * A caixa/acentuação de EXIBIÇÃO ("CIDADE EXEMPLO", "Régua D1"): o vocabulário do
 * upstream não separa nome de slug — o chip mostra o texto gravado no contato
 * (minúsculo). O cartão do funil desenha em CAIXA ALTA por CSS, então o visual
 * do Atemix se mantém ali.
 *
 * ─── Backup e desfazer ──────────────────────────────────────────────────────
 *
 * Com `--apply`, antes de escrever o script grava um JSON com o `tags`,
 * `tags_travadas` e `tag_catalog` de ANTES (`--backup <arquivo>`, padrão
 * `./etiquetas-backup-<org>-<data>.json`, modo 0600). Desfazer = repor esses
 * três valores em `organizations.settings` (o próprio JSON traz o `jsonb_set`
 * pronto no campo `desfazer_sql`).
 *
 * ─── Uso ────────────────────────────────────────────────────────────────────
 *
 *   # DRY-RUN (padrão): mostra o que faria, escreve NADA
 *   tsx --env-file=.env scripts/migrar-etiquetas-para-vocabulario.ts --org <org_id>
 *
 *   # APLICAR
 *   tsx --env-file=.env scripts/migrar-etiquetas-para-vocabulario.ts --org <org_id> --apply
 *
 * Conexão: `SUPABASE_DB_URL` (Postgres direto). A URL NUNCA é impressa.
 */
import { chmodSync, writeFileSync } from "node:fs";

import pg from "pg";

import {
  automaticasDoAgenteForaDasTravadas,
  migrarCatalogoParaVocabulario,
} from "../lib/tags/migrar-catalogo";
import { etiquetasComCor } from "../lib/tags/cor-da-etiqueta";
import { CHAVE_DAS_TAGS_TRAVADAS, travadasDoSettings } from "../lib/tags/travadas";

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const tem = (nome: string) => process.argv.includes(nome);

async function main(): Promise<number> {
  const orgId = arg("--org");
  const aplicar = tem("--apply");
  const limpar = tem("--limpar-catalogo");
  if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) {
    console.error("uso: --org <uuid da organização> [--apply] [--limpar-catalogo] [--backup <arquivo>]");
    return 2;
  }
  const url = process.env["SUPABASE_DB_URL"];
  if (!url) {
    console.error("SUPABASE_DB_URL ausente");
    return 2;
  }
  if (limpar && !aplicar) {
    console.error("--limpar-catalogo só faz sentido junto de --apply");
    return 2;
  }

  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    await cliente.query("begin");
    const { rows } = await cliente.query<{ settings: Record<string, unknown> | null }>(
      "select settings from public.organizations where id = $1 for update",
      [orgId],
    );
    if (rows.length !== 1) throw new Error("organização não encontrada");
    const antes = rows[0]!.settings ?? {};

    if (!Array.isArray(antes["tag_catalog"])) {
      console.info("Esta organização não tem `tag_catalog` — nada a migrar.");
      await cliente.query("rollback");
      return 0;
    }

    const r = migrarCatalogoParaVocabulario(antes);
    console.info(`tag_catalog: ${(antes["tag_catalog"] as unknown[]).length} entrada(s) lidas.`);
    for (const l of r.relatorio) {
      const extra = l.corDoCatalogo ? ` (catálogo tinha ${l.corDoCatalogo}; a cor do vocabulário foi mantida)` : "";
      console.info(
        `  ${l.automatica ? "[travada] " : "          "}${l.tag.padEnd(24)} ${(l.cor ?? "sem cor").padEnd(8)} ${l.resultado}${extra}`,
      );
    }
    if (r.ignoradas.length > 0) {
      console.warn(`ATENÇÃO: ${r.ignoradas.length} entrada(s) do catálogo ilegíveis, NÃO migradas:`, r.ignoradas);
    }
    const faltando = automaticasDoAgenteForaDasTravadas(r.travadas);
    if (faltando.length > 0) {
      console.warn(
        `ATENÇÃO: ${faltando.length} das 7 automáticas do agente NÃO ficariam travadas (o catálogo não as marca como automáticas): ${faltando.join(", ")}.`,
      );
    }

    await cliente.query(
      `update public.organizations
          set settings = jsonb_set(
                           jsonb_set(coalesce(settings, '{}'::jsonb), '{tags}', $2::jsonb, true),
                           '{${CHAVE_DAS_TAGS_TRAVADAS}}', $3::jsonb, true)
        where id = $1`,
      [orgId, JSON.stringify(r.tags), JSON.stringify(r.travadas)],
    );

    // Conferência: relê e compara com o que o CATÁLOGO dizia.
    const { rows: depoisRows } = await cliente.query<{ settings: Record<string, unknown> }>(
      "select settings from public.organizations where id = $1",
      [orgId],
    );
    const depois = depoisRows[0]!.settings;
    const corPorTag = new Map(etiquetasComCor(depois).map((e) => [e.tag.trim().toLowerCase(), e.cor]));
    const travadasDepois = new Set(travadasDoSettings(depois));
    const problemas: string[] = [];
    for (const l of r.relatorio) {
      if (l.resultado === "cor_invalida_sem_cor") continue;
      if (corPorTag.get(l.tag) === undefined) problemas.push(`${l.tag}: sem cor no vocabulário depois de gravar`);
      if (l.automatica && !travadasDepois.has(l.tag)) problemas.push(`${l.tag}: automática não ficou travada`);
    }
    if (problemas.length > 0) {
      console.error("CONFERÊNCIA FALHOU — ROLLBACK:\n  " + problemas.join("\n  "));
      await cliente.query("rollback");
      return 1;
    }

    if (!aplicar) {
      await cliente.query("rollback");
      console.info("\nDRY-RUN: nada foi gravado. Rode de novo com --apply para aplicar.");
      return 0;
    }

    const arquivo = arg("--backup") ?? `./etiquetas-backup-${orgId}-${new Date().toISOString().slice(0, 10)}.json`;
    writeFileSync(
      arquivo,
      JSON.stringify(
        {
          organizacao: orgId,
          antes: {
            tags: antes["tags"] ?? null,
            [CHAVE_DAS_TAGS_TRAVADAS]: antes[CHAVE_DAS_TAGS_TRAVADAS] ?? null,
            tag_catalog: antes["tag_catalog"],
          },
          desfazer_sql:
            "update public.organizations set settings = " +
            `jsonb_set(jsonb_set(coalesce(settings,'{}'::jsonb),'{tags}',<antes.tags ou 'null'>),'{${CHAVE_DAS_TAGS_TRAVADAS}}',<antes.${CHAVE_DAS_TAGS_TRAVADAS} ou 'null'>) ` +
            `where id = '${orgId}'`,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    chmodSync(arquivo, 0o600);
    console.info(`Backup do estado anterior: ${arquivo}`);

    if (limpar) {
      await cliente.query(
        "update public.organizations set settings = settings - 'tag_catalog' where id = $1",
        [orgId],
      );
      console.info("`tag_catalog` removido (--limpar-catalogo).");
    }
    await cliente.query("commit");
    console.info("\nAPLICADO. Confira em Configurações → Tags.");
    return 0;
  } catch (e) {
    await cliente.query("rollback").catch(() => undefined);
    console.error("Falhou, ROLLBACK feito:", e instanceof Error ? e.message : e);
    return 1;
  } finally {
    await cliente.end();
  }
}

void main().then((codigo) => process.exit(codigo));
