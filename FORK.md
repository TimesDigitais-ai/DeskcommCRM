# Sobre este fork

Fork do [DeskcommCRM](https://github.com/melgarafael/DeskcommCRM) (MIT), baseado na
release **v1.44.0**. O aviso de copyright e a licença do upstream foram mantidos.

## O que este fork acrescenta

- **Espelho de Inbox somente leitura** — recebe por webhook as conversas de uma
  plataforma de atendimento externa e as mostra no Inbox sem enviar nada por ela;
  anexos entram por link assinado, com allowlist estrita de host.
- **Etiquetas travadas** — nomes que um sistema externo escreve e que só mudam de cor,
  mais a migração do catálogo antigo para o vocabulário nativo.
- Alias `pointer_id` nos fluxos de acompanhamento e consultas em lotes no quadro do funil.
- CI em 4 shards e checagem de colisão de numeração de migrations.

Detalhes: `docs/specs/inbox-mirror.md` e `docs/threat-model.md`.

## Manutenção

Mantido para uso interno da Times Digitais. Issues estão desligadas e PRs de terceiros
podem não ser revisados. Correções que valham para todos são melhor enviadas ao upstream.
Este fork acompanha as **releases** do upstream, não o `main` dele.

## Fluxo de trabalho

1. Trabalhe numa branch e abra um PR contra `main`; o `ci` roda no PR.
2. Se o CI não iniciar sozinho, dispare-o à mão na branch:
   `gh workflow run ci.yml --ref <branch>` (o `ci.yml` aceita `workflow_dispatch`).
3. Só faça merge com `verify` e `invariants` verdes.
4. Não coloque neste repositório nomes de clientes, telefones, domínios de servidor,
   caminhos de infraestrutura nem chaves: ele é público. O que for específico de um
   cliente fica num repositório privado de operação.
