import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { arvoreAlvo } from "../conjuntos";
import type { EtapaDeArvore, Plano } from "../plano";
import { POR_ATO, POR_NIVEL } from "../teste/pob-de-exemplo";
import { PLANO, planoDeExemplo } from "../teste/rota-de-exemplo";
import { lerArvore, TIPO, type ArvoreDoJogo } from "./dados";
import {
  AVISO_DE_ORDEM_ESTIMADA,
  avisosDeSempre,
  chaveDoGuia,
  montarGuia,
  NUMERADOS,
  paraOSistema,
  type GuiaDaArvore,
} from "./guia";
import { pontosAte } from "./pontos";

// A mesma árvore pequena do teste da ordem:
//
//   100 (início) ── 1001 ── 1002 ── 1003 (notável) ── 1004 (maestria)
//        │            │                 └── 1030 ── 1031 (joia) ── 1040 ── 200 (outro início) ── 1050
//        │            └── 1010 ── 1011 ── 1012 (pedra angular)
//        └── 1020 ── 1021 (notável) ── 1022 (maestria)
const PEQUENA = {
  formato: 1,
  versao: "0.1",
  pob: ["0_1", "0_1_ruthless"],
  nos: [
    [100, 0, 0, 5, 0, 0, "MARAUDER"],
    [200, 900, 0, 5, 0, 0, "WITCH"],
    [1001, 100, 0, 0, 0, 0, "Strength"],
    [1002, 200, 0, 0, 0, 0, "Strength"],
    [1003, 300, 0, 1, 0, 0, "Born to Fight"],
    [1004, 300, 80, 4, 0, 0, "Life Mastery"],
    [1010, 100, 100, 0, 0, 0, "Armour"],
    [1011, 100, 200, 0, 0, 0, "Armour"],
    [1012, 100, 300, 2, 0, 0, "Unwavering Stance"],
    [1020, 0, -100, 0, 0, 0, "Life"],
    [1021, 0, -200, 1, 0, 0, "Heart of the Warrior"],
    [1022, 80, -200, 4, 0, 0, "Life Mastery"],
    [1030, 400, 0, 0, 0, 0, "Dexterity"],
    [1031, 500, 0, 3, 0, 0, "Basic Jewel Socket"],
    [1040, 700, 0, 0, 0, 0, "Intelligence"],
    [1050, 1000, 0, 0, 0, 0, "Intelligence"],
  ],
  ligacoes: [0, 2, 2, 3, 3, 4, 4, 5, 2, 6, 6, 7, 7, 8, 0, 9, 9, 10, 10, 11, 4, 12, 12, 13, 13, 14, 14, 1, 1, 15],
  classes: [
    { nome: "Marauder", inicio: 100, ascendencias: ["Juggernaut"] },
    { nome: "Witch", inicio: 200, ascendencias: [] },
  ],
  maestrias: {
    "Life Mastery": [
      [9001, "+50 to maximum Life"],
      [9002, "10% increased maximum Life"],
      [9003, `Linha um\n   linha dois ${"x".repeat(500)}`],
    ],
  },
  ascendencias: {
    Juggernaut: {
      nome: "Juggernaut",
      inicio: 300,
      nos: [
        [300, 0, 0, 7, 0, 0, "Juggernaut"],
        [301, 10, 0, 1, 1, 2, "Unstoppable"],
      ],
      ligacoes: [0, 1],
    },
  },
};

function pequena(): ArvoreDoJogo {
  const arvore = lerArvore(PEQUENA);
  if (!arvore) throw new Error("a árvore pequena do teste não foi lida");
  return arvore;
}

let contador = 0;

function etapa(nos: number[], extra: Partial<EtapaDeArvore> = {}): EtapaDeArvore {
  contador += 1;
  return {
    id: `t${contador}`,
    titulo: "",
    nivel_min: null,
    nivel_max: null,
    ato_min: null,
    ato_max: null,
    estimativa: null,
    inicial: false,
    fim_de_jogo: false,
    chave: null,
    lab: null,
    versao: "0_1",
    nos,
    maestrias: [],
    url: "",
    ordem: null,
    nos_novos: 0,
    ...extra,
  };
}

interface Opcoes {
  classe?: string;
  ativa?: string | null;
  hash?: string;
}

/** O plano de exemplo com as árvores trocadas pelas do teste. */
function planoCom(etapas: EtapaDeArvore[], opcoes: Opcoes = {}): Plano {
  return {
    ...PLANO,
    fonte: { ...PLANO.fonte, hash_codigo: opcoes.hash ?? "sha256:arvore" },
    personagem: { ...PLANO.personagem, classe: opcoes.classe ?? "Marauder" },
    arvore: { etapas, ativa_no_pob: opcoes.ativa ?? null, ascendencias: [] },
  };
}

function guiaDe(plano: Plano, arvore: ArvoreDoJogo, nivel = 1, ato = 1): GuiaDaArvore {
  const guia = montarGuia(plano, { nivel, ato }, arvore);
  if (!guia) throw new Error("era pra ter guia");
  return guia;
}

