// O "plano de leveling": o que a build pede em cada etapa (gemas, árvore e itens), montado uma
// vez na importação, a partir do PoB. O formato segue a proposta do estudo
// `leveling/conhecimento/fontes-de-build.md` (parte 6), com dois acréscimos que os PoBs reais
// pediram: rótulo por ato ("Act 3") e a etapa "inicial", sem rótulo ("Pre-Sunder").

import receitasJson from "../dados/receitas.json";
import { Data } from "../terceiros/exile-leveling/src/data";
import "./dados-330";
import { limparTexto, type Bandido, type GemaPob, type GrupoPob, type Pob } from "./pob";
import { montarRota, type GemaNecessaria, type OndePegar } from "./rota";

export const VERSAO_DO_PLANO = 1;

/** Nível em que a campanha acaba e os mapas começam. */
export const NIVEL_DE_MAPAS = 68;

/** Nível com que se costuma chegar em cada ato (o piso das zonas do ato). */
export const NIVEL_DO_ATO: Record<number, number> = {
  1: 1,
  2: 13,
  3: 23,
  4: 33,
  5: 41,
  6: 45,
  7: 50,
  8: 55,
  9: 61,
  10: 64,
};

export type Lab = "normal" | "cruel" | "merciless" | "eternal";

/** Nível usado quando o título só fala do laboratório ("Cruel Lab"). */
const NIVEL_DO_LAB: Record<Lab, number> = { normal: 33, cruel: 55, merciless: 68, eternal: 80 };

/** O que deu pra tirar do título de um conjunto do PoB. */
export interface Rotulo {
  /** Título sem as cores e sem a chave `{1}`. */
  titulo: string;
  /** Chave de loadout do PoB: "1" ou "2,3,4". */
  chave: string | null;
  nivel_min: number | null;
  nivel_max: number | null;
  ato_min: number | null;
  ato_max: number | null;
  lab: Lab | null;
  /** Conjunto de fim de jogo: não entra sozinho durante a campanha. */
  fim_de_jogo: boolean;
  /**
   * O nível veio de um número solto ("Level 26", "26", "Level 82+"), e não de faixa, ato, lab ou mapas.
   * É o jeito de rotular "como a build deve estar NAQUELE nível" (ver `pontosDeNivel`, em `conjuntos.ts`).
   */
  ponto: boolean;
}

const PALAVRA_NIVEL = "(?:levels?|lvls?|lv|nv|n[ií]vel|n[ií]veis)";
const FIM_DA_FAIXA = "(\\d{1,3}|maps?|mapas?|mapping|end\\s*game)";
const SEPARADOR = "(?:-|–|—|~|to|a|ao|até)";

const RE_CHAVE = /\{([\w,\s]+)\}/;
const RE_ATO = new RegExp(
  `\\b(?:acts?|atos?)\\s*(\\d{1,2})(?:\\s*(?:-|–|—|~|to|a|ao|até|&|and|e|/)\\s*(?:acts?|atos?)?\\s*(\\d{1,2})(?!\\d))?`,
  "i",
);
const RE_FAIXA = new RegExp(
  `\\b${PALAVRA_NIVEL}\\.?\\s*(\\d{1,3})\\s*${SEPARADOR}\\s*(?:${PALAVRA_NIVEL}\\.?\\s*)?${FIM_DA_FAIXA}\\b`,
  "i",
);
const RE_FAIXA_SOLTA = new RegExp(`^\\s*(\\d{1,3})\\s*(?:-|–|—|~)\\s*${FIM_DA_FAIXA}\\b`, "i");
const RE_PONTO = new RegExp(`\\b${PALAVRA_NIVEL}\\.?\\s*(\\d{1,3})\\b`, "i");
/** Título que é só o número ("12", "50", "92+"): muito PoB rotula assim os conjuntos de itens. */
const RE_SO_NUMERO = /^\s*(\d{1,3})\s*\+?\s*$/;
const RE_LAB =
  /\b(normal|cruel|merc(?:iless)?|uber|eternal|1st|first|2nd|second|3rd|third|4th|fourth)\s+lab/i;
