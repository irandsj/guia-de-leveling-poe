import { describe, expect, it } from "vitest";

import {
  atualizarPlano,
  ehPlano,
  etapasDeLeveling,
  gemasNecessarias,
  lerRotulo,
  montarPlano,
  notasDeLeveling,
  type Plano,
} from "./plano";
import { lerPob } from "./pob";
import { EARLY_GAME_ANTES_DOS_ATOS, POR_ATO, POR_NIVEL, xmlDeExemplo, type PobDeExemplo } from "./teste/pob-de-exemplo";

const ORIGEM = { url: "https://pobb.in/exemplo", id: "exemplo", site: "pobb.in", hash_codigo: "sha256:abc" };
const AGORA = new Date("2026-11-10T12:00:00Z");

function planoDe(pob: PobDeExemplo): Plano {
  return montarPlano(lerPob(xmlDeExemplo(pob)), ORIGEM, AGORA);
}

describe("lerRotulo", () => {
  const casos: [string, Partial<ReturnType<typeof lerRotulo>>][] = [
    ["Level 1 - 4", { nivel_min: 1, nivel_max: 4, fim_de_jogo: false }],
    ["Level 4 - 12", { nivel_min: 4, nivel_max: 12, ponto: false }],
    ["Level 38 - Maps", { nivel_min: 38, nivel_max: 68 }],
    ["Level 12", { nivel_min: 12, nivel_max: null, ponto: true }],
    ["Level 82+", { nivel_min: 82, nivel_max: null, ponto: true }],
    ["12", { titulo: "12", nivel_min: 12, nivel_max: null, ponto: true, fim_de_jogo: false }],
    ["92+", { nivel_min: 92, ponto: true }],
    ["Ubers", { nivel_min: null, ponto: false, fim_de_jogo: true }],
    ["Level 32 - Normal Lab", { nivel_min: 32, nivel_max: null, lab: "normal" }],
    ["Level 54 - Cruel Lab", { nivel_min: 54, lab: "cruel" }],
    ["Level 67 - Merc Lab & Respec", { nivel_min: 67, lab: "merciless" }],
    ["^1Lvl 20-30", { titulo: "Lvl 20-30", nivel_min: 20, nivel_max: 30 }],
    ["12-24", { nivel_min: 12, nivel_max: 24 }],
    ["Nível 10 a 20", { nivel_min: 10, nivel_max: 20 }],
    ["Act 3", { ato_min: 3, ato_max: null, nivel_min: null, ponto: false }],
    ["Act 6+", { ato_min: 6, ato_max: 10 }],
    ["Acts 1-4", { ato_min: 1, ato_max: 4 }],
    ["Ato 2", { ato_min: 2 }],
    ["Act 2 (Level 18)", { ato_min: 2, nivel_min: 18, ponto: false }],
    ["Cruel Lab", { nivel_min: 55, lab: "cruel", ponto: false }],
    ["Start of Maps (Boneshatter Swap)", { nivel_min: 68, ponto: false }],
    ["Leveling", { nivel_min: 1, fim_de_jogo: false }],
    ["Pre-Sunder", { nivel_min: null, ato_min: null, fim_de_jogo: false }],
    ["Early Game {1}", { titulo: "Early Game", chave: "1", nivel_min: null, fim_de_jogo: true }],
    // Partes da campanha sem número (PoBs do fórum): antes viravam todas nível 1.
    ["Early Acts", { ato_min: 1, nivel_min: null, fim_de_jogo: false }],
    ["Middle Acts", { ato_min: 4, nivel_min: null }],
    ["late acts", { ato_min: 6, nivel_min: null }],
    ["Mid Campaign", { ato_min: 4 }],
    ["early maps", { nivel_min: 68, fim_de_jogo: false }],
    ["late maps", { nivel_min: null, ato_min: null, fim_de_jogo: true }],
    ["Red Maps", { nivel_min: null, fim_de_jogo: true }],
    // Árvore rotulada pelos pontos de passiva (PoE Vault).
    ["LvLing Tree 12 points", { nivel_min: 10, ponto: true, fim_de_jogo: false }],
    ["LvLing Tree 30 points", { nivel_min: 23 }],
    ["LvLing Tree 70 points", { nivel_min: 54 }],
    ["Tree 110 points", { nivel_min: 89 }],
    ["Level 40 (52 points)", { nivel_min: 40 }],
    // Itens de leveling ligados a vários loadouts.
    ["Sunder Leveling {1,2,3,4,5}", { titulo: "Sunder Leveling", chave: "1,2,3,4,5", nivel_min: 1, fim_de_jogo: false }],
    ["Endgame {2,3,4,5,6}", { titulo: "Endgame", chave: "2,3,4,5,6", fim_de_jogo: true }],
    ["Mirror tier", { nivel_min: null, fim_de_jogo: true }],
    ["", { titulo: "", nivel_min: null, ato_min: null, fim_de_jogo: false }],
    ["Level 0", { nivel_min: null }],
    ["Level 250", { nivel_min: null }],
  ];
  for (const [titulo, esperado] of casos) {
    it(JSON.stringify(titulo), () => {
      expect(lerRotulo(titulo)).toMatchObject(esperado);
    });
  }
});

