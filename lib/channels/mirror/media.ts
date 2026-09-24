/**
 * Mídia do espelho: o que o CRM aceita como anexo de uma cópia e de onde pode
 * buscar os bytes.
 *
 * O evento da origem (Attemics/wts.chat) anuncia o arquivo por uma URL assinada
 * do CDN dela. Essa URL vem do PAYLOAD de um webhook autenticado só por token na
 * URL — então NUNCA é confiada: só `https://cdn.flw.chat/...`, sem credenciais
 * embutidas, vira mídia; qualquer outra coisa é ignorada (a mensagem segue com
 * o aviso de anexo). O mesmo teste guarda o download em `adapter.ts`, porque uma
 * linha antiga (ou escrita por outro caminho) não pode ampliar o alcance do fetch.
 *
 * Só ENTRADA: o espelho continua sem enviar nada. Ler o anexo de uma cópia é
 * proxy/persistência de mídia de entrada por allowlist de host.
 */

/** Único host de mídia aceito. Igualdade exata: `evil.cdn.flw.chat` e `cdn.flw.chat.evil.com` não passam. */
export const MIRROR_MEDIA_HOST = "cdn.flw.chat";
const MAX_URL_LENGTH = 4096;

/** Tipos de mensagem da origem que trazem arquivo, e como viram `messages.type`. */
const TIPO_DE_MIDIA = {
  IMAGE: "image",
  AUDIO: "audio",
  VIDEO: "video",
  DOCUMENT: "document",
  STICKER: "sticker",
  // O arquivo de uma localização é a imagem do mapa.
  LOCATION: "image",
} as const;

export type MirrorMessageType = "text" | "image" | "audio" | "video" | "document" | "sticker";

/** Tipo do CRM para um tipo da origem; `null` = não é tipo de mídia (fica texto com aviso). */
export function tipoDeMidiaDoEspelho(sourceType: string): MirrorMessageType | null {
  return Object.hasOwn(TIPO_DE_MIDIA, sourceType) ? TIPO_DE_MIDIA[sourceType as keyof typeof TIPO_DE_MIDIA] : null;
}

/**
 * A URL, se e somente se for `https://cdn.flw.chat/...` sem usuário/senha nem
 * porta explícita. Devolve a forma normalizada; qualquer outra coisa é `null`.
 */
export function urlDeMidiaPermitida(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null; // relativa ou malformada
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname !== MIRROR_MEDIA_HOST) return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.port !== "") return null;
  return url.toString();
}

const MIME_PADRAO: Record<MirrorMessageType, string | null> = {
  text: null,
  image: "image/jpeg",
  audio: "audio/ogg",
  video: "video/mp4",
  document: "application/octet-stream",
  sticker: "image/webp",
};

const MIME_FORMA = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

export type MirrorMedia = { url: string; mime: string; sizeBytes: number | null };

const objeto = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Tolerante por construção: campo ausente ou mal-formado devolve `null` e NUNCA
 * rejeita o evento (a origem reenviaria o mesmo evento indefinidamente).
 * Lê `details.file` ou `details.files[0]`; usa `publicUrl` e, se ela não passar
 * na allowlist, `publicUrlDownload`.
 */
export function extrairMidiaDoEvento(details: unknown, tipo: MirrorMessageType, sourceType: string): MirrorMedia | null {
  if (tipo === "text") return null;
  const d = objeto(details);
  const files = Array.isArray(d.files) ? d.files : [];
  const file = objeto(d.file ?? files[0]);
  const url = urlDeMidiaPermitida(file.publicUrl) ?? urlDeMidiaPermitida(file.publicUrlDownload);
  if (!url) return null;
  const declarado = typeof file.mimeType === "string" ? file.mimeType.split(";")[0]!.trim() : "";
  const mime =
    declarado && declarado.length <= 100 && MIME_FORMA.test(declarado)
      ? declarado.toLowerCase()
      : sourceType === "LOCATION"
        ? "image/png"
        : file.type === "PDF"
          ? "application/pdf"
          : MIME_PADRAO[tipo]!;
  const size = typeof file.size === "number" && Number.isFinite(file.size) && file.size > 0 ? Math.floor(file.size) : null;
  return { url, mime, sizeBytes: size };
}

/**
 * Diagnóstico seguro: só os NOMES dos campos. Nunca valor, URL nem texto —
 * o objetivo é descobrir se o webhook traz `details.file`, não vazar o que ele traz.
 */
export function camposDoEvento(details: unknown): { details: string[]; file: string[] | null } {
  const d = objeto(details);
  const files = Array.isArray(d.files) ? d.files : [];
  const arquivo = d.file ?? files[0];
  const nomes = (o: Record<string, unknown>) => Object.keys(o).map(k => k.replace(/[^\w.-]/g, "?").slice(0, 40)).slice(0, 40).sort();
  return {
    details: nomes(d),
    file: arquivo && typeof arquivo === "object" && !Array.isArray(arquivo) ? nomes(arquivo as Record<string, unknown>) : null,
  };
}

/** Tipos que a rota jamais serve inline, mesmo que o CDN os anuncie: executam script na origem do CRM. */
const MIME_ATIVO = /^(text\/(html|xml|javascript|ecmascript|x-javascript)|application\/(xhtml|xml|javascript|x-javascript|ecmascript)|image\/svg)/i;

/** Mime do arquivo baixado: o `content-type` da resposta manda; a dica só entra se ele for genérico/ausente. `null` = recusar. */
export function mimeSeguroDoDownload(contentType: string | null, hintMime: string | null | undefined): string | null {
  const limpo = (v: string | null | undefined) => (v ? v.split(";")[0]!.trim().toLowerCase() : "");
  const resposta = limpo(contentType);
  const dica = MIME_FORMA.test(limpo(hintMime)) ? limpo(hintMime) : "";
  const generico = (m: string) => m === "" || m === "application/octet-stream" || m === "binary/octet-stream";
  const escolhido = generico(resposta) ? dica || "application/octet-stream" : resposta;
  if (MIME_ATIVO.test(escolhido) || !MIME_FORMA.test(escolhido)) return null;
  return escolhido;
}
