import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConversationListItem } from "@/components/inbox/ConversationListItem";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";

/**
 * A linha da lista do Inbox lê o espelho do agente: a prévia chega com o negrito
 * cru do WhatsApp ("*Maria Silva:*") e todo contato importado traz a etiqueta
 * WHATSAPP-IMPORT. Nenhum dos dois pode aparecer na lista — o outro lado
 * (conversa aberta, painel do contato) não é coberto aqui.
 */
const conversa = (preview: string, tags: string[], metadata: Record<string, unknown> = {}) =>
  ({
    id: "c1",
    organization_id: "org",
    contact_id: "ct1",
    channel_session_id: "s1",
    channel: "whatsapp",
    status: "open",
    last_message_at: new Date().toISOString(),
    last_message_preview: preview,
    unread_count_for_assignee: 0,
    created_at: new Date().toISOString(),
    contacts: { id: "ct1", display_name: "Sabrina", name: null, phone_number: "+595999", tags, is_blocked: false, is_anonymized: false },
    channel_sessions: null,
    metadata,
  }) as unknown as ConversationWithContact;

const pintar = (conv: ConversationWithContact) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConversationListItem conversation={conv} isSelected={false} onSelect={() => {}} />
    </QueryClientProvider>,
  );

describe("linha da lista do Inbox", () => {
  it("mostra a prévia sem os asteriscos do negrito do WhatsApp", () => {
    pintar(conversa("*Maria Silva:* Qual a forma de pagamento?", []));
    expect(screen.getByText(/Maria Silva: Qual a forma de pagamento\?/)).toBeInTheDocument();
    expect(screen.queryByText(/\*/)).not.toBeInTheDocument();
  });

  it("não mostra a etiqueta de importação, mas mostra as do time", () => {
    pintar(conversa("Olá", ["whatsapp-import", "cliente"]));
    expect(screen.queryByText(/whatsapp-import/i)).not.toBeInTheDocument();
    expect(screen.getByText(/cliente/i)).toBeInTheDocument();
  });

  it("só com a etiqueta de importação, não sobra selo vazio", () => {
    pintar(conversa("Olá", ["whatsapp-import"]));
    expect(screen.queryByText(/whatsapp-import/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
  });

  it("mostra setor e atendente que o espelho anotou, com o nome curto", () => {
    pintar(
      conversa("Olá", [], {
        read_only_mirror: true,
        mirror_session: { department: "Comercial", agent: "Maria Silva Costa dos Santos" },
      }),
    );
    expect(screen.getByText("Comercial")).toBeInTheDocument();
    expect(screen.getByText("Maria Silva")).toBeInTheDocument();
    expect(screen.queryByText(/Costa/)).not.toBeInTheDocument();
  });

  it("conversa sem sessão anotada não ganha selo de setor", () => {
    pintar(conversa("Olá", []));
    expect(screen.queryByTitle(/plataforma de origem/)).not.toBeInTheDocument();
  });
});