/** O que vale pra qualquer guia: o contrato com o Rust e as propriedades da ordem. */
function conferirGuia(guia: GuiaDaArvore, arvore: ArvoreDoJogo): void {
  const pos = (id: number): number => {
    const p = arvore.indice.get(id);
    if (p === undefined) throw new Error(`nó ${id} não existe na árvore`);
    return p;
  };
  const posicaoDoInicio = pos(guia.inicio);
  expect(arvore.nos[posicaoDoInicio].tipo).toBe(TIPO.INICIO);
  expect(guia.versao).toBe(arvore.versao);
  expect(guia.numerados).toBe(NUMERADOS);
  expect(guia.ate_alvo).toBeGreaterThan(0);
  expect(guia.ate_alvo).toBeLessThanOrEqual(guia.ordem.length);
  // Limites que o Rust confere ao receber.
  expect(guia.ordem.length).toBeLessThanOrEqual(3000);
  for (const texto of [guia.texto, guia.etapa, guia.build, ...guia.avisos]) expect(texto.length).toBeLessThanOrEqual(400);
  expect(new Set(guia.ordem.map((p) => p.no)).size).toBe(guia.ordem.length);

  guia.ordem.forEach((passo, i) => {
    const p = pos(passo.no);
    const no = arvore.nos[p];
    expect(passo.nome).toBe(no.nome);
    expect(passo.tipo).toBe(no.tipo);
    expect(passo.nome.length).toBeLessThanOrEqual(400);
    expect(no.tipo).not.toBe(TIPO.INICIO);
    if (no.tipo === TIPO.MAESTRIA) {
      expect(passo.rotulo).not.toBeNull();
      expect(passo.rotulo?.length ?? 0).toBeGreaterThan(0);
      expect(passo.rotulo?.length ?? 0).toBeLessThanOrEqual(400);
      expect(/[\n\r\t]/.test(passo.rotulo ?? "")).toBe(false);
    } else {
      expect(passo.rotulo).toBeNull();
    }
    if (passo.solto) {
      expect(passo.pai).toBe(-1);
      expect(i).toBeLessThan(guia.ate_alvo);
      return;
    }
    expect(Number.isInteger(passo.pai)).toBe(true);
    expect(passo.pai).toBeGreaterThanOrEqual(-1);
    expect(passo.pai).toBeLessThan(i);
    const posicaoDoPai = passo.pai === -1 ? posicaoDoInicio : pos(guia.ordem[passo.pai].no);
    expect(arvore.vizinhos[p].includes(posicaoDoPai), `nó ${passo.no} ligado ao pai`).toBe(true);
    if (passo.pai >= 0) {
      expect(guia.ordem[passo.pai].solto).toBe(false);
      expect(guia.ordem[passo.pai].tipo).not.toBe(TIPO.MAESTRIA);
    }
    if (no.tipo === TIPO.MAESTRIA) expect(guia.ordem[passo.pai]?.tipo).toBe(TIPO.NOTAVEL);
  });

  const manter = new Set(guia.manter);
  for (const passo of guia.ordem) expect(manter.has(passo.no)).toBe(true);
  for (const id of guia.devolver) {
    expect(manter.has(id)).toBe(false);
    expect(arvore.indice.has(id)).toBe(true);
  }
  // Vai pela ponte como JSON: nada de `undefined`, `Map` ou número torto.
  expect(JSON.parse(JSON.stringify(guia))).toEqual(guia);
}