const RE_MAPAS = /\b(maps?|mapas?|mapping|atlas)\b/i;
/** "Late Maps", "Red Maps": o fim do atlas, que o jogador escolhe à mão (não entra no nível 68). */
const RE_MAPAS_TARDIOS = /\b(late|red)\s*-?\s*(maps?|mapas?|mapping)\b/i;
const RE_LEVELING = /\b(level{1,2}ing|campaign|campanha|acts|atos)\b/i;
/** "Early Acts", "Middle Acts", "Late Acts": a parte da campanha, sem número de ato. */
const RE_PARTE_DA_CAMPANHA = /\b(early|mid|middle|late)\s*-?\s*(?:acts|atos|campaign|campanha|level{1,2}ing)\b/i;
/** Começo de cada parte: o começo, o meio da primeira metade e a segunda metade (atos 6 a 10). */
const ATO_DA_PARTE: Record<string, number> = { early: 1, mid: 4, middle: 4, late: 6 };
/** "LvLing Tree 30 points", "50 pts": a árvore com tantos pontos de passiva. */
const RE_PONTOS = /\b(\d{1,3})\s*(?:passive\s*)?(?:points?|pts|pontos)\b/i;
const RE_FIM_DE_JOGO =
  /\b(end\s*-?\s*game|late\s*-?\s*game|mid\s*-?\s*game|early\s*-?\s*game|ubers?|min\s*-?\s*max|budget|mirror|final)\b/i;
/**
 * "Early Game": sozinho, é o começo do atlas; logo antes da primeira etapa da campanha ("Early Game",
 * "Act 5", "Act 10"...), é o começo do leveling (ver `estimar`).
 */
const RE_COMECO_DO_JOGO = /\bearly\s*-?\s*game\b/i;

const LAB_POR_PALAVRA: Record<string, Lab> = {
  normal: "normal",
  "1st": "normal",
  first: "normal",
  cruel: "cruel",
  "2nd": "cruel",
  second: "cruel",
  merc: "merciless",
  merciless: "merciless",
  "3rd": "merciless",
  third: "merciless",
  uber: "eternal",
  eternal: "eternal",
  "4th": "eternal",
  fourth: "eternal",
};

function numero(texto: string): number {
  return Number.parseInt(texto, 10);
}

/**
 * Nível em que o personagem tem tantos pontos de passiva: um por nível depois do 1, mais os das
 * quests (uns 22 até o fim da campanha, no nível 68 mais ou menos).
 */
export function nivelDosPontos(pontos: number): number {
  const nivel = pontos >= 89 ? pontos - 21 : Math.round((pontos + 1) / 1.32);
  return Math.min(100, Math.max(1, nivel));
}

/** Lê o título de um conjunto do PoB ("Level 4 - 12", "Act 3", "Endgame {2}"). */
export function lerRotulo(bruto: string): Rotulo {
  let texto = limparTexto(bruto);
  let chave: string | null = null;
  const mChave = RE_CHAVE.exec(texto);
  if (mChave) {
    chave = mChave[1].replace(/\s+/g, "");
    texto = texto.slice(0, mChave.index) + texto.slice(mChave.index + mChave[0].length);
  }
  const titulo = texto.replace(/\s{2,}/g, " ").trim();

  let resto = titulo;
  let atoMin: number | null = null;
  let atoMax: number | null = null;
  const mAto = RE_ATO.exec(resto);
  if (mAto) {
    const primeiro = numero(mAto[1]);
    if (primeiro >= 1 && primeiro <= 10) {
      atoMin = primeiro;
      const segundo = mAto[2] ? numero(mAto[2]) : Number.NaN;
      if (segundo >= primeiro && segundo <= 10) atoMax = segundo;
      const depois = resto.slice(mAto.index + mAto[0].length);
      // "Act 6+" = do ato 6 até o fim da campanha.
      if (atoMax === null && /^\s*\+/.test(depois)) atoMax = 10;
      resto = resto.slice(0, mAto.index) + " " + depois;
    }
  }

  let nivelMin: number | null = null;
  let nivelMax: number | null = null;
  let ponto = false;
  const mFaixa = RE_FAIXA.exec(resto) ?? RE_FAIXA_SOLTA.exec(resto);
  if (mFaixa) {
    nivelMin = numero(mFaixa[1]);
    nivelMax = /^\d/.test(mFaixa[2]) ? numero(mFaixa[2]) : NIVEL_DE_MAPAS;
    if (nivelMax < nivelMin) nivelMax = null;
  } else {
    // (Com ato no título, número solto não é nível: o "3" de "Act 3" já saiu do `resto`.)
    const mPonto = RE_PONTO.exec(resto) ?? (atoMin === null ? RE_SO_NUMERO.exec(resto) : null);
    if (mPonto) {
      nivelMin = numero(mPonto[1]);
      ponto = atoMin === null;
    }
  }
  if (nivelMin === null && atoMin === null) {
    const mPontos = RE_PONTOS.exec(resto);
    if (mPontos) {
      nivelMin = nivelDosPontos(numero(mPontos[1]));
      ponto = true;
    }
  }
  if (nivelMin !== null && (nivelMin < 1 || nivelMin > 100)) {
    nivelMin = null;
    nivelMax = null;
    ponto = false;
  }

  const mLab = RE_LAB.exec(resto);
  const lab = mLab ? (LAB_POR_PALAVRA[mLab[1].toLowerCase()] ?? null) : null;

  const semGatilho = () => nivelMin === null && atoMin === null;
  if (semGatilho() && lab) nivelMin = NIVEL_DO_LAB[lab];
  const mapasTardios = RE_MAPAS_TARDIOS.test(resto);
  if (semGatilho() && RE_MAPAS.test(resto) && !mapasTardios) nivelMin = NIVEL_DE_MAPAS;
  const mParte = semGatilho() ? RE_PARTE_DA_CAMPANHA.exec(resto) : null;
  if (mParte) atoMin = ATO_DA_PARTE[mParte[1].toLowerCase()] ?? null;
  // Com chave de loadout também ("Sunder Leveling {1,2,3,4,5}": os itens de todos os loadouts da campanha).
  if (semGatilho() && RE_LEVELING.test(resto) && !RE_FIM_DE_JOGO.test(resto) && !mapasTardios) {
    nivelMin = 1;
  }

  return {
    titulo,
    chave,
    nivel_min: nivelMin,
    nivel_max: nivelMax,
    ato_min: atoMin,
    ato_max: atoMax,
    lab,
    fim_de_jogo: semGatilho() && (chave !== null || RE_FIM_DE_JOGO.test(resto) || mapasTardios),
    ponto,
  };
}

