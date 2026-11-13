// Monta a rota dos atos 1 a 10 como uma lista corrida de passos, já com as gemas da build
// encaixadas no passo em que cada uma fica disponível (recompensa de quest ou vendedor).
//
// O texto da rota, o interpretador e os dados são do exile-leveling (MIT), copiados em
// `src/terceiros/exile-leveling/`. Este arquivo é nosso: ele só usa aquele código.
// A regra de "onde encaixar as gemas" e a tabela de custo seguem o que o site do
// exile-leveling faz (web/src/state/route.ts e web/src/components/.../Fragment), reescrito.

import { Data } from "../terceiros/exile-leveling/src/data";
import "./dados-330";
import { buildGemSteps, findCharacterGems } from "../terceiros/exile-leveling/src/route-processing/gems";
import {
  getRouteFiles,
  initializeRouteState,
  parseRoute,
} from "../terceiros/exile-leveling/src/route-processing/index";
import type { Fragments, RouteData } from "../terceiros/exile-leveling/src/types";

import ato1 from "../terceiros/exile-leveling/data/routes/act-1.txt?raw";
import ato2 from "../terceiros/exile-leveling/data/routes/act-2.txt?raw";
import ato3 from "../terceiros/exile-leveling/data/routes/act-3.txt?raw";
import ato4 from "../terceiros/exile-leveling/data/routes/act-4.txt?raw";
import ato5 from "../terceiros/exile-leveling/data/routes/act-5.txt?raw";
import ato6 from "../terceiros/exile-leveling/data/routes/act-6.txt?raw";
import ato7 from "../terceiros/exile-leveling/data/routes/act-7.txt?raw";
import ato8 from "../terceiros/exile-leveling/data/routes/act-8.txt?raw";
import ato9 from "../terceiros/exile-leveling/data/routes/act-9.txt?raw";
import ato10 from "../terceiros/exile-leveling/data/routes/act-10.txt?raw";

import type { Bandido } from "./pob";

const TEXTOS_DA_ROTA = [ato1, ato2, ato3, ato4, ato5, ato6, ato7, ato8, ato9, ato10];

export interface OpcoesRota {
  /** Começo de liga: inclui os passos de quem não tem itens guardados. */
  liga_nova: boolean;
  /** Fazer a quest da Biblioteca no ato 3 (libera a Siosa, que vende gemas de outras classes). */
  biblioteca: boolean;
}

export const OPCOES_PADRAO: OpcoesRota = { liga_nova: true, biblioteca: true };

/** Uma gema que a build pede, na ordem em que ela aparece nos conjuntos de leveling. */
export interface GemaNecessaria {
  gem_id: string;
  quantidade: number;
  /** De qual conjunto ela vem (vira a nota ao lado da gema). */
  nota: string;
}

export type TipoDePedaco =
  | "texto"
  | "zona"
  | "inimigo"
  | "arena"
  | "quest"
  | "destaque"
  | "viagem"
  | "marco"
  | "item"
  | "seta";

/** Um pedaço de texto de um passo, com o tipo pra interface saber como pintar. */
export interface Pedaco {
  t: TipoDePedaco;
  v: string;
  /** Zona: nível mínimo recomendado do personagem e se é cidade. */
  nivel?: number;
  cidade?: boolean;
  /** Seta: 0 = pra cima, de 45 em 45 graus no sentido do relógio. */
  dir?: number;
}

export interface GemaDoPasso {
  gem_id: string;
  nome: string;
  /** "strength", "dexterity", "intelligence" ou "none". */
  cor: string;
  suporte: boolean;
  nivel_req: number;
  tipo: "quest" | "vendedor";
  npc: string;
  quest: string;
  /** Só pra vendedor: a moeda que ele pede (1 unidade). */
  custo: string | null;
  quantidade: number;
  nota: string;
}

export interface Passo {
  indice: number;
  ato: number;
  pedacos: Pedaco[];
  dicas: Pedaco[][];
  /** Posição em `Rota.bordas` quando este passo é o primeiro numa zona nova. */
  borda: number | null;
  /** O passo termina trocando de zona (entrar, waypoint, portal, logout). */
  termina_em_troca: boolean;
  /** Zona em que o jogador está enquanto faz o passo. */
  zona: string;
  /** Zona em que ele está depois de fazer o passo. */
  zona_depois: string;
  gemas: GemaDoPasso[];
}

