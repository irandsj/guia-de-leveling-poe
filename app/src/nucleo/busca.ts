// As buscas prontas pro baú e pro vendedor (a caixa de busca do Ctrl+F do jogo): o "regex" que o
// autor da build deixou nas notas do PoB (o Maxroll põe um) e um feito aqui com as gemas do
// conjunto. Os botões ficam logo abaixo do campo de busca do jogo (ver busca.rs e Busca.tsx).
//
// As buscas avançam com a build, como as gemas, os itens e a árvore:
// - Busca que o autor ligou a um nível ou ato ("Level 26: ...", um título "Act 4+" em cima, "Maps")
//   só aparece na etapa dela, que vira junto com a árvore (`etapaDaFase`). Rótulo de fim de jogo
//   sem número ("Maps", "Endgame", "Ubers") vale nos mapas, depois das de número.
// - Busca sem etapa vale a build toda. Se ela tem a lista de gemas do autor (`^(gema|gema)$`),
//   a lista vira a do conjunto de agora quando o conjunto muda.
//
// A busca do PoE1 não liga pra maiúsculas e olha linha por linha do item: `|` é "ou", `!` é
// "não", espaço separa termos (todos têm que bater) e aspas juntam um termo com espaço.

import { Data } from "../terceiros/exile-leveling/src/data";
import { etapaDaFase, faseDaArvore, type Situacao } from "./conjuntos";
import { chaveDaGema, lerRotulo, NIVEL_DE_MAPAS, NIVEL_DO_ATO, pareceCabecalho } from "./plano";
import type { EtapaBase, EtapaDeGemas, Plano } from "./plano";

/** O jogo corta a busca em 250 letras. */
export const LIMITE_DA_BUSCA = 250;
/** Quantos botões saem das notas: os da etapa da vez primeiro, depois os que valem a build toda. */
const BUSCAS_DAS_NOTAS = 3;
/** Quantas buscas da mesma etapa entram. */
const POR_ETAPA = 2;
/** Quantas buscas das notas são lidas (o resto é ignorado). */
const MAX_ACHADAS = 60;
/** Tamanho máximo do rótulo que vem antes da busca ("Level 12 - 26 vendor regex: "). */
const MAIOR_ROTULO = 60;

export interface Busca {
  /** "build" (das notas) ou "gemas" (feita aqui). Se houver mais das notas: "build-2", "build-3". */
  chave: string;
  /** Nome curto no botão. */
  rotulo: string;
  /** O que vai pra caixa de busca do jogo. */
  texto: string;
  /** Explicação curta, pra dica do botão. */
  dica: string;
}

/** Uma busca achada nas notas (ou no rótulo de um grupo de gemas). */
export interface BuscaAchada {
  texto: string;
  /** O nível ou ato que o autor pôs nela ("Level 26", "Act 1-3", "Maps"); `null` = a build toda. */
  etapa: string | null;
}

/** Em que ponto da build o personagem está (o mesmo que escolhe gemas, itens e árvore). */
export interface FaseDaBusca {
  situacao: Situacao;
  /** O `minimo` da árvore (ver `arvoreAlvo`). */
  minimo: number;
}

/** Um ou mais termos entre aspas (cada um pode ter `!` antes ou dentro), separados por espaço. */
const TERMOS_COM_ASPAS = /^!?"[^"\n]+"(?:\s+!?"[^"\n]+")*$/;
/** Um termo só, sem espaço e sem aspas, com pelo menos um "ou" (`a|b|c`). */
const TERMO_SOLTO = /^!?[^\s"]*\|[^\s"]*$/;
/** O texto antes da busca diz que é uma busca ("Vendor regex:", "Busca:"). */
const DIZ_BUSCA = /\b(?:regex|search|busca)\b/i;
/** Onde a busca pode começar numa linha com rótulo: depois de `:`, `=` ou ` - `, ou nas aspas. */
const CORTES = /:|=|\s[-–—]+>?\s|!?"/g;
/** "Early game" é leveling, não fim de jogo. */
const CEDO = /\bearly\s*-?\s*game\b/i;

/** Palavras que podem acompanhar um rótulo de etapa sem ele virar texto corrido. */
const DE_ROTULO = new Set(
  (
    "level levels lvl lvls lv nv nivel nível niveis níveis act acts ato atos regex regexes search " +
    "busca buscas vendor vendors shop loja stash bau baú item items itens gem gems gema gemas for " +
    "pra para pro from de do da dos das to at até a ao and e on onward onwards up until plus the o os " +
    "maps map mapping mapas mapa end endgame late mid early game campaign campanha leveling " +
    "levelling uber ubers lab normal cruel merc merciless eternal setup phase fase stage etapa"
  ).split(" "),
);