export interface GemaDoPlano {
  gem_id: string | null;
  skill_id: string | null;
  nome: string;
  suporte: boolean;
  /** "strength", "dexterity", "intelligence" ou "none". */
  cor: string;
  nivel_req: number | null;
  quantidade: number;
  /** A gema está nos nossos dados: dá pra dizer onde pegar. */
  conhecida: boolean;
}

export interface GrupoDoPlano {
  /** Texto que o autor pôs no grupo ("Leap Slam @ lvl 10"). Grupo sem gemas = título de seção. */
  rotulo: string;
  principal: boolean;
  gemas: GemaDoPlano[];
}

export interface Mudancas {
  novas: string[];
  sairam: string[];
  trocas: { de: string; para: string }[];
}

export interface EtapaBase {
  id: string;
  titulo: string;
  nivel_min: number | null;
  nivel_max: number | null;
  ato_min: number | null;
  /** Último ato em que a etapa vale ("Act 6+" = 10). `null` = só o `ato_min`. */
  ato_max: number | null;
  /** Nível em que a etapa costuma começar. `null` = sem gatilho, não entra sozinha. */
  estimativa: number | null;
  /** Etapa sem rótulo que vem antes da primeira com rótulo: vale desde o nível 1. */
  inicial: boolean;
  fim_de_jogo: boolean;
  chave: string | null;
}

export interface EtapaDeGemas extends EtapaBase {
  origem: { tipo: "SkillSet"; id: string };
  /** Etapa por ato: só entra quando o personagem tem nível pra habilidade principal. */
  nivel_gatilho: number | null;
  grupos: GrupoDoPlano[];
  /** Calculado em relação à etapa anterior. */
  mudancas: Mudancas;
}

export interface EtapaDeArvore extends EtapaBase {
  lab: Lab | null;
  versao: string;
  nos: number[];
  maestrias: { no: number; efeito: number }[];
  url: string;
  /** Só o planner do Maxroll dá a ordem dos cliques. Com PoB fica vazio. */
  ordem: null;
  /** Quantos nós entraram em relação à etapa anterior. */
  nos_novos: number;
}

export interface ItemDoPlano {
  espaco: string;
  nome: string;
  base: string;
  raridade: string;
  nivel_req: number | null;
}

export interface EtapaDeItens extends EtapaBase {
  origem: { tipo: "ItemSet"; id: string };
  itens: ItemDoPlano[];
}

export interface DicaDeItem {
  receita_id: string;
  nome: string;
  ingredientes: string[];
  resultado: string;
  ato_min: number;
  ato_max: number;
  fonte: string;
  /** `false` = a receita não foi conferida: mostrar como "a confirmar". */
  verificado: boolean;
}

export interface Fonte {
  tipo: "pob";
  url: string | null;
  id: string | null;
  site: string;
  titulo: string;
  versao_arvore: string | null;
  /** Pra saber se a build mudou ao importar de novo. */
  hash_codigo: string;
}

export interface Loadout {
  nome: string;
  chave: string;
  arvore: string | null;
  gemas: string | null;
  itens: string | null;
}