describe("plano de um PoB separado por nível", () => {
  const plano = planoDe(POR_NIVEL);

  it("cabeçalho", () => {
    expect(plano.versao).toBe(1);
    expect(plano.criado_em).toBe("2026-11-10T12:00:00.000Z");
    expect(plano.fonte).toEqual({
      tipo: "pob",
      url: "https://pobb.in/exemplo",
      id: "exemplo",
      site: "pobb.in",
      titulo: "Boneshatter Juggernaut",
      versao_arvore: "3_28",
      hash_codigo: "sha256:abc",
    });
    expect(plano.personagem).toEqual({
      classe: "Marauder",
      ascendencia: "Juggernaut",
      bandido: "None",
      panteao: { maior: "Lunaris", menor: null },
    });
  });

  it("etapas de gemas na ordem dos níveis, com as de fim de jogo no fim", () => {
    expect(plano.gemas.etapas.map((e) => [e.id, e.titulo, e.estimativa, e.fim_de_jogo])).toEqual([
      ["g1", "Level 1 - 4", 1, false],
      ["g2", "Level 4 - 12", 4, false],
      ["g3", "Level 12 - 38", 12, false],
      ["g4", "Level 38 - Maps", 38, false],
      ["g5", "Early Game", null, true],
      ["g6", "Endgame", null, true],
    ]);
    expect(plano.gemas.ativa_no_pob).toBe("g6");
    expect(plano.gemas.etapas.some((e) => e.inicial)).toBe(false);
    expect(etapasDeLeveling(plano.gemas.etapas).map((e) => e.id)).toEqual(["g1", "g2", "g3", "g4"]);
  });

  it("grupo principal, rótulo do grupo e dados da gema", () => {
    const etapa = plano.gemas.etapas[2];
    expect(etapa.grupos.map((g) => g.principal)).toEqual([true, false, false, false]);
    expect(plano.gemas.etapas[1].grupos[2].rotulo).toBe("Leap Slam @ lvl 10");
    expect(etapa.grupos[0].gemas[0]).toMatchObject({
      gem_id: "Metadata/Items/Gems/SkillGemSunder",
      nome: "Sunder",
      suporte: false,
      cor: "strength",
      nivel_req: 12,
      quantidade: 1,
      conhecida: true,
    });
    expect(etapa.grupos[0].gemas[1]).toMatchObject({ nome: "Ruthless Support", suporte: true });
  });

  it("o que entra e o que sai em cada troca de conjunto", () => {
    const [g1, g2, g3, g4] = plano.gemas.etapas;
    expect(g1.mudancas).toEqual({ novas: [], sairam: [], trocas: [] });
    expect(g2.mudancas.novas).toEqual([
      "Metadata/Items/Gems/SkillGemFrostblink",
      "Metadata/Items/Gems/SkillGemLeapSlam",
      "Metadata/Items/Gems/SupportGemFasterAttack",
    ]);
    expect(g2.mudancas.sairam).toEqual([]);
    expect(g3.mudancas.novas).toContain("Metadata/Items/Gems/SkillGemSunder");
    expect(g3.mudancas.sairam).toEqual(["Metadata/Items/Gems/SkillGemGroundSlam"]);
    expect(g4.mudancas.novas).toEqual(["Metadata/Items/Gems/SkillGemBoneshatter"]);
    expect(g4.mudancas.sairam).toEqual(["Metadata/Items/Gems/SkillGemSunder"]);
  });

  it("ignora grupo desligado, gema desligada e habilidade que vem de item", () => {
    const inicio = plano.gemas.etapas.find((e) => e.id === "g5");
    const nomes = inicio?.grupos.map((g) => g.gemas.map((x) => x.nome));
    expect(nomes).toEqual([["Boneshatter", "Melee Physical Damage Support", "Brutality Support"], ["Leap Slam"]]);
  });

  it("gemas que a rota precisa: ordem de uso, maior quantidade, sem o fim de jogo", () => {
    const necessarias = gemasNecessarias(plano);
    expect(necessarias.map((g) => g.gem_id.split("/").pop())).toEqual([
      "SkillGemGroundSlam",
      "SupportGemRuthless",
      "SkillGemFrostblink",
      "SkillGemLeapSlam",
      "SupportGemFasterAttack",
      "SkillGemSunder",
      "SupportGemMeleePhysicalDamage",
      "SkillGemHeraldOfAsh",
      "SkillGemBoneshatter",
    ]);
    const faster = necessarias.find((g) => g.gem_id.endsWith("SupportGemFasterAttack"));
    expect(faster).toMatchObject({ quantidade: 2, nota: "Level 4 - 12" });
    // Brutality e Pride só aparecem nos conjuntos de fim de jogo.
    expect(necessarias.some((g) => g.gem_id.endsWith("SupportGemBrutality"))).toBe(false);
  });

  it("onde pegar cada gema", () => {
    const onde = plano.gemas.onde_pegar;
    expect(onde["Metadata/Items/Gems/SkillGemGroundSlam"]).toMatchObject({
      tipo: "recompensa_quest",
      quest: "Enemy at the Gate",
      npc: "Tarkleigh",
      ato: 1,
    });
    expect(onde["Metadata/Items/Gems/SkillGemFrostblink"]).toMatchObject({
      tipo: "vendedor_quest",
      npc: "Nessa",
      custo: "Scroll of Wisdom",
    });
    expect(onde["Metadata/Items/Gems/SupportGemRuthless"].tipo).toBe("inicial");
    expect(onde["Metadata/Items/Gems/SkillGemBoneshatter"]).toMatchObject({ ato: 3 });
    expect(Object.keys(onde)).toHaveLength(9);
  });

  it("árvores com nível, laboratório, maestrias e nós novos", () => {
    expect(plano.arvore.etapas.map((e) => [e.id, e.titulo, e.estimativa, e.lab, e.nos.length, e.nos_novos])).toEqual([
      ["t1", "Level 12", 12, null, 12, 12],
      ["t2", "Level 32 - Normal Lab", 32, "normal", 34, 22],
      ["t3", "Level 67 - Merc Lab & Respec", 67, "merciless", 80, 46],
      ["t4", "Early Game", null, null, 100, 20],
      ["t5", "Endgame", null, null, 120, 20],
    ]);
    expect(plano.arvore.etapas[2].maestrias).toEqual([
      { no: 1010, efeito: 555 },
      { no: 1020, efeito: 777 },
    ]);
    expect(plano.arvore.ativa_no_pob).toBe("t5");
    expect(plano.arvore.etapas.every((e) => e.ordem === null)).toBe(true);
  });

  it("itens: conjuntos, únicos que servem na campanha e loadouts", () => {
    expect(plano.itens.etapas.map((e) => [e.id, e.titulo, e.estimativa, e.itens.length])).toEqual([
      ["i1", "Leveling", 1, 3],
      ["i2", "Endgame", null, 2],
    ]);
    // Kaom's Heart pede nível 68: fica fora da lista da campanha.
    expect(plano.itens.unicos_desejados.map((i) => i.nome)).toEqual(["Tabula Rasa"]);
    expect(plano.fim_de_jogo.loadouts).toEqual([
      { nome: "Early Game", chave: "1", arvore: "t4", gemas: "g5", itens: null },
      { nome: "Endgame", chave: "2", arvore: "t5", gemas: "g6", itens: "i2" },
      { nome: "Endgame", chave: "3", arvore: "t5", gemas: "g6", itens: "i2" },
    ]);
  });

  it("receita conferida tem fonte: patch notes da 3.30 ou poedb", () => {
    expect(plano.itens.dicas.length).toBeGreaterThanOrEqual(5);
    expect(plano.itens.dicas.every((d) => !d.verificado || /patch notes oficiais|poedb\.tw/.test(d.fonte))).toBe(true);
    expect(plano.itens.dicas.some((d) => d.verificado)).toBe(true);
    expect(plano.itens.dicas.every((d) => d.ingredientes.length > 0 && d.ato_min <= d.ato_max)).toBe(true);
  });

  it("notas: tira as cores e separa o bloco de leveling", () => {
    expect(plano.notas.completas.startsWith("Guia completo no site.")).toBe(true);
    expect(plano.notas.leveling).toBe(
      "===== LEVELING =====\nUse Ground Slam até o nível 12.\nCompre uma arma de duas mãos nova a cada ato.",
    );
  });

  it("sem avisos, e o plano sobrevive a ir pro disco e voltar", () => {
    expect(plano.avisos).toEqual([]);
    const doDisco: unknown = JSON.parse(JSON.stringify(plano));
    expect(ehPlano(doDisco)).toBe(true);
    expect(doDisco).toEqual(plano);
  });
});