export type TipoDeFonte =
  | "recompensa_quest"
  | "vendedor_quest"
  | "siosa"
  | "lilly"
  | "inicial"
  | "sem_fonte";

export interface OndePegar {
  tipo: TipoDeFonte;
  quest: string | null;
  npc: string | null;
  ato: number | null;
  passo_rota: number | null;
  custo: string | null;
}

export interface Rota {
  passos: Passo[];
  /** Zona de cada "borda" (troca de zona), na ordem do caminho. */
  bordas: string[];
  /** Passo de cada borda. */
  passo_da_borda: number[];
  /** Primeiro passo de cada ato. */
  inicio_do_ato: Record<number, number>;
  onde_pegar: Record<string, OndePegar>;
  avisos: string[];
}

/** Nível mínimo do personagem pra não perder experiência na zona (regra do exile-leveling). */
export function nivelMinimoDaZona(nivelDaZona: number): number {
  return Math.max(1, nivelDaZona - (3 + Math.floor(nivelDaZona / 16)));
}

/**
 * Moeda que o vendedor cobra por uma gema, pelo nível que ela exige.
 * 3.30 (patch notes oficiais): 28-33 passou a custar Alteration e 34-37 Alchemy (antes, os dois
 * custavam Orb of Chance, que saiu dos vendedores).
 */
export function custoDaGema(nivelExigido: number): string {
  if (nivelExigido < 8) return "Scroll of Wisdom";
  if (nivelExigido < 16) return "Orb of Transmutation";
  if (nivelExigido < 34) return "Orb of Alteration";
  return "Orb of Alchemy";
}

function nomeDaZona(id: string): string {
  return Data.Areas[id]?.name ?? id;
}

function zona(id: string): Pedaco {
  const area = Data.Areas[id];
  if (!area) return { t: "zona", v: id };
  if (area.is_town_area) return { t: "zona", v: area.name, cidade: true };
  return { t: "zona", v: area.name, nivel: nivelMinimoDaZona(area.level) };
}

const LABIRINTOS: Record<Fragments.AscendFragment["version"], { nome: string; zona: string }> = {
  normal: { nome: "Labirinto normal", zona: "1_Labyrinth_boss_3" },
  cruel: { nome: "Labirinto cruel", zona: "2_Labyrinth_boss_3" },
  merciless: { nome: "Labirinto impiedoso", zona: "3_Labyrinth_boss_3" },
  eternal: { nome: "Labirinto eterno", zona: "EndGame_Labyrinth_boss_3" },
};

function npcsDaQuest(parte: Fragments.QuestFragment): string {
  const quest = Data.Quests[parte.questId];
  const nomes = new Set<string>();
  for (const id of parte.rewardOffers) {
    const npc = quest?.reward_offers[id]?.quest_npc;
    if (npc) nomes.add(npc);
  }
  return [...nomes].join(", ");
}

/** Transforma um fragmento da rota num pedaço pronto pra mostrar. */
function pedaco(parte: Fragments.AnyFragment): Pedaco | null {
  if (typeof parte === "string") return { t: "texto", v: parte };
  switch (parte.type) {
    case "kill":
      return { t: "inimigo", v: parte.value };
    case "arena":
      return { t: "arena", v: parte.value };
    case "area":
    case "enter":
      return zona(parte.areaId);
    case "logout":
      return { t: "viagem", v: `Logout ➞ ${nomeDaZona(parte.areaId)}` };
    case "waypoint":
    case "waypoint_get":
      return { t: "marco", v: "Waypoint" };
    case "waypoint_use": {
      const destino = Data.Areas[parte.dstAreaId];
      const origem = Data.Areas[parte.srcAreaId];
      let texto = `Waypoint ➞ ${destino ? destino.map_name || destino.name : parte.dstAreaId}`;
      if (destino && origem && destino.act !== origem.act && destino.id !== "Labyrinth_Airlock") {
        texto += ` (ato ${destino.act})`;
      }
      return { t: "viagem", v: texto };
    }
    case "portal_set":
      return { t: "marco", v: "Portal" };
    case "portal_use":
      return { t: "viagem", v: `Portal ➞ ${nomeDaZona(parte.dstAreaId)}` };
    case "quest": {
      const quest = Data.Quests[parte.questId];
      const npcs = npcsDaQuest(parte);
      return { t: "quest", v: (quest?.name ?? parte.questId) + (npcs ? ` (${npcs})` : "") };
    }
    case "quest_text":
    case "generic":
      return { t: "destaque", v: parte.value };
    case "reward_quest":
      return { t: "item", v: parte.item };
    case "reward_vendor":
      return { t: "item", v: parte.cost ? `${parte.item} (${parte.cost})` : parte.item };
    case "trial":
      return { t: "marco", v: "Trial of Ascendancy" };
    case "ascend": {
      const lab = LABIRINTOS[parte.version];
      const area = Data.Areas[lab.zona];
      const nivel = area ? ` (nível ${nivelMinimoDaZona(area.level)}+)` : "";
      return { t: "marco", v: `${lab.nome}${nivel}` };
    }
    case "crafting":
      return { t: "marco", v: `Receita de bancada: ${parte.crafting_recipes.join(", ")}` };
    case "dir":
      return { t: "seta", v: "", dir: parte.dirIndex };
    case "copy":
      return null;
    default:
      return null;
  }
}

