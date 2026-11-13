// O filtro de itens da build: uns blocos que destacam, só na campanha, o que a build usa. São as
// bases dos itens, os links nas cores das gemas, as próprias gemas, botas com movimento e os únicos.
// O guia grava esses blocos em cima do filtro que o jogador já usa (o NeverSink, por exemplo), num
// arquivo próprio na pasta do jogo. Fora da campanha, quem decide é o filtro de sempre.
//
// Um nome que o jogo não conhece estraga o filtro inteiro, então só entram bases que a tabela de
// artes conhece e gemas que os dados de gemas conhecem.

import { baseConhecida, type TabelaDeArtes } from "./artes-itens";
import type { Plano } from "./plano";

/** Os destaques só valem até esta área (a campanha termina na 67; nos mapas fica o filtro de sempre). */
export const ULTIMA_AREA_DA_CAMPANHA = 67;

/** Mods de movimento das botas, do 10% ao 35% (os mesmos nomes que o NeverSink usa). */
const MODS_DE_MOVIMENTO = ["Runner's", "Sprinter's", "Stallion's", "Gazelle's", "Cheetah's", "Hellion's"];

/** Letra do soquete de cada cor de gema. Gema branca ou sem cor não pede soquete. */
const LETRA: Record<string, string> = { strength: "R", dexterity: "G", intelligence: "B" };

/** No máximo tantas combinações de links (cada uma é um bloco). */
const MAXIMO_DE_LINKS = 8;

// O roxo do guia: borda e fundo iguais em todos os destaques, ícone diferente por tipo.
const BORDA = "SetBorderColor 190 140 255 255";
const FUNDO = "SetBackgroundColor 45 20 75 240";

export interface FiltroDaBuild {
  /** Os blocos prontos, com o cabeçalho. */
  texto: string;
  bases: string[];
  /** As cores de cada link ("GGB", "GGGB"), do maior pro menor. */
  links: string[];
  gemas: string[];
  unicos: string[];
}