describe("plano de um PoB separado por ato", () => {
  const plano = planoDe(POR_ATO);

  it("o conjunto sem rótulo antes do primeiro ato é o inicial", () => {
    expect(
      plano.gemas.etapas.map((e) => [e.id, e.titulo, e.ato_min, e.ato_max, e.estimativa, e.nivel_gatilho, e.inicial]),
    ).toEqual([
      ["g1", "Pre-Sunder", null, null, 0, null, true],
      ["g2", "Act 1", 1, null, 12, 12, false],
      ["g3", "Act 2", 2, null, 13, 12, false],
      ["g4", "Act 6+", 6, 10, 45, 12, false],
      ["g5", "Start of Maps (Boneshatter Swap)", null, null, 68, null, false],
      ["g6", "Level 90", null, null, 90, null, false],
    ]);
  });

  it("árvores: a inicial é a menor, antes da primeira com rótulo", () => {
    expect(plano.arvore.etapas.map((e) => [e.titulo, e.estimativa, e.inicial])).toEqual([
      ["Pre-Sunder", 0, true],
      ["Act 1", 1, false],
      ["Act 2", 13, false],
      ["Act 6+", 45, false],
      ["Start of Maps (Boneshatter Swap)", 68, false],
      ["Level 90", 90, false],
    ]);
  });

  it("as gemas da rota incluem o conjunto inicial e param antes dos mapas", () => {
    const nomes = gemasNecessarias(plano).map((g) => g.gem_id.split("/").pop());
    expect(nomes.slice(0, 3)).toEqual(["SkillGemGroundSlam", "SupportGemRuthless", "SkillGemFrostblink"]);
    expect(nomes).toContain("SupportGemFistOfWar");
    expect(nomes).not.toContain("SkillGemBoneshatter");
  });
});

