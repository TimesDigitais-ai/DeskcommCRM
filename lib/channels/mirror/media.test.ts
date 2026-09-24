import { describe, it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseMirrorEvent } from "./contract";
import { mirrorAdapter } from "./adapter";
import { urlDeMidiaPermitida, camposDoEvento, mimeSeguroDoDownload } from "./media";
import { MAX_MEDIA_BYTES, MediaTooLargeError } from "@/lib/messaging/media/types";
import { resolveSessionRef, resolveSessionRefDeMidia } from "../session-ref";

const company = randomUUID();
const phones = ["+5511999998888"];
const date = "2026-09-20T15:53:26.134229Z";
const CDN = "https://cdn.flw.chat/upload/abc/IMAGE/tok.jpg?AWSAccessKeyId=x&Expires=1&Signature=y";

function event(type: string, details: Record<string, unknown> = {}, text: string | null = null) {
  return {
    eventType: "MESSAGE_RECEIVED", date,
    content: {
      id: randomUUID(), sessionId: randomUUID(), companyId: company, timestamp: date, updatedAt: date,
      type, text, direction: "FROM_HUB", status: "DELIVERED",
      details: { from: "+5511988889999", to: phones[0], ...details },
    },
  };
}
const file = (over: Record<string, unknown> = {}) => ({ id: "f", name: "a.jpg", mimeType: "image/jpeg", type: "IMAGE", publicUrl: CDN, size: 1234, ...over });

describe("allowlist de URL de mídia", () => {
  it("aceita cdn.flw.chat por https", () => {
    expect(urlDeMidiaPermitida(CDN)).toBe(CDN);
  });
  it.each([
    ["http", CDN.replace("https:", "http:")],
    ["outro host", "https://example.com/a.jpg"],
    ["subdomínio do host", "https://evil.cdn.flw.chat/a.jpg"],
    ["host como prefixo", "https://cdn.flw.chat.evil.com/a.jpg"],
    ["host como usuário", "https://cdn.flw.chat@evil.com/a.jpg"],
    ["credenciais", "https://user:pass@cdn.flw.chat/a.jpg"],
    ["só usuário", "https://user@cdn.flw.chat/a.jpg"],
    ["porta explícita", "https://cdn.flw.chat:8443/a.jpg"],
    ["relativa", "/upload/a.jpg"],
    ["sem esquema", "cdn.flw.chat/upload/a.jpg"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:image/png;base64,AAAA"],
    ["vazia", ""],
  ])("recusa %s", (_n, url) => {
    expect(urlDeMidiaPermitida(url)).toBeNull();
  });
  it("recusa o que não é texto", () => {
    expect(urlDeMidiaPermitida(null)).toBeNull();
    expect(urlDeMidiaPermitida({ a: 1 })).toBeNull();
  });
});

describe("mapeamento de tipo do evento", () => {
  it.each([
    ["IMAGE", "image", "image/jpeg"],
    ["AUDIO", "audio", "audio/ogg"],
    ["VIDEO", "video", "video/mp4"],
    ["DOCUMENT", "document", "application/pdf"],
    ["STICKER", "sticker", "image/webp"],
    ["LOCATION", "image", "image/png"],
  ])("%s vira %s com o mime do arquivo", (source, type, mimeType) => {
    const m = parseMirrorEvent(event(source, { file: file({ mimeType }) }, "legenda"), company, phones)!;
    expect(m.type).toBe(type);
    expect(m.media).toEqual({ url: CDN, mime: mimeType, sizeBytes: 1234 });
    expect(m.body).toBe("legenda");
    expect(m.sourceType).toBe(source);
  });
  it("sem mimeType, escolhe pelo tipo", () => {
    expect(parseMirrorEvent(event("AUDIO", { file: file({ mimeType: undefined }) }), company, phones)!.media?.mime).toBe("audio/ogg");
    expect(parseMirrorEvent(event("DOCUMENT", { file: file({ mimeType: "lixo", type: "PDF" }) }), company, phones)!.media?.mime).toBe("application/pdf");
    expect(parseMirrorEvent(event("STICKER", { file: file({ mimeType: undefined }) }), company, phones)!.media?.mime).toBe("image/webp");
  });
  it("mídia sem legenda tem corpo vazio; localização ganha rótulo", () => {
    expect(parseMirrorEvent(event("IMAGE", { file: file() }), company, phones)!.body).toBe("");
    expect(parseMirrorEvent(event("LOCATION", { file: file() }), company, phones)!.body).toBe("📍 Localização");
    expect(parseMirrorEvent(event("LOCATION", { file: file() }, "Rua X"), company, phones)!.body).toBe("Rua X");
  });
  it("TEXT continua texto; CONTACT e TRACK viram texto com o aviso, mesmo com file", () => {
    expect(parseMirrorEvent(event("TEXT", { file: file() }, "oi"), company, phones)).toMatchObject({ type: "text", media: null, body: "oi" });
    for (const t of ["CONTACT", "TRACK", "ALGO_NOVO"]) {
      const m = parseMirrorEvent(event(t, { file: file() }), company, phones)!;
      expect(m.type).toBe("text");
      expect(m.media).toBeNull();
      expect(m.body).toContain("consulte na plataforma de origem");
    }
  });
  it("lê details.files[0] e cai para publicUrlDownload", () => {
    expect(parseMirrorEvent(event("IMAGE", { files: [file()] }), company, phones)!.media?.url).toBe(CDN);
    const m = parseMirrorEvent(event("IMAGE", { file: file({ publicUrl: "https://evil.com/x.jpg", publicUrlDownload: CDN }) }), company, phones)!;
    expect(m.media?.url).toBe(CDN);
  });
  it("tamanho só vale se for número positivo", () => {
    for (const size of ["10", 0, -3, NaN, null]) {
      expect(parseMirrorEvent(event("IMAGE", { file: file({ size }) }), company, phones)!.media?.sizeBytes).toBeNull();
    }
  });
  it("evento sem arquivo (ou com URL proibida) mantém o aviso e nunca rejeita", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const details of [{}, { file: null }, { file: "texto" }, { files: "x" }, { file: file({ publicUrl: "http://cdn.flw.chat/a", publicUrlDownload: undefined }) }]) {
      const m = parseMirrorEvent(event("IMAGE", details), company, phones)!;
      expect(m).toMatchObject({ type: "text", media: null });
      expect(m.body).toBe("[Anexo (IMAGE) — consulte na plataforma de origem]");
    }
    warn.mockRestore();
  });
  it("o aviso de diagnóstico traz só NOMES de campo, nunca valores", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    parseMirrorEvent(event("AUDIO", { file: { id: "SEGREDO-ID", publicUrl: "https://evil.com/token-secreto", mimeType: "audio/ogg" }, extra: "valor-sensivel" }, "texto privado"), company, phones);
    expect(warn).toHaveBeenCalledTimes(1);
    const linha = String(warn.mock.calls[0]![0]);
    expect(linha).toContain("AUDIO");
    expect(linha).toContain("publicUrl");
    expect(linha).toContain("extra");
    for (const proibido of ["SEGREDO-ID", "token-secreto", "valor-sensivel", "texto privado", "evil.com", "http"]) expect(linha).not.toContain(proibido);
    warn.mockRestore();
  });
  it("não avisa quando há arquivo utilizável nem para tipos sem arquivo", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    parseMirrorEvent(event("IMAGE", { file: file() }), company, phones);
    parseMirrorEvent(event("TRACK"), company, phones);
    parseMirrorEvent(event("TEXT", {}, "oi"), company, phones);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
  it("camposDoEvento lista nomes sem valores", () => {
    expect(camposDoEvento({ from: "x", file: { a: 1, b: 2 } })).toEqual({ details: ["file", "from"], file: ["a", "b"] });
    expect(camposDoEvento(null)).toEqual({ details: [], file: null });
  });
});