export interface Plano {
  versao: number;
  criado_em: string;
  fonte: Fonte;
  personagem: {
    classe: string;
    ascendencia: string | null;
    bandido: Bandido;
    panteao: { maior: string | null; menor: string | null };
  };
  gemas: {
    etapas: EtapaDeGemas[];
    /** Etapa que estava ativa no PoB (vale quando nenhuma tem rótulo). */
    ativa_no_pob: string | null;
    onde_pegar: Record<string, OndePegar>;
  };
  arvore: {
    etapas: EtapaDeArvore[];
    ativa_no_pob: string | null;
    ascendencias: { lab: Lab; nos: number[] }[];
  };
  itens: {
    etapas: EtapaDeItens[];
    dicas: DicaDeItem[];
    unicos_desejados: ItemDoPlano[];
  };
  fim_de_jogo: { loadouts: Loadout[] };
  notas: { leveling: string; completas: string };
  avisos: string[];
}

/** Identificador de uma gema pra comparar etapas (o id, ou o nome quando não há id). */
export function chaveDaGema(gema: { gem_id: string | null; nome: string }): string {
  return gema.gem_id ?? `nome:${gema.nome.toLowerCase()}`;
}

function gemaDoPlano(gema: GemaPob): GemaDoPlano {
  const dados = gema.gemId ? Data.Gems[gema.gemId] : undefined;
  const pareceSuporte =
    /^Support/.test(gema.skillId ?? "") || /SupportGem/.test(gema.gemId ?? "");
  return {
    gem_id: gema.gemId,
    skill_id: gema.skillId,
    nome: dados?.name ?? gema.nome,
    suporte: dados?.is_support ?? pareceSuporte,
    cor: dados?.primary_attribute ?? "none",
    nivel_req: dados?.required_level ?? null,
    quantidade: gema.quantidade,
    conhecida: dados !== undefined,
  };
}

function gruposDoPlano(grupos: GrupoPob[]): GrupoDoPlano[] {
  const saida: GrupoDoPlano[] = [];
  for (const grupo of grupos) {
    // Fora: grupos desligados no PoB e habilidades que vêm de item (não são gemas pra pegar).
    if (!grupo.ativo || grupo.deItem) continue;
    const gemas = grupo.gemas
      .filter((g) => g.ativa && (g.gemId !== null || g.nome.length > 0))
      .map(gemaDoPlano);
    if (gemas.length === 0 && !grupo.rotulo) continue;
    saida.push({ rotulo: grupo.rotulo, principal: false, gemas });
  }
  // Principal = o grupo com mais gemas ligadas (empate: o primeiro).
  let maior = -1;
  for (let i = 0; i < saida.length; i++) {
    if (saida[i].gemas.length > 0 && (maior < 0 || saida[i].gemas.length > saida[maior].gemas.length)) {
      maior = i;
    }
  }
  if (maior >= 0) saida[maior].principal = true;
  return saida;
}

/** Nível exigido pela primeira habilidade (não suporte) do primeiro grupo com gemas. */
function nivelDaPrimeiraHabilidade(grupos: GrupoDoPlano[]): number | null {
  for (const grupo of grupos) {
    if (grupo.gemas.length === 0) continue;
    const habilidade = grupo.gemas.find((g) => !g.suporte && g.nivel_req !== null);
    return habilidade?.nivel_req ?? null;
  }
  return null;
}

function base(id: string, rotulo: Rotulo): EtapaBase {
  return {
    id,
    titulo: rotulo.titulo,
    nivel_min: rotulo.nivel_min,
    nivel_max: rotulo.nivel_max,
    ato_min: rotulo.ato_min,
    ato_max: rotulo.ato_max,
    estimativa: null,
    inicial: false,
    fim_de_jogo: rotulo.fim_de_jogo,
    chave: rotulo.chave,
  };
}

/**
 * Preenche a estimativa de nível e marca a etapa "inicial": a sem rótulo que vem logo antes da
 * primeira com rótulo ("Pre-Sunder" antes de "Act 1"). `podeSerInicial` barra o caso comum do
 * PoB que traz o conjunto de fim de jogo sem rótulo antes do de leveling. "Early Game" (sem chave de
 * loadout) nesse lugar é inicial pelo próprio título, mesmo sendo de itens, e deixa de ser fim de jogo.
 * Mexe nas etapas recebidas.
 */