/** A linha (já sem o rótulo) tem cara de busca do jogo? */
function ehBusca(texto: string): boolean {
  if (texto.length < 3 || texto.length > LIMITE_DA_BUSCA) return false;
  return TERMOS_COM_ASPAS.test(texto) || TERMO_SOLTO.test(texto);
}

/**
 * O texto é um rótulo de etapa ("Level 26", "Lvl 12 - 26 regex", "Act 4+", "== Maps ==")? Devolve
 * o rótulo sem os enfeites em volta, ou `null`. Texto corrido que cita um nível ("Get Frostblink at
 * level 4") não conta: só passa uma palavra que não seja de rótulo.
 */
export function rotuloDeEtapa(bruto: string): string | null {
  const texto = bruto.replace(/^[\s=#*_~\-–—[(<|:.>]+|[\s=#*_~\-–—\])>|:.<]+$/g, "").trim();
  if (texto === "" || texto.length > MAIOR_ROTULO) return null;
  const estranhas = (texto.match(/\p{L}+/gu) ?? []).filter((p) => !DE_ROTULO.has(p.toLowerCase()));
  if (estranhas.length > 1) return null;
  const rotulo = lerRotulo(CEDO.test(texto) ? "Leveling" : texto);
  if (rotulo.nivel_min === null && rotulo.ato_min === null && !rotulo.fim_de_jogo) return null;
  return texto;
}

/** Uma linha das notas: a busca que tem nela e o rótulo de etapa que veio junto. */
function lerLinha(linha: string): BuscaAchada | null {
  if (ehBusca(linha)) return { texto: linha, etapa: null };
  // Rótulo antes: "Level 26: ...", "Act 1-3 - ...", "Vendor regex (lvl 12) = ...", `Level 12 "..."`.
  for (const corte of linha.matchAll(CORTES)) {
    if (corte.index > MAIOR_ROTULO + 3) break;
    const inicio = corte[0].includes('"') ? corte.index : corte.index + corte[0].length;
    const texto = linha.slice(inicio).trim();
    if (!ehBusca(texto)) continue;
    const antes = linha.slice(0, inicio);
    const etapa = rotuloDeEtapa(antes);
    if (etapa) return { texto, etapa };
    if (DIZ_BUSCA.test(antes)) return { texto, etapa: null };
  }
  // Rótulo depois: `"..." (Level 1-12)`.
  const ultima = linha.lastIndexOf('"');
  if (ultima > 0 && ultima < linha.length - 1) {
    const texto = linha.slice(0, ultima + 1).trim();
    const etapa = rotuloDeEtapa(linha.slice(ultima + 1));
    if (etapa && ehBusca(texto)) return { texto, etapa };
  }
  return null;
}

/**
 * As buscas que o autor deixou nas notas do PoB, na ordem em que aparecem (sem repetir), cada uma
 * com a etapa a que ele ligou ela: na mesma linha ("Level 26: ...") ou num título em cima
 * ("---- Act 4+ ----", "Level 12" sozinho na linha). O título vale até o próximo título.
 */
export function buscasDasNotas(notas: string): BuscaAchada[] {
  const achadas: BuscaAchada[] = [];
  let titulo: string | null = null;
  for (const crua of notas.split(/\r\n|\r|\n/)) {
    const linha = crua.trim();
    if (linha === "") continue;
    const achada = lerLinha(linha);
    if (achada) {
      const etapa = achada.etapa ?? titulo;
      if (!achadas.some((a) => a.texto === achada.texto && a.etapa === etapa)) {
        achadas.push({ texto: achada.texto, etapa });
      }
      if (achadas.length >= MAX_ACHADAS) break;
      continue;
    }
    const rotulo = rotuloDeEtapa(linha);
    if (rotulo) titulo = rotulo;
    // Outro título ("---- Bandits ----") encerra o do nível; "Vendor regex:" só anuncia a busca.
    else if (pareceCabecalho(linha) && !DIZ_BUSCA.test(linha)) titulo = null;
  }
  return achadas;
}

/** Todas as buscas da build: as das notas e as que o autor pôs no rótulo de um grupo de gemas. */
export function buscasDaBuild(plano: Plano): BuscaAchada[] {
  const achadas = buscasDasNotas(plano.notas.completas);
  for (const etapa of plano.gemas.etapas) {
    for (const grupo of etapa.grupos) {
      const achada = grupo.rotulo ? lerLinha(grupo.rotulo.trim()) : null;
      if (!achada) continue;
      const nova = { texto: achada.texto, etapa: achada.etapa ?? etapa.titulo };
      if (!achadas.some((a) => a.texto === nova.texto && a.etapa === nova.etapa)) achadas.push(nova);
    }
  }
  return achadas;
}

/**
 * Que tipo de rótulo é: "etapa" (tem nível, ato ou lab: "Level 26", "Act 4+", "Cruel Lab"),
 * "leveling" (a campanha inteira, sem número: "Leveling", "Acts", "Early game") ou "fim" (fim de
 * jogo sem número: "Maps", "Endgame", "Ubers").
 */
function tipoDoRotulo(rotulo: string): "etapa" | "leveling" | "fim" {
  if (CEDO.test(rotulo)) return "leveling";
  const lido = lerRotulo(rotulo);
  if (/\d/.test(rotulo) || lido.lab !== null || lido.ato_min !== null) return "etapa";
  if (lido.fim_de_jogo || (lido.nivel_min ?? 0) >= NIVEL_DE_MAPAS) return "fim";
  return lido.nivel_min !== null ? "leveling" : "etapa";
}

function etapaDoRotulo(rotulo: string): EtapaBase {
  const lido = lerRotulo(rotulo);
  return {
    id: rotulo,
    titulo: rotulo,
    nivel_min: lido.nivel_min,
    nivel_max: lido.nivel_max,
    ato_min: lido.ato_min,
    ato_max: lido.ato_max,
    estimativa: lido.nivel_min ?? (lido.ato_min !== null ? (NIVEL_DO_ATO[lido.ato_min] ?? 1) : null),
    inicial: false,
    fim_de_jogo: lido.fim_de_jogo,
    chave: null,
  };
}

/**
 * Os rótulos das buscas que valem agora, entre os que o autor usou:
 * - dos de etapa, um só, pela regra dos itens (vira junto com a árvore);
 * - os de leveling, durante a campanha (antes do nível dos mapas);
 * - os de fim de jogo, nos mapas, depois de todos os de etapa: aí só eles.
 */
export function rotulosDaVez(plano: Plano, rotulos: string[], fase: FaseDaBusca | null): string[] {
  if (rotulos.length === 0) return [];
  const s = fase?.situacao ?? { nivel: 1, ato: 1 };
  const minimo = fase?.minimo ?? 0;
  const nivel = faseDaArvore(plano, s, minimo).nivel;
  const deEtapa = rotulos.filter((r) => tipoDoRotulo(r) === "etapa").map(etapaDoRotulo);
  const ultimo = Math.max(0, ...deEtapa.map((e) => e.nivel_max ?? e.nivel_min ?? 0));
  const doFim = rotulos.filter((r) => tipoDoRotulo(r) === "fim");
  if (doFim.length > 0 && nivel >= NIVEL_DE_MAPAS && nivel >= ultimo) return doFim;
  const daVez: string[] = [];
  const escolhida = etapaDaFase(plano, deEtapa, s, minimo);
  if (escolhida) daVez.push(escolhida.id);
  if (nivel < NIVEL_DE_MAPAS) daVez.push(...rotulos.filter((r) => tipoDoRotulo(r) === "leveling"));
  return daVez;
}

/** As gemas do conjunto, sem repetir: as novas do conjunto primeiro, depois as outras, na ordem dos grupos. */
function nomesDasGemas(etapa: EtapaDeGemas, novasPrimeiro = false): string[] {
  const nomes: string[] = [];
  const novas: string[] = [];
  const chavesNovas = new Set(etapa.mudancas?.novas ?? []);
  for (const grupo of etapa.grupos) {
    for (const gema of grupo.gemas) {
      const nome = gema.nome.trim().toLowerCase();
      if (nome === "" || nome.includes('"') || nomes.includes(nome) || novas.includes(nome)) continue;
      if (novasPrimeiro && chavesNovas.has(chaveDaGema(gema))) novas.push(nome);
      else nomes.push(nome);
    }
  }
  return [...novas, ...nomes];
}

/** Caracteres que a busca do jogo leria como regex e aparecem em nome de gema. */
function escapar(nome: string): string {
  return nome.replace(/[.*+?^$()[\]{}|\\]/g, "\\$&");
}

/**
 * Uma busca que acha as gemas do conjunto (nome inteiro na linha, como o Maxroll faz:
 * `"^(volley support|frostblink)$"`). Se não couber no limite do jogo, entram as primeiras.
 * Devolve também quantas entraram e quantas eram.
 */
export function buscaDasGemas(etapa: EtapaDeGemas): { texto: string; entraram: number; total: number } | null {
  const nomes = nomesDasGemas(etapa).map(escapar);
  if (nomes.length === 0) return null;
  const montar = (lista: string[]) => `"^(${lista.join("|")})$"`;
  let entram = nomes.length;
  while (entram > 1 && montar(nomes.slice(0, entram)).length > LIMITE_DA_BUSCA) entram -= 1;
  const texto = montar(nomes.slice(0, entram));
  if (texto.length > LIMITE_DA_BUSCA) return null;
  return { texto, entraram: entram, total: nomes.length };
}

/** A lista de gemas que o Maxroll põe na busca: `^(nome|nome)$`. */
const LISTA_DE_GEMAS = /\^\(([^()"]+)\)\$/;

let nomesDeGemas: Set<string> | null = null;

/** Os nomes de todas as gemas do jogo, em minúsculas. */
function ehNomeDeGema(nome: string): boolean {
  if (nomesDeGemas === null) {
    nomesDeGemas = new Set(Object.values(Data.Gems).map((gema) => gema.name.toLowerCase()));
  }
  return nomesDeGemas.has(nome);
}

/**
 * A busca do autor com a lista de gemas trocada pela do conjunto `etapa` (as novas do conjunto
 * primeiro; sem caber todas, as primeiras). Só troca depois do conjunto pra que o autor fez a lista
 * (o que tem mais gemas dela, o primeiro no empate): até ele, a busca é a do autor.
 * `null` quando fica a busca do autor: sem lista de gemas, conjunto dele ou de antes, nada cabe.
 */
export function comGemasDoConjunto(texto: string, etapa: EtapaDeGemas, etapas: EtapaDeGemas[]): string | null {
  const lista = LISTA_DE_GEMAS.exec(texto);
  if (!lista) return null;
  const doAutor = lista[1].split("|").map((n) => n.trim().toLowerCase().replace(/\\(.)/g, "$1"));
  if (doAutor.length === 0 || !doAutor.every(ehNomeDeGema)) return null;
  let doAutorNoPlano = -1;
  let maisGemas = 0;
  etapas.forEach((candidata, i) => {
    const nomes = nomesDasGemas(candidata);
    const quantas = doAutor.filter((n) => nomes.includes(n)).length;
    if (quantas > maisGemas) {
      maisGemas = quantas;
      doAutorNoPlano = i;
    }
  });
  const agora = etapas.indexOf(etapa);
  if (doAutorNoPlano < 0 || agora <= doAutorNoPlano) return null;
  const doConjunto = nomesDasGemas(etapa, true);
  if (doConjunto.length === 0) return null;
  const antes = texto.slice(0, lista.index);
  const depois = texto.slice(lista.index + lista[0].length);
  for (let entram = doConjunto.length; entram >= 1; entram--) {
    const novo = `${antes}^(${doConjunto.slice(0, entram).map(escapar).join("|")})$${depois}`;
    if (novo.length <= LIMITE_DA_BUSCA) return novo;
  }
  return null;
}

/**
 * Os botões da loja: as buscas das notas que valem agora (as da etapa da vez e as da build toda,
 * estas com as gemas do conjunto de agora) e a das gemas do conjunto.
 */
export function buscasDaLoja(plano: Plano, etapa: EtapaDeGemas | null, fase: FaseDaBusca | null = null): Busca[] {
  const achadas = buscasDaBuild(plano);
  const rotulos = [...new Set(achadas.flatMap((a) => (a.etapa === null ? [] : [a.etapa])))];
  const daVez = rotulosDaVez(plano, rotulos, fase);
  // A busca no rótulo de um grupo de gemas vale com o conjunto dela, mesmo sem nível no título
  // ("Pre-Sunder").
  if (etapa && rotulos.includes(etapa.titulo) && !daVez.includes(etapa.titulo)) daVez.unshift(etapa.titulo);

  const dasNotas: { texto: string; dica: string }[] = [];
  const juntar = (texto: string, dica: string) => {
    if (!dasNotas.some((b) => b.texto === texto)) dasNotas.push({ texto, dica });
  };
  for (const rotulo of daVez) {
    for (const achada of achadas.filter((a) => a.etapa === rotulo).slice(0, POR_ETAPA)) {
      juntar(achada.texto, `A busca que o autor da build deixou pra "${rotulo}"`);
    }
  }
  for (const achada of achadas.filter((a) => a.etapa === null)) {
    const trocada = etapa ? comGemasDoConjunto(achada.texto, etapa, plano.gemas.etapas) : null;
    if (trocada) juntar(trocada, `A busca das notas da build, com as gemas do conjunto ${etapa!.titulo}`);
    else juntar(achada.texto, "A busca que o autor da build deixou nas notas do PoB");
  }

  const buscas: Busca[] = dasNotas.slice(0, BUSCAS_DAS_NOTAS).map((b, i) => ({
    chave: i === 0 ? "build" : `build-${i + 1}`,
    rotulo: i === 0 ? "Build" : `Build ${i + 1}`,
    texto: b.texto,
    dica: b.dica,
  }));
  const gemas = etapa ? buscaDasGemas(etapa) : null;
  if (etapa && gemas) {
    const quantas = gemas.entraram < gemas.total ? `${gemas.entraram} de ${gemas.total}` : `${gemas.total}`;
    buscas.push({
      chave: "gemas",
      rotulo: "Gemas",
      texto: gemas.texto,
      dica: `As gemas do conjunto ${etapa.titulo} (${quantas})`,
    });
  }
  return buscas;
}