describe("guia numa árvore pequena", () => {
  const arvore = pequena();
  const A = [100, 1020, 1021];
  const B = [100, 1020, 1021, 1001, 1002, 1003, 1004];
  const C = [100, 1020, 1021, 1001, 1002, 1003, 1004, 1030, 1031, 1010, 1011, 1012];
  const porNivel = () =>
    planoCom([
      etapa(A, { titulo: "Level 12", nivel_min: 12, estimativa: 12 }),
      etapa(B, { titulo: "Level 30", nivel_min: 30, estimativa: 30, maestrias: [{ no: 1004, efeito: 9002 }] }),
      etapa(C, { titulo: "Level 60", nivel_min: 60, estimativa: 60, maestrias: [{ no: 1004, efeito: 9001 }] }),
    ]);

  it("monta o guia da etapa que vale agora, com os dados da build", () => {
    const guia = guiaDe(porNivel(), arvore, 12, 2);
    conferirGuia(guia, arvore);
    expect(guia.build).toBe("sha256:arvore");
    expect(guia.versao).toBe("0.1");
    expect(guia.etapa).toBe("Level 30");
    expect(guia.texto).toBe("Árvore até Level 30 (2/3)");
    expect(guia.inicio).toBe(100);
    expect(guia.numerados).toBe(8);
    expect(guia.avisos).toEqual([]);
    expect(guia.ate_alvo).toBe(6);
    expect(guia.ordem.slice(0, 6)).toEqual([
      { no: 1020, pai: -1, nome: "Life", tipo: 0, rotulo: null, solto: false },
      { no: 1021, pai: 0, nome: "Heart of the Warrior", tipo: 1, rotulo: null, solto: false },
      { no: 1001, pai: -1, nome: "Strength", tipo: 0, rotulo: null, solto: false },
      { no: 1002, pai: 2, nome: "Strength", tipo: 0, rotulo: null, solto: false },
      { no: 1003, pai: 3, nome: "Born to Fight", tipo: 1, rotulo: null, solto: false },
      { no: 1004, pai: 4, nome: "Life Mastery", tipo: 4, rotulo: "10% increased maximum Life", solto: false },
    ]);
    // Depois do alvo vem o resto da build, pra o desenho saber o que manter.
    expect(guia.ordem.slice(6).map((p) => p.no)).toEqual([1030, 1031, 1010, 1011, 1012]);
    expect(guia.manter).toEqual([1001, 1002, 1003, 1004, 1010, 1011, 1012, 1020, 1021, 1030, 1031]);
    expect(guia.devolver).toEqual([]);
  });

  it("o alvo anda com o nível do personagem", () => {
    const plano = porNivel();
    expect(guiaDe(plano, arvore, 1).etapa).toBe("Level 12");
    expect(guiaDe(plano, arvore, 1).ate_alvo).toBe(2);
    expect(guiaDe(plano, arvore, 11).etapa).toBe("Level 12");
    expect(guiaDe(plano, arvore, 30).etapa).toBe("Level 60");
    expect(guiaDe(plano, arvore, 30).ate_alvo).toBe(11);
    expect(guiaDe(plano, arvore, 95).etapa).toBe("Level 60");
    // O efeito da maestria é o da etapa alvo.
    expect(guiaDe(plano, arvore, 30).ordem.find((p) => p.no === 1004)?.rotulo).toBe("+50 to maximum Life");
    // Maestria que só chega depois do alvo leva o efeito da primeira etapa que a tem.
    expect(guiaDe(plano, arvore, 1).ordem.find((p) => p.no === 1004)?.rotulo).toBe("10% increased maximum Life");
  });

  it("a etapa alvo é a mesma de arvoreAlvo", () => {
    const plano = porNivel();
    for (const nivel of [1, 12, 29, 30, 59, 60, 100]) {
      expect(guiaDe(plano, arvore, nivel).etapa).toBe(arvoreAlvo(plano, { nivel, ato: 1 })?.titulo);
    }
  });

  it("a etapa escolhida na mão vale mais que o nível (voltar pra ver a maestria que ficou)", () => {
    const plano = porNivel();
    // No nível 30 o alvo seria o "Level 60"; o jogador voltou pra etapa 2.
    const guia = montarGuia(plano, { nivel: 30, ato: 3 }, arvore, 0, 1)!;
    conferirGuia(guia, arvore);
    expect(guia.etapa).toBe("Level 30");
    expect(guia.texto).toBe("Árvore até Level 30 (2/3)");
    expect(guia.ordem.find((p) => p.no === 1004)?.rotulo).toBe("10% increased maximum Life");
    // Posição que não existe: volta pro automático.
    expect(montarGuia(plano, { nivel: 30, ato: 3 }, arvore, 0, 9)!.etapa).toBe("Level 60");
  });

  it("não mexe no plano nem na árvore", () => {
    const plano = porNivel();
    const antes = JSON.stringify(plano);
    const nosAntes = JSON.stringify(arvore.nos);
    montarGuia(plano, { nivel: 30, ato: 3 }, arvore);
    expect(JSON.stringify(plano)).toBe(antes);
    expect(JSON.stringify(arvore.nos)).toBe(nosAntes);
  });

  it("mesma entrada, mesma saída", () => {
    const plano = porNivel();
    expect(guiaDe(plano, arvore, 30)).toEqual(guiaDe(plano, arvore, 30));
    expect(guiaDe(porNivel(), arvore, 30)).toEqual(guiaDe(plano, arvore, 30));
  });

  it("rótulo de ato: marcos pelas etapas com gatilho que vêm antes", () => {
    const plano = planoCom([
      etapa(A, { titulo: "Act 1", ato_min: 1, estimativa: 12 }),
      etapa(C, { titulo: "Act 2", ato_min: 2, estimativa: 22, maestrias: [{ no: 1004, efeito: 9001 }] }),
    ]);
    const guia = guiaDe(plano, arvore, 14, 2);
    conferirGuia(guia, arvore);
    expect(guia.texto).toBe("Árvore até Act 2 (2/2)");
    expect(guia.ordem.slice(0, 2).map((p) => p.no)).toEqual([1020, 1021]);
    expect(guia.ate_alvo).toBe(11);
  });

  it("respec: nós só do marco antigo viram devolver e ficam fora da ordem", () => {
    const plano = planoCom([
      etapa([100, 1020, 1021, 1022, 1001, 1010, 1011], { titulo: "Level 12", nivel_min: 12, maestrias: [{ no: 1022, efeito: 9001 }] }),
      etapa([100, 1001, 1002, 1003, 1030, 1031], { titulo: "Level 40 - respec", nivel_min: 40 }),
    ]);
    const guia = guiaDe(plano, arvore, 20);
    conferirGuia(guia, arvore);
    expect(guia.ordem.map((p) => p.no)).toEqual([1001, 1002, 1003, 1030, 1031]);
    expect(guia.devolver).toEqual([1010, 1011, 1020, 1021, 1022]);
    expect(guia.manter).toEqual([1001, 1002, 1003, 1030, 1031]);
    // Antes do respec, nada a devolver: o alvo ainda é a árvore antiga.
    expect(guiaDe(plano, arvore, 5).devolver).toEqual([]);
  });

  it("etapas sem gatilho: o alvo é a árvore ativa no PoB, as menores viram marcos e as maiores vêm depois", () => {
    const menor = etapa(A, { titulo: "Começo" });
    const media = etapa(B, { titulo: "Meio", maestrias: [{ no: 1004, efeito: 9001 }] });
    const maior = etapa(C, { titulo: "Fim", maestrias: [{ no: 1004, efeito: 9001 }] });
    const outra = etapa([200, 1040, 1050], { titulo: "Outra build" });
    const plano = planoCom([maior, outra, media, menor], { ativa: media.id });
    const guia = guiaDe(plano, arvore, 50, 5);
    conferirGuia(guia, arvore);
    expect(guia.etapa).toBe("Meio");
    expect(guia.ordem.map((p) => p.no)).toEqual([1020, 1021, 1001, 1002, 1003, 1004, 1030, 1031, 1010, 1011, 1012]);
    expect(guia.ate_alvo).toBe(6);
    expect(guia.devolver).toEqual([]);
    expect(guia.manter.includes(1040)).toBe(false);
    // O nível não muda o alvo quando não há rótulo.
    expect(guiaDe(plano, arvore, 1, 1)).toEqual(guia);
  });

  it("etapas sem gatilho: sem o marco, a ordem muda", () => {
    // Sozinho, o alvo vai ao notável mais perto (1021); com a etapa menor como marco, vai primeiro pro 1003.
    const alvo = etapa([100, 1020, 1021, 1001, 1002, 1003], { titulo: "Alvo" });
    const marco = etapa([100, 1001, 1002, 1003], { titulo: "Antes" });
    expect(guiaDe(planoCom([alvo], { ativa: alvo.id }), arvore).ordem.map((p) => p.no)).toEqual([1020, 1021, 1001, 1002, 1003]);
    expect(guiaDe(planoCom([marco, alvo], { ativa: alvo.id }), arvore).ordem.map((p) => p.no)).toEqual([
      1001, 1002, 1003, 1020, 1021,
    ]);
  });

  it("etapa única, sem título", () => {
    const guia = guiaDe(planoCom([etapa(C, { maestrias: [{ no: 1004, efeito: 9001 }] })]), arvore);
    conferirGuia(guia, arvore);
    expect(guia.etapa).toBe("");
    expect(guia.texto).toBe("Árvore da build");
    expect(guia.ate_alvo).toBe(guia.ordem.length);
    expect(guia.ordem.map((p) => p.no)).toEqual([1020, 1021, 1001, 1002, 1003, 1004, 1030, 1031, 1010, 1011, 1012]);
  });

  it("maestria sem efeito escolhido fica de fora, sem aviso", () => {
    const guia = guiaDe(planoCom([etapa([100, 1020, 1021, 1022, 1001, 1002, 1003, 1004])]), arvore);
    conferirGuia(guia, arvore);
    expect(guia.ordem.map((p) => p.no)).toEqual([1020, 1021, 1001, 1002, 1003]);
    expect(guia.manter).toEqual([1001, 1002, 1003, 1020, 1021]);
    expect(guia.avisos).toEqual([AVISO_DE_ORDEM_ESTIMADA]);
  });

  it("maestria com efeito que a árvore não conhece entra sem rótulo", () => {
    const guia = guiaDe(planoCom([etapa([100, 1020, 1021, 1022], { maestrias: [{ no: 1022, efeito: 123456 }] })]), arvore);
    expect(guia.ordem[2]).toEqual({ no: 1022, pai: 1, nome: "Life Mastery", tipo: 4, rotulo: null, solto: false });
  });

  it("texto comprido do PoB e dos dados é cortado antes de ir pro Rust", () => {
    const titulo = `Level 90 ${"muito ".repeat(200)}`;
    const guia = guiaDe(planoCom([etapa(B, { titulo, nivel_min: 90, maestrias: [{ no: 1004, efeito: 9003 }] })]), arvore);
    conferirGuia(guia, arvore);
    expect(guia.etapa.length).toBeLessThanOrEqual(60);
    expect(guia.etapa.endsWith("…")).toBe(true);
    expect(guia.texto.length).toBeLessThanOrEqual(80);
    const rotulo = guia.ordem.find((p) => p.no === 1004)?.rotulo ?? "";
    expect(rotulo.startsWith("Linha um linha dois x")).toBe(true);
    expect(rotulo.length).toBeLessThanOrEqual(300);
  });

  it("avisa de cluster, de nó desconhecido e de nó sem caminho, sem tratar como erro", () => {
    const plano = planoCom([etapa([100, 1001, 1002, 301, 300, 65536, 65537, 70000, 4242, 1050, 5000001])]);
    const guia = guiaDe(plano, arvore);
    conferirGuia(guia, arvore);
    expect(guia.ordem.map((p) => [p.no, p.solto])).toEqual([
      [1001, false],
      [1002, false],
      [1050, true],
    ]);
    expect(guia.avisos).toEqual([
      "4 nós de joia cluster ficaram de fora",
      "1 nó do PoB não existe na árvore 0.1",
      "1 nó sem caminho ficou sem número",
      AVISO_DE_ORDEM_ESTIMADA,
    ]);
  });

  it("PoB de outra versão da árvore: guia sai, com aviso", () => {
    const guia = guiaDe(planoCom([etapa(A, { versao: "3_28" })]), arvore);
    conferirGuia(guia, arvore);
    expect(guia.avisos.length).toBe(2);
    expect(guia.avisos[0]).toContain("3.28");
    expect(guia.avisos[0]).toContain("0.1");
    expect(guia.avisos[1]).toBe(AVISO_DE_ORDEM_ESTIMADA);
    // As versões que usam esta árvore (inclusive a ruthless) e PoB sem versão não avisam da versão.
    expect(guiaDe(planoCom([etapa(A, { versao: "0_1_ruthless" })]), arvore).avisos).toEqual([AVISO_DE_ORDEM_ESTIMADA]);
    expect(guiaDe(planoCom([etapa(A, { versao: "" })]), arvore).avisos).toEqual([AVISO_DE_ORDEM_ESTIMADA]);
  });

  it("ordem estimada: avisa só quando o PoB não traz nenhuma outra etapa da árvore", () => {
    expect(guiaDe(planoCom([etapa(C)]), arvore).avisos).toEqual([AVISO_DE_ORDEM_ESTIMADA]);
    // Com etapas, antes ou depois do alvo, a ordem tem em que se apoiar.
    for (const nivel of [1, 12, 30, 60]) {
      expect(guiaDe(porNivel(), arvore, nivel).avisos, `nível ${nivel}`).toEqual([]);
    }
  });

  it("avisos de sempre: só o de versão e o de ordem estimada aparecem fora do modo de edição", () => {
    const plano = planoCom([etapa([100, 1001, 1002, 65536, 4242, 1050], { versao: "3_28" })]);
    const guia = guiaDe(plano, arvore);
    expect(guia.avisos.length).toBe(5);
    expect(avisosDeSempre(guia)).toEqual([guia.avisos[0], AVISO_DE_ORDEM_ESTIMADA]);
    expect(avisosDeSempre(guia)[0]).toContain("3.28");
    expect(avisosDeSempre(guiaDe(porNivel(), arvore))).toEqual([]);
  });

  it("o início vem do nó de início da etapa; sem ele, da classe do plano", () => {
    expect(guiaDe(planoCom([etapa([1020, 1021])], { classe: "Marauder" }), arvore).inicio).toBe(100);
    expect(guiaDe(planoCom([etapa([200, 1040, 1031])], { classe: "Marauder" }), arvore).inicio).toBe(200);
    const bruxa = guiaDe(planoCom([etapa([1040, 1031, 1050])], { classe: "Witch" }), arvore);
    conferirGuia(bruxa, arvore);
    expect(bruxa.inicio).toBe(200);
    expect(bruxa.ordem.map((p) => p.no)).toEqual([1040, 1031, 1050]);
  });

  it("sem guia: PoB sem árvore, início desconhecido ou etapa sem nó conhecido", () => {
    const s = { nivel: 10, ato: 1 };
    expect(montarGuia(planoCom([]), s, arvore)).toBeNull();
    expect(montarGuia(planoCom([etapa([1020, 1021])], { classe: "Exilado" }), s, arvore)).toBeNull();
    expect(montarGuia(planoCom([etapa([1020, 1021])], { classe: "" }), s, arvore)).toBeNull();
    expect(montarGuia(planoCom([etapa([])]), s, arvore)).toBeNull();
    expect(montarGuia(planoCom([etapa([100])]), s, arvore)).toBeNull();
    expect(montarGuia(planoCom([etapa([100, 301, 65536, 4242])]), s, arvore)).toBeNull();
    expect(montarGuia(planoCom([etapa([100, 1004, 1022])]), s, arvore)).toBeNull();
  });

  it("o PoB de exemplo, com ids em sequência a partir de 1000, não quebra", () => {
    for (const pob of [POR_NIVEL, POR_ATO]) {
      const plano = planoDeExemplo(pob);
      for (const [nivel, ato] of [[1, 1], [12, 2], [32, 4], [70, 10], [95, 11]]) {
        const guia = montarGuia(plano, { nivel, ato }, arvore);
        expect(guia).not.toBeNull();
        if (guia) {
          conferirGuia(guia, arvore);
          expect(guia.build).toBe("sha256:teste");
          // O PoB de exemplo diz "3_28" e a árvore pequena é outra.
          expect(guia.avisos.some((a) => a.includes("3.28"))).toBe(true);
        }
      }
    }
  });
});