function estimar<T extends EtapaBase>(
  etapas: T[],
  nivelGatilho: (etapa: T) => number | null,
  podeSerInicial: (candidata: T, primeiraComRotulo: T) => boolean,
): void {
  for (const etapa of etapas) {
    if (etapa.nivel_min !== null) etapa.estimativa = etapa.nivel_min;
    else if (etapa.ato_min !== null) {
      etapa.estimativa = Math.max(NIVEL_DO_ATO[etapa.ato_min] ?? 1, nivelGatilho(etapa) ?? 0);
    }
  }
  // Só existe "inicial" antes de uma etapa da campanha: "Bossing" antes de "Mapping" não é.
  const primeira = etapas.findIndex((e) => e.estimativa !== null && e.estimativa < NIVEL_DE_MAPAS);
  for (let i = primeira - 1; i >= 0; i--) {
    const etapa = etapas[i];
    const comeco = etapa.chave === null && etapa.estimativa === null && RE_COMECO_DO_JOGO.test(etapa.titulo);
    if (etapa.fim_de_jogo && !comeco) continue;
    if (comeco || podeSerInicial(etapa, etapas[primeira])) {
      etapa.inicial = true;
      etapa.estimativa = 0;
      etapa.fim_de_jogo = false;
    }
    break;
  }
}

/** O maior nível exigido pelas gemas conhecidas da etapa. */
function maiorNivelExigido(etapa: EtapaDeGemas): number {
  let maior = 0;
  for (const grupo of etapa.grupos) {
    for (const gema of grupo.gemas) maior = Math.max(maior, gema.nivel_req ?? 0);
  }
  return maior;
}

/** Ordena por nível estimado. As sem gatilho ficam no fim, na ordem do PoB. */
function ordenar<T extends EtapaBase>(etapas: T[]): T[] {
  return etapas
    .map((etapa, indice) => ({ etapa, indice }))
    .sort((a, b) => {
      const ea = a.etapa.estimativa;
      const eb = b.etapa.estimativa;
      if (ea === null && eb === null) return a.indice - b.indice;
      if (ea === null) return 1;
      if (eb === null) return -1;
      return ea - eb || a.indice - b.indice;
    })
    .map((x) => x.etapa);
}

function chavesDaEtapa(etapa: EtapaDeGemas): Set<string> {
  const chaves = new Set<string>();
  for (const grupo of etapa.grupos) for (const gema of grupo.gemas) chaves.add(chaveDaGema(gema));
  return chaves;
}

function etapasDeGemas(pob: Pob): EtapaDeGemas[] {
  const etapas: EtapaDeGemas[] = pob.conjuntosGemas.map((conjunto, i) => {
    const grupos = gruposDoPlano(conjunto.grupos);
    return {
      ...base(`g${i + 1}`, lerRotulo(conjunto.titulo)),
      origem: { tipo: "SkillSet", id: conjunto.id },
      nivel_gatilho: null,
      grupos,
      mudancas: { novas: [], sairam: [], trocas: [] },
    };
  });
  for (const etapa of etapas) {
    if (etapa.nivel_min === null && etapa.ato_min !== null) {
      etapa.nivel_gatilho = nivelDaPrimeiraHabilidade(etapa.grupos);
    }
  }
  estimar(
    etapas,
    (e) => e.nivel_gatilho,
    // Só é "inicial" se todas as gemas já servem antes da primeira etapa com rótulo.
    (candidata, primeira) => maiorNivelExigido(candidata) <= Math.max(primeira.estimativa ?? 1, 12),
  );
  const ordenadas = ordenar(etapas);
  // A primeira etapa não tem "gemas novas": não há com o que comparar.
  let anterior: Set<string> | null = null;
  for (const etapa of ordenadas) {
    const atual = chavesDaEtapa(etapa);
    const antes: Set<string> = anterior ?? atual;
    etapa.mudancas = {
      novas: [...atual].filter((c) => !antes.has(c)),
      sairam: [...antes].filter((c) => !atual.has(c)),
      trocas: [],
    };
    anterior = atual;
  }
  return ordenadas;
}

function etapasDeArvore(pob: Pob): EtapaDeArvore[] {
  const etapas: EtapaDeArvore[] = pob.arvores.map((arvore, i) => {
    const rotulo = lerRotulo(arvore.titulo);
    const maestrias: { no: number; efeito: number }[] = [];
    for (const m of arvore.maestrias.matchAll(/\{(\d+),(\d+)\}/g)) {
      maestrias.push({ no: numero(m[1]), efeito: numero(m[2]) });
    }
    return {
      ...base(`t${i + 1}`, rotulo),
      lab: rotulo.lab,
      versao: arvore.versao,
      nos: arvore.nos,
      maestrias,
      url: arvore.url,
      ordem: null,
      nos_novos: 0,
    };
  });
  estimar(
    etapas,
    () => null,
    (candidata, primeira) => candidata.nos.length <= primeira.nos.length,
  );
  const ordenadas = ordenar(etapas);
  let anterior = new Set<number>();
  for (const etapa of ordenadas) {
    etapa.nos_novos = etapa.nos.filter((n) => !anterior.has(n)).length;
    anterior = new Set(etapa.nos);
  }
  return ordenadas;
}