function pedacos(partes: Fragments.AnyFragment[]): Pedaco[] {
  const saida: Pedaco[] = [];
  for (const parte of partes) {
    const p = pedaco(parte);
    if (p) saida.push(p);
  }
  return saida;
}

const TROCAS_DE_ZONA = new Set(["enter", "waypoint_use", "logout", "portal_use", "ascend"]);

/** O último fragmento que não é texto solto é uma troca de zona? */
function terminaEmTroca(partes: Fragments.AnyFragment[]): boolean {
  for (let i = partes.length - 1; i >= 0; i--) {
    const parte = partes[i];
    if (typeof parte === "string") continue;
    return TROCAS_DE_ZONA.has(parte.type);
  }
  return false;
}

function serveProClasse(classes: string[], classe: string): boolean {
  return classes.length === 0 || classes.includes(classe);
}

function descreverGema(
  passoDeGema: RouteData.GemStep,
  parte: Fragments.QuestFragment,
  classe: string,
): GemaDoPasso | null {
  const gema = Data.Gems[passoDeGema.requiredGem.id];
  const quest = Data.Quests[parte.questId];
  if (!gema || !quest) return null;

  let npc = "";
  for (const id of parte.rewardOffers) {
    const oferta = quest.reward_offers[id];
    if (!oferta) continue;
    if (passoDeGema.rewardType === "quest") {
      const recompensa = oferta.quest[gema.id];
      if (recompensa && serveProClasse(recompensa.classes, classe)) {
        npc = oferta.quest_npc;
        break;
      }
    } else {
      const venda = oferta.vendor[gema.id];
      if (venda && serveProClasse(venda.classes, classe)) {
        npc = venda.npc;
        break;
      }
    }
  }

  return {
    gem_id: gema.id,
    nome: gema.name,
    cor: gema.primary_attribute,
    suporte: gema.is_support,
    nivel_req: gema.required_level,
    tipo: passoDeGema.rewardType === "quest" ? "quest" : "vendedor",
    npc,
    quest: quest.name,
    custo: passoDeGema.rewardType === "vendor" ? custoDaGema(gema.required_level) : null,
    quantidade: Math.max(1, passoDeGema.count),
    nota: passoDeGema.requiredGem.note,
  };
}

function tipoDeFonte(gema: GemaDoPasso): TipoDeFonte {
  if (gema.tipo === "quest") return "recompensa_quest";
  if (gema.npc === "Siosa") return "siosa";
  if (gema.npc === "Lilly Roth") return "lilly";
  return "vendedor_quest";
}

function semAvisosNoConsole<T>(fazer: () => T): T {
  // O interpretador despeja os avisos dele no console. Aqui eles não interessam ao jogador.
  const original = console.warn;
  console.warn = () => {};
  try {
    return fazer();
  } finally {
    console.warn = original;
  }
}