describe("casos de borda do plano", () => {
  it("conjunto de fim de jogo sem rótulo antes do de leveling não vira o inicial", () => {
    const plano = planoDe({
      conjuntos: [
        { titulo: "Minha build", grupos: [{ gemas: ["Boneshatter", "Brutality Support", "Pride"] }] },
        { titulo: "Leveling", grupos: [{ gemas: ["Ground Slam", "Ruthless Support"] }] },
      ],
    });
    expect(plano.gemas.etapas.map((e) => [e.titulo, e.estimativa, e.inicial])).toEqual([
      ["Leveling", 1, false],
      ["Minha build", null, false],
    ]);
    expect(gemasNecessarias(plano).map((g) => g.gem_id.split("/").pop())).toEqual([
      "SkillGemGroundSlam",
      "SupportGemRuthless",
    ]);
  });

  it("PoB sem divisão nenhuma: vale o conjunto ativo, com aviso", () => {
    const plano = planoDe({
      conjuntoAtivo: 2,
      conjuntos: [
        { titulo: "Bossing", grupos: [{ gemas: ["Pride"] }] },
        { titulo: "Mapping", grupos: [{ gemas: ["Boneshatter", "Brutality Support"] }] },
      ],
    });
    // "Mapping" tem gatilho (nível 68), mas nenhuma etapa é da campanha.
    expect(etapasDeLeveling(plano.gemas.etapas)).toEqual([]);
    expect(plano.gemas.ativa_no_pob).toBe("g2");
    expect(gemasNecessarias(plano).map((g) => g.gem_id.split("/").pop())).toEqual([
      "SkillGemBoneshatter",
      "SupportGemBrutality",
    ]);
    expect(plano.avisos.join(" ")).toContain("não tem conjunto de leveling");
  });

  it("PoB sem gemas", () => {
    const plano = planoDe({ conjuntos: [] });
    expect(plano.avisos.join(" ")).toContain("sem gemas");
    expect(gemasNecessarias(plano)).toEqual([]);
    expect(plano.fonte.titulo).toBe("Juggernaut");
  });

  it("gema que não está nos dados (nova na liga) vira aviso e não quebra a rota", () => {
    const plano = planoDe({
      conjuntos: [{ titulo: "Level 1 - 12", grupos: [{ gemas: ["Ground Slam", "Golpe Novo da Liga"] }] }],
    });
    const nova = plano.gemas.etapas[0].grupos[0].gemas[1];
    expect(nova).toMatchObject({ nome: "Golpe Novo da Liga", conhecida: false, nivel_req: null });
    expect(plano.avisos.join(" ")).toContain("Golpe Novo da Liga");
    expect(gemasNecessarias(plano)).toHaveLength(1);
  });

  it("gema que só cai de monstro vira aviso", () => {
    const plano = planoDe({
      conjuntos: [{ titulo: "Level 1 - 68", grupos: [{ gemas: ["Ground Slam", "Empower Support"] }] }],
    });
    expect(plano.gemas.onde_pegar["Metadata/Items/Gems/SupportGemAdditionalLevel"].tipo).toBe("sem_fonte");
    expect(plano.avisos.join(" ")).toContain("Empower Support");
  });

  it("classe que os dados não conhecem: aviso, sem travar", () => {
    const plano = planoDe({
      classe: "Classe Nova",
      conjuntos: [{ titulo: "Level 1 - 12", grupos: [{ gemas: ["Ground Slam"] }] }],
    });
    expect(plano.avisos.join(" ")).toContain("Classe Nova");
  });
});

