import { describe, expect, it } from "vitest";

import { Data } from "../terceiros/exile-leveling/src/data";
import { ARCANE_LINK } from "./dados-330";
import { gemasNecessarias } from "./plano";
import { atoDaZona, custoDaGema, montarRota, nivelMinimoDaZona, nomeDaZona, type Rota } from "./rota";
import { PLANO, ROTA, textoDoPasso } from "./teste/rota-de-exemplo";

const GEMAS = gemasNecessarias(PLANO);
const id = (nome: string): string => {
  const gema = PLANO.gemas.etapas.flatMap((e) => e.grupos.flatMap((g) => g.gemas)).find((g) => g.nome === nome);
  if (!gema?.gem_id) throw new Error(`o plano de exemplo não tem a gema ${nome}`);
  return gema.gem_id;
};

function passoCom(rota: Rota, trecho: string) {
  const achado = rota.passos.find((p) => textoDoPasso(p).includes(trecho));
  if (!achado) throw new Error(`nenhum passo com "${trecho}"`);
  return achado;
}

describe("a rota dos atos 1 a 10", () => {
  it("tem os 10 atos, em ordem, com os passos numerados", () => {
    expect(ROTA.passos.length).toBeGreaterThan(300);
    ROTA.passos.forEach((p, i) => expect(p.indice).toBe(i));
    for (let i = 1; i < ROTA.passos.length; i++) {
      expect(ROTA.passos[i].ato, `passo ${i}`).toBeGreaterThanOrEqual(ROTA.passos[i - 1].ato);
    }
    expect(Object.keys(ROTA.inicio_do_ato).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (let ato = 1; ato <= 10; ato++) {
      expect(ROTA.inicio_do_ato[ato], `ato ${ato}`).toBe(ROTA.passos.findIndex((p) => p.ato === ato));
    }
    expect(ROTA.avisos).toEqual([]);
  });

  it("nenhum passo fica sem texto", () => {
    for (const p of ROTA.passos) expect(textoDoPasso(p).trim().length, `passo ${p.indice}`).toBeGreaterThan(0);
  });

  it("começa na praia e termina em Oriath", () => {
    expect(ROTA.bordas[0]).toBe("1_1_1");
    expect(ROTA.bordas[ROTA.bordas.length - 1]).toBe("2_11_endgame_town");
    expect(ROTA.passos[0].zona).toBe("1_1_1");
    expect(ROTA.passos[ROTA.passos.length - 1].zona).toBe("2_11_endgame_town");
  });

  it("todas as zonas da rota existem nos dados do jogo", () => {
    const fora = ROTA.bordas.filter((zona) => !Data.Areas[zona]);
    expect(fora).toEqual([]);
  });

  it("cada borda aponta pro passo que troca de zona, em ordem", () => {
    expect(ROTA.passo_da_borda.length).toBe(ROTA.bordas.length);
    ROTA.bordas.forEach((_, borda) => {
      const passo = ROTA.passo_da_borda[borda];
      expect(ROTA.passos[passo]?.borda, `borda ${borda}`).toBe(borda);
      if (borda > 0) expect(passo, `borda ${borda}`).toBeGreaterThan(ROTA.passo_da_borda[borda - 1]);
    });
    const comBorda = ROTA.passos.filter((p) => p.borda !== null).length;
    expect(comBorda).toBe(ROTA.bordas.length);
  });

  it("a zona de cada passo acompanha as bordas", () => {
    let zona = ROTA.bordas[0];
    for (const p of ROTA.passos) {
      if (p.borda === null) {
        expect(p.termina_em_troca, `passo ${p.indice}`).toBe(false);
        expect(p.zona, `passo ${p.indice}`).toBe(zona);
      } else {
        expect(p.zona, `passo ${p.indice}`).toBe(p.termina_em_troca ? zona : ROTA.bordas[p.borda]);
        zona = ROTA.bordas[p.borda];
      }
      expect(p.zona_depois, `passo ${p.indice}`).toBe(zona);
    }
  });

  it("os primeiros passos do ato 1", () => {
    const inicio = ROTA.passos.slice(0, 8).map((p) => [textoDoPasso(p), p.zona, p.zona_depois, p.borda]);
    expect(inicio).toEqual([
      ["Find and kill Hillock", "1_1_1", "1_1_1", 0],
      ["➞ Lioneye's Watch", "1_1_1", "1_1_town", 1],
      ["Hand in Enemy at the Gate (Tarkleigh)", "1_1_town", "1_1_town", null],
      ["➞ The Coast", "1_1_town", "1_1_2", 2],
      ["Get Waypoint", "1_1_2", "1_1_2", null],
      ["➞ The Mud Flats", "1_1_2", "1_1_3", 3],
      ["Find 3xGlyph", "1_1_3", "1_1_3", null],
      ["➞ The Submerged Passage", "1_1_3", "1_1_4_1", 4],
    ]);
    expect(ROTA.passos[0].termina_em_troca).toBe(false);
    expect(ROTA.passos[1].termina_em_troca).toBe(true);
  });

  it("os pedaços vêm com o tipo certo pra interface pintar", () => {
    expect(ROTA.passos[0].pedacos).toEqual([
      { t: "texto", v: "Find and kill " },
      { t: "inimigo", v: "Hillock" },
    ]);
    expect(ROTA.passos[1].pedacos).toEqual([
      { t: "texto", v: "➞ " },
      { t: "zona", v: "Lioneye's Watch", cidade: true },
    ]);
    const costa = ROTA.passos[3].pedacos[1];
    expect(costa).toMatchObject({ t: "zona", v: "The Coast" });
    expect(costa.nivel).toBe(nivelMinimoDaZona(Data.Areas["1_1_2"].level));
    expect(ROTA.passos[2].pedacos[1]).toEqual({ t: "quest", v: "Enemy at the Gate (Tarkleigh)" });
    expect(ROTA.passos[4].pedacos[1]).toEqual({ t: "marco", v: "Waypoint" });
  });

  it("viagens por waypoint, logout e portal dizem o destino", () => {
    const viagens = ROTA.passos.flatMap((p) => p.pedacos.filter((x) => x.t === "viagem").map((x) => x.v));
    expect(viagens).toContain("Waypoint ➞ The Coast");
    expect(viagens).toContain("Logout ➞ Lioneye's Watch");
    expect(viagens.some((v) => v.startsWith("Portal ➞ "))).toBe(true);
    // Voltar pra um ato anterior avisa o ato.
    expect(viagens).toContain("Waypoint ➞ The Sarn Encampment (ato 3)");
  });

  it("as dicas do passo vêm separadas, com as setas de direção", () => {
    const comDica = ROTA.passos.filter((p) => p.dicas.length > 0);
    expect(comDica.length).toBeGreaterThan(50);
    const setas = ROTA.passos.flatMap((p) => p.dicas.flat().filter((x) => x.t === "seta"));
    expect(setas.length).toBeGreaterThan(10);
    for (const seta of setas) {
      expect(seta.dir).toBeGreaterThanOrEqual(0);
      expect(seta.dir).toBeLessThan(8);
    }
  });

  it("os três labirintos da campanha estão na rota", () => {
    const marcos = ROTA.passos.flatMap((p) => p.pedacos.filter((x) => x.t === "marco").map((x) => x.v));
    expect(marcos.filter((m) => m.startsWith("Labirinto normal"))).toHaveLength(1);
    expect(marcos.filter((m) => m.startsWith("Labirinto cruel"))).toHaveLength(1);
    expect(marcos.filter((m) => m.startsWith("Labirinto impiedoso"))).toHaveLength(1);
    expect(marcos.filter((m) => m === "Trial of Ascendancy").length).toBeGreaterThanOrEqual(6);
  });
});

describe("gemas encaixadas na rota", () => {
  it("recompensa de quest: Ground Slam com o Tarkleigh, logo ao chegar na cidade", () => {
    const passo = ROTA.passos[2];
    expect(passo.gemas).toEqual([
      {
        gem_id: id("Ground Slam"),
        nome: "Ground Slam",
        cor: "strength",
        suporte: false,
        nivel_req: 1,
        tipo: "quest",
        npc: "Tarkleigh",
        quest: "Enemy at the Gate",
        custo: null,
        quantidade: 1,
        nota: "Level 1 - 4",
      },
    ]);
    expect(ROTA.onde_pegar[id("Ground Slam")]).toEqual({
      tipo: "recompensa_quest",
      quest: "Enemy at the Gate",
      npc: "Tarkleigh",
      ato: 1,
      passo_rota: 2,
      custo: null,
    });
  });

  it("vendedor: Frostblink com a Nessa, depois de Breaking Some Eggs, por um Scroll of Wisdom", () => {
    const passo = passoCom(ROTA, "Hand in Breaking Some Eggs");
    expect(passo.gemas).toHaveLength(1);
    expect(passo.gemas[0]).toMatchObject({
      nome: "Frostblink",
      tipo: "vendedor",
      npc: "Nessa",
      custo: "Scroll of Wisdom",
      quantidade: 1,
    });
    expect(ROTA.onde_pegar[id("Frostblink")]).toMatchObject({
      tipo: "vendedor_quest",
      npc: "Nessa",
      ato: 1,
      passo_rota: passo.indice,
      custo: "Scroll of Wisdom",
    });
  });

  it("a gema com que a classe começa é 'inicial'", () => {
    // O Marauder começa com Heavy Strike e acha Ruthless no baú da praia.
    expect(ROTA.onde_pegar[id("Ruthless Support")]).toEqual({
      tipo: "inicial",
      quest: null,
      npc: null,
      ato: 1,
      passo_rota: 0,
      custo: null,
    });
    expect(ROTA.passos.some((p) => p.gemas.some((g) => g.nome === "Ruthless Support"))).toBe(false);
  });

  it("gema pedida 2 vezes: uma da quest e a outra comprada no mesmo passo", () => {
    const passo = passoCom(ROTA, "Hand in The Caged Brute (Nessa)");
    const faster = passo.gemas.filter((g) => g.nome === "Faster Attacks Support");
    expect(faster.map((g) => [g.tipo, g.quantidade, g.custo])).toEqual([
      ["quest", 1, null],
      ["vendedor", 1, "Orb of Transmutation"],
    ]);
  });

  it("todas as gemas do plano têm onde pegar, cada uma num passo que existe", () => {
    expect(Object.keys(ROTA.onde_pegar).sort()).toEqual(GEMAS.map((g) => g.gem_id).sort());
    for (const [gemId, onde] of Object.entries(ROTA.onde_pegar)) {
      expect(onde.tipo, gemId).not.toBe("sem_fonte");
      expect(onde.passo_rota, gemId).not.toBeNull();
      expect(ROTA.passos[onde.passo_rota as number].ato, gemId).toBe(onde.ato);
    }
  });

  it("nenhuma gema aparece antes da quest que a libera", () => {
    for (const p of ROTA.passos) {
      for (const g of p.gemas) {
        expect(textoDoPasso(p), `${g.nome} no passo ${p.indice}`).toContain(g.quest);
        expect(g.npc, `${g.nome} no passo ${p.indice}`).not.toBe("");
      }
    }
  });

  it("3.30: Arcane Link é recompensa do Scion e compra do Templar em Breaking the Seal, por Alchemy", () => {
    const pedido = [{ gem_id: ARCANE_LINK, quantidade: 1, nota: "" }];
    const scion = montarRota({ classe: "Scion", bandido: "None" }, pedido);
    expect(scion.onde_pegar[ARCANE_LINK]).toMatchObject({ tipo: "recompensa_quest", quest: "Breaking the Seal", ato: 4 });
    const templar = montarRota({ classe: "Templar", bandido: "None" }, pedido);
    expect(templar.onde_pegar[ARCANE_LINK]).toMatchObject({
      tipo: "vendedor_quest",
      npc: "Petarus and Vanja",
      ato: 4,
      custo: "Orb of Alchemy",
    });
    // A Witch não compra no ato 4: só com a Lilly Roth, no ato 6.
    const witch = montarRota({ classe: "Witch", bandido: "None" }, pedido);
    expect(witch.onde_pegar[ARCANE_LINK]).toMatchObject({ npc: "Lilly Roth", ato: 6 });
  });

  it("outra classe pega as mesmas gemas em outros lugares (Siosa, no ato 3)", () => {
    const witch = montarRota({ classe: "Witch", bandido: "None" }, GEMAS);
    expect(witch.avisos).toEqual([]);
    expect(witch.onde_pegar[id("Frostblink")]).toMatchObject({ tipo: "recompensa_quest", npc: "Tarkleigh" });
    expect(witch.onde_pegar[id("Ground Slam")]).toMatchObject({
      tipo: "siosa",
      quest: "A Fixture of Fate",
      npc: "Siosa",
      ato: 3,
      custo: "Scroll of Wisdom",
    });
    expect(witch.onde_pegar[id("Sunder")]).toMatchObject({ tipo: "siosa", custo: "Orb of Transmutation" });
  });

  it("sem a quest da biblioteca não existe Siosa", () => {
    const witch = montarRota({ classe: "Witch", bandido: "None" }, GEMAS, { liga_nova: true, biblioteca: false });
    const fontes = Object.values(witch.onde_pegar).map((o) => o.tipo);
    expect(fontes).not.toContain("siosa");
    expect(witch.passos.some((p) => textoDoPasso(p).includes("A Fixture of Fate"))).toBe(false);
  });

  it("classe que não está nos dados: a rota vem sem gemas e com aviso", () => {
    const nova = montarRota({ classe: "Classe Nova", bandido: "None" }, GEMAS);
    expect(nova.passos.length).toBe(ROTA.passos.length);
    expect(nova.passos.every((p) => p.gemas.length === 0)).toBe(true);
    expect(nova.avisos).toEqual([
      'Não reconheci a classe "Classe Nova": a rota aparece sem as gemas encaixadas nas quests.',
    ]);
    expect(Object.values(nova.onde_pegar).every((o) => o.tipo === "sem_fonte")).toBe(true);
    // Sem gemas não há o que avisar.
    expect(montarRota({ classe: "Classe Nova", bandido: "None" }, []).avisos).toEqual([]);
  });

  it("gema repetida ou desconhecida na lista não quebra nem duplica", () => {
    const lista = [
      { gem_id: id("Ground Slam"), quantidade: 1, nota: "a" },
      { gem_id: id("Ground Slam"), quantidade: 1, nota: "b" },
      { gem_id: "SkillGemQueNaoExiste", quantidade: 1, nota: "c" },
      { gem_id: id("Frostblink"), quantidade: 0, nota: "d" },
    ];
    const rota = montarRota({ classe: "Marauder", bandido: "None" }, lista);
    expect(Object.keys(rota.onde_pegar).sort()).toEqual([id("Frostblink"), id("Ground Slam")].sort());
    const todas = rota.passos.flatMap((p) => p.gemas);
    expect(todas.map((g) => [g.nome, g.nota, g.quantidade])).toEqual([
      ["Ground Slam", "a", 1],
      ["Frostblink", "d", 1],
    ]);
  });

  it("sem gemas a rota é a mesma, só sem as gemas", () => {
    const limpa = montarRota({ classe: "Marauder", bandido: "None" }, []);
    expect(limpa.passos.map(textoDoPasso)).toEqual(ROTA.passos.map(textoDoPasso));
    expect(limpa.bordas).toEqual(ROTA.bordas);
    expect(limpa.onde_pegar).toEqual({});
  });
});

describe("opções da rota", () => {
  const dosBandidos = (rota: Rota) =>
    rota.passos.map(textoDoPasso).filter((t) => /Alira|Kraityn|Oak/.test(t) && /Kill|kill|Help|help/.test(t));

  it("matar os três bandidos (2 pontos de passiva)", () => {
    const textos = dosBandidos(ROTA);
    expect(textos.some((t) => t.includes("Kill Kraityn"))).toBe(true);
    expect(textos.some((t) => t.includes("kill Oak"))).toBe(true);
    expect(textos.some((t) => t.includes("Kill Alira"))).toBe(true);
    expect(textos.some((t) => /[Hh]elp/.test(t))).toBe(false);
  });

  it("ajudar um bandido troca o passo dele e encurta a rota", () => {
    for (const bandido of ["Alira", "Kraityn", "Oak"] as const) {
      const rota = montarRota({ classe: "Marauder", bandido }, []);
      const textos = dosBandidos(rota);
      expect(textos.filter((t) => /[Hh]elp/.test(t)), bandido).toHaveLength(1);
      expect(textos.find((t) => /[Hh]elp/.test(t)), bandido).toContain(bandido);
      expect(textos.find((t) => /[Hh]elp/.test(t)), bandido).toContain("The Apex");
      expect(rota.passos.length, bandido).toBeLessThan(ROTA.passos.length);
    }
  });

  it("sem 'começo de liga' e sem biblioteca a rota tem menos passos", () => {
    const base = { classe: "Marauder", bandido: "None" as const };
    const semLiga = montarRota(base, [], { liga_nova: false, biblioteca: true });
    const semBiblioteca = montarRota(base, [], { liga_nova: true, biblioteca: false });
    expect(semLiga.passos.length).toBeLessThan(ROTA.passos.length);
    expect(semBiblioteca.passos.length).toBeLessThan(ROTA.passos.length);
    for (const rota of [semLiga, semBiblioteca]) {
      expect(Object.keys(rota.inicio_do_ato)).toHaveLength(10);
      expect(rota.bordas[0]).toBe("1_1_1");
      expect(rota.bordas[rota.bordas.length - 1]).toBe("2_11_endgame_town");
    }
  });
});

describe("tabelas", () => {
  it("custo da gema no vendedor pelo nível que ela exige", () => {
    const casos: [number, string][] = [
      [1, "Scroll of Wisdom"],
      [7, "Scroll of Wisdom"],
      [8, "Orb of Transmutation"],
      [15, "Orb of Transmutation"],
      [16, "Orb of Alteration"],
      [27, "Orb of Alteration"],
      [28, "Orb of Alteration"],
      [33, "Orb of Alteration"],
      [34, "Orb of Alchemy"],
      [37, "Orb of Alchemy"],
      [38, "Orb of Alchemy"],
      [72, "Orb of Alchemy"],
    ];
    for (const [nivel, moeda] of casos) expect(custoDaGema(nivel), `nível ${nivel}`).toBe(moeda);
  });

  it("nível mínimo pra não perder experiência na zona", () => {
    expect(nivelMinimoDaZona(1)).toBe(1);
    expect(nivelMinimoDaZona(4)).toBe(1);
    expect(nivelMinimoDaZona(13)).toBe(10);
    expect(nivelMinimoDaZona(16)).toBe(12);
    expect(nivelMinimoDaZona(33)).toBe(28);
    expect(nivelMinimoDaZona(68)).toBe(61);
  });

  it("ato e nome de uma zona", () => {
    expect(atoDaZona("1_1_town")).toBe(1);
    expect(atoDaZona("1_4_town")).toBe(4);
    expect(atoDaZona("2_10_town")).toBe(10);
    expect(atoDaZona("zona_que_nao_existe")).toBeNull();
    expect(nomeDaZona("1_1_town")).toBe("Lioneye's Watch");
    expect(nomeDaZona("1_1_2")).toBe("The Coast");
    expect(nomeDaZona("zona_que_nao_existe")).toBe("zona_que_nao_existe");
  });
});
