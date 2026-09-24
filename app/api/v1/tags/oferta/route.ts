/**
 * GET /api/v1/tags/oferta — as etiquetas que o seletor OFERECE, e quais delas
 * estão travadas (fork; reconciliação com o upstream v1.44.0).
 *
 * ── Por que uma rota própria, e não `/api/v1/tags/cores` ─────────────────────
 *
 * `/tags/cores` é do upstream e responde "de que cor é esta etiqueta": devolve
 * só as entradas do vocabulário COM cor, para o chip. O seletor do formulário do
 * lead precisa de outra pergunta — "o que posso escolher, e o que é só da
 * agente" —, que inclui a etiqueta sem cor e a marca de travada
 * (`lib/tags/travadas.ts`). Estender a rota deles mudaria um contrato que os
 * testes do upstream cobram; uma rota nossa ao lado não colide em merge nenhum.
 *
 * ── Portão ───────────────────────────────────────────────────────────────────
 *
 * `viewer`, sem MFA: mesma régua de `/tags/cores` — quem atende precisa da lista
 * para escolher, e ler o vocabulário não é ato. Client da SESSÃO: a RLS de
 * `organizations` isola o tenant.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { ofertaDoSettings, travadasDoSettings } from "@/lib/tags/travadas";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const auth = await requireRole("viewer", { requestId, resource: "settings_tags" });
  if (!auth.ok) return auth.response;

  const db = await createClient();
  const { data, error } = await db
    .from("organizations")
    .select("settings")
    .eq("id", auth.org.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", "Não foi possível carregar as etiquetas.", 500, { requestId });

  const settings = data?.settings ?? null;
  return ok(
    { tags: ofertaDoSettings(settings), travadas: travadasDoSettings(settings) },
    { requestId },
  );
}
