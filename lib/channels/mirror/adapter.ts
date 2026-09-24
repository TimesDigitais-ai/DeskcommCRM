import { MAX_MEDIA_BYTES, MediaTooLargeError, type FetchedMedia } from "@/lib/messaging/media/types";
import type { ChannelAdapter } from "../types";
import { mimeSeguroDoDownload, urlDeMidiaPermitida } from "./media";

const refused = async (): Promise<never> => { throw new Error("channel_read_only"); };

const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

/**
 * Baixa o anexo de uma cópia (ENTRADA). É a única coisa que o espelho busca fora:
 * GET sem credenciais, só `https://cdn.flw.chat/...` (a mesma allowlist que decide
 * o que vira mídia na ingestão — uma linha antiga ou escrita por outro caminho não
 * amplia o alcance do fetch), com prazo e teto de tamanho. Redirect só é seguido
 * se o destino também passar na allowlist. Nada de envio: `send`/`sendTemplate`
 * seguem recusando.
 */
async function fetchInboundMedia(input: { url: string; hintMime?: string | null }): Promise<FetchedMedia> {
  let atual = urlDeMidiaPermitida(input.url);
  if (!atual) throw new Error("mirror_media_untrusted_url");

  let res: Response | undefined;
  for (let salto = 0; salto <= MAX_REDIRECTS; salto++) {
    res = await fetch(atual, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      headers: { Accept: "*/*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status < 300 || res.status >= 400) break;
    const destino = urlDeMidiaPermitida(res.headers.get("location") ? new URL(res.headers.get("location")!, atual).toString() : null);
    await res.body?.cancel().catch(() => undefined);
    if (!destino) throw new Error("mirror_media_redirect_refused");
    atual = destino;
    res = undefined;
  }
  if (!res) throw new Error("mirror_media_too_many_redirects");
  if (!res.ok) throw new Error(`mirror_media_${res.status}`);

  const mime = mimeSeguroDoDownload(res.headers.get("content-type"), input.hintMime);
  if (!mime) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error("mirror_media_unsafe_type");
  }

  const declarado = Number(res.headers.get("content-length") ?? 0);
  if (declarado > MAX_MEDIA_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw new MediaTooLargeError();
  }

  // Lê em pedaços e aborta ao passar do teto: content-length ausente ou mentiroso
  // não pode fazer o servidor segurar um arquivo inteiro na memória.
  const partes: Uint8Array[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_MEDIA_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new MediaTooLargeError();
      }
      partes.push(value);
    }
  }
  return { buffer: Buffer.concat(partes, total), mime };
}

/**
 * Não possui cliente de envio nem credenciais de saída, inclusive para templates.
 * A leitura de mídia de entrada (acima) é proxy por allowlist, não capacidade de envio.
 */
export const mirrorAdapter: ChannelAdapter = {
  provider: "mirror",
  isConfigured: () => false,
  resolveRecipient: () => null,
  // Saúde do atendimento externo não é observável pelo receptor de cópias.
  checkHealth: async () => ({ reachable: false, status: null, detail: "read_only_mirror" }),
  send: refused,
  sendTemplate: refused,
  fetchInboundMedia,
  codes: { notConfigured: "channel_read_only", sendFailed: "channel_read_only", unknownError: "channel_read_only" },
};
