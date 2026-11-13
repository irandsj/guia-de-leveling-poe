// Abre um código do Path of Building e lê o que interessa pro leveling: classe, bandido,
// conjuntos de gemas, árvores, conjuntos de itens e notas.
//
// O formato está descrito em `leveling/conhecimento/fontes-de-build.md` (parte 1).
// A tabela GEM_ID_REMAP e a função `mapearGemId` vêm do exile-leveling
// (https://github.com/HeartofPhos/exile-leveling, commit b7b2dd0, arquivo
// web/src/state/pob/process.ts), licença MIT, Copyright (c) 2025 HeartofPhos.
// O texto da licença está em leveling/terceiros/exile-leveling/LICENSE.

import { Inflate } from "pako";

import { Data } from "../terceiros/exile-leveling/src/data";
import "./dados-330";

/** Limites pra não travar o app com um texto gigante ou uma "bomba" de compressão. */
const MAX_CODIGO = 4 * 1024 * 1024;
const MAX_XML = 24 * 1024 * 1024;

export type Bandido = "None" | "Oak" | "Kraityn" | "Alira";

export interface GemaPob {
  /** Id da gema já convertido pro dos nossos dados. `null` quando o PoB não informa. */
  gemId: string | null;
  skillId: string | null;
  nome: string;
  ativa: boolean;
  quantidade: number;
}

export interface GrupoPob {
  rotulo: string;
  ativo: boolean;
  slot: string | null;
  /** Habilidade que vem de um item (não é gema pra pegar). */
  deItem: boolean;
  gemas: GemaPob[];
}

export interface ConjuntoGemasPob {
  id: string;
  titulo: string;
  grupos: GrupoPob[];
}

export interface ArvorePob {
  titulo: string;
  versao: string;
  nos: number[];
  maestrias: string;
  url: string;
}

export interface ItemPob {
  id: string;
  raridade: string;
  nome: string;
  base: string;
  nivelReq: number | null;
}

export interface ConjuntoItensPob {
  id: string;
  titulo: string;
  espacos: { nome: string; itemId: string }[];
}

export interface Pob {
  classe: string;
  ascendencia: string | null;
  nivel: number | null;
  bandido: Bandido;
  panteaoMaior: string | null;
  panteaoMenor: string | null;
  conjuntosGemas: ConjuntoGemasPob[];
  conjuntoGemasAtivo: string | null;
  arvores: ArvorePob[];
  /** Posição (a partir de 0) da árvore marcada como ativa no PoB. */
  arvoreAtiva: number;
  itens: Record<string, ItemPob>;
  conjuntosItens: ConjuntoItensPob[];
  conjuntoItensAtivo: string | null;
  notas: string;
}

const GEM_ID_REMAP: Record<string, string> = {
  // O PoB usa ids diferentes pra estas gemas (ver skills.lua do PoB).
  "Metadata/Items/Gems/Smite": "Metadata/Items/Gems/SkillGemSmite",
  "Metadata/Items/Gems/ConsecratedPath": "Metadata/Items/Gems/SkillGemConsecratedPath",
  "Metadata/Items/Gems/VaalAncestralWarchief": "Metadata/Items/Gems/SkillGemVaalAncestralWarchief",
  "Metadata/Items/Gems/HeraldOfAgony": "Metadata/Items/Gems/SkillGemHeraldOfAgony",
  "Metadata/Items/Gems/HeraldOfPurity": "Metadata/Items/Gems/SkillGemHeraldOfPurity",
  "Metadata/Items/Gems/ScourgeArrow": "Metadata/Items/Gems/SkillGemScourgeArrow",
  "Metadata/Items/Gems/RainOfSpores": "Metadata/Items/Gems/SkillGemToxicRain",
  "Metadata/Items/Gems/SummonRelic": "Metadata/Items/Gems/SkillGemSummonRelic",
  "Metadata/Items/Gems/SkillGemNewPhaseRun": "Metadata/Items/Gems/SkillGemPhaseRun",
  "Metadata/Items/Gems/SkillGemNewArcticArmour": "Metadata/Items/Gems/SkillGemArcticArmour",
};

