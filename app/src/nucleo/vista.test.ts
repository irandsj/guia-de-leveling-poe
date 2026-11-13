import { describe, expect, it } from "vitest";

import { chaveDaGema, gemasNecessarias } from "./plano";
import { type GemaDoPasso, montarRota, type Passo, type Rota } from "./rota";
import { PLANO, ROTA, textoDoPasso } from "./teste/rota-de-exemplo";
import {
  chaveDaMarca,
  comoPegar,
  comprasQueFicaram,
  gemasDoAto,
  linkDaGema,
  moedasDoAto,
  nomeCurtoDaMoeda,
  proximaParada,
  gemasQueSairam,
  gruposDoConjunto,
  itensEmLinha,
  itensQueMudam,
  linhasDeItens,
  nomeCurtoDoItem,
  passoEquivalente,
  passosAVista,
  posicaoNoAto,
  resumoDoPlano,
} from "./vista";

const ULTIMO = ROTA.passos.length - 1;

describe("posição do passo no ato", () => {
  it("conta a partir de 1 dentro do ato", () => {
    const ato2 = ROTA.inicio_do_ato[2];
    const ato3 = ROTA.inicio_do_ato[3];
    expect(posicaoNoAto(ROTA, 0)).toEqual({ ato: 1, numero: 1, total: ato2 });
    expect(posicaoNoAto(ROTA, ato2 - 1)).toEqual({ ato: 1, numero: ato2, total: ato2 });
    expect(posicaoNoAto(ROTA, ato2)).toEqual({ ato: 2, numero: 1, total: ato3 - ato2 });
    const fim = posicaoNoAto(ROTA, ULTIMO);
    expect(fim.ato).toBe(10);
    expect(fim.numero).toBe(fim.total);
  });

  it("passo fora da rota fica na ponta", () => {
    expect(posicaoNoAto(ROTA, -5)).toEqual(posicaoNoAto(ROTA, 0));
    expect(posicaoNoAto(ROTA, 99999)).toEqual(posicaoNoAto(ROTA, ULTIMO));
  });

  it("mostra o passo atual e os seguintes, sem passar do fim", () => {
    expect(passosAVista(ROTA, 0, 2).map((p) => p.indice)).toEqual([0, 1, 2]);
    expect(passosAVista(ROTA, 7, 0).map((p) => p.indice)).toEqual([7]);
    expect(passosAVista(ROTA, ULTIMO - 1, 2).map((p) => p.indice)).toEqual([ULTIMO - 1, ULTIMO]);
    expect(passosAVista(ROTA, ULTIMO, 2).map((p) => p.indice)).toEqual([ULTIMO]);
  });
});

describe("gemas do ato", () => {
  it("lista do passo atual até o fim do ato, na ordem", () => {
    const lista = gemasDoAto(ROTA, 0);
    expect(lista.length).toBeGreaterThan(0);
    const esperado = ROTA.passos.filter((p) => p.ato === 1 && p.gemas.length > 0).map((p) => p.indice);
    expect(lista.map((g) => g.passo)).toEqual(esperado);
    for (const grupo of lista) {
      expect(grupo.faltam).toBe(grupo.passo);
      expect(grupo.gemas).toBe(ROTA.passos[grupo.passo].gemas);
    }
  });

  it("o que ficou pra trás não aparece", () => {
    const todas = gemasDoAto(ROTA, 0);
    const meio = todas[1].passo;
    const depois = gemasDoAto(ROTA, meio);
    expect(depois.map((g) => g.passo)).toEqual(todas.slice(1).map((g) => g.passo));
    expect(depois[0].faltam).toBe(0);
    const passou = gemasDoAto(ROTA, meio + 1);
    expect(passou.map((g) => g.passo)).toEqual(todas.slice(2).map((g) => g.passo));
  });

  it("não mistura com o ato seguinte", () => {
    const ato2 = ROTA.inicio_do_ato[2];
    for (const grupo of gemasDoAto(ROTA, ato2 - 1)) expect(ROTA.passos[grupo.passo].ato).toBe(1);
    for (const grupo of gemasDoAto(ROTA, ato2)) expect(ROTA.passos[grupo.passo].ato).toBe(2);
  });

  it("diz como se consegue cada gema", () => {
    const todas = ROTA.passos.flatMap((p) => p.gemas);
    const deQuest = todas.find((g) => g.tipo === "quest");
    const deVendedor = todas.find((g) => g.tipo === "vendedor" && g.custo !== null);
    expect(deQuest).toBeDefined();
    expect(deVendedor).toBeDefined();
    expect(comoPegar(deQuest!)).toBe(`recompensa · ${deQuest!.npc}`);
    expect(comoPegar(deVendedor!)).toBe(`comprar · ${deVendedor!.npc} · ${deVendedor!.custo}`);
    expect(comoPegar({ ...deVendedor!, custo: null })).toBe(`comprar · ${deVendedor!.npc}`);
  });
});

