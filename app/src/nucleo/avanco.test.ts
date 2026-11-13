import { describe, expect, it } from "vitest";

import {
  aoChegarNaZona,
  aoChegarPeloNome,
  bordaDoPasso,
  ehCidade,
  ehCidadePeloNome,
  inicioDoAto,
  limitarPasso,
  nivelEstimado,
  ressincronizar,
} from "./avanco";
import { nomeDaZona } from "./rota";
import { ROTA } from "./teste/rota-de-exemplo";

const ULTIMO = ROTA.passos.length - 1;

/** Passo que manda entrar numa zona, pra não depender de números da rota de hoje. */
function passoQueVaiPra(zona: string, aPartirDe = 0): number {
  const passo = ROTA.passos.findIndex(
    (p) => p.indice >= aPartirDe && p.borda !== null && p.termina_em_troca && p.zona_depois === zona,
  );
  if (passo < 0) throw new Error(`a rota não vai pra ${zona}`);
  return passo;
}

describe("onde o jogador está na rota", () => {
  it("limitarPasso segura o passo dentro da rota", () => {
    expect(limitarPasso(ROTA, Number.NaN)).toBe(0);
    expect(limitarPasso(ROTA, Number.POSITIVE_INFINITY)).toBe(0);
    expect(limitarPasso(ROTA, -5)).toBe(0);
    expect(limitarPasso(ROTA, 3.7)).toBe(3);
    expect(limitarPasso(ROTA, 99_999)).toBe(ULTIMO);
    expect(limitarPasso(ROTA, ULTIMO)).toBe(ULTIMO);
  });

  it("bordaDoPasso: o passo que manda trocar de zona ainda está na zona de antes", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((p) => bordaDoPasso(ROTA, p))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4]);
  });

  it("bordaDoPasso aponta sempre pra zona em que o passo é feito", () => {
    for (const p of ROTA.passos) {
      expect(ROTA.bordas[bordaDoPasso(ROTA, p.indice)], `passo ${p.indice}`).toBe(p.zona);
    }
  });

  it("cidades", () => {
    expect(ehCidade("1_1_town")).toBe(true);
    expect(ehCidade("2_6_town")).toBe(true);
    expect(ehCidade("1_1_2")).toBe(false);
    expect(ehCidade("zona_que_nao_existe")).toBe(false);
    expect(ehCidadePeloNome("Lioneye's Watch")).toBe(true);
    expect(ehCidadePeloNome("The Coast")).toBe(false);
    expect(ehCidadePeloNome("Vigia de Olho-de-Leão")).toBe(false);
  });
});

