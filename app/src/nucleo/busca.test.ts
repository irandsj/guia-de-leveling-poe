import { describe, expect, it } from "vitest";

import {
  buscaDasGemas,
  buscasDaLoja,
  buscasDasNotas,
  comGemasDoConjunto,
  LIMITE_DA_BUSCA,
  rotuloDeEtapa,
  rotulosDaVez,
} from "./busca";
import { etapaDeGemas } from "./conjuntos";
import { montarPlano, type EtapaDeGemas, type GemaDoPlano, type Plano } from "./plano";
import { lerPob } from "./pob";
import { xmlDeExemplo, type PobDeExemplo } from "./teste/pob-de-exemplo";

// A linha que vem nas notas do PoB da build do Maxroll (Ranger de Spectral Throw).
const DO_MAXROLL =
  '"-\\w-.-|-[rgbw]-|runn|rint|s:.*two.*sw|^(shield charge|spectral throw|frostblink|withering step|volley support|multiple projectiles support)$" "!class:.*one.*sword"';

function gema(nome: string): GemaDoPlano {
  return {
    gem_id: null,
    skill_id: null,
    nome,
    suporte: nome.endsWith(" Support"),
    cor: "dexterity",
    nivel_req: null,
    quantidade: 1,
    conhecida: true,
  };
}

function etapa(...grupos: string[][]): EtapaDeGemas {
  return {
    id: "g1",
    titulo: "Level 12",
    nivel_min: 12,
    nivel_max: null,
    ato_min: null,
    ato_max: null,
    estimativa: 12,
    inicial: false,
    fim_de_jogo: false,
    chave: null,
    origem: { tipo: "SkillSet", id: "1" },
    nivel_gatilho: null,
    grupos: grupos.map((nomes, i) => ({ rotulo: "", principal: i === 0, gemas: nomes.map(gema) })),
    mudancas: { novas: [], sairam: [], trocas: [] },
  } as EtapaDeGemas;
}

describe("buscasDasNotas", () => {
  it("acha a busca do Maxroll, que é a nota inteira", () => {
    expect(buscasDasNotas(DO_MAXROLL)).toEqual([{ texto: DO_MAXROLL, etapa: null }]);
    expect(DO_MAXROLL.length).toBeLessThanOrEqual(LIMITE_DA_BUSCA);
  });

  it("acha a busca no meio do texto, com ou sem rótulo antes", () => {
    const notas = [
      "Guia completo no site.",
      "Vendor regex: \"-r-r-|nne|rint\"",
      "Use a busca no baú:",
      "ssive|tant|-g-g-",
      "Fim.",
    ].join("\n");
    expect(buscasDasNotas(notas)).toEqual([
      { texto: '"-r-r-|nne|rint"', etapa: null },
      { texto: "ssive|tant|-g-g-", etapa: null },
    ]);
  });

  it("não confunde texto comum com busca", () => {
    const notas = [
      "Pegue as gemas com a Nessa | depois vá pro Ato 2.",
      'Ele disse "oi" pra todo mundo',
      "Level 12 - 24",
      "",
    ].join("\n");
    expect(buscasDasNotas(notas)).toEqual([]);
  });

  it("deixa de fora busca maior que o limite do jogo e repetida", () => {
    const grande = `"${"a|".repeat(130)}b"`;
    expect(buscasDasNotas(`${grande}\n"x|y"\n"x|y"`)).toEqual([{ texto: '"x|y"', etapa: null }]);
  });
});

describe("buscaDasGemas", () => {
  it("nome inteiro de cada gema, sem repetir, entre aspas", () => {
    const busca = buscaDasGemas(etapa(["Spectral Throw", "Volley Support"], ["Frostblink", "Volley Support"]));
    expect(busca).toEqual({
      texto: '"^(spectral throw|volley support|frostblink)$"',
      entraram: 3,
      total: 3,
    });
  });

  it("corta as últimas gemas pra caber no limite", () => {
    const nomes = Array.from({ length: 30 }, (_, i) => `Gema Comprida Numero ${i} Support`);
    const busca = buscaDasGemas(etapa(nomes));
    expect(busca).not.toBeNull();
    expect(busca!.texto.length).toBeLessThanOrEqual(LIMITE_DA_BUSCA);
    expect(busca!.total).toBe(30);
    expect(busca!.entraram).toBeLessThan(30);
    expect(busca!.texto.startsWith('"^(gema comprida numero 0 support|')).toBe(true);
  });

  it("conjunto sem gemas não tem busca", () => {
    expect(buscaDasGemas(etapa([]))).toBeNull();
  });
});

