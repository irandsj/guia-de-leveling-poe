// Só pros testes: monta PoBs de mentira (o XML e o código comprimido, igual ao do PoB de verdade).
// Nenhum dado de build real fica guardado aqui.

import { deflate } from "pako";

import { Data } from "../../terceiros/exile-leveling/src/data";

export interface GemaDeExemplo {
  nome: string;
  ativa?: boolean;
  quantidade?: number;
  /** PoB antigo: só o nome, sem `gemId`. */
  semId?: boolean;
}

export interface GrupoDeExemplo {
  rotulo?: string;
  ativo?: boolean;
  /** Habilidade que não vem de gema: `Item:123:Nome`, `Tree:47197`, `Explode`. */
  origem?: string;
  gemas: (string | GemaDeExemplo)[];
}

export interface ConjuntoDeExemplo {
  titulo: string;
  grupos: GrupoDeExemplo[];
}

export interface ArvoreDeExemplo {
  titulo: string;
  /** Quantidade de nós (os números são inventados, em sequência). */
  nos: number;
  maestrias?: string;
}

export interface ItemDeExemplo {
  id: number;
  texto: string;
}

export interface ConjuntoDeItensDeExemplo {
  titulo: string;
  espacos: Record<string, number>;
}

export interface PobDeExemplo {
  raiz?: string;
  classe?: string;
  ascendencia?: string;
  bandido?: string;
  nivel?: number;
  conjuntos: ConjuntoDeExemplo[];
  /** Posição (a partir de 1) do conjunto ativo. */
  conjuntoAtivo?: number;
  /** `false` = formato antigo, com os <Skill> soltos dentro de <Skills>. */
  comSkillSet?: boolean;
  arvores?: ArvoreDeExemplo[];
  arvoreAtiva?: number;
  itens?: ItemDeExemplo[];
  conjuntosDeItens?: ConjuntoDeItensDeExemplo[];
  notas?: string;
}

// Os dados têm nomes repetidos (variantes "Royale"): vale o primeiro id que não é Royale.
const ID_POR_NOME: Map<string, string> = new Map();
for (const gema of Object.values(Data.Gems)) {
  if (!ID_POR_NOME.has(gema.name) && !gema.id.endsWith("Royale")) ID_POR_NOME.set(gema.name, gema.id);
}