describe("conjunto de gemas", () => {
  const etapas = PLANO.gemas.etapas;

  it("o primeiro conjunto não tem gema nova", () => {
    const grupos = gruposDoConjunto(etapas[0]);
    expect(grupos.length).toBeGreaterThan(0);
    expect(grupos.flatMap((g) => g.gemas).some((g) => g.nova)).toBe(false);
  });

  it("marca as gemas que entraram em relação ao conjunto anterior", () => {
    for (const etapa of etapas.slice(1)) {
      const marcadas = gruposDoConjunto(etapa)
        .flatMap((g) => g.gemas)
        .filter((g) => g.nova)
        .map((g) => chaveDaGema(g));
      expect(new Set(marcadas), etapa.titulo).toEqual(new Set(etapa.mudancas.novas));
    }
    expect(etapas.slice(1).some((e) => e.mudancas.novas.length > 0)).toBe(true);
  });

  it("guarda o rótulo e o grupo principal", () => {
    const etapa = etapas[1];
    const grupos = gruposDoConjunto(etapa);
    const comGemas = etapa.grupos.filter((g) => g.gemas.length > 0 || g.rotulo.trim() !== "");
    expect(grupos.map((g) => g.rotulo)).toEqual(comGemas.map((g) => g.rotulo));
    expect(grupos.map((g) => g.principal)).toEqual(comGemas.map((g) => g.principal));
  });

  it("dá o nome das gemas que saíram", () => {
    const comSaida = etapas.find((e) => e.mudancas.sairam.length > 0);
    expect(comSaida).toBeDefined();
    const nomes = gemasQueSairam(PLANO, comSaida!);
    expect(nomes).toHaveLength(comSaida!.mudancas.sairam.length);
    for (const nome of nomes) {
      expect(nome).not.toMatch(/^Metadata\//);
      expect(nome.length).toBeGreaterThan(2);
    }
    expect(gemasQueSairam(PLANO, etapas[0])).toEqual([]);
  });
});

describe("passo equivalente quando a rota muda", () => {
  const gemas = gemasNecessarias(PLANO);
  const build = { classe: "Marauder", bandido: "None" } as const;

  it("a mesma rota devolve o mesmo passo", () => {
    for (const passo of [0, 1, 40, 41, 200, ULTIMO]) {
      expect(passoEquivalente(ROTA, ROTA, passo)).toBe(passo);
    }
  });

  it("acha o mesmo passo (mesmo ato, zona e texto) na rota com outra opção", () => {
    for (const opcoes of [
      { liga_nova: false, biblioteca: true },
      { liga_nova: true, biblioteca: false },
      { liga_nova: false, biblioteca: false },
    ]) {
      const outra = montarRota(build, gemas, opcoes);
      let iguais = 0;
      for (const velho of ROTA.passos) {
        const novo = outra.passos[passoEquivalente(ROTA, outra, velho.indice)];
        expect(novo.ato, `passo ${velho.indice}`).toBe(velho.ato);
        const existe = outra.passos.some(
          (p) => p.ato === velho.ato && p.zona === velho.zona && textoDoPasso(p) === textoDoPasso(velho),
        );
        if (existe) {
          expect(textoDoPasso(novo), `passo ${velho.indice}`).toBe(textoDoPasso(velho));
          expect(novo.zona).toBe(velho.zona);
          iguais++;
        }
      }
      // A grande maioria dos passos existe nas duas rotas.
      expect(iguais).toBeGreaterThan(ROTA.passos.length * 0.8);
      // E a volta também funciona.
      for (const velho of outra.passos) {
        const novo = ROTA.passos[passoEquivalente(outra, ROTA, velho.indice)];
        expect(novo.ato).toBe(velho.ato);
      }
    }
  });

  it("um passo que só existe com a opção ligada cai num passo vizinho do mesmo ato", () => {
    const semBiblioteca = montarRota(build, gemas, { liga_nova: true, biblioteca: false });
    const soNaPadrao = ROTA.passos.filter(
      (velho) => !semBiblioteca.passos.some((p) => p.ato === velho.ato && textoDoPasso(p) === textoDoPasso(velho)),
    );
    expect(soNaPadrao.length).toBeGreaterThan(0);
    for (const velho of soNaPadrao) {
      const novo = semBiblioteca.passos[passoEquivalente(ROTA, semBiblioteca, velho.indice)];
      expect(novo.ato).toBe(velho.ato);
      // Não joga o jogador pro outro lado do ato.
      const posVelha = posicaoNoAtoDe(ROTA, velho.indice);
      const posNova = posicaoNoAtoDe(semBiblioteca, novo.indice);
      expect(Math.abs(posVelha - posNova)).toBeLessThan(0.25);
    }
  });
});

function posicaoNoAtoDe(rota: typeof ROTA, passo: number): number {
  const p = posicaoNoAto(rota, passo);
  return (p.numero - 1) / Math.max(1, p.total);
}

describe("resumo do plano", () => {
  it("diz a classe e quantos conjuntos e árvores vieram", () => {
    const texto = resumoDoPlano(PLANO);
    expect(texto).toContain("Marauder");
    expect(texto).toContain(`${PLANO.gemas.etapas.length} conjuntos de gemas`);
    expect(texto).not.toContain("bandido");
    const comBandido = resumoDoPlano({
      ...PLANO,
      personagem: { ...PLANO.personagem, bandido: "Alira", ascendencia: null },
      gemas: { ...PLANO.gemas, etapas: PLANO.gemas.etapas.slice(0, 1) },
    });
    expect(comBandido).toContain("1 conjunto de gemas");
    expect(comBandido).toContain("bandido: Alira");
    expect(comBandido.startsWith("Marauder ·")).toBe(true);
  });
});

describe("cartão da próxima gema e moedas a guardar", () => {
  it("a próxima parada é o primeiro passo com gema dali pra frente, mesmo em outro ato", () => {
    const primeira = ROTA.passos.find((p) => p.gemas.length > 0)!;
    const parada = proximaParada(ROTA, 0)!;
    expect(parada).toMatchObject({ passo: primeira.indice, faltam: primeira.indice });
    expect(parada.gemas.slice(0, primeira.gemas.length)).toEqual(primeira.gemas);
    expect(proximaParada(ROTA, primeira.indice)?.faltam).toBe(0);
    const fimDoAto1 = ROTA.inicio_do_ato[2] - 1;
    const depois = proximaParada(ROTA, fimDoAto1);
    const esperado = ROTA.passos.find((p) => p.indice >= fimDoAto1 && p.gemas.length > 0);
    expect(depois?.passo).toBe(esperado?.indice);
    const ultimoComGema = [...ROTA.passos].reverse().find((p) => p.gemas.length > 0)!;
    expect(proximaParada(ROTA, ultimoComGema.indice + 1)).toBeNull();
  });

  it("junta as gemas da mesma ida à cidade e lembra das compras que ficaram pra trás", () => {
    // Como no ato 1 do Ranger: Breaking Some Eggs e Mercy Mission entregues na mesma visita.
    const gema = (nome: string, tipo: "quest" | "vendedor"): GemaDoPasso => ({
      gem_id: `Metadata/Items/Gems/${nome.replace(/\W/g, "")}`,
      nome,
      cor: "dexterity",
      suporte: nome.endsWith("Support"),
      nivel_req: 4,
      tipo,
      npc: "Nessa",
      quest: "",
      custo: tipo === "vendedor" ? "Orb of Transmutation" : null,
      quantidade: 1,
      nota: "",
    });
    const passo = (indice: number, zona: string, gemas: GemaDoPasso[] = []): Passo => ({
      indice,
      ato: 1,
      pedacos: [],
      dicas: [],
      borda: null,
      termina_em_troca: false,
      zona,
      zona_depois: zona,
      gemas,
    });
    const rota = {
      ...ROTA,
      inicio_do_ato: { 1: 0 },
      passos: [
        passo(0, "costa"),
        passo(1, "cidade", [gema("Sniper's Mark", "quest"), gema("Frostblink", "vendedor")]),
        passo(2, "cidade", [gema("Volley Support", "quest"), gema("Chance to Poison Support", "vendedor")]),
        passo(3, "cidade"),
        passo(4, "passagem"),
        passo(5, "cidade", [gema("Faster Attacks Support", "quest")]),
      ],
    } as Rota;
    expect(proximaParada(rota, 0)?.gemas.map((g) => g.nome)).toEqual([
      "Sniper's Mark",
      "Frostblink",
      "Volley Support",
      "Chance to Poison Support",
    ]);
    expect(comprasQueFicaram(rota, 0)).toEqual([]);
    // Ainda na cidade, depois do primeiro passo: o resto aparece, e o que passou vira lembrete.
    expect(proximaParada(rota, 2)?.gemas.map((g) => g.nome)).toEqual(["Volley Support", "Chance to Poison Support"]);
    expect(comprasQueFicaram(rota, 2).map((g) => g.nome)).toEqual(["Frostblink"]);
    // Saiu da cidade: lembra das compras da visita inteira até a próxima parada.
    expect(comprasQueFicaram(rota, 4).map((g) => g.nome)).toEqual(["Frostblink", "Chance to Poison Support"]);
    expect(comprasQueFicaram(rota, 5).map((g) => g.nome)).toEqual(["Frostblink", "Chance to Poison Support"]);

    // Marcou como comprada: some da lista do que ficou pra trás e das moedas.
    const frostblink = chaveDaMarca(rota.passos[1].gemas[1]);
    expect(frostblink).toBe("vendedor:Metadata/Items/Gems/Frostblink");
    expect(comprasQueFicaram(rota, 4, [frostblink]).map((g) => g.nome)).toEqual(["Chance to Poison Support"]);
    expect(moedasDoAto(rota, 0, [frostblink])).toEqual([{ nome: "Transmutation", quantidade: 1 }]);
    // Na parada, as marcadas vão pro fim; parada toda marcada fica pra trás.
    const sniper = chaveDaMarca(rota.passos[1].gemas[0]);
    expect(proximaParada(rota, 0, [sniper])?.gemas.map((g) => g.nome)).toEqual([
      "Frostblink",
      "Volley Support",
      "Chance to Poison Support",
      "Sniper's Mark",
    ]);
    const tudo = rota.passos.slice(1, 3).flatMap((p) => p.gemas.map(chaveDaMarca));
    expect(proximaParada(rota, 0, tudo)).toMatchObject({ passo: 5, faltam: 5 });
  });

  it("soma as moedas das gemas compradas no resto do ato", () => {
    const moedas = moedasDoAto(ROTA, 0);
    let esperado = 0;
    for (const p of ROTA.passos.filter((p) => p.ato === 1)) {
      for (const g of p.gemas) if (g.tipo === "vendedor" && g.custo) esperado += Math.max(1, g.quantidade);
    }
    expect(moedas.reduce((s, m) => s + m.quantidade, 0)).toBe(esperado);
    expect(esperado).toBeGreaterThan(0);
    expect(moedas.every((m) => !m.nome.startsWith("Orb of "))).toBe(true);
    // No fim da rota não falta comprar nada.
    expect(moedasDoAto(ROTA, ULTIMO)).toEqual([]);
  });

  it("diz pra qual link da build a gema serve", () => {
    const id = (nome: string) => {
      for (const e of PLANO.gemas.etapas) for (const g of e.grupos) for (const x of g.gemas) if (x.nome === nome) return x.gem_id!;
      throw new Error(nome);
    };
    // Rótulo do PoB.
    expect(linkDaGema(PLANO, { gem_id: id("Faster Attacks Support"), nota: "Level 4 - 12" })).toBe("Leap Slam @ lvl 10");
    // Sem rótulo: o suporte diz de quem é; a habilidade sozinha não ganha texto repetido.
    expect(linkDaGema(PLANO, { gem_id: id("Ruthless Support"), nota: "Level 1 - 4" })).toBe("link do Ground Slam");
    expect(linkDaGema(PLANO, { gem_id: id("Ground Slam"), nota: "Level 1 - 4" })).toBeNull();
    // Rótulo com enfeite e longo.
    const plano = structuredClone(PLANO);
    plano.gemas.etapas[0].grupos[0].rotulo = "==== 4L FF Utility Spectres *** 1x Perf Guardian Turtle ====";
    expect(linkDaGema(plano, { gem_id: id("Ground Slam"), nota: "Level 1 - 4" })).toBe("4L FF Utility Spectres 1x Per…");
    expect(linkDaGema(PLANO, { gem_id: "Metadata/Items/Gems/Nada", nota: "Level 1 - 4" })).toBeNull();
  });

  it("nome curto da moeda", () => {
    expect(nomeCurtoDaMoeda("Orb of Transmutation")).toBe("Transmutation");
    expect(nomeCurtoDaMoeda("Scroll of Wisdom")).toBe("Scroll of Wisdom");
  });
});

describe("itens do conjunto", () => {
  const item = (espaco: string, nome: string, raridade = "NORMAL", base = "") => ({
    espaco,
    nome,
    base,
    raridade,
    nivel_req: null,
  });

  it("um espaço por linha, na ordem do personagem; anéis e frascos juntos", () => {
    const linhas = linhasDeItens([
      item("Flask 5", "Quicksilver Flask"),
      item("Belt", "Rustic Sash"),
      item("Weapon 1", "Corroded Blade"),
      item("Amulet", "Lapis Amulet"),
      item("Ring 1", "Iron Ring"),
      item("Ring 2", "Iron Ring"),
      item("Flask 1", "Life Flask"),
      item("Gloves", "Asenath's Gentle Touch", "UNIQUE", "Silk Gloves"),
    ]);
    expect(linhas.map((l) => [l.espaco, l.itens.map((i) => `${i.nome}×${i.quantidade}`).join(", ")])).toEqual([
      ["Main hand", "Corroded Blade×1"],
      ["Gloves", "Asenath's Gentle Touch×1"],
      ["Amulet", "Lapis Amulet×1"],
      ["Rings", "Iron Ring×2"],
      ["Belt", "Rustic Sash×1"],
      ["Flasks", "Life Flask×1, Quicksilver Flask×1"],
    ]);
    expect(linhas[1].itens[0]).toMatchObject({ base: "Silk Gloves", raridade: "UNIQUE" });
  });

  it("o que muda no próximo conjunto: só os espaços diferentes", () => {
    const atual = [item("Weapon 1", "Corroded Blade"), item("Belt", "Rustic Sash"), item("Ring 1", "Iron Ring")];
    const proximo = [
      item("Belt", "Perandus Blazon", "UNIQUE"),
      item("Ring 1", "Iron Ring"),
      item("Body Armour", "Random 5L Evasion Chest", "RARE"),
    ];
    expect(itensQueMudam(atual, proximo).map((l) => [l.espaco, l.itens[0].nome])).toEqual([
      ["Body", "Random 5L Evasion Chest"],
      ["Belt", "Perandus Blazon"],
    ]);
    expect(itensQueMudam(proximo, proximo)).toEqual([]);
  });
});

describe('raro com o nome padrão do PoB ("New Item")', () => {
  const raro = (espaco: string, base: string, nome = "New Item") => ({ espaco, nome, base, raridade: "RARE", nivel_req: null });

  it("mostra a base no lugar do nome, e não junta bases diferentes", () => {
    const linhas = linhasDeItens([
      raro("Weapon 1", "Quartz Wand"),
      raro("Weapon 2", "Quartz Wand"),
      raro("Helmet", "Sallet"),
      raro("Ring 1", "Two-Stone Ring"),
      raro("Ring 2", "Two-Stone Ring"),
      raro("Body Armour", "Vaal Regalia", "Doom Song"),
    ]);
    expect(linhas.map((l) => [l.espaco, l.itens.map((i) => `${i.nome}×${i.quantidade}`).join(", ")])).toEqual([
      ["Main hand", "Quartz Wand×1"],
      ["Off hand", "Quartz Wand×1"],
      ["Helmet", "Sallet×1"],
      ["Body", "Doom Song×1"],
      ["Rings", "Two-Stone Ring×2"],
    ]);
    expect(linhas[0].itens[0].base).toBeNull();
    expect(linhas[3].itens[0].base).toBe("Vaal Regalia");
    expect(itensEmLinha(linhas).map((i) => `${i.nome}×${i.quantidade}`)).toEqual([
      "Quartz Wand×2",
      "Sallet×1",
      "Doom Song×1",
      "Two-Stone Ring×2",
    ]);
  });
});

describe("faixa de itens", () => {
  const item = (espaco: string, nome: string, raridade = "NORMAL") => ({ espaco, nome, base: "", raridade, nivel_req: null });

  it("frasco mágico fica só com a base; o resto, como o PoB escreveu", () => {
    expect(nomeCurtoDoItem({ nome: "Concentrated Divine Life Flask of Warding", raridade: "MAGIC" })).toBe(
      "Divine Life Flask",
    );
    expect(nomeCurtoDoItem({ nome: "Alchemist's Quartz Flask of Incision", raridade: "MAGIC" })).toBe("Quartz Flask");
    expect(nomeCurtoDoItem({ nome: "Divine Life Flask of Warding", raridade: "MAGIC" })).toBe("Divine Life Flask");
    expect(nomeCurtoDoItem({ nome: "Quicksilver Flask", raridade: "NORMAL" })).toBe("Quicksilver Flask");
    expect(nomeCurtoDoItem({ nome: "Seething Stormrider Boots of the Fox", raridade: "MAGIC" })).toBe(
      "Seething Stormrider Boots of the Fox",
    );
    expect(nomeCurtoDoItem({ nome: "Carrion Jack", raridade: "RARE" })).toBe("Carrion Jack");
  });

  it("numa linha só, na ordem do personagem, juntando os repetidos", () => {
    const linhas = linhasDeItens([
      item("Flask 5", "Quicksilver Flask"),
      item("Belt", "Rustic Sash"),
      item("Weapon 1", "Corroded Blade"),
      item("Ring 1", "Iron Ring"),
      item("Ring 2", "Iron Ring"),
      item("Flask 1", "Concentrated Divine Life Flask of Warding", "MAGIC"),
      item("Flask 2", "Seething Divine Life Flask of Staunching", "MAGIC"),
    ]);
    expect(itensEmLinha(linhas).map((i) => `${i.nome}×${i.quantidade}`)).toEqual([
      "Corroded Blade×1",
      "Iron Ring×2",
      "Rustic Sash×1",
      "Divine Life Flask×2",
      "Quicksilver Flask×1",
    ]);
  });
});