/** Nome que dá pra pôr entre aspas no filtro. */
function nomeBom(nome: string): boolean {
  return nome.trim() !== "" && !/["\r\n]/.test(nome);
}

function entreAspas(nomes: readonly string[]): string {
  return nomes.map((nome) => `"${nome}"`).join(" ");
}

function bloco(oQue: string, condicoes: string[], estilo: string[]): string[] {
  return [
    `Show # Guia de leveling: ${oQue}`,
    `\tAreaLevel <= ${ULTIMA_AREA_DA_CAMPANHA}`,
    ...condicoes.map((linha) => `\t${linha}`),
    ...estilo.map((linha) => `\t${linha}`),
    "",
  ];
}

/** As cores dos links do grupo principal de cada conjunto de gemas da campanha (3 e 4 links). */
function linksDaBuild(plano: Plano): string[] {
  const achados = new Set<string>();
  for (const etapa of plano.gemas.etapas) {
    if (etapa.fim_de_jogo) continue;
    const grupo = etapa.grupos.find((g) => g.principal) ?? etapa.grupos[0];
    if (!grupo) continue;
    const letras = grupo.gemas.map((gema) => LETRA[gema.cor]).filter((letra): letra is string => letra !== undefined);
    for (const tamanho of [3, 4]) {
      if (letras.length < tamanho) continue;
      const cores = letras.slice(0, tamanho).sort((a, b) => "RGB".indexOf(a) - "RGB".indexOf(b));
      achados.add(cores.join(""));
    }
  }
  // Primeiro os maiores: o jogo usa o primeiro bloco que casa.
  return [...achados].sort((a, b) => b.length - a.length).slice(0, MAXIMO_DE_LINKS);
}

function gemasDaBuild(plano: Plano): string[] {
  const nomes = new Set<string>();
  for (const etapa of plano.gemas.etapas) {
    if (etapa.fim_de_jogo) continue;
    for (const grupo of etapa.grupos) {
      for (const gema of grupo.gemas) if (gema.conhecida && nomeBom(gema.nome)) nomes.add(gema.nome.trim());
    }
  }
  return [...nomes];
}

function itensDaBuild(plano: Plano, tabela: TabelaDeArtes): { bases: string[]; unicos: string[] } {
  const bases = new Set<string>();
  const unicos = new Set<string>();
  const itens = [
    ...plano.itens.etapas.filter((etapa) => !etapa.fim_de_jogo).flatMap((etapa) => etapa.itens),
    ...plano.itens.unicos_desejados,
  ];
  for (const item of itens) {
    const base = baseConhecida(tabela, item);
    if (!base || !nomeBom(base)) continue;
    (item.raridade === "UNIQUE" ? unicos : bases).add(base);
  }
  return { bases: [...bases], unicos: [...unicos] };
}

/**
 * O título da build como vai no cabeçalho dos destaques. É por ele que o guia sabe de qual build é
 * cada filtro que criou (o lado do Rust lê a linha `destaques da build "<título>".`).
 */
export function tituloDoFiltro(plano: Plano): string {
  return (plano.fonte.titulo || "build importada").replace(/[\r\n]+/g, " ").trim();
}

/** Os destaques da build, prontos pra ir em cima de um filtro. */
export function filtroDaBuild(plano: Plano, tabela: TabelaDeArtes): FiltroDaBuild {
  const { bases, unicos } = itensDaBuild(plano, tabela);
  const links = linksDaBuild(plano);
  const gemas = gemasDaBuild(plano);
  const titulo = tituloDoFiltro(plano);

  const linhas = [
    "# ==========================================================================",
    `# Guia de leveling: destaques da build "${titulo}".`,
    `# Valem só na campanha (área até o nível ${ULTIMA_AREA_DA_CAMPANHA}), com a borda roxa.`,
    "# ==========================================================================",
    "",
  ];
  if (unicos.length > 0) {
    linhas.push(
      ...bloco("únicos que a build usa", ["Rarity Unique", `BaseType == ${entreAspas(unicos)}`], [
        "SetFontSize 45",
        BORDA,
        FUNDO,
        "PlayEffect Purple",
        "MinimapIcon 0 Purple Star",
      ]),
    );
  }
  for (const cores of links) {
    const grande = cores.length >= 4;
    linhas.push(
      ...bloco(`${cores.length} links nas cores da build`, ["Rarity Normal Magic Rare", `SocketGroup "${cores}"`], [
        `SetFontSize ${grande ? 42 : 38}`,
        BORDA,
        FUNDO,
        ...(grande ? ["PlayEffect Purple Temp"] : []),
        `MinimapIcon ${grande ? 1 : 2} Purple Square`,
      ]),
    );
  }
  linhas.push(
    ...bloco("botas com movimento", ['Class == "Boots"', "Rarity Magic Rare", `HasExplicitMod ${entreAspas(MODS_DE_MOVIMENTO)}`], [
      "SetFontSize 42",
      BORDA,
      FUNDO,
      "PlayEffect Purple Temp",
      "MinimapIcon 1 Purple Kite",
    ]),
  );
  if (bases.length > 0) {
    linhas.push(
      ...bloco("bases dos itens da build", ["Rarity Magic Rare", `BaseType == ${entreAspas(bases)}`], [
        "SetFontSize 40",
        BORDA,
        FUNDO,
        "PlayEffect Purple Temp",
        "MinimapIcon 1 Purple Diamond",
      ]),
    );
  }
  if (gemas.length > 0) {
    linhas.push(
      ...bloco("gemas da build", [`BaseType == ${entreAspas(gemas)}`], [
        "SetFontSize 40",
        BORDA,
        FUNDO,
        "PlayEffect Purple Temp",
        "MinimapIcon 1 Purple Triangle",
      ]),
    );
  }
  return { texto: linhas.join("\n"), bases, links, gemas, unicos };
}

/** Uma linha dizendo o que o filtro destaca. */
export function resumoDoFiltro(filtro: FiltroDaBuild): string {
  const partes: string[] = [];
  if (filtro.unicos.length > 0) partes.push(`${filtro.unicos.length} único${filtro.unicos.length > 1 ? "s" : ""}`);
  if (filtro.links.length > 0) partes.push(`links ${filtro.links.join(", ")}`);
  partes.push("botas com movimento");
  if (filtro.bases.length > 0) partes.push(`${filtro.bases.length} base${filtro.bases.length > 1 ? "s" : ""} de item`);
  if (filtro.gemas.length > 0) partes.push(`${filtro.gemas.length} gema${filtro.gemas.length > 1 ? "s" : ""}`);
  return partes.join(", ");
}

/** A segunda palavra do nome do filtro novo: o nome do programa (o guia de leveling). */
export const SUFIXO_DO_NOME = "Leveling";
/** O nome do filtro vira nome de arquivo: até tantas letras. */
export const LIMITE_DO_NOME = 60;

/**
 * Deixa um nome pronto pra virar nome de arquivo do Windows: tira \ / : * ? " < > | e os
 * caracteres de controle, junta os espaços e tira os pontos das pontas.
 */
export function limparNome(nome: string): string {
  return nome
    .replace(/\.filter$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, LIMITE_DO_NOME)
    .trim();
}

/**
 * Nome do filtro novo que o guia cria: a ascendência da build (ou a classe, se não tem) e o nome do
 * programa: "Elementalist Leveling", "Witch Leveling". Vira "Elementalist Leveling.filter" na pasta
 * do jogo e aparece assim na lista de filtros do jogo.
 */
export function nomeDoFiltro(plano: Plano): string {
  const quem = limparNome(plano.personagem.ascendencia ?? plano.personagem.classe ?? "");
  return limparNome(`${quem || "Build"} ${SUFIXO_DO_NOME}`);
}

/** Um filtro que o guia criou na pasta do jogo e de qual build ele é. */
export interface FiltroDoGuia {
  arquivo: string;
  nome: string;
  /** O título da build dos destaques (`null` num arquivo que não diz). */
  build: string | null;
}

/** O filtro que o jogo está usando e os que o guia criou, do mais novo pro mais velho. */
export interface FiltroNoJogo {
  /** O arquivo escolhido nas opções do jogo (`null` num filtro online ou sem filtro). */
  escolhido: string | null;
  do_guia: FiltroDoGuia[];
}

/** O jogo não está com o filtro que o jogador criou pra esta build. */
export interface FiltroErrado {
  /** O filtro que o jogo está usando, como aparece no jogo (`null` = online ou nenhum). */
  atual: string | null;
  /** O que o jogo está usando é um filtro do guia, de outra build. */
  de_outra_build: boolean;
  /** O filtro desta build, como aparece no jogo (o mais novo, se houver mais de um). */
  certo: string;
}

/**
 * Confere se o jogo está com o filtro desta build. Só fala alguma coisa se o jogador criou um filtro
 * pra esta build: quem não quis o filtro (ou usa outro de propósito) não é incomodado.
 */
export function filtroErrado(plano: Plano, noJogo: FiltroNoJogo): FiltroErrado | null {
  const titulo = tituloDoFiltro(plano);
  const daBuild = noJogo.do_guia.filter((f) => f.build === titulo);
  if (daBuild.length === 0) return null;
  const escolhido = noJogo.escolhido?.toLowerCase() ?? null;
  if (daBuild.some((f) => f.arquivo.toLowerCase() === escolhido)) return null;
  const doGuia = noJogo.do_guia.find((f) => f.arquivo.toLowerCase() === escolhido);
  return {
    atual: doGuia ? doGuia.nome : noJogo.escolhido ? noJogo.escolhido.replace(/\.filter$/i, "") : null,
    de_outra_build: doGuia !== undefined,
    certo: daBuild[0].nome,
  };
}

/** O aviso de filtro errado, numa frase. */
export function textoDoFiltroErrado(errado: FiltroErrado): string {
  const atual =
    errado.atual === null
      ? "o jogo não está com o filtro desta build"
      : `o jogo está com o filtro "${errado.atual}"${errado.de_outra_build ? ", de outra build" : ""}`;
  return `Filtro de itens: ${atual}. Os itens da build não vão brilhar: troque em Esc › Options › Game › Item Filter › "${errado.certo}".`;
}

/** Tem o que destacar? (as botas com movimento entram sempre; o resto depende da build) */
export function temOQueDestacar(filtro: FiltroDaBuild): boolean {
  return filtro.bases.length + filtro.links.length + filtro.gemas.length + filtro.unicos.length > 0;
}