describe("avanço automático pela zona", () => {
  it("chegar na zona que o passo pede conclui o passo", () => {
    expect(aoChegarNaZona(ROTA, 1, "1_1_town")).toBe(2);
    expect(aoChegarNaZona(ROTA, 3, "1_1_2")).toBe(4);
    expect(aoChegarNaZona(ROTA, 5, "1_1_3")).toBe(6);
  });

  it("também conclui os passos de antes que ficaram sem marcar", () => {
    // Ainda em "matar o Hillock" e o jogador já chegou na cidade.
    expect(aoChegarNaZona(ROTA, 0, "1_1_town")).toBe(2);
    // Ainda em "entregar a quest" e o jogador já saiu pra praia.
    expect(aoChegarNaZona(ROTA, 2, "1_1_2")).toBe(4);
  });

  it("entrar de novo na zona atual não faz nada", () => {
    expect(aoChegarNaZona(ROTA, 4, "1_1_2")).toBe(4);
    expect(aoChegarNaZona(ROTA, 2, "1_1_town")).toBe(2);
    expect(aoChegarNaZona(ROTA, 13, "1_1_town")).toBe(13);
  });

  it("nunca volta o passo", () => {
    for (let passo = 0; passo <= 60; passo++) {
      for (const zona of new Set(ROTA.bordas.slice(0, 40))) {
        expect(aoChegarNaZona(ROTA, passo, zona), `passo ${passo}, zona ${zona}`).toBeGreaterThanOrEqual(passo);
      }
    }
  });

  it("zona fora da rota ou de trás não mexe no passo", () => {
    expect(aoChegarNaZona(ROTA, 6, "zona_que_nao_existe")).toBe(6);
    expect(aoChegarNaZona(ROTA, 6, "1_1_1")).toBe(6);
    expect(aoChegarNaZona(ROTA, 20, "1_1_3")).toBe(20);
  });

  it("ir à cidade fora de hora não avança", () => {
    // "Get Waypoint" na praia; a rota só volta pra cidade bem depois.
    expect(aoChegarNaZona(ROTA, 4, "1_1_town")).toBe(4);
    expect(aoChegarNaZona(ROTA, 6, "1_1_town")).toBe(6);
  });

  it("pular uma zona nova (cortou caminho ou uma linha se perdeu) é aceito", () => {
    // Do "Get Waypoint" na praia direto pra Submerged Passage, sem o guia ver o Mud Flats.
    expect(aoChegarNaZona(ROTA, 4, "1_1_4_1")).toBe(8);
  });

  it("voltar pra uma zona antiga não é atalho, mesmo que a rota passe por ela de novo", () => {
    // No Mud Flats (passo 6) a rota segue: Submerged Passage e, de waypoint, The Coast.
    // Morreu e voltou andando pela Coast: a Coast está 2 bordas à frente, mas não é avanço.
    expect(ROTA.bordas.slice(3, 6)).toEqual(["1_1_3", "1_1_4_1", "1_1_2"]);
    expect(aoChegarNaZona(ROTA, 6, "1_1_2")).toBe(6);
    expect(aoChegarPeloNome(ROTA, 6, "The Coast")).toBe(6);
    // Voltando pro Mud Flats o guia continua onde estava.
    expect(aoChegarNaZona(ROTA, 6, "1_1_3")).toBe(6);
  });

  it("3 zonas à frente já é longe demais: fica pra tecla de ressincronizar", () => {
    expect(ROTA.bordas[3]).toBe("1_1_3");
    expect(aoChegarNaZona(ROTA, 0, "1_1_3")).toBe(0);
  });

  it("depois de matar o Hailrake, o logout pra cidade conclui os dois passos", () => {
    const hailrake = passoQueVaiPra("1_1_2a") + 1;
    expect(ROTA.passos[hailrake].zona).toBe("1_1_2a");
    const naCidade = aoChegarNaZona(ROTA, hailrake, "1_1_town");
    expect(naCidade).toBe(hailrake + 2);
    expect(ROTA.passos[naCidade].zona).toBe("1_1_town");
  });

  it("troca de ato: do covil da Merveil pra floresta do ato 2", () => {
    const entrar = passoQueVaiPra("1_2_1");
    expect(ROTA.passos[entrar].ato).toBe(2);
    expect(ROTA.passos[entrar - 1].ato).toBe(1);
    const depois = aoChegarNaZona(ROTA, entrar - 1, "1_2_1");
    expect(depois).toBe(entrar + 1);
    expect(ROTA.passos[depois].ato).toBe(2);
  });

  it("pelo nome da zona (volta pra uma zona que já existia)", () => {
    expect(aoChegarPeloNome(ROTA, 0, "Lioneye's Watch")).toBe(2);
    expect(aoChegarPeloNome(ROTA, 2, "The Coast")).toBe(4);
    expect(aoChegarPeloNome(ROTA, 4, "The Coast")).toBe(4);
    expect(aoChegarPeloNome(ROTA, 4, "Lioneye's Watch")).toBe(4);
    expect(aoChegarPeloNome(ROTA, 4, "The Submerged Passage")).toBe(8);
    // Cliente em português: o nome não casa e o guia espera a linha com o id.
    expect(aoChegarPeloNome(ROTA, 2, "A Costa")).toBe(2);
  });

  it("a campanha inteira, zona por zona, sem apertar tecla nenhuma", () => {
    let passo = 0;
    for (let borda = 1; borda < ROTA.bordas.length; borda++) {
      const antes = passo;
      passo = aoChegarNaZona(ROTA, passo, ROTA.bordas[borda]);
      expect(passo, `borda ${borda}`).toBeGreaterThanOrEqual(antes);

      const atual = ROTA.passos[passo];
      // O único caso em que a conta fica uma borda à frente: o passo é "➞ zona, faça algo"
      // (não termina trocando de zona) e o jogador ainda está a caminho.
      const aCaminho = atual.borda === borda + 1 && !atual.termina_em_troca;
      expect(bordaDoPasso(ROTA, passo), `borda ${borda}, passo ${passo}`).toBe(aCaminho ? borda + 1 : borda);
      expect(passo, `borda ${borda}`).toBeGreaterThanOrEqual(ROTA.passo_da_borda[borda]);
    }
    // Chegou em Oriath: sobram só os passos da última cidade.
    expect(ROTA.passos[passo].zona).toBe("2_11_endgame_town");
    expect(ULTIMO - passo).toBeLessThan(6);
  });

  it("a campanha inteira só pelos nomes das zonas (cliente em inglês)", () => {
    let passo = 0;
    for (let borda = 1; borda < ROTA.bordas.length; borda++) {
      passo = aoChegarPeloNome(ROTA, passo, nomeDaZona(ROTA.bordas[borda]));
      expect(passo, `borda ${borda}`).toBeGreaterThanOrEqual(ROTA.passo_da_borda[borda]);
    }
    expect(ROTA.passos[passo].zona).toBe("2_11_endgame_town");
  });
});