describe("mimeSeguroDoDownload", () => {
  it("usa o content-type da resposta e a dica só quando ele é genérico", () => {
    expect(mimeSeguroDoDownload("image/png; charset=x", "image/jpeg")).toBe("image/png");
    expect(mimeSeguroDoDownload("application/octet-stream", "image/jpeg")).toBe("image/jpeg");
    expect(mimeSeguroDoDownload(null, null)).toBe("application/octet-stream");
  });
  it("recusa tipos que executam script na origem do CRM", () => {
    for (const t of ["text/html", "text/html; charset=utf-8", "image/svg+xml", "application/xhtml+xml", "text/javascript", "application/xml"]) {
      expect(mimeSeguroDoDownload(t, "image/png")).toBeNull();
    }
    expect(mimeSeguroDoDownload("application/octet-stream", "text/html")).toBeNull();
  });
});

function resposta(body: BodyInit | null, init: ResponseInit = {}) {
  return new Response(body, { status: 200, headers: { "content-type": "image/jpeg" }, ...init });
}
const fetchMedia = (url: string, hintMime?: string | null) =>
  mirrorAdapter.fetchInboundMedia!({ organizationId: "org", sessionRef: "mirror", url, hintMime });

describe("mirrorAdapter.fetchInboundMedia", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("baixa da allowlist, sem credenciais, sem seguir redirect sozinho", async () => {
    const f = vi.fn(async () => resposta(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", f);
    const r = await fetchMedia(CDN, "image/png");
    expect(Array.from(r.buffer)).toEqual([1, 2, 3]);
    expect(r.mime).toBe("image/jpeg");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CDN);
    expect(init.redirect).toBe("manual");
    expect(init.credentials).toBe("omit");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(init.headers ?? {}).toLowerCase()).not.toMatch(/authorization|api-key|cookie/);
  });
  it("usa a dica quando o content-type é genérico", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resposta(new Uint8Array([1]), { headers: { "content-type": "binary/octet-stream" } })));
    expect((await fetchMedia(CDN, "audio/ogg")).mime).toBe("audio/ogg");
  });
  it("404 vira erro", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resposta("x", { status: 404 })));
    await expect(fetchMedia(CDN)).rejects.toThrow("mirror_media_404");
  });
  it("host proibido nem chega a chamar fetch", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    for (const url of ["https://evil.com/a.jpg", "http://cdn.flw.chat/a.jpg", "https://u:p@cdn.flw.chat/a.jpg", "/a.jpg", "http://169.254.169.254/latest"]) {
      await expect(fetchMedia(url)).rejects.toThrow("mirror_media_untrusted_url");
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("recusa arquivo grande pelo content-length e pelo corpo real", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resposta("x", { headers: { "content-type": "image/jpeg", "content-length": String(MAX_MEDIA_BYTES + 1) } })));
    await expect(fetchMedia(CDN)).rejects.toBeInstanceOf(MediaTooLargeError);
    const grande = new ReadableStream<Uint8Array>({
      pull(c) { c.enqueue(new Uint8Array(MAX_MEDIA_BYTES / 2 + 1)); },
    });
    vi.stubGlobal("fetch", vi.fn(async () => resposta(grande)));
    await expect(fetchMedia(CDN)).rejects.toBeInstanceOf(MediaTooLargeError);
  });
  it("redirect para outro host é recusado; para a allowlist é seguido", async () => {
    const f = vi.fn(async () => resposta(null, { status: 302, headers: { location: "https://evil.com/x.jpg" } }));
    vi.stubGlobal("fetch", f);
    await expect(fetchMedia(CDN)).rejects.toThrow("mirror_media_redirect_refused");
    expect(f).toHaveBeenCalledTimes(1);

    const ok = vi.fn()
      .mockResolvedValueOnce(resposta(null, { status: 302, headers: { location: "/upload/outro.jpg" } }))
      .mockResolvedValueOnce(resposta(new Uint8Array([9])));
    vi.stubGlobal("fetch", ok);
    expect((await fetchMedia(CDN)).buffer.byteLength).toBe(1);
    expect(ok.mock.calls[1]![0]).toBe("https://cdn.flw.chat/upload/outro.jpg");
  });
  it("laço de redirects termina", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resposta(null, { status: 302, headers: { location: CDN } })));
    await expect(fetchMedia(CDN)).rejects.toThrow("mirror_media_too_many_redirects");
  });
  it("content-type html nunca é servido", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resposta("<script>", { headers: { "content-type": "text/html" } })));
    await expect(fetchMedia(CDN)).rejects.toThrow("mirror_media_unsafe_type");
  });
});