/** Monta a rota inteira pra uma classe, um bandido e uma lista de gemas. */
export function montarRota(
  build: { classe: string; bandido: Bandido },
  gemas: GemaNecessaria[],
  opcoes: OpcoesRota = OPCOES_PADRAO,
): Rota {
  const avisos: string[] = [];
  const estado = initializeRouteState();
  if (opcoes.liga_nova) estado.preprocessorDefinitions.add("LEAGUE_START");
  if (opcoes.biblioteca) estado.preprocessorDefinitions.add("LIBRARY");
  estado.preprocessorDefinitions.add(
    build.bandido === "None" ? "BANDIT_KILL" : `BANDIT_${build.bandido.toUpperCase()}`,
  );

  const bruta = semAvisosNoConsole(() => parseRoute(getRouteFiles(TEXTOS_DA_ROTA), estado));

  const classeConhecida = build.classe in Data.Characters;
  if (!classeConhecida && gemas.length > 0) {
    avisos.push(
      `Não reconheci a classe "${build.classe}": a rota aparece sem as gemas encaixadas nas quests.`,
    );
  }

  const dadosDaBuild: RouteData.BuildData = {
    characterClass: build.classe,
    bandit: build.bandido,
    leagueStart: opcoes.liga_nova,
    library: opcoes.biblioteca,
  };
  const necessarias: RouteData.RequiredGem[] = [];
  for (const g of gemas) {
    if (!Data.Gems[g.gem_id]) continue;
    if (necessarias.some((n) => n.id === g.gem_id)) continue;
    necessarias.push({ id: g.gem_id, note: g.nota, count: Math.max(1, g.quantidade) });
  }
  const jaPegas = new Set<number>();
  const jaCompradas = new Set<number>();
  const ondePegar: Record<string, OndePegar> = {};
  if (classeConhecida) {
    findCharacterGems(dadosDaBuild, necessarias, jaPegas);
    for (const i of jaPegas) {
      ondePegar[necessarias[i].id] = {
        tipo: "inicial",
        quest: null,
        npc: null,
        ato: 1,
        passo_rota: 0,
        custo: null,
      };
    }
  }

  const passos: Passo[] = [];
  const passoDaBorda: number[] = [];
  const inicioDoAto: Record<number, number> = {};
  let zonaAtual = bruta.edges[0];
  let ato = 1;

  for (const secao of bruta.sections) {
    const numero = /(\d+)/.exec(secao.name);
    if (numero) ato = Number.parseInt(numero[1], 10);

    for (const passoBruto of secao.steps) {
      if (passoBruto.type !== "fragment_step") continue;
      const indice = passos.length;
      const antes = zonaAtual;
      let troca = false;
      if (passoBruto.edgeIndex !== null) {
        zonaAtual = bruta.edges[passoBruto.edgeIndex];
        passoDaBorda[passoBruto.edgeIndex] = indice;
        troca = passoBruto.edgeIndex > 0 && terminaEmTroca(passoBruto.parts);
      }

      const gemasDoPasso: GemaDoPasso[] = [];
      if (classeConhecida && necessarias.length > 0) {
        for (const parte of passoBruto.parts) {
          if (typeof parte === "string" || parte.type !== "quest") continue;
          const passosDeGema = buildGemSteps(parte, dadosDaBuild, necessarias, jaPegas, jaCompradas);
          for (const passoDeGema of passosDeGema) {
            const gema = descreverGema(passoDeGema, parte, build.classe);
            if (!gema) continue;
            gemasDoPasso.push(gema);
            if (!ondePegar[gema.gem_id]) {
              ondePegar[gema.gem_id] = {
                tipo: tipoDeFonte(gema),
                quest: gema.quest,
                npc: gema.npc || null,
                ato,
                passo_rota: indice,
                custo: gema.custo,
              };
            }
          }
        }
      }

      if (!(ato in inicioDoAto)) inicioDoAto[ato] = indice;
      passos.push({
        indice,
        ato,
        pedacos: pedacos(passoBruto.parts),
        dicas: passoBruto.subSteps.map((sub) => pedacos(sub.parts)).filter((d) => d.length > 0),
        borda: passoBruto.edgeIndex,
        termina_em_troca: troca,
        zona: troca ? antes : zonaAtual,
        zona_depois: zonaAtual,
        gemas: gemasDoPasso,
      });
    }
  }

  for (const necessaria of necessarias) {
    if (ondePegar[necessaria.id]) continue;
    ondePegar[necessaria.id] = {
      tipo: "sem_fonte",
      quest: null,
      npc: null,
      ato: null,
      passo_rota: null,
      custo: null,
    };
  }

  return {
    passos,
    bordas: bruta.edges,
    passo_da_borda: passoDaBorda,
    inicio_do_ato: inicioDoAto,
    onde_pegar: ondePegar,
    avisos,
  };
}

/** Ato de uma zona pelos dados do jogo (ou `null` se a zona não é da campanha). */
export function atoDaZona(id: string): number | null {
  return Data.Areas[id]?.act ?? null;
}

export { nomeDaZona };