function itensDoConjunto(pob: Pob, espacos: { nome: string; itemId: string }[]): ItemDoPlano[] {
  const saida: ItemDoPlano[] = [];
  for (const espaco of espacos) {
    const item = pob.itens[espaco.itemId];
    if (!item || !item.nome) continue;
    saida.push({
      espaco: espaco.nome,
      nome: item.nome,
      base: item.base,
      raridade: item.raridade,
      nivel_req: item.nivelReq,
    });
  }
  return saida;
}

function etapasDeItens(pob: Pob): EtapaDeItens[] {
  const etapas: EtapaDeItens[] = pob.conjuntosItens.map((conjunto, i) => ({
    ...base(`i${i + 1}`, lerRotulo(conjunto.titulo)),
    origem: { tipo: "ItemSet", id: conjunto.id },
    itens: itensDoConjunto(pob, conjunto.espacos),
  }));
  estimar(
    etapas,
    () => null,
    () => false,
  );
  return ordenar(etapas.filter((e) => e.itens.length > 0));
}

/** Itens únicos que dá pra usar durante a campanha, sem repetir, do menor nível pro maior. */
function unicosDesejados(etapas: EtapaDeItens[]): ItemDoPlano[] {
  const vistos = new Map<string, ItemDoPlano>();
  for (const etapa of etapas) {
    for (const item of etapa.itens) {
      if (item.raridade !== "UNIQUE") continue;
      if (item.nivel_req !== null && item.nivel_req >= NIVEL_DE_MAPAS) continue;
      if (!vistos.has(item.nome)) vistos.set(item.nome, item);
    }
  }
  return [...vistos.values()].sort((a, b) => (a.nivel_req ?? 0) - (b.nivel_req ?? 0));
}

function dicasDeItem(): DicaDeItem[] {
  return receitasJson.receitas.map((r) => ({
    receita_id: r.id,
    nome: r.nome,
    ingredientes: r.ingredientes,
    resultado: r.resultado,
    ato_min: r.ato_minimo,
    ato_max: r.ato_maximo,
    fonte: r.fonte,
    verificado: r.verificado === true,
  }));
}

function loadouts(plano: Pick<Plano, "gemas" | "arvore" | "itens">): Loadout[] {
  const temChave = (chaveDoConjunto: string | null, numeroDoLoadout: string) =>
    chaveDoConjunto !== null && chaveDoConjunto.split(",").includes(numeroDoLoadout);
  const saida: Loadout[] = [];
  for (const arvore of plano.arvore.etapas) {
    if (arvore.chave === null) continue;
    for (const n of arvore.chave.split(",")) {
      if (!n || saida.some((l) => l.chave === n)) continue;
      saida.push({
        nome: arvore.titulo,
        chave: n,
        arvore: arvore.id,
        gemas: plano.gemas.etapas.find((e) => temChave(e.chave, n))?.id ?? null,
        itens: plano.itens.etapas.find((e) => temChave(e.chave, n))?.id ?? null,
      });
    }
  }
  return saida;
}

const MAX_NOTAS = 40_000;
const MAX_NOTAS_DE_LEVELING = 6_000;