describe("o espelho continua somente leitura", () => {
  it("send e sendTemplate recusam e o canal segue sem configuração de envio", async () => {
    expect(mirrorAdapter.isConfigured()).toBe(false);
    expect(mirrorAdapter.resolveRecipient("+5511999998888" as never)).toBeNull();
    await expect(mirrorAdapter.send({ organizationId: "o", sessionRef: "s", to: "r", kind: "text" })).rejects.toThrow("channel_read_only");
    await expect(mirrorAdapter.sendTemplate!({ organizationId: "o", sessionRef: "s", to: "r", name: "m", language: "pt_BR", values: {} })).rejects.toThrow("channel_read_only");
  });
  it("o adapter só ganhou leitura de entrada: nada de envio de mídia, presença ou reação", () => {
    const capacidades = Object.keys(mirrorAdapter).sort();
    expect(capacidades).toEqual(["checkHealth", "codes", "fetchInboundMedia", "isConfigured", "provider", "resolveRecipient", "send", "sendTemplate"]);
  });
  it("a fonte do adapter só faz GET e nunca manda credencial", () => {
    const fonte = readFileSync("lib/channels/mirror/adapter.ts", "utf8");
    expect(fonte).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/);
    expect(fonte).not.toMatch(/Authorization|X-Api-Key|process\.env|createAdminClient/i);
    expect(fonte).toMatch(/const refused = async \(\): Promise<never> => \{ throw new Error\("channel_read_only"\); \}/);
    expect(fonte).toMatch(/send: refused,\s*sendTemplate: refused,/);
  });
  it("resolveSessionRef continua recusando o espelho; só o ref de MÍDIA é liberado", () => {
    expect(() => resolveSessionRef({ provider: "mirror" })).toThrow("channel_read_only");
    expect(resolveSessionRefDeMidia({ provider: "mirror" })).toBe("mirror");
    expect(resolveSessionRefDeMidia({ provider: "waha", waha_session_name: "s1" })).toBe("s1");
  });
});