describe("ressincronizar pela zona atual", () => {
  it("já está na zona certa: não muda", () => {
    expect(ressincronizar(ROTA, 6, { id: "1_1_3", nome: null })).toBe(6);
    expect(ressincronizar(ROTA, 0, { id: "1_1_1", nome: "The Twilight Strand" })).toBe(0);
  });

  it("o guia ficou pra trás: procura pra frente", () => {
    expect(ressincronizar(ROTA, 0, { id: "1_1_3", nome: null })).toBe(6);
    expect(ressincronizar(ROTA, 0, { id: null, nome: "The Mud Flats" })).toBe(6);
    const merveil = ROTA.passo_da_borda[ROTA.bordas.indexOf("1_1_11_2")];
    expect(ressincronizar(ROTA, 0, { id: "1_1_11_2", nome: null })).toBe(merveil + 1);
  });

  it("só com o nome, procura até o fim do ato seguinte, não a campanha toda", () => {
    expect(ressincronizar(ROTA, 0, { id: null, nome: nomeDaZona("1_2_1") })).toBe(passoQueVaiPra("1_2_1") + 1);
    expect(ressincronizar(ROTA, 0, { id: null, nome: nomeDaZona("1_3_1") })).toBeNull();
    // Os atos 6 a 10 repetem nomes: do fim do ato 1, "The Coast" é a do ato 1, não a do ato 6.
    const fimDoAto1 = passoQueVaiPra("1_2_1");
    const achado = ressincronizar(ROTA, fimDoAto1, { id: null, nome: "The Coast" });
    expect(achado).not.toBeNull();
    expect(ROTA.passos[achado ?? 0].ato).toBe(1);
  });

  it("com o id da zona, acha em qualquer ato (build importada no meio da campanha)", () => {
    expect(ressincronizar(ROTA, 0, { id: "1_2_1", nome: null })).toBe(passoQueVaiPra("1_2_1") + 1);
    expect(ressincronizar(ROTA, 0, { id: "1_3_1", nome: null })).toBe(passoQueVaiPra("1_3_1") + 1);
    const noAto6 = ressincronizar(ROTA, 0, { id: "2_6_2", nome: "The Coast" });
    expect(noAto6).toBe(passoQueVaiPra("2_6_2") + 1);
    expect(ROTA.passos[noAto6 ?? 0].ato).toBe(6);
    // Cidade de um ato distante: cai na primeira visita a ela.
    const sarn = ressincronizar(ROTA, 0, { id: "1_3_town", nome: null });
    expect(sarn).toBe(passoQueVaiPra("1_3_town") + 1);
  });

  it("o guia passou do ponto: procura pra trás a visita mais recente", () => {
    const noAto2 = ROTA.inicio_do_ato[2] + 9;
    expect(ROTA.passos[noAto2].ato).toBe(2);
    // The Coast aparece duas vezes no ato 1: vale a última.
    expect(ROTA.bordas.indexOf("1_1_2")).toBe(2);
    expect(ROTA.bordas.lastIndexOf("1_1_2")).toBe(5);
    expect(ressincronizar(ROTA, noAto2, { id: "1_1_2", nome: null })).toBe(9);
  });

  it("zona fora da rota ou desconhecida: null", () => {
    expect(ressincronizar(ROTA, 6, { id: "zona_que_nao_existe", nome: null })).toBeNull();
    expect(ressincronizar(ROTA, 6, { id: null, nome: "A Costa" })).toBeNull();
    expect(ressincronizar(ROTA, 6, { id: null, nome: null })).toBeNull();
  });

  it("o id vale mais que o nome", () => {
    expect(ressincronizar(ROTA, 0, { id: "1_1_3", nome: "Lioneye's Watch" })).toBe(6);
  });
});