describe("buscas ligadas a um nível ou ato", () => {
  it("lê o rótulo na mesma linha, antes ou depois da busca", () => {
    const notas = ['Level 1-12: "a|b"', 'Lvl 26 regex - "c|d"', "Act 4+ = e|f", '"g|h" (Maps)'].join("\n");
    expect(buscasDasNotas(notas)).toEqual([
      { texto: '"a|b"', etapa: "Level 1-12" },
      { texto: '"c|d"', etapa: "Lvl 26 regex" },
      { texto: "e|f", etapa: "Act 4+" },
      { texto: '"g|h"', etapa: "Maps" },
    ]);
  });

  it("um título com o nível vale pras buscas de baixo, até o próximo título", () => {
    const notas = [
      "---- Level 12 ----",
      "Vendor regex:",
      '"a|b"',
      "",
      "== Level 26 ==",
      '"c|d"',
      "---- Bandits ----",
      "Kill all",
      '"e|f"',
    ].join("\n");
    expect(buscasDasNotas(notas)).toEqual([
      { texto: '"a|b"', etapa: "Level 12" },
      { texto: '"c|d"', etapa: "Level 26" },
      { texto: '"e|f"', etapa: null },
    ]);
  });

  it("texto corrido que cita um nível não vira rótulo", () => {
    const notas = ["Get Frostblink at level 4 and Shield Charge at level 10", '"x|y"'].join("\n");
    expect(buscasDasNotas(notas)).toEqual([{ texto: '"x|y"', etapa: null }]);
    expect(rotuloDeEtapa("Get Frostblink at level 4")).toBeNull();
    expect(rotuloDeEtapa("==== Lvl 48 - 71 ====")).toBe("Lvl 48 - 71");
    expect(rotuloDeEtapa("Endgame:")).toBe("Endgame");
    expect(rotuloDeEtapa("Bandits")).toBeNull();
  });
});

function planoDe(pob: PobDeExemplo): Plano {
  const origem = { url: null, id: null, site: "teste", hash_codigo: "sha256:teste" };
  return montarPlano(lerPob(xmlDeExemplo(pob)), origem, new Date("2026-11-10T12:00:00Z"));
}

const fase = (nivel: number, ato: number) => ({ situacao: { nivel, ato }, minimo: 0 });

/** Build de nível em nível ("Level 26" = como ela fica no nível 26), como a do Maxroll. */
const DE_NIVEL_EM_NIVEL: PobDeExemplo = {
  classe: "Ranger",
  ascendencia: "Deadeye",
  bandido: "None",
  conjuntos: [
    {
      titulo: "Level 12",
      grupos: [{ gemas: ["Spectral Throw", "Volley Support"] }, { gemas: ["Frostblink", "Shield Charge"] }],
    },
    {
      titulo: "Level 26",
      grupos: [
        { gemas: ["Spectral Throw", "Volley Support", "Vicious Projectiles Support"] },
        { gemas: ["Frostblink", "Shield Charge"] },
        { gemas: ["Herald of Ice"] },
      ],
    },
    {
      titulo: "Level 48",
      grupos: [
        { gemas: ["Spectral Throw", "Volley Support", "Vicious Projectiles Support", "Inspiration Support"] },
        { gemas: ["Frostblink"] },
        { gemas: ["Herald of Ice", "Precision"] },
      ],
    },
    {
      titulo: "Level 71",
      grupos: [
        { gemas: ["Spectral Throw", "Volley Support", "Vicious Projectiles Support", "Inspiration Support"] },
        { gemas: ["Blink Arrow"] },
        { gemas: ["Herald of Ice", "Grace"] },
      ],
    },
  ],
  arvores: [
    { titulo: "Level 12", nos: 12 },
    { titulo: "Level 26", nos: 26 },
    { titulo: "Level 48", nos: 48 },
    { titulo: "Level 71", nos: 71 },
  ],
};