describe('"Early Game" antes dos atos', () => {
  const plano = planoDe(EARLY_GAME_ANTES_DOS_ATOS);

  it.each(["gemas", "arvore", "itens"] as const)('%s: o "Early Game" é o inicial, e não fim de jogo', (parte) => {
    const etapas = plano[parte].etapas;
    expect(etapas[0]).toMatchObject({ titulo: "Early Game", inicial: true, estimativa: 0, fim_de_jogo: false });
    expect(etapas.filter((e) => e.inicial)).toHaveLength(1);
    expect(etapas.find((e) => e.titulo.startsWith("End Game"))?.fim_de_jogo).toBe(true);
    expect(etapas.find((e) => e.titulo.startsWith("Red Maps"))?.fim_de_jogo).toBe(true);
  });

  it("as gemas do começo entram na rota, primeiro que as do ato 5", () => {
    const ids = gemasNecessarias(plano).map((g) => g.gem_id);
    expect(ids[0]).toBe("Metadata/Items/Gems/SkillGemMagmaOrb"); // Rolling Magma
    const arc = ids.findIndex((id) => id.endsWith("/SkillGemArc"));
    expect(arc).toBeGreaterThan(0);
  });

  it('"Early Game" depois da campanha, ou sem campanha nenhuma, continua fim de jogo', () => {
    const depois = planoDe({
      conjuntos: [
        { titulo: "Act 1", grupos: [{ gemas: ["Ground Slam"] }] },
        { titulo: "Early Game", grupos: [{ gemas: ["Boneshatter"] }] },
      ],
    });
    expect(depois.gemas.etapas.map((e) => [e.titulo, e.inicial, e.fim_de_jogo])).toEqual([
      ["Act 1", false, false],
      ["Early Game", false, true],
    ]);
    const semCampanha = planoDe({
      conjuntos: [
        { titulo: "Early Game", grupos: [{ gemas: ["Boneshatter"] }] },
        { titulo: "End Game", grupos: [{ gemas: ["Boneshatter", "Pride"] }] },
      ],
    });
    expect(semCampanha.gemas.etapas.map((e) => [e.titulo, e.inicial, e.fim_de_jogo])).toEqual([
      ["Early Game", false, true],
      ["End Game", false, true],
    ]);
  });

  it('com chave de loadout ("Early Game {1}") antes dos atos, é loadout de fim de jogo', () => {
    const comChave = planoDe({
      conjuntos: [
        { titulo: "Early Game {1}", grupos: [{ gemas: ["Boneshatter"] }] },
        { titulo: "Act 1", grupos: [{ gemas: ["Ground Slam"] }] },
      ],
    });
    expect(comChave.gemas.etapas.find((e) => e.titulo === "Early Game")).toMatchObject({
      inicial: false,
      fim_de_jogo: true,
    });
  });
});