/** A linha das notas tem cara de título de seção ("---- Level 12 ----", "LEVELING", "Act 4:"). */
export function pareceCabecalho(linha: string): boolean {
  const t = linha.trim();
  if (t.length === 0 || t.length > 70) return false;
  if (/^[-=#*_~[(<|]{2,}/.test(t) || /[-=#*_~\])>|:]$/.test(t)) return true;
  return /[A-Z]/.test(t) && t === t.toUpperCase();
}

function falaDeLeveling(linha: string): boolean {
  return /level{1,2}ing|campaign|campanha|\bacts?\b|\batos?\b/i.test(linha);
}

/** Acha nas notas do PoB o bloco que fala de leveling (do cabeçalho até o próximo cabeçalho). */
export function notasDeLeveling(notas: string): string {
  const linhas = notas.split(/\r\n|\r|\n/);
  const inicio = linhas.findIndex((l) => pareceCabecalho(l) && falaDeLeveling(l));
  if (inicio < 0) return "";
  let fim = linhas.length;
  for (let i = inicio + 1; i < linhas.length; i++) {
    if (pareceCabecalho(linhas[i]) && !falaDeLeveling(linhas[i])) {
      fim = i;
      break;
    }
  }
  return linhas.slice(inicio, fim).join("\n").trim().slice(0, MAX_NOTAS_DE_LEVELING);
}

function limparNotas(notas: string): string {
  return notas
    .split(/\r\n|\r|\n/)
    .map((l) => limparTexto(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_NOTAS);
}

/** Etapas que valem durante a campanha, já na ordem em que entram. */
export function etapasDeLeveling<T extends EtapaBase>(etapas: T[]): T[] {
  return etapas.filter((e) => e.estimativa !== null && e.estimativa < NIVEL_DE_MAPAS);
}

/** A etapa que estava ativa no PoB, ou a primeira. */
function etapaAtivaNoPob<T extends EtapaBase>(etapas: T[], id: string | null): T | null {
  return etapas.find((e) => e.id === id) ?? etapas[0] ?? null;
}

/**
 * As gemas que a rota precisa encaixar nas quests, na ordem em que a build passa a usar.
 * Sem etapas com rótulo, vale o conjunto que estava ativo no PoB.
 */
export function gemasNecessarias(plano: Pick<Plano, "gemas">): GemaNecessaria[] {
  let etapas = etapasDeLeveling(plano.gemas.etapas);
  if (etapas.length === 0) {
    const ativa = etapaAtivaNoPob(plano.gemas.etapas, plano.gemas.ativa_no_pob);
    etapas = ativa ? [ativa] : [];
  }
  const saida: GemaNecessaria[] = [];
  for (const etapa of etapas) {
    const naEtapa = new Map<string, number>();
    for (const grupo of etapa.grupos) {
      for (const gema of grupo.gemas) {
        if (!gema.gem_id || !gema.conhecida) continue;
        naEtapa.set(gema.gem_id, (naEtapa.get(gema.gem_id) ?? 0) + gema.quantidade);
      }
    }
    for (const [id, quantidade] of naEtapa) {
      const existente = saida.find((g) => g.gem_id === id);
      if (existente) existente.quantidade = Math.max(existente.quantidade, quantidade);
      else saida.push({ gem_id: id, quantidade, nota: etapa.titulo });
    }
  }
  return saida;
}

function tituloDaBuild(pob: Pob, etapas: EtapaDeGemas[], ativa: string | null): string {
  const etapa = etapaAtivaNoPob(etapas, ativa);
  const principal = etapa?.grupos.find((g) => g.principal) ?? etapa?.grupos.find((g) => g.gemas.length > 0);
  const habilidade = principal?.gemas.find((g) => !g.suporte)?.nome ?? "";
  const quem = pob.ascendencia ?? pob.classe;
  return [habilidade, quem].filter((p) => p.length > 0).join(" ") || "Build sem nome";
}

/** De onde o código veio. O hash é calculado por quem importa. */
export interface OrigemDoCodigo {
  url: string | null;
  id: string | null;
  site: string;
  hash_codigo: string;
}

/** Monta o plano de leveling a partir do PoB já lido. */
export function montarPlano(pob: Pob, origem: OrigemDoCodigo, agora: Date = new Date()): Plano {
  const avisos: string[] = [];

  const gemasEtapas = etapasDeGemas(pob);
  const arvoreEtapas = etapasDeArvore(pob);
  const itensEtapas = etapasDeItens(pob);

  const idDaEtapa = (prefixo: string, idNoPob: string | null, ids: string[]): string | null => {
    const posicao = idNoPob === null ? -1 : ids.indexOf(idNoPob);
    return posicao >= 0 ? `${prefixo}${posicao + 1}` : null;
  };
  const gemasAtiva = idDaEtapa("g", pob.conjuntoGemasAtivo, pob.conjuntosGemas.map((c) => c.id));
  const arvoreAtiva = pob.arvores[pob.arvoreAtiva] ? `t${pob.arvoreAtiva + 1}` : null;

  const gemas: Plano["gemas"] = { etapas: gemasEtapas, ativa_no_pob: gemasAtiva, onde_pegar: {} };
  const arvore: Plano["arvore"] = { etapas: arvoreEtapas, ativa_no_pob: arvoreAtiva, ascendencias: [] };
  const itens: Plano["itens"] = {
    etapas: itensEtapas,
    dicas: dicasDeItem(),
    unicos_desejados: unicosDesejados(itensEtapas),
  };

  if (gemasEtapas.every((e) => e.grupos.every((g) => g.gemas.length === 0))) {
    avisos.push("O PoB veio sem gemas: o guia mostra só a rota.");
  } else if (etapasDeLeveling(gemasEtapas).length === 0) {
    avisos.push(
      "O PoB não tem conjunto de leveling: na campanha o guia monta os links com as gemas do conjunto ativo que o nível já permite; o conjunto completo aparece nos mapas.",
    );
  }

  const desconhecidas = new Set<string>();
  for (const etapa of gemasEtapas) {
    if (etapa.estimativa !== null && etapa.estimativa >= NIVEL_DE_MAPAS) continue;
    for (const grupo of etapa.grupos) {
      for (const gema of grupo.gemas) if (!gema.conhecida && gema.nome) desconhecidas.add(gema.nome);
    }
  }
  if (desconhecidas.size > 0) {
    avisos.push(
      `Gemas que não estão nos nossos dados (novas na liga?): ${[...desconhecidas].join(", ")}. O guia não sabe onde pegá-las.`,
    );
  }

  const necessarias = gemasNecessarias({ gemas });
  const rota = montarRota({ classe: pob.classe, bandido: pob.bandido }, necessarias);
  gemas.onde_pegar = rota.onde_pegar;
  avisos.push(...rota.avisos);

  const semFonte = necessarias
    .filter((g) => rota.onde_pegar[g.gem_id]?.tipo === "sem_fonte")
    .map((g) => Data.Gems[g.gem_id]?.name ?? g.gem_id);
  if (semFonte.length > 0 && rota.avisos.length === 0) {
    avisos.push(
      `Gemas que nenhuma quest dá e nenhum vendedor vende na campanha (só drop ou troca): ${semFonte.join(", ")}.`,
    );
  }

  const completas = limparNotas(pob.notas);
  const versaoDaArvore = pob.arvores[pob.arvoreAtiva]?.versao || pob.arvores[0]?.versao || null;

  return {
    versao: VERSAO_DO_PLANO,
    criado_em: agora.toISOString(),
    fonte: {
      tipo: "pob",
      url: origem.url,
      id: origem.id,
      site: origem.site,
      titulo: tituloDaBuild(pob, gemasEtapas, gemasAtiva),
      versao_arvore: versaoDaArvore,
      hash_codigo: origem.hash_codigo,
    },
    personagem: {
      classe: pob.classe,
      ascendencia: pob.ascendencia,
      bandido: pob.bandido,
      panteao: { maior: pob.panteaoMaior, menor: pob.panteaoMenor },
    },
    gemas,
    arvore,
    itens,
    fim_de_jogo: { loadouts: loadouts({ gemas, arvore, itens }) },
    notas: { leveling: notasDeLeveling(completas), completas },
    avisos,
  };
}

/**
 * Plano gravado por uma versão anterior do guia: relê o título dos conjuntos de itens que ficaram sem
 * rótulo (o "12" e o "50" dos conjuntos de itens não eram lidos como nível). Devolve o mesmo plano
 * quando não há o que mudar.
 */
export function atualizarPlano(plano: Plano): Plano {
  let mudou = false;
  const etapas = plano.itens.etapas.map((etapa) => {
    if (etapa.nivel_min !== null || etapa.ato_min !== null || etapa.chave !== null || etapa.inicial) return etapa;
    const rotulo = lerRotulo(etapa.titulo);
    if (rotulo.nivel_min === null) return etapa;
    mudou = true;
    return {
      ...etapa,
      nivel_min: rotulo.nivel_min,
      nivel_max: rotulo.nivel_max,
      estimativa: rotulo.nivel_min,
      fim_de_jogo: false,
    };
  });
  // As receitas de vendedor são do guia, não da build: o plano salvo pega as de agora (conferidas
  // depois de ele ter sido importado, por exemplo).
  const dicas = dicasDeItem();
  const dicasMudaram = JSON.stringify(dicas) !== JSON.stringify(plano.itens.dicas);
  if (!mudou && !dicasMudaram) return plano;
  return {
    ...plano,
    itens: {
      ...plano.itens,
      etapas: mudou ? ordenar(etapas) : plano.itens.etapas,
      dicas: dicasMudaram ? dicas : plano.itens.dicas,
    },
  };
}

/** Confere se o que veio do disco é um plano desta versão (o resto do app confia nisso). */
export function ehPlano(valor: unknown): valor is Plano {
  if (typeof valor !== "object" || valor === null) return false;
  const p = valor as Partial<Plano>;
  return (
    p.versao === VERSAO_DO_PLANO &&
    typeof p.fonte?.hash_codigo === "string" &&
    typeof p.personagem?.classe === "string" &&
    Array.isArray(p.gemas?.etapas) &&
    Array.isArray(p.arvore?.etapas) &&
    Array.isArray(p.itens?.etapas) &&
    Array.isArray(p.itens?.dicas) &&
    Array.isArray(p.avisos)
  );
}
