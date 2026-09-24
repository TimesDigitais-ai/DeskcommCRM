/** Espelho é uma fonte de leitura; nunca participa da escolha de transporte. */
export function canalSomenteLeitura(provider: string | null | undefined): boolean {
  return provider === "mirror";
}
