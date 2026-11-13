# De onde vem o `arvore.json`

Os dados da árvore de passivas são da **Grinding Gear Games**, que publica a árvore de cada versão do
Path of Exile em <https://github.com/grindinggear/skilltree-export>. Este projeto não é ligado à GGG.

| | |
|---|---|
| Fonte | `https://raw.githubusercontent.com/grindinggear/skilltree-export/3.30.0/data.json` |
| Versão (tag) | 3.30.0 |
| Gerado em | 2026-11-12 |
| Feito por | `scripts/gerar-arvore.mjs` |
| Tamanho | 215.273 bytes |

As contas de posição (ângulo de cada órbita) e as regras de quais nós entram são as do Path of Building
Community (`src/Classes/PassiveTree.lua` e `PassiveSpec.lua`, licença MIT).

Da 3.29.1 pra 3.30.0 nenhum nó mudou de id, lugar, tipo ou nome. Mudou o texto de 12 maestrias e os nomes
dos nós da Reliquarian. A 3.30.0 também passou a marcar palavras com link no texto dos efeitos
(`[Blind|Blinded]`), e o gerador deixa só o que o jogo mostra (`Blinded`).

## Como atualizar quando sair outra versão

Na pasta `leveling/app`, depois que a GGG publicar a tag no repositório dela:

```
node scripts/gerar-arvore.mjs 3.30.1
```

O gerador baixa o `data.json` da tag e grava este `arvore.json` por cima. Depois, trocar a versão e a
data na tabela acima, o `VERSAO_DOS_DADOS` em `src/nucleo/arvore/dados.ts`, e rodar `npm test` (o teste
`dados.test.ts` confere a versão e as contagens e vai pedir os números novos, que o gerador imprime).

Outras formas de chamar:

```
node scripts/gerar-arvore.mjs 3.30.0 --arquivo data.json          lê um data.json já baixado, sem rede
node scripts/gerar-arvore.mjs 3.30.0 --saida outro.json           grava em outro lugar, pra conferir antes
node scripts/gerar-arvore.mjs 3.30.0 --pob 3_30,3_30_ruthless     diz os treeVersion do PoB na mão
```

- A tag é a do repositório da GGG e vira o campo `versao`. Conferir o nome exato lá (pode ser `3.30.0`,
  `3.30.1`...).
- Sem `--pob`, os `treeVersion` saem da tag: `3.30.0` vira `3_30` e `3_30_ruthless`. É o que o guia compara
  com a versão de árvore do PoB importado pra avisar quando não bate.
- Mesma entrada, mesma saída, byte a byte. Rodar de novo com o mesmo `data.json` não muda o arquivo.
- O gerador se recusa a gravar se o resultado não parecer a árvore do jogo (menos de 1000 nós, classes
  diferentes de 7).

## O que o arquivo contém

JSON numa linha só, sem espaços, UTF-8. Só números e nomes: **nenhuma arte do jogo** (sem ícones, sem
sprites) e sem o texto dos nós comuns.

| Chave | Conteúdo |
|---|---|
| `formato` | versão deste formato (1) |
| `versao` | tag do `skilltree-export` de onde saiu |
| `pob` | os `treeVersion` do PoB que este arquivo atende |
| `raios` | raio de cada órbita, em unidades da árvore (`constants.orbitRadii`) |
| `grupos` | `[x, y]` do centro de cada grupo usado (609), renumerados de 0 em diante |
| `nos` | `[id, x, y, tipo, grupo, orbita, nome]` de cada nó da árvore principal (2321), por id crescente. `x`, `y` em unidades da árvore, arredondados a 0,1; `grupo` é índice em `grupos`; `orbita` é índice em `raios`; `nome` em inglês, como no jogo |
| `ligacoes` | pares de ÍNDICES em `nos` (não ids), achatados: `[i, j, i, j, …]`, cada ligação uma vez (2703 pares). Inclui maestria↔notável e início de classe↔vizinho |
| `classes` | `{nome, inicio, ascendencias}`; a posição na lista é o `classId` do PoB; `inicio` é o id do nó |
| `secundarias` | ids das linhagens (ascendências secundárias); posição + 1 = `secondaryAscendClassId` do PoB |
| `maestrias` | por nome do nó de maestria (61): lista de `[idDoEfeito, texto]`; linhas do efeito juntadas com `\n` |
| `ascendencias` | por id da ascendência (37): `{nome, inicio, secundaria, nos, ligacoes, pontes?}`. `nos` = `[id, dx, dy, tipo, custo, pontos, nome]`, com `dx`, `dy` relativos ao nó de início dela; `ligacoes` = pares de índices na lista `nos` dela; `pontes` (só a Ascendant) = `[idDoNoDaAscendencia, idDoNoDaPrincipal]` |

Tipos de nó: 0 normal, 1 notável, 2 pedra angular, 3 encaixe de joia, 4 maestria, 5 início de classe,
6 encaixe grande de cluster, 7 início de ascendência (só dentro de `ascendencias`).

Ficam de fora de propósito: o texto (`stats`) dos nós comuns, ícones e sprites, os nós `isBlighted` (o
jogo não desenha), os nós de cluster que só existem com a joia encaixada (`isProxy`, grupo `isProxy`,
`expansionJewel.parent`) e o número original de cada grupo.