function attr(valor: string | number): string {
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function xmlDaGema(gema: string | GemaDeExemplo): string {
  const g = typeof gema === "string" ? { nome: gema } : gema;
  const suporte = g.nome.endsWith(" Support");
  // No PoB o nome do suporte vem sem a palavra "Support".
  const nameSpec = suporte ? g.nome.slice(0, -" Support".length) : g.nome;
  const semEspaco = nameSpec.replace(/[^A-Za-z]/g, "");
  const id = ID_POR_NOME.get(g.nome) ?? `Metadata/Items/Gems/${suporte ? "SupportGem" : "SkillGem"}${semEspaco}`;
  const atributos = [
    `nameSpec="${attr(nameSpec)}"`,
    `skillId="${attr((suporte ? "Support" : "") + semEspaco)}"`,
    g.semId ? "" : `gemId="${attr(id)}"`,
    `enabled="${g.ativa === false ? "false" : "true"}"`,
    `count="${g.quantidade ?? 1}"`,
    `level="20" quality="0"`,
  ].filter((a) => a.length > 0);
  return `        <Gem ${atributos.join(" ")}/>`;
}

function xmlDoGrupo(grupo: GrupoDeExemplo): string {
  const atributos = [
    `enabled="${grupo.ativo === false ? "false" : "true"}"`,
    grupo.rotulo ? `label="${attr(grupo.rotulo)}"` : "",
    grupo.origem ? `source="${attr(grupo.origem)}"` : "",
    `slot="Body Armour"`,
  ].filter((a) => a.length > 0);
  return [`      <Skill ${atributos.join(" ")}>`, ...grupo.gemas.map(xmlDaGema), "      </Skill>"].join("\n");
}

/** O XML de um PoB com o que foi pedido. */
export function xmlDeExemplo(pob: PobDeExemplo): string {
  const raiz = pob.raiz ?? "PathOfBuilding";
  const linhas: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', `<${raiz}>`];
  linhas.push(
    `  <Build level="${pob.nivel ?? 90}" className="${attr(pob.classe ?? "Marauder")}" ` +
      `ascendClassName="${attr(pob.ascendencia ?? "Juggernaut")}" bandit="${attr(pob.bandido ?? "None")}" ` +
      `pantheonMajorGod="Lunaris" pantheonMinorGod="None" mainSocketGroup="1" targetVersion="3_0"/>`,
  );

  linhas.push(`  <Skills activeSkillSet="${pob.conjuntoAtivo ?? 1}" sortGemsByDPS="true">`);
  if (pob.comSkillSet === false) {
    for (const conjunto of pob.conjuntos) linhas.push(...conjunto.grupos.map(xmlDoGrupo));
  } else {
    pob.conjuntos.forEach((conjunto, i) => {
      linhas.push(`    <SkillSet id="${i + 1}" title="${attr(conjunto.titulo)}">`);
      linhas.push(...conjunto.grupos.map(xmlDoGrupo));
      linhas.push("    </SkillSet>");
    });
  }
  linhas.push("  </Skills>");

  linhas.push(`  <Tree activeSpec="${pob.arvoreAtiva ?? 1}">`);
  let proximoNo = 1000;
  for (const arvore of pob.arvores ?? []) {
    // Cada árvore contém a anterior: os nós são 1000, 1001, 1002...
    const nos = Array.from({ length: arvore.nos }, (_, i) => 1000 + i);
    proximoNo = Math.max(proximoNo, 1000 + arvore.nos);
    linhas.push(
      `    <Spec title="${attr(arvore.titulo)}" treeVersion="3_28" classId="1" ascendClassId="1" ` +
        `nodes="${nos.join(",")}" masteryEffects="${attr(arvore.maestrias ?? "")}">`,
      `      <URL>https://www.pathofexile.com/passive-skill-tree/AAAABgEA${proximoNo}</URL>`,
      "    </Spec>",
    );
  }
  linhas.push("  </Tree>");

  linhas.push(`  <Notes>${attr(pob.notas ?? "")}</Notes>`);

  linhas.push(`  <Items activeItemSet="1" useSecondWeaponSet="false">`);
  for (const item of pob.itens ?? []) {
    linhas.push(`    <Item id="${item.id}">\n${attr(item.texto)}\n    </Item>`);
  }
  (pob.conjuntosDeItens ?? []).forEach((conjunto, i) => {
    linhas.push(`    <ItemSet id="${i + 1}" title="${attr(conjunto.titulo)}" useSecondWeaponSet="false">`);
    for (const [nome, itemId] of Object.entries(conjunto.espacos)) {
      linhas.push(`      <Slot name="${attr(nome)}" itemId="${itemId}"/>`);
    }
    linhas.push("    </ItemSet>");
  });
  linhas.push("  </Items>");
  linhas.push(`</${raiz}>`);
  return linhas.join("\n");
}

/** Comprime e codifica como o PoB faz no "Generate": zlib + base64 com `-` e `_`. */
export function codificar(xml: string): string {
  const bytes = deflate(new TextEncoder().encode(xml));
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_");
}

/** Build de exemplo no estilo dos guias que separam por faixa de nível ("Level 4 - 12"). */
export const POR_NIVEL: PobDeExemplo = {
  classe: "Marauder",
  ascendencia: "Juggernaut",
  bandido: "None",
  conjuntoAtivo: 6,
  conjuntos: [
    { titulo: "Level 1 - 4", grupos: [{ gemas: ["Ground Slam", "Ruthless Support"] }] },
    {
      titulo: "Level 4 - 12",
      grupos: [
        { gemas: ["Ground Slam", "Ruthless Support"] },
        { gemas: ["Frostblink"] },
        { rotulo: "Leap Slam @ lvl 10", gemas: ["Leap Slam", "Faster Attacks Support"] },
      ],
    },
    {
      titulo: "Level 12 - 38",
      grupos: [
        { gemas: ["Sunder", "Ruthless Support", "Melee Physical Damage Support"] },
        { gemas: ["Leap Slam", "Faster Attacks Support"] },
        { gemas: ["Frostblink"] },
        { gemas: ["Herald of Ash"] },
      ],
    },
    {
      titulo: "Level 38 - Maps",
      grupos: [
        { gemas: ["Boneshatter", "Melee Physical Damage Support", "Ruthless Support"] },
        { gemas: ["Leap Slam", { nome: "Faster Attacks Support", quantidade: 2 }] },
        { gemas: ["Frostblink"] },
        { gemas: ["Herald of Ash"] },
      ],
    },
    {
      titulo: "Early Game {1}",
      grupos: [
        { gemas: ["Boneshatter", "Melee Physical Damage Support", "Brutality Support"] },
        { ativo: false, gemas: ["Vaal Molten Shell"] },
        { origem: "Item:7:Algum Anel", gemas: ["Herald of Purity"] },
        { gemas: ["Leap Slam", { nome: "Faster Attacks Support", ativa: false }] },
      ],
    },
    {
      titulo: "^xE05030Endgame {2,3}",
      grupos: [{ gemas: ["Boneshatter", "Brutality Support", "Pride"] }],
    },
  ],
  arvoreAtiva: 5,
  arvores: [
    { titulo: "Level 12", nos: 12 },
    { titulo: "Level 32 - Normal Lab", nos: 34 },
    { titulo: "Level 67 - Merc Lab & Respec", nos: 80, maestrias: "{1010,555},{1020,777}" },
    { titulo: "Early Game {1}", nos: 100 },
    { titulo: "Endgame {2,3}", nos: 120 },
  ],
  itens: [
    {
      id: 1,
      texto:
        "Rarity: UNIQUE\nTabula Rasa\nSimple Robe\nUnique ID: abc\nItem Level: 85\nSockets: W-W-W-W-W-W\nLevelReq: 0\nImplicits: 0",
    },
    {
      id: 2,
      texto: "Rarity: RARE\nDoom Bite\nVaal Axe\nItem Level: 84\nLevelReq: 64\nImplicits: 0",
    },
    {
      id: 3,
      texto: "Rarity: UNIQUE\nKaom's Heart\nGlorious Plate\nLevelReq: 68\nImplicits: 0",
    },
    { id: 4, texto: "Rarity: MAGIC\nSeething Divine Life Flask of Sealing\nLevelReq: 60" },
  ],
  conjuntosDeItens: [
    { titulo: "Leveling", espacos: { "Body Armour": 1, "Weapon 1": 2, "Flask 1": 4 } },
    { titulo: "Endgame {2,3}", espacos: { "Body Armour": 3, "Weapon 1": 2 } },
  ],
  notas: [
    "^7Guia completo no site.",
    "",
    "===== LEVELING =====",
    "Use Ground Slam até o nível 12.",
    "Compre uma arma de duas mãos nova a cada ato.",
    "",
    "===== MAPS =====",
    "Troque pra Boneshatter.",
  ].join("\n"),
};

/** Build de exemplo no estilo que separa por ato, com um conjunto sem rótulo antes ("Pre-Sunder"). */
export const POR_ATO: PobDeExemplo = {
  classe: "Marauder",
  ascendencia: "Juggernaut",
  bandido: "None",
  conjuntoAtivo: 6,
  conjuntos: [
    {
      titulo: "Pre-Sunder",
      grupos: [{ gemas: ["Ground Slam", "Ruthless Support"] }, { gemas: ["Frostblink"] }],
    },
    {
      titulo: "Act 1",
      grupos: [{ gemas: ["Sunder", "Ruthless Support"] }, { gemas: ["Leap Slam", "Faster Attacks Support"] }],
    },
    {
      titulo: "Act 2",
      grupos: [
        { gemas: ["Sunder", "Ruthless Support", "Melee Physical Damage Support"] },
        { gemas: ["Leap Slam", "Faster Attacks Support"] },
        { gemas: ["Herald of Ash"] },
      ],
    },
    {
      titulo: "Act 6+",
      grupos: [
        { gemas: ["Sunder", "Ruthless Support", "Melee Physical Damage Support", "Fist of War Support"] },
        { gemas: ["Leap Slam", "Faster Attacks Support"] },
        { gemas: ["Herald of Ash"] },
      ],
    },
    {
      titulo: "Start of Maps (Boneshatter Swap)",
      grupos: [{ gemas: ["Boneshatter", "Ruthless Support", "Melee Physical Damage Support"] }],
    },
    { titulo: "Level 90", grupos: [{ gemas: ["Boneshatter", "Brutality Support", "Pride"] }] },
  ],
  arvoreAtiva: 6,
  arvores: [
    { titulo: "Pre-Sunder", nos: 10 },
    { titulo: "Act 1", nos: 15 },
    { titulo: "Act 2", nos: 28 },
    { titulo: "Act 6+", nos: 92 },
    { titulo: "Start of Maps (Boneshatter Swap)", nos: 98 },
    { titulo: "Level 90", nos: 126 },
  ],
};

/**
 * PoB com "Early Game" (sem chave de loadout) antes dos atos, nas gemas, na árvore e nos itens, e os
 * raros com o nome padrão do PoB ("New Item"). O formato de muita build de liga.
 */
export const EARLY_GAME_ANTES_DOS_ATOS: PobDeExemplo = {
  classe: "Templar",
  ascendencia: "Hierophant",
  bandido: "None",
  conjuntoAtivo: 6,
  conjuntos: [
    {
      titulo: "Early Game",
      grupos: [
        { gemas: ["Rolling Magma", "Combustion Support", "Elemental Proliferation Support"] },
        { gemas: ["Flame Dash"] },
        { gemas: ["Holy Flame Totem"] },
      ],
    },
    { titulo: "Act 5", grupos: [{ gemas: ["Arc", "Elemental Proliferation Support"] }, { gemas: ["Flame Dash"] }] },
    { titulo: "Act 10", grupos: [{ gemas: ["Shock Nova", "Elemental Proliferation Support"] }, { gemas: ["Herald of Thunder"] }] },
    { titulo: "Early Mapping", grupos: [{ gemas: ["Shock Nova", "Elemental Proliferation Support"] }] },
    { titulo: "Red Maps/VoidStones", grupos: [{ gemas: ["Shock Nova", "Herald of Thunder"] }] },
    { titulo: "End Game Super Tanky Setup", grupos: [{ gemas: ["Shock Nova", "Herald of Thunder"] }] },
  ],
  arvoreAtiva: 6,
  arvores: [
    { titulo: "Early Game", nos: 31 },
    { titulo: "Act 5", nos: 61 },
    { titulo: "Act 10", nos: 101 },
    { titulo: "Early Mapping", nos: 114 },
    { titulo: "Red Maps/VoidStones", nos: 129 },
    { titulo: "End Game Super Tanky Setup", nos: 127 },
  ],
  itens: [
    { id: 1, texto: "Rarity: RARE\nNew Item\nQuartz Wand\nLevelReq: 18\nImplicits: 1" },
    { id: 2, texto: "Rarity: RARE\nNew Item\nQuartz Wand\nLevelReq: 18\nImplicits: 1" },
    { id: 3, texto: "Rarity: RARE\nNew Item\nSallet\nLevelReq: 23\nImplicits: 0" },
    { id: 4, texto: "Rarity: RARE\nNew Item\nTwo-Stone Ring\nLevelReq: 20\nImplicits: 1" },
    { id: 5, texto: "Rarity: RARE\nNew Item\nTwo-Stone Ring\nLevelReq: 20\nImplicits: 1" },
    { id: 6, texto: "Rarity: UNIQUE\nTabula Rasa\nSimple Robe\nLevelReq: 0\nImplicits: 0" },
    { id: 7, texto: "Rarity: RARE\nDoom Song\nVaal Regalia\nLevelReq: 68\nImplicits: 0" },
  ],
  conjuntosDeItens: [
    { titulo: "Early Game", espacos: { "Weapon 1": 1, "Weapon 2": 2, Helmet: 3, "Ring 1": 4, "Ring 2": 5 } },
    { titulo: "Act 5", espacos: { "Weapon 1": 1, "Body Armour": 6 } },
    { titulo: "Act 10", espacos: { "Weapon 1": 1, "Body Armour": 6 } },
    { titulo: "Early Mapping", espacos: { "Body Armour": 7 } },
    { titulo: "Red Maps/VoidStones", espacos: { "Body Armour": 7 } },
    { titulo: "End Game Super Tanky Setup", espacos: { "Body Armour": 7 } },
  ],
};