describe("as buscas avançam com a build", () => {
  const notas = [
    "Vendor regex por nível:",
    'Level 12: "r-r|doze"',
    'Level 26: "r-g|vinte"',
    'Level 48: "g-g-g|quarenta"',
    'Level 71: "g-g-g-g|setenta"',
    'Maps: "mapa|tier"',
    'Leveling: "mov|lif"',
  ].join("\n");
  const plano = planoDe({ ...DE_NIVEL_EM_NIVEL, notas });
  const rotulos = ["Level 12", "Level 26", "Level 48", "Level 71", "Maps", "Leveling"];

  it("a busca do nível vira junto com a árvore; a de leveling vale até os mapas", () => {
    const esperado: [number, number, string[]][] = [
      [1, 1, ["Level 12", "Leveling"]],
      [11, 2, ["Level 12", "Leveling"]],
      [12, 3, ["Level 26", "Leveling"]],
      [30, 5, ["Level 48", "Leveling"]],
      [60, 9, ["Level 71", "Leveling"]],
      [70, 10, ["Level 71"]],
      [75, 10, ["Maps"]],
      [92, 10, ["Maps"]],
    ];
    for (const [nivel, ato, rotulosEsperados] of esperado) {
      expect([nivel, rotulosDaVez(plano, rotulos, fase(nivel, ato))]).toEqual([nivel, rotulosEsperados]);
    }
  });

  it("os botões: a busca do nível, a de leveling e a das gemas", () => {
    const s = { nivel: 30, ato: 5 };
    const etapa = etapaDeGemas(plano, s, null).etapa;
    expect(etapa?.titulo).toBe("Level 48");
    const buscas = buscasDaLoja(plano, etapa, { situacao: s, minimo: 0 });
    expect(buscas.map((b) => [b.chave, b.texto])).toEqual([
      ["build", '"g-g-g|quarenta"'],
      ["build-2", '"mov|lif"'],
      ["gemas", expect.stringContaining("inspiration support")],
    ]);
    expect(buscas[0].dica).toContain("Level 48");
  });

  it("rótulo de ato segue o ato", () => {
    const porAto = planoDe({ ...DE_NIVEL_EM_NIVEL, notas: 'Act 1-3: "a|b"\nAct 4+: "c|d"' });
    expect(rotulosDaVez(porAto, ["Act 1-3", "Act 4+"], fase(5, 2))).toEqual(["Act 1-3"]);
    expect(rotulosDaVez(porAto, ["Act 1-3", "Act 4+"], fase(30, 5))).toEqual(["Act 4+"]);
  });

  it("sem rótulo nenhum, nada muda", () => {
    expect(rotulosDaVez(plano, [], fase(30, 5))).toEqual([]);
  });
});

describe("a busca do autor com as gemas do conjunto de agora", () => {
  const doze = etapa(["Spectral Throw", "Volley Support"], ["Frostblink", "Shield Charge"]);
  const vinte = etapa(["Spectral Throw", "Volley Support", "Vicious Projectiles Support"], ["Herald of Ice"]);
  vinte.mudancas = {
    ...vinte.mudancas!,
    novas: ["nome:vicious projectiles support", "nome:herald of ice"],
  };
  const comLista = (lista: string) => DO_MAXROLL.replace(/\^\([^)]*\)\$/, () => `^(${lista})$`);

  it("no conjunto pra que o autor fez a lista, fica a do autor", () => {
    expect(comGemasDoConjunto(DO_MAXROLL, doze, [doze, vinte])).toBeNull();
  });

  it("nos conjuntos de depois, a lista vira a do conjunto, com as novas primeiro", () => {
    expect(comGemasDoConjunto(DO_MAXROLL, vinte, [doze, vinte])).toBe(
      comLista("vicious projectiles support|herald of ice|spectral throw|volley support"),
    );
  });

  it("corta as últimas gemas pra caber no limite", () => {
    const longa = etapa(Array.from({ length: 30 }, (_, i) => `Gema Comprida Numero ${i} Support`));
    const trocada = comGemasDoConjunto(DO_MAXROLL, longa, [doze, longa]);
    expect(trocada).not.toBeNull();
    expect(trocada!.length).toBeLessThanOrEqual(LIMITE_DA_BUSCA);
    expect(trocada!.startsWith('"-\\w-.-|-[rgbw]-|runn|rint|s:.*two.*sw|^(gema comprida numero 0 support|')).toBe(true);
    expect(trocada!.endsWith(')$" "!class:.*one.*sword"')).toBe(true);
  });

  it("lista que não é de gemas, ou busca sem lista, fica como está", () => {
    expect(comGemasDoConjunto('"^(sapato|meia)$"', vinte, [doze, vinte])).toBeNull();
    expect(comGemasDoConjunto('"-r-r-|nne|rint"', vinte, [doze, vinte])).toBeNull();
  });

  it("nos botões, a busca sem etapa leva as gemas do conjunto da vez", () => {
    const plano = planoDe({ ...DE_NIVEL_EM_NIVEL, notas: DO_MAXROLL });
    const naVinte = etapaDeGemas(plano, { nivel: 20, ato: 4 }, null).etapa!;
    expect(naVinte.titulo).toBe("Level 26");
    const build = buscasDaLoja(plano, naVinte, { situacao: { nivel: 20, ato: 4 }, minimo: 0 })[0];
    expect(build.texto).toContain("^(vicious projectiles support|herald of ice|");
    expect(build.dica).toContain("Level 26");
    const naDoze = etapaDeGemas(plano, { nivel: 5, ato: 1 }, null).etapa!;
    expect(buscasDaLoja(plano, naDoze, { situacao: { nivel: 5, ato: 1 }, minimo: 0 })[0].texto).toBe(DO_MAXROLL);
  });
});