/** Converte o id do PoB pro id dos dados: corrige os diferentes, Vaal e Awakened viram a gema comum. */
export function mapearGemId(gemId: string): string {
  let id = GEM_ID_REMAP[gemId] ?? gemId;
  id = Data.VaalGemLookup[id] ?? id;
  id = Data.AwakenedGemLookup[id] ?? id;
  return id;
}

const COR_DO_POB = /\^(x[a-zA-Z0-9]{6}|[0-9])/g;

/** Tira os códigos de cor do PoB (^7, ^xFF0000) de um texto. */
export function limparTexto(sujo: string): string {
  return sujo.replace(COR_DO_POB, "").trim();
}

function base64ParaBytes(codigo: string): Uint8Array {
  const b64 = codigo.replace(/-/g, "+").replace(/_/g, "/");
  const completo = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  let binario: string;
  try {
    binario = atob(completo);
  } catch {
    throw new Error(
      "O código não está inteiro. No PoB: Import/Export Build > Generate > Copy, e cole tudo.",
    );
  }
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** Descomprime com um teto de tamanho. Devolve `null` se o formato não bater. */
function descomprimir(bytes: Uint8Array, opcoes: { raw?: boolean; windowBits?: number }): string | null {
  const pedacos: Uint8Array[] = [];
  let total = 0;
  let estourou = false;
  try {
    const inflador = new Inflate(opcoes);
    inflador.onData = (pedaco: Uint8Array) => {
      total += pedaco.length;
      if (total > MAX_XML) {
        estourou = true;
        throw new Error("grande demais");
      }
      pedacos.push(pedaco);
    };
    inflador.push(bytes, true);
    if (inflador.err) return null;
  } catch {
    if (estourou) throw new Error("O código é grande demais pra ser um PoB.");
    return null;
  }
  const junto = new Uint8Array(total);
  let pos = 0;
  for (const pedaco of pedacos) {
    junto.set(pedaco, pos);
    pos += pedaco.length;
  }
  return new TextDecoder("utf-8").decode(junto);
}

/** Transforma o código do PoB (base64url + zlib) no XML. Aceita o XML puro também. */
export function decodificarCodigo(texto: string): string {
  const aparado = texto.trim();
  if (/^(<\?xml|<PathOfBuilding)/i.test(aparado)) return aparado;
  if (aparado.length > MAX_CODIGO) throw new Error("O código é grande demais pra ser um PoB.");

  const bytes = base64ParaBytes(aparado.replace(/\s+/g, ""));
  // zlib é o normal. As outras duas são reservas: sem cabeçalho e gzip.
  const tentativas = [{}, { raw: true }, { windowBits: 31 }];
  for (const opcoes of tentativas) {
    const xml = descomprimir(bytes, opcoes);
    if (xml && xml.includes("<PathOfBuilding")) return xml;
  }
  throw new Error("Não consegui abrir o código: ele não parece ser de um Path of Building.");
}

function atributo(el: Element | null | undefined, nome: string): string | null {
  const valor = el?.getAttribute(nome);
  return valor === null || valor === undefined ? null : valor;
}

function filhos(el: Element, nome: string): Element[] {
  return Array.from(el.children).filter((f) => f.tagName === nome);
}

function semNada(valor: string | null): string | null {
  if (!valor) return null;
  const limpo = limparTexto(valor);
  return limpo && limpo !== "None" ? limpo : null;
}

/** Gemas que alguma quest dá ou algum vendedor vende na campanha. */
const COM_FONTE: Set<string> = new Set(
  Object.values(Data.Quests).flatMap((quest) =>
    Object.values(quest.reward_offers).flatMap((oferta) =>
      oferta ? [...Object.keys(oferta.quest), ...Object.keys(oferta.vendor)] : [],
    ),
  ),
);

/** Entre gemas de mesmo nome: vale mais a que dá pra pegar na campanha, e menos a "Royale". */
export function pesoDoId(id: string): number {
  if (COM_FONTE.has(id)) return 2;
  return id.endsWith("Royale") ? 0 : 1;
}

/**
 * Nome → id, pros PoBs antigos, que só trazem o nome. Os dados têm nomes repetidos (as variantes
 * "Royale" e algumas versões antigas da gema): vale a que dá pra pegar na campanha.
 */
const NOME_PRA_ID: Map<string, string> = new Map();
for (const gema of Object.values(Data.Gems)) {
  const chave = gema.name.toLowerCase();
  const atual = NOME_PRA_ID.get(chave);
  if (atual === undefined || pesoDoId(gema.id) > pesoDoId(atual)) NOME_PRA_ID.set(chave, gema.id);
}

function lerGema(el: Element): GemaPob {
  const nome = limparTexto(atributo(el, "nameSpec") ?? "");
  const bruto = atributo(el, "gemId");
  let gemId: string | null = bruto ? mapearGemId(bruto) : null;
  // Gema nova com id que os dados não conhecem (ex.: a 3.30 antes de atualizar): tenta pelo nome.
  if (gemId && !Data.Gems[gemId] && nome) gemId = NOME_PRA_ID.get(nome.toLowerCase()) ?? gemId;
  if (!gemId && nome) {
    // PoBs antigos só trazem o nome. O suporte vem sem a palavra "Support".
    const chave = nome.toLowerCase();
    gemId = NOME_PRA_ID.get(chave) ?? NOME_PRA_ID.get(`${chave} support`) ?? null;
  }
  const quantidade = Number.parseInt(atributo(el, "count") ?? "1", 10);
  return {
    gemId,
    skillId: atributo(el, "skillId"),
    nome: nome || (gemId ? (Data.Gems[gemId]?.name ?? "") : ""),
    ativa: atributo(el, "enabled") !== "false",
    quantidade: Number.isFinite(quantidade) && quantidade > 0 ? Math.min(quantidade, 6) : 1,
  };
}

function lerGrupo(el: Element): GrupoPob {
  const origem = atributo(el, "source");
  return {
    rotulo: limparTexto(atributo(el, "label") ?? ""),
    ativo: atributo(el, "enabled") !== "false",
    slot: atributo(el, "slot"),
    // Habilidade que vem de item ("Item:3:…"), da árvore ("Tree:47197") ou de modificador ("Explode"):
    // não é gema, não se pega em lugar nenhum.
    deItem: !!origem,
    gemas: filhos(el, "Gem").map(lerGema),
  };
}

function lerItem(el: Element): ItemPob {
  const linhas = (el.textContent ?? "")
    .split(/\r\n|\r|\n/g)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const raridade = (/^Rarity:\s*(\w+)/i.exec(linhas[0] ?? "")?.[1] ?? "").toUpperCase();
  const nome = limparTexto(linhas[1] ?? "");
  const terceira = linhas[2] ?? "";
  const temBase = (raridade === "RARE" || raridade === "UNIQUE") && !/^[\w ]+:\s/.test(terceira);
  let nivelReq: number | null = null;
  for (const linha of linhas) {
    const m = /^LevelReq:\s*(\d+)/i.exec(linha);
    if (m) {
      nivelReq = Number.parseInt(m[1], 10);
      break;
    }
  }
  return {
    id: atributo(el, "id") ?? "",
    raridade,
    nome,
    base: temBase ? limparTexto(terceira) : "",
    nivelReq,
  };
}

function lerEspacos(pai: Element): { nome: string; itemId: string }[] {
  return filhos(pai, "Slot")
    .map((s) => ({ nome: atributo(s, "name") ?? "", itemId: atributo(s, "itemId") ?? "0" }))
    .filter((s) => s.nome && s.itemId !== "0");
}

/** Lê o XML do PoB. Lança erro (em português) quando não é um PoB de PoE 1. */
export function lerPob(xml: string): Pob {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const raiz = doc.documentElement;
  if (!raiz || raiz.tagName !== "PathOfBuilding" || doc.getElementsByTagName("parsererror").length > 0) {
    if (raiz?.tagName === "PathOfBuilding2") {
      throw new Error("Esse código é do Path of Building de PoE 2. Este guia é só do PoE 1.");
    }
    throw new Error("O conteúdo não é um Path of Building válido.");
  }

  const build = filhos(raiz, "Build")[0];
  if (!build) throw new Error("O PoB veio sem os dados do personagem (falta <Build>).");

  const classe = atributo(build, "className") ?? "";
  const bandidoBruto = atributo(build, "bandit") ?? "None";
  const bandido: Bandido =
    bandidoBruto === "Oak" || bandidoBruto === "Kraityn" || bandidoBruto === "Alira"
      ? bandidoBruto
      : "None";
  const nivel = Number.parseInt(atributo(build, "level") ?? "", 10);

  // Gemas: PoBs novos têm <SkillSet>; os antigos põem <Skill> direto em <Skills>.
  const skills = filhos(raiz, "Skills")[0];
  const conjuntosGemas: ConjuntoGemasPob[] = [];
  if (skills) {
    const sets = filhos(skills, "SkillSet");
    if (sets.length > 0) {
      for (const set of sets) {
        conjuntosGemas.push({
          id: atributo(set, "id") ?? String(conjuntosGemas.length + 1),
          titulo: limparTexto(atributo(set, "title") ?? ""),
          grupos: filhos(set, "Skill").map(lerGrupo),
        });
      }
    } else {
      const soltos = filhos(skills, "Skill");
      if (soltos.length > 0) conjuntosGemas.push({ id: "1", titulo: "", grupos: soltos.map(lerGrupo) });
    }
  }

  const tree = filhos(raiz, "Tree")[0];
  const arvores: ArvorePob[] = [];
  if (tree) {
    for (const spec of filhos(tree, "Spec")) {
      const nos = (atributo(spec, "nodes") ?? "")
        .split(",")
        .map((n) => Number.parseInt(n, 10))
        .filter((n) => Number.isFinite(n));
      arvores.push({
        titulo: limparTexto(atributo(spec, "title") ?? ""),
        versao: atributo(spec, "treeVersion") ?? "",
        nos,
        maestrias: atributo(spec, "masteryEffects") ?? "",
        url: (filhos(spec, "URL")[0]?.textContent ?? "").trim(),
      });
    }
  }
  const arvoreAtiva = Number.parseInt(atributo(tree, "activeSpec") ?? "1", 10) - 1;

  const items = filhos(raiz, "Items")[0];
  const itens: Record<string, ItemPob> = {};
  const conjuntosItens: ConjuntoItensPob[] = [];
  if (items) {
    for (const el of filhos(items, "Item")) {
      const item = lerItem(el);
      if (item.id) itens[item.id] = item;
    }
    const sets = filhos(items, "ItemSet");
    for (const set of sets) {
      conjuntosItens.push({
        id: atributo(set, "id") ?? String(conjuntosItens.length + 1),
        titulo: limparTexto(atributo(set, "title") ?? ""),
        espacos: lerEspacos(set),
      });
    }
    if (sets.length === 0) {
      const espacos = lerEspacos(items);
      if (espacos.length > 0) conjuntosItens.push({ id: "1", titulo: "", espacos });
    }
  }

  return {
    classe,
    ascendencia: semNada(atributo(build, "ascendClassName")),
    nivel: Number.isFinite(nivel) ? nivel : null,
    bandido,
    panteaoMaior: semNada(atributo(build, "pantheonMajorGod")),
    panteaoMenor: semNada(atributo(build, "pantheonMinorGod")),
    conjuntosGemas,
    conjuntoGemasAtivo: atributo(skills, "activeSkillSet"),
    arvores,
    arvoreAtiva: Number.isFinite(arvoreAtiva) && arvoreAtiva >= 0 ? arvoreAtiva : 0,
    itens,
    conjuntosItens,
    conjuntoItensAtivo: atributo(items, "activeItemSet"),
    notas: (filhos(raiz, "Notes")[0]?.textContent ?? "").trim(),
  };
}