describe("chave do guia", () => {
  const arvore = pequena();
  const base = () => guiaDe(planoCom([etapa([100, 1020, 1021, 1022, 1001], { titulo: "Level 12", maestrias: [{ no: 1022, efeito: 9001 }] })]), arvore);

  it("sem guia a chave é vazia; guia igual, chave igual", () => {
    expect(chaveDoGuia(null)).toBe("");
    expect(chaveDoGuia(base())).toBe(chaveDoGuia(base()));
    expect(chaveDoGuia(base()).length).toBeGreaterThan(10);
    expect(chaveDoGuia(base()).length).toBeLessThan(200);
  });

  it("muda quando qualquer coisa enviada ao Rust muda", () => {
    const original = base();
    const chave = chaveDoGuia(original);
    const trocas: ((g: GuiaDaArvore) => void)[] = [
      (g) => (g.build = "sha256:outra"),
      (g) => (g.versao = "0.2"),
      (g) => (g.etapa = "Level 13"),
      (g) => (g.inicio = 200),
      (g) => (g.ate_alvo -= 1),
      (g) => (g.texto = "Árvore até Level 13"),
      (g) => (g.numerados = 5),
      (g) => g.avisos.push("aviso novo"),
      (g) => g.manter.pop(),
      (g) => g.devolver.push(1050),
      // Mesmo tamanho, outro nó.
      (g) => (g.ordem[3].no = 1010),
      // Mesmos nós, noutra ordem.
      (g) => g.ordem.reverse(),
      (g) => (g.ordem[1].pai = -1),
      (g) => (g.ordem[1].nome = "Outro nome"),
      (g) => (g.ordem[1].tipo = 2),
      (g) => (g.ordem[2].rotulo = "10% increased maximum Life"),
      (g) => (g.ordem[2].rotulo = null),
      (g) => (g.ordem[3].solto = true),
    ];
    const vistas = new Set([chave]);
    for (const trocar of trocas) {
      const copia = structuredClone(original);
      trocar(copia);
      const nova = chaveDoGuia(copia);
      expect(nova, trocar.toString()).not.toBe(chave);
      vistas.add(nova);
    }
    expect(vistas.size).toBe(trocas.length + 1);
    expect(chaveDoGuia(original)).toBe(chave);
  });

  it("muda quando a etapa alvo muda e quando só o efeito da maestria muda", () => {
    const A = [100, 1020, 1021, 1022];
    const plano = (efeito: number) =>
      planoCom([
        etapa(A, { titulo: "Level 12", nivel_min: 12, maestrias: [{ no: 1022, efeito }] }),
        etapa([...A, 1001], { titulo: "Level 30", nivel_min: 30, maestrias: [{ no: 1022, efeito }] }),
      ]);
    expect(chaveDoGuia(guiaDe(plano(9001), arvore, 1))).not.toBe(chaveDoGuia(guiaDe(plano(9001), arvore, 12)));
    expect(chaveDoGuia(guiaDe(plano(9001), arvore, 1))).not.toBe(chaveDoGuia(guiaDe(plano(9002), arvore, 1)));
    expect(chaveDoGuia(guiaDe(plano(9001), arvore, 1))).toBe(chaveDoGuia(guiaDe(plano(9001), arvore, 11)));
  });
});