describe("plano gravado por uma versão anterior", () => {
  const comItens = planoDe({
    ...POR_NIVEL,
    conjuntosDeItens: [
      { titulo: "12", espacos: { "Weapon 1": 2 } },
      { titulo: "50", espacos: { "Body Armour": 1 } },
      { titulo: "Ubers", espacos: { "Body Armour": 3 } },
    ],
  });

  it('conjunto de itens com título só de número ("12", "50") vira nível', () => {
    expect(comItens.itens.etapas.map((e) => [e.titulo, e.nivel_min, e.estimativa])).toEqual([
      ["12", 12, 12],
      ["50", 50, 50],
      ["Ubers", null, null],
    ]);
  });

  it("relê o título dos conjuntos de itens que antes ficavam sem nível", () => {
    const antigo: Plano = {
      ...comItens,
      itens: {
        ...comItens.itens,
        // O "Ubers" vem antes, como o PoB deixava quando nenhum tinha nível.
        etapas: [comItens.itens.etapas[2], comItens.itens.etapas[0], comItens.itens.etapas[1]].map((e) =>
          e.titulo === "Ubers" ? e : { ...e, nivel_min: null, estimativa: null },
        ),
      },
    };
    const novo = atualizarPlano(antigo);
    expect(novo.itens.etapas.map((e) => [e.titulo, e.nivel_min, e.estimativa])).toEqual([
      ["12", 12, 12],
      ["50", 50, 50],
      ["Ubers", null, null],
    ]);
    expect(ehPlano(novo)).toBe(true);
    // Nada a mudar: o mesmo plano, sem cópia.
    expect(atualizarPlano(novo)).toBe(novo);
    expect(atualizarPlano(comItens)).toBe(comItens);
  });

  it("troca as receitas de vendedor do plano salvo pelas de agora", () => {
    const antigo: Plano = {
      ...comItens,
      itens: { ...comItens.itens, dicas: comItens.itens.dicas.map((d) => ({ ...d, verificado: false })) },
    };
    const novo = atualizarPlano(antigo);
    expect(novo.itens.dicas).toEqual(comItens.itens.dicas);
    expect(novo.itens.etapas).toBe(antigo.itens.etapas);
  });
});

describe("ehPlano", () => {
  it("recusa o que não é um plano desta versão", () => {
    expect(ehPlano(null)).toBe(false);
    expect(ehPlano("plano")).toBe(false);
    expect(ehPlano({})).toBe(false);
    expect(ehPlano({ ...planoDe(POR_ATO), versao: 99 })).toBe(false);
  });
});

describe("notasDeLeveling", () => {
  it("sem cabeçalho de leveling não devolve nada", () => {
    expect(notasDeLeveling("Uma build qualquer.\nSem divisão.")).toBe("");
  });

  it("pega do cabeçalho até o próximo cabeçalho", () => {
    const notas = "INTRO\nolá\n\n[Leveling tips]\ndica 1\ndica 2\n\n[Gear]\nitens";
    expect(notasDeLeveling(notas)).toBe("[Leveling tips]\ndica 1\ndica 2");
  });
});