describe("nível estimado e começo dos atos", () => {
  it("começa no 1 e fica sempre dentro da faixa do ato", () => {
    const faixas: Record<number, [number, number]> = {
      1: [1, 12],
      2: [12, 22],
      3: [22, 32],
      4: [32, 40],
      5: [40, 45],
      6: [45, 50],
      7: [50, 55],
      8: [55, 60],
      9: [60, 64],
      10: [64, 68],
    };
    expect(nivelEstimado(ROTA, 0)).toBe(1);
    for (const p of ROTA.passos) {
      const nivel = nivelEstimado(ROTA, p.indice);
      const [piso, teto] = faixas[p.ato];
      expect(nivel, `passo ${p.indice}`).toBeGreaterThanOrEqual(piso);
      expect(nivel, `passo ${p.indice}`).toBeLessThanOrEqual(teto);
    }
  });

  it("no fim da campanha o chute fica abaixo do nível de mapas", () => {
    expect(nivelEstimado(ROTA, ULTIMO)).toBeGreaterThanOrEqual(64);
    expect(nivelEstimado(ROTA, ULTIMO)).toBeLessThanOrEqual(68);
    expect(nivelEstimado(ROTA, 99_999)).toBe(nivelEstimado(ROTA, ULTIMO));
  });

  it("inicioDoAto", () => {
    expect(inicioDoAto(ROTA, 1)).toBe(0);
    for (let ato = 2; ato <= 10; ato++) {
      const inicio = inicioDoAto(ROTA, ato);
      expect(ROTA.passos[inicio].ato).toBe(ato);
      expect(ROTA.passos[inicio - 1].ato).toBe(ato - 1);
    }
    expect(inicioDoAto(ROTA, 11)).toBe(0);
    expect(inicioDoAto(ROTA, 0)).toBe(0);
  });
});

describe("quem saiu da ordem da rota não deixa o guia travado", () => {
  /** Passa as zonas na ordem, como o Client.txt manda, e devolve o passo do fim. */
  function andar(zonas: string[], passo = 0): number {
    let anterior: string | null = null;
    for (const zona of zonas) {
      passo = aoChegarNaZona(ROTA, passo, zona, anterior);
      anterior = zona;
    }
    return passo;
  }

  // Corrida de verdade (11/11): pulou a Flooded Depths, foi até a prisão e voltou pra matar
  // o Dweller depois. O guia ficou parado no Dweller até o ato 2.
  const COMECO = ["1_1_1", "1_1_town", "1_1_2", "1_1_3", "1_1_4_1", "1_1_2", "1_1_2a", "1_1_town", "1_1_4_1"];
  const FORA_DA_ORDEM = ["1_1_5", "1_1_6", "1_1_7_1", "1_1_town", "1_1_4_1", "1_1_4_0", "1_1_town", "1_1_7_1", "1_1_7_2"];

  it("duas zonas novas seguidas mais à frente: o guia alcança", () => {
    const antes = andar(COMECO);
    const depois = andar(["1_1_5", "1_1_6"], antes);
    expect(depois).toBeGreaterThan(antes);
    expect(depois).toBe(passoQueVaiPra("1_1_7_1"));
  });

  it("uma zona nova sozinha lá na frente não pula (pode ser só uma visita)", () => {
    const antes = andar(COMECO);
    expect(aoChegarNaZona(ROTA, antes, "1_1_5", "1_1_4_1")).toBe(antes);
  });

  it("a corrida inteira fora da ordem chega no ato 2 junto com o jogador", () => {
    const naPrisao = andar([...COMECO, ...FORA_DA_ORDEM]);
    expect(nomeDaZona(ROTA.passos[naPrisao].zona)).toBe("The Upper Prison");
    const fim = andar(
      ["1_1_town", "1_1_8", "1_1_9", "1_1_9a", "1_1_9", "1_1_11_1", "1_1_town", "1_1_11_1", "1_1_11_2", "1_2_1"],
      naPrisao,
    );
    expect(ROTA.passos[fim].ato).toBe(2);
    expect(ROTA.passos[fim].zona).toBe("1_2_1");
  });

  it("zona de um ato mais adiante puxa o guia, mesmo travado lá atrás", () => {
    const travado = andar(COMECO);
    const fim = aoChegarNaZona(ROTA, travado, "1_2_town", "1_2_1");
    expect(ROTA.passos[fim].ato).toBe(2);
    expect(ROTA.passos[fim].zona).toBe("1_2_town");
  });

  it("voltar pra uma zona de um ato anterior não mexe", () => {
    const noAto2 = aoChegarNaZona(ROTA, andar(COMECO), "1_2_town", "1_2_1");
    expect(aoChegarNaZona(ROTA, noAto2, "1_1_2", "1_1_town")).toBe(noAto2);
    expect(andar(["1_1_town", "1_1_2", "1_1_2a"], noAto2)).toBe(noAto2);
  });

  it("ir antes à zona opcional e voltar não pula nada", () => {
    const naCosta = andar(["1_1_1", "1_1_town", "1_1_2"]);
    expect(andar(["1_1_2a", "1_1_2"], naCosta)).toBe(naCosta);
  });
});