// ---------------------------------------------------------------------------------------------
// O arquivo de verdade.
// ---------------------------------------------------------------------------------------------

const ARQUIVO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "dados", "arvore", "arvore.json");

interface ArquivoCru {
  maestrias: Record<string, [number, string][]>;
}

const cru = JSON.parse(readFileSync(ARQUIVO, "utf8")) as ArquivoCru;

function real(): ArvoreDoJogo {
  const arvore = lerArvore(cru);
  if (!arvore) throw new Error("o arquivo da árvore não foi lido");
  return arvore;
}

/** Cresce um conjunto ligado ao início pela busca em largura, pulando um vizinho de vez em quando. */
function crescer(arvore: ArvoreDoJogo, inicio: number, quantos: number, passo: number): number[] {
  const partida = arvore.indice.get(inicio);
  if (partida === undefined) throw new Error("início desconhecido");
  const dentro = new Set<number>([partida]);
  const fila = [partida];
  const saida: number[] = [];
  let conta = 0;
  for (let i = 0; i < fila.length && saida.length < quantos; i++) {
    for (const v of arvore.vizinhos[fila[i]]) {
      const tipo = arvore.nos[v].tipo;
      if (dentro.has(v) || tipo === TIPO.MAESTRIA || tipo === TIPO.INICIO) continue;
      conta += 1;
      // Deixa alguns nós comuns de fora pra a build não ser uma bola; notável sempre entra.
      if (tipo === TIPO.NORMAL && conta % passo === 0) continue;
      if (saida.length >= quantos) break;
      dentro.add(v);
      fila.push(v);
      saida.push(arvore.nos[v].id);
    }
  }
  return saida;
}

