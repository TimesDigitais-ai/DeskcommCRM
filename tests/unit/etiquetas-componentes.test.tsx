import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { TagPicker } from "@/components/tags/TagPicker";
import type { EtiquetaOferecida } from "@/lib/tags/travadas";

const oferta: EtiquetaOferecida[] = [
  { tag: "instagram", cor: "#faa1f1", travada: false },
  { tag: "contrato", cor: "#a25ddc", travada: false },
  { tag: "régua d4", cor: "#ff642e", travada: true },
];
const travadas = ["régua d4"];

function picker(props: Partial<React.ComponentProps<typeof TagPicker>> = {}) {
  return (
    <TagPicker oferta={oferta} travadas={travadas} value={[]} onChange={() => undefined} {...props} />
  );
}

describe("TagPicker (vocabulário do upstream + travadas do fork)", () => {
  it("travada aparece travada (só o agente): clicar não muda nada", () => {
    const onChange = vi.fn();
    render(picker({ value: ["régua d4"], onChange }));
    const caixa = screen.getByRole("checkbox", { name: "régua d4" });
    expect(caixa).toBeChecked();
    expect(caixa).toBeDisabled();
    expect(screen.getByText("só o agente")).toBeInTheDocument();
    fireEvent.click(caixa);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a cor do chip vem da oferta (o vocabulário), com texto legível por contraste", () => {
    render(picker({ value: ["instagram"] }));
    const chip = screen.getAllByText("instagram").find((el) => el.getAttribute("style")?.includes("background"));
    expect(chip).toBeDefined();
    expect(chip).toHaveStyle({ backgroundColor: "#faa1f1" });
  });

  it("travada não tem botão de remover nos chips escolhidos", () => {
    render(picker({ value: ["régua d4", "instagram"] }));
    expect(screen.queryByRole("button", { name: /Remover etiqueta régua d4/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Remover etiqueta instagram/ })).toBeInTheDocument();
  });

  it("marcar uma do time devolve o value COM a travada preservada", () => {
    const onChange = vi.fn();
    render(picker({ value: ["régua d4"], onChange }));
    fireEvent.click(screen.getByRole("checkbox", { name: "contrato" }));
    expect(onChange).toHaveBeenCalledWith(["régua d4", "contrato"]);
  });

  it("desmarcar tira só a escolhida; a travada continua no array", () => {
    const onChange = vi.fn();
    render(picker({ value: ["régua d4", "instagram"], onChange }));
    fireEvent.click(screen.getByRole("checkbox", { name: "instagram" }));
    expect(onChange).toHaveBeenCalledWith(["régua d4"]);
  });

  it("texto livre fora do vocabulário continua visível e removível", () => {
    const onChange = vi.fn();
    render(picker({ value: ["vip"], onChange }));
    expect(screen.getByText("Fora do cadastro")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Remover etiqueta vip/ }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("no contato a seção 'Automáticas' não aparece", () => {
    render(picker({ mostrarAutomaticas: false }));
    expect(screen.queryByText("Automáticas")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "régua d4" })).toBeNull();
  });

  it("a busca filtra a lista", () => {
    render(picker());
    fireEvent.change(screen.getByPlaceholderText("Buscar etiqueta…"), { target: { value: "contr" } });
    expect(screen.getByRole("checkbox", { name: "contrato" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "instagram" })).toBeNull();
  });

  it("desabilitado não emite nenhuma mudança", () => {
    const onChange = vi.fn();
    render(picker({ disabled: true, onChange }));
    fireEvent.click(screen.getByRole("checkbox", { name: "contrato" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