function comMaestrias(arvore: ArvoreDoJogo, ids: number[]): { nos: number[]; maestrias: { no: number; efeito: number }[] } {
  const maestrias: { no: number; efeito: number }[] = [];
  const sem: number[] = [];
  const vistas = new Set<number>();
  for (const id of ids) {
    const p = arvore.indice.get(id);
    if (p === undefined || arvore.nos[p].tipo !== TIPO.NOTAVEL) continue;
    for (const v of arvore.vizinhos[p]) {
      const no = arvore.nos[v];
      if (no.tipo !== TIPO.MAESTRIA || vistas.has(no.id)) continue;
      vistas.add(no.id);
      const efeitos = cru.maestrias[no.nome] ?? [];
      // Uma em cada quatro fica sem efeito, como quando o PoB lista a maestria mas não aloca.
      if (vistas.size % 4 !== 0 && efeitos.length > 0) {
        maestrias.push({ no: no.id, efeito: efeitos[(vistas.size - 1) % efeitos.length][0] });
      } else {
        sem.push(no.id);
      }
    }
  }
  return { nos: [...ids, ...maestrias.map((m) => m.no), ...sem], maestrias };
}

describe("guia com a árvore de verdade", () => {
  const arvore = real();
  const TAMANHOS = [20, 45, 80, 115];
  const NIVEIS = [12, 30, 55, 80];

  for (const classe of arvore.classes) {
    describe(`build de ${classe.nome}`, () => {
      const crescimento = crescer(arvore, classe.inicio, 115, 5);
      const deAscendencia = [...arvore.ascendencia.keys()].slice(10, 18);
      const etapas = TAMANHOS.map((tamanho, i) => {
        const { nos, maestrias } = comMaestrias(arvore, crescimento.slice(0, tamanho));
        return etapa([classe.inicio, ...nos, ...deAscendencia, 65536, 65540], {
          titulo: `Level ${NIVEIS[i]}`,
          nivel_min: NIVEIS[i],
          estimativa: NIVEIS[i],
          versao: "3_30",
          maestrias,
        });
      });
      // A classe do plano está errada de propósito: quem manda é o nó de início que veio na etapa.
      const plano = planoCom(etapas, { classe: "Marauder" });

      it("o crescimento chegou nos 115 nós", () => {
        expect(crescimento.length).toBe(115);
      });

      NIVEIS.forEach((nivel, k) => {
        it(`nível ${nivel - 1}: guia até a etapa de ${TAMANHOS[k]} nós`, () => {
          const guia = guiaDe(plano, arvore, nivel - 1, 1);
          conferirGuia(guia, arvore);
          expect(guia.inicio).toBe(classe.inicio);
          expect(guia.etapa).toBe(`Level ${nivel}`);
          expect(guia.versao).toBe("3.30.0");
          expect(guia.avisos).toEqual(["2 nós de joia cluster ficaram de fora"]);
          const doAlvo = new Set([...crescimento.slice(0, TAMANHOS[k]), ...etapas[k].maestrias.map((m) => m.no)]);
          expect(guia.ate_alvo).toBe(doAlvo.size);
          expect(new Set(guia.ordem.slice(0, guia.ate_alvo).map((p) => p.no))).toEqual(doAlvo);
          expect(guia.ordem.some((p) => p.solto)).toBe(false);
          expect(guia.devolver).toEqual([]);
          const daUltima = new Set([...crescimento, ...etapas[3].maestrias.map((m) => m.no)]);
          expect(new Set(guia.ordem.map((p) => p.no))).toEqual(daUltima);
          expect(guia.manter).toEqual([...daUltima].sort((a, b) => a - b));
          // Cada maestria leva o texto do efeito escolhido na etapa.
          for (const m of etapas[3].maestrias) {
            const passo = guia.ordem.find((p) => p.no === m.no);
            expect(passo?.rotulo).toBe(arvore.efeitos.get(m.efeito)?.replace(/\s+/g, " ").trim());
          }
          // A estimativa de pontos do painel nunca passa do trecho do alvo por muito: a build é do tamanho do nível.
          expect(pontosAte(nivel, 1)).toBeLessThan(guia.ordem.length);
        });
      });

      it("os primeiros passos de um alvo adiantado são os do marco anterior", () => {
        const cedo = guiaDe(plano, arvore, 1, 1);
        const tarde = guiaDe(plano, arvore, 60, 6);
        expect(tarde.ordem.slice(0, cedo.ate_alvo)).toEqual(cedo.ordem.slice(0, cedo.ate_alvo));
        expect(tarde.ordem).toEqual(cedo.ordem);
        expect(chaveDoGuia(tarde)).not.toBe(chaveDoGuia(cedo));
      });

      it("PoB de outra versão: mesmo guia, mais o aviso", () => {
        const antigo = planoCom(etapas.map((e) => ({ ...e, versao: "3_25" })), { classe: classe.nome });
        const guia = guiaDe(antigo, arvore, 20, 2);
        conferirGuia(guia, arvore);
        expect(guia.avisos.length).toBe(2);
        expect(guia.avisos[0]).toContain("3.25");
        expect(guia.avisos[0]).toContain("3.30.0");
        expect(guia.ordem).toEqual(guiaDe(plano, arvore, 20, 2).ordem);
      });
    });
  }

  // Ids de verdade da 3.30.0 (iguais aos da 3.29.1), do início do Marauder (47175) e da Scion (58833).
  const ATE_BORN_TO_FIGHT = [31628, 9511, 23881, 26523, 58449];
  const DE_PASSAGEM = [50904, 6981];
  const DEPOIS_DE_BORN_TO_FIGHT = [20551, 61198];

  it("título de faixa com respec: o alvo é a etapa em que o personagem está, e nada dela vira devolver", () => {
    const plano = planoCom([
      etapa([47175, ...ATE_BORN_TO_FIGHT, ...DE_PASSAGEM], {
        titulo: "Level 1-12",
        nivel_min: 1,
        nivel_max: 12,
        estimativa: 1,
        versao: "3_30",
      }),
      etapa([47175, ...ATE_BORN_TO_FIGHT, ...DEPOIS_DE_BORN_TO_FIGHT], {
        titulo: "Level 12-22",
        nivel_min: 12,
        nivel_max: 22,
        estimativa: 12,
        versao: "3_30",
      }),
    ]);
    for (const nivel of [1, 2, 11]) {
      const guia = guiaDe(plano, arvore, nivel);
      conferirGuia(guia, arvore);
      expect(guia.etapa, `nível ${nivel}`).toBe("Level 1-12");
      expect(new Set(guia.ordem.slice(0, guia.ate_alvo).map((p) => p.no))).toEqual(
        new Set([...ATE_BORN_TO_FIGHT, ...DE_PASSAGEM]),
      );
      expect(guia.devolver).toEqual([]);
      expect(guia.avisos).toEqual([]);
    }
    for (const nivel of [12, 21, 30]) {
      const guia = guiaDe(plano, arvore, nivel);
      conferirGuia(guia, arvore);
      expect(guia.etapa, `nível ${nivel}`).toBe("Level 12-22");
      expect(guia.ordem.slice(0, 5).map((p) => p.no)).toEqual(ATE_BORN_TO_FIGHT);
      expect(new Set(guia.ordem.map((p) => p.no))).toEqual(
        new Set([...ATE_BORN_TO_FIGHT, ...DEPOIS_DE_BORN_TO_FIGHT]),
      );
      expect(guia.devolver).toEqual([...DE_PASSAGEM].sort((a, b) => a - b));
    }
  });

  it("árvore inicial sem rótulo: o que o PoB manda pegar primeiro vem primeiro", () => {
    const inicial = etapa([47175, ...DE_PASSAGEM], { titulo: "Start", inicial: true, estimativa: 0, versao: "3_30" });
    const ato1 = etapa([47175, ...DE_PASSAGEM, ...ATE_BORN_TO_FIGHT], {
      titulo: "Act 1",
      ato_min: 1,
      estimativa: 12,
      versao: "3_30",
    });
    const guia = guiaDe(planoCom([inicial, ato1]), arvore, 2, 1);
    conferirGuia(guia, arvore);
    expect(guia.etapa).toBe("Act 1");
    expect(guia.ordem.map((p) => p.no)).toEqual([...DE_PASSAGEM, ...ATE_BORN_TO_FIGHT]);
    // Sem a inicial, o guia iria primeiro pro notável.
    expect(guiaDe(planoCom([ato1]), arvore, 2, 1).ordem.map((p) => p.no)).toEqual([
      ...ATE_BORN_TO_FIGHT,
      ...DE_PASSAGEM,
    ]);
  });

  it("Ascendant com Path of the Marauder: o pedaço do outro início fica sem número, e o aviso diz por quê", () => {
    const ateConstitution = [48828, 62662, 13782, 12702, 15073, 62021, 65034, 55485];
    const plano = planoCom([etapa([58833, ...ateConstitution, 24755, ...ATE_BORN_TO_FIGHT], { versao: "3_30" })], {
      classe: "Scion",
    });
    const guia = guiaDe(plano, arvore);
    conferirGuia(guia, arvore);
    expect(guia.ordem.filter((p) => !p.solto).map((p) => p.no)).toEqual(ateConstitution);
    expect(guia.ordem.filter((p) => p.solto).map((p) => p.no)).toEqual([...ATE_BORN_TO_FIGHT].sort((a, b) => a - b));
    expect(guia.avisos).toEqual([
      '5 nós sem caminho ficaram sem número: o guia ainda não guia os nós que vêm depois de "Path of the Marauder"',
      AVISO_DE_ORDEM_ESTIMADA,
    ]);
  });

  it("o PoB de exemplo (ids falsos) com a árvore de verdade não quebra", () => {
    for (const pob of [POR_NIVEL, POR_ATO]) {
      const plano = planoDeExemplo(pob);
      for (const [nivel, ato] of [[1, 1], [12, 2], [40, 5], [95, 11]]) {
        const guia = montarGuia(plano, { nivel, ato }, arvore);
        if (guia) conferirGuia(guia, arvore);
      }
    }
  });
});

describe("a árvore do jeito que o Rust recebe", () => {
  it("vetores do mesmo tamanho, na mesma ordem dos nós, e ligações dentro da faixa", () => {
    const arvore = real();
    const s = paraOSistema(arvore);
    expect(s.versao).toBe("3.30.0");
    expect(s.ids.length).toBe(2321);
    expect(s.xs.length).toBe(2321);
    expect(s.ys.length).toBe(2321);
    expect(s.tipos.length).toBe(2321);
    expect(s.ids.length).toBeLessThanOrEqual(6000);
    expect(s.ligacoes.length).toBe(2703 * 2);
    expect(s.ligacoes.every((p) => Number.isInteger(p) && p >= 0 && p < s.ids.length)).toBe(true);
    expect(s.xs.every(Number.isFinite) && s.ys.every(Number.isFinite)).toBe(true);
    arvore.nos.forEach((no, i) => {
      expect([s.ids[i], s.xs[i], s.ys[i], s.tipos[i]]).toEqual([no.id, no.x, no.y, no.tipo]);
    });
    expect(Object.keys(s).sort()).toEqual(["ids", "ligacoes", "tipos", "versao", "xs", "ys"]);
  });

  it("árvore pequena", () => {
    expect(paraOSistema(pequena())).toEqual({
      versao: "0.1",
      ids: PEQUENA.nos.map((n) => n[0]),
      xs: PEQUENA.nos.map((n) => n[1]),
      ys: PEQUENA.nos.map((n) => n[2]),
      tipos: PEQUENA.nos.map((n) => n[3]),
      ligacoes: PEQUENA.ligacoes,
    });
  });
});
