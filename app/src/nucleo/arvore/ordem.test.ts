import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { EtapaDeArvore } from "../plano";
import { lerArvore, TIPO, type ArvoreDoJogo } from "./dados";
import { acharInicio, ordenar, separarNos, sequenciaDeMarcos, type Ordem } from "./ordem";

// ---------------------------------------------------------------------------------------------
// Árvore pequena, feita à mão.
//
//   100 (início) ── 1001 ── 1002 ── 1003 (notável) ── 1004 (maestria)
//        │            │                 └── 1030 ── 1031 (joia) ── 1040 ── 200 (outro início) ── 1050
//        │            └── 1010 ── 1011 ── 1012 (pedra angular)
//        └── 1020 ── 1021 (notável) ── 1022 (maestria)
// ---------------------------------------------------------------------------------------------

const PEQUENA = {
  formato: 1,
  versao: "0.1",
  pob: ["0_1"],
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
  // Pares de posições em `nos`.
  ligacoes: [0, 2, 2, 3, 3, 4, 4, 5, 2, 6, 6, 7, 7, 8, 0, 9, 9, 10, 10, 11, 4, 12, 12, 13, 13, 14, 14, 1, 1, 15],
  classes: [
    { nome: "Marauder", inicio: 100, ascendencias: ["Juggernaut"] },
    { nome: "Witch", inicio: 200, ascendencias: [] },
  ],
  maestrias: {
    "Life Mastery": [
      [9001, "+50 to maximum Life"],
      [9002, "10% increased maximum Life"],
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

/** Uma etapa de árvore do plano, só com o que estas contas olham. */
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

/**
 * As propriedades da ordem que valem sempre: sem nó repetido; cada passo com caminho chega de um passo
 * anterior que é vizinho dele (ou do início), logo todo prefixo é ligado ao início; maestria vem depois
 * de um notável vizinho e ninguém passa por maestria; os soltos ficam juntos no fim do trecho do alvo.
 */
function conferir(arvore: ArvoreDoJogo, inicio: number, ordem: Ordem): void {
  const pos = (id: number): number => {
    const p = arvore.indice.get(id);
    if (p === undefined) throw new Error(`nó ${id} não existe na árvore`);
    return p;
  };
  const posicaoDoInicio = pos(inicio);
  const ids = ordem.passos.map((p) => p.no);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ordem.ate_alvo).toBeLessThanOrEqual(ordem.passos.length);

  let primeiroSolto = -1;
  ordem.passos.forEach((passo, i) => {
    const p = pos(passo.no);
    const no = arvore.nos[p];
    expect(no.tipo).not.toBe(TIPO.INICIO);
    if (passo.solto) {
      if (primeiroSolto < 0) primeiroSolto = i;
      expect(passo.pai).toBe(-1);
      expect(i).toBeLessThan(ordem.ate_alvo);
      return;
    }
    // Depois do primeiro solto, dentro do trecho do alvo, só vem solto.
    if (primeiroSolto >= 0) expect(i).toBeGreaterThanOrEqual(ordem.ate_alvo);
    expect(passo.pai).toBeGreaterThanOrEqual(-1);
    expect(passo.pai).toBeLessThan(i);
    if (passo.pai === -1) {
      expect(no.tipo).not.toBe(TIPO.MAESTRIA);
      expect(arvore.vizinhos[p].includes(posicaoDoInicio), `nó ${passo.no} ligado ao início`).toBe(true);
      return;
    }
    const pai = ordem.passos[passo.pai];
    const posicaoDoPai = pos(pai.no);
    expect(pai.solto).toBe(false);
    expect(arvore.nos[posicaoDoPai].tipo).not.toBe(TIPO.MAESTRIA);
    expect(arvore.vizinhos[p].includes(posicaoDoPai), `nó ${passo.no} ligado ao pai ${pai.no}`).toBe(true);
    if (no.tipo === TIPO.MAESTRIA) expect(arvore.nos[posicaoDoPai].tipo).toBe(TIPO.NOTAVEL);
  });

  expect([...ordem.manter].sort((a, b) => a - b)).toEqual(ordem.manter);
  expect([...ordem.devolver].sort((a, b) => a - b)).toEqual(ordem.devolver);
  const manter = new Set(ordem.manter);
  for (const id of ordem.devolver) expect(manter.has(id)).toBe(false);
}

const nosDe = (ordem: Ordem, de = 0, ate = ordem.passos.length) => ordem.passos.slice(de, ate).map((p) => p.no);

describe("separar os nós de uma etapa", () => {
  const arvore = pequena();

  it("conta cada tipo sem tratar nada como erro", () => {
    const e = etapa([100, 1001, 1002, 1003, 1004, 1022, 301, 65540, 70000, 4242, 1001], {
      maestrias: [{ no: 1004, efeito: 9001 }],
    });
    const nos = separarNos(e, arvore);
    expect(nos.principais).toEqual([1001, 1002, 1003, 1004]);
    expect(nos.inicios).toEqual([100]);
    expect([...nos.efeitos]).toEqual([[1004, 9001]]);
    expect(nos.ascendencia).toBe(1);
    expect(nos.cluster).toBe(2);
    expect(nos.desconhecidos).toBe(1);
    expect(nos.maestriasSemEfeito).toBe(1);
  });

  it("maestria sem par de efeito não conta: o PoB não aloca", () => {
    const nos = separarNos(etapa([1003, 1004]), arvore);
    expect(nos.principais).toEqual([1003]);
    expect(nos.maestriasSemEfeito).toBe(1);
  });

  it("etapa vazia dá tudo zerado", () => {
    const nos = separarNos(etapa([]), arvore);
    expect(nos.principais).toEqual([]);
    expect(nos.inicios).toEqual([]);
  });

  it("o início vem do nó de início da etapa; sem ele, do nome da classe", () => {
    expect(acharInicio(separarNos(etapa([100, 1001]), arvore), "", arvore)).toBe(100);
    expect(acharInicio(separarNos(etapa([200, 1040]), arvore), "Marauder", arvore)).toBe(200);
    expect(acharInicio(separarNos(etapa([200, 100, 1001]), arvore), "Marauder", arvore)).toBe(100);
    expect(acharInicio(separarNos(etapa([1001]), arvore), "witch", arvore)).toBe(200);
    expect(acharInicio(separarNos(etapa([1001]), arvore), "Bruxa", arvore)).toBeNull();
    expect(acharInicio(separarNos(etapa([1001]), arvore), "", arvore)).toBeNull();
  });
});

describe("sequência de marcos", () => {
  const principais = (e: EtapaDeArvore) => e.nos;
  const faixa = (de: number, ate: number) => Array.from({ length: ate - de }, (_, i) => de + i);

  it("com rótulos: as com gatilho antes do alvo, o alvo, e tudo o que vem depois", () => {
    const a = etapa(faixa(0, 10), { nivel_min: 12 });
    const b = etapa(faixa(0, 20), { ato_min: 3 });
    const c = etapa(faixa(0, 30), { nivel_min: 60 });
    const d = etapa(faixa(0, 40), { nivel_min: 90 });
    const solta = etapa(faixa(0, 50));
    const { marcos, depois } = sequenciaDeMarcos([a, b, c, d, solta], c, principais);
    expect(marcos).toEqual([a, b, c]);
    expect(depois).toEqual([d, solta]);
    expect(sequenciaDeMarcos([a, b, c, d, solta], a, principais)).toEqual({ marcos: [a], depois: [b, c, d, solta] });
  });

  it("com rótulos: etapa sem gatilho antes do alvo não é marco", () => {
    const inicial = etapa(faixa(0, 5));
    const a = etapa(faixa(0, 10), { nivel_min: 12 });
    const b = etapa(faixa(0, 20), { nivel_min: 30 });
    expect(sequenciaDeMarcos([inicial, a, b], b, principais).marcos).toEqual([a, b]);
  });

  it("com rótulos: a etapa inicial (sem rótulo, antes da primeira com rótulo) é marco", () => {
    const inicial = etapa(faixa(0, 5), { inicial: true, estimativa: 0 });
    const a = etapa(faixa(0, 10), { nivel_min: 12 });
    const b = etapa(faixa(0, 20), { nivel_min: 30 });
    expect(sequenciaDeMarcos([inicial, a, b], a, principais)).toEqual({ marcos: [inicial, a], depois: [b] });
    expect(sequenciaDeMarcos([inicial, a, b], b, principais).marcos).toEqual([inicial, a, b]);
  });

  it("sem rótulos: as menores parecidas viram marcos, as maiores parecidas vêm depois", () => {
    const alvo = etapa(faixa(0, 50));
    const pequena20 = etapa(faixa(0, 20));
    const pequena10 = etapa(faixa(0, 10));
    const outraBuild = etapa(faixa(500, 530));
    // 12 de 20 em comum = 0,6: ainda conta.
    const noLimite = etapa([...faixa(0, 12), ...faixa(900, 908)]);
    // 11 de 20 = 0,55: é outra build.
    const abaixo = etapa([...faixa(0, 11), ...faixa(900, 909)]);
    const maior = etapa(faixa(0, 80));
    const maiorDiferente = etapa([...faixa(0, 29), ...faixa(600, 660)]);
    const doMesmoTamanho = etapa(faixa(1, 51));
    const vazia = etapa([]);
    const { marcos, depois } = sequenciaDeMarcos(
      [maior, pequena20, outraBuild, alvo, noLimite, pequena10, abaixo, maiorDiferente, doMesmoTamanho, vazia],
      alvo,
      principais,
    );
    // Tamanho crescente; no empate (20 e 20), a ordem do PoB.
    expect(marcos).toEqual([pequena10, pequena20, noLimite, alvo]);
    expect(depois).toEqual([maior]);
  });

  it("uma etapa só: o único marco é o alvo", () => {
    const unica = etapa(faixa(0, 30));
    expect(sequenciaDeMarcos([unica], unica, principais)).toEqual({ marcos: [unica], depois: [] });
    const comRotulo = etapa(faixa(0, 30), { nivel_min: 40 });
    expect(sequenciaDeMarcos([comRotulo], comRotulo, principais)).toEqual({ marcos: [comRotulo], depois: [] });
  });

  it("alvo que não está na lista vira o único marco", () => {
    const a = etapa(faixa(0, 10), { nivel_min: 12 });
    const fora = etapa(faixa(0, 20), { nivel_min: 30 });
    expect(sequenciaDeMarcos([a], fora, principais)).toEqual({ marcos: [fora], depois: [] });
  });
});

describe("ordem numa árvore pequena", () => {
  const arvore = pequena();
  const TUDO = [1001, 1002, 1003, 1004, 1010, 1011, 1012, 1020, 1021, 1030, 1031];

  it("vai ao notável mais perto primeiro, e a maestria entra logo depois do notável dela", () => {
    const ordem = ordenar(arvore, 100, [TUDO], []);
    conferir(arvore, 100, ordem);
    expect(nosDe(ordem)).toEqual([1020, 1021, 1001, 1002, 1003, 1004, 1030, 1031, 1010, 1011, 1012]);
    expect(ordem.passos.map((p) => p.pai)).toEqual([-1, 0, -1, 2, 3, 4, 4, 6, 2, 8, 9]);
    expect(ordem.ate_alvo).toBe(11);
    expect(ordem.manter).toEqual(TUDO);
    expect(ordem.devolver).toEqual([]);
  });

  it("a ordem em que o PoB lista os nós não muda nada", () => {
    const direta = ordenar(arvore, 100, [TUDO], []);
    const invertida = ordenar(arvore, 100, [[...TUDO].reverse()], []);
    const repetida = ordenar(arvore, 100, [[...TUDO, ...TUDO]], []);
    expect(invertida).toEqual(direta);
    expect(repetida).toEqual(direta);
    expect(ordenar(arvore, 100, [TUDO], [])).toEqual(direta);
  });

  it("os marcos mandam: o que a etapa anterior já tinha vem antes", () => {
    // O marco antigo foi pela pedra angular; sem ele, o notável 1021 viria primeiro.
    // Depois, 1003 e 1021 estão à mesma distância do que já está feito: ganha o menor id.
    const ordem = ordenar(arvore, 100, [[1001, 1010, 1011, 1012], TUDO], []);
    conferir(arvore, 100, ordem);
    expect(nosDe(ordem, 0, 4)).toEqual([1001, 1010, 1011, 1012]);
    expect(nosDe(ordem, 4)).toEqual([1002, 1003, 1004, 1020, 1021, 1030, 1031]);
    expect(ordem.devolver).toEqual([]);
  });

  it("sem meta no lote, entra tudo o que dá pra alcançar, do mais perto pro mais longe", () => {
    const ordem = ordenar(arvore, 100, [[1001, 1002, 1010, 1020]], []);
    conferir(arvore, 100, ordem);
    expect(nosDe(ordem)).toEqual([1001, 1020, 1002, 1010]);
    expect(ordem.passos.map((p) => p.pai)).toEqual([-1, -1, 0, 0]);
  });

  it("respec: o que só o marco antigo tinha vira devolver e não entra na ordem", () => {
    const antigo = [1020, 1021, 1001, 1010, 1011];
    const alvo = [1001, 1002, 1003, 1004, 1030, 1031];
    const ordem = ordenar(arvore, 100, [antigo, alvo], []);
    conferir(arvore, 100, ordem);
    expect(nosDe(ordem)).toEqual([1001, 1002, 1003, 1004, 1030, 1031]);
    expect(ordem.devolver).toEqual([1010, 1011, 1020, 1021]);
    expect(ordem.manter).toEqual(alvo);
  });

  it("respec: nó que volta numa etapa de depois não é pra devolver", () => {
    const ordem = ordenar(arvore, 100, [[1020, 1021, 1001, 1010], [1001, 1002, 1003]], [[1001, 1002, 1003, 1020, 1021]]);
    conferir(arvore, 100, ordem);
    expect(ordem.devolver).toEqual([1010]);
    expect(ordem.ate_alvo).toBe(3);
    expect(nosDe(ordem, 3)).toEqual([1020, 1021]);
    expect(ordem.manter).toEqual([1001, 1002, 1003, 1020, 1021]);
  });

  it("as etapas de depois continuam a ordem a partir do que já está feito", () => {
    const ordem = ordenar(arvore, 100, [[1001, 1002, 1003]], [[1001, 1002, 1003, 1004, 1030, 1031], TUDO]);
    conferir(arvore, 100, ordem);
    expect(ordem.ate_alvo).toBe(3);
    expect(nosDe(ordem)).toEqual([1001, 1002, 1003, 1004, 1030, 1031, 1020, 1021, 1010, 1011, 1012]);
  });

  it("nó sem caminho pelos nós da build fica solto no fim do trecho do alvo, por id", () => {
    // 1050 só se alcança passando pelo início de outra classe; 1012 ficou sem o 1011.
    const ordem = ordenar(arvore, 100, [[1001, 1002, 1050, 1012, 200]], [[1001, 1002, 1003, 1050]]);
    conferir(arvore, 100, ordem);
    expect(ordem.passos.slice(0, 4)).toEqual([
      { no: 1001, pai: -1, solto: false },
      { no: 1002, pai: 0, solto: false },
      { no: 1012, pai: -1, solto: true },
      { no: 1050, pai: -1, solto: true },
    ]);
    expect(ordem.ate_alvo).toBe(4);
    expect(nosDe(ordem, 4)).toEqual([1003]);
  });

  it("nunca passa pelo início de outra classe nem por maestria", () => {
    const ordem = ordenar(arvore, 100, [[1001, 1002, 1003, 1030, 1031, 1040, 200, 1050]], []);
    conferir(arvore, 100, ordem);
    expect(nosDe(ordem).includes(200)).toBe(false);
    expect(ordem.passos.find((p) => p.no === 1040)?.solto).toBe(false);
    expect(ordem.passos.find((p) => p.no === 1050)?.solto).toBe(true);
  });

  it("maestria cujo notável não está na build fica solta", () => {
    const ordem = ordenar(arvore, 100, [[1001, 1002, 1004]], []);
    conferir(arvore, 100, ordem);
    expect(ordem.passos).toEqual([
      { no: 1001, pai: -1, solto: false },
      { no: 1002, pai: 0, solto: false },
      { no: 1004, pai: -1, solto: true },
    ]);
  });

  it("maestria que só chega numa etapa de depois entra ligada ao notável já feito", () => {
    const ordem = ordenar(arvore, 100, [[1020, 1021]], [[1020, 1021, 1022]]);
    conferir(arvore, 100, ordem);
    expect(ordem.passos[2]).toEqual({ no: 1022, pai: 1, solto: false });
  });

  it("ids que a árvore não conhece são ignorados, sem estourar", () => {
    const ordem = ordenar(arvore, 100, [[1001, 5, 65540, 99999, 301, -1, 1.5, Number.NaN]], [[424242]]);
    conferir(arvore, 100, ordem);
    expect(nosDe(ordem)).toEqual([1001]);
    expect(ordem.manter).toEqual([1001]);
  });

  it("início que não existe: tudo fica solto", () => {
    const ordem = ordenar(arvore, 777, [[1001, 1002]], []);
    expect(ordem.passos.every((p) => p.solto)).toBe(true);
    expect(ordem.ate_alvo).toBe(2);
  });

  it("sem marcos e com marco vazio a ordem é vazia", () => {
    expect(ordenar(arvore, 100, [], [])).toEqual({ passos: [], ate_alvo: 0, manter: [], devolver: [] });
    expect(ordenar(arvore, 100, [[]], [])).toEqual({ passos: [], ate_alvo: 0, manter: [], devolver: [] });
  });
});

// ---------------------------------------------------------------------------------------------
// O arquivo de verdade: builds inventadas por busca no grafo, a partir de cada início de classe.
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

/** Sorteio com semente (mulberry32): o teste dá sempre o mesmo resultado. */
function sorteio(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cresce um conjunto ligado ao início, um nó vizinho por vez (sem maestria e sem início de classe),
 * puxando pros notáveis como uma build de verdade. Devolve os ids na ordem em que entraram.
 */
function crescer(arvore: ArvoreDoJogo, inicio: number, quantos: number, semente: number): number[] {
  const acaso = sorteio(semente);
  const dentro = new Set<number>();
  const borda: number[] = [];
  const naBorda = new Set<number>();
  const abrir = (p: number) => {
    for (const v of arvore.vizinhos[p]) {
      const tipo = arvore.nos[v].tipo;
      if (dentro.has(v) || naBorda.has(v) || tipo === TIPO.MAESTRIA || tipo === TIPO.INICIO) continue;
      naBorda.add(v);
      borda.push(v);
    }
  };
  const posicaoDoInicio = arvore.indice.get(inicio);
  if (posicaoDoInicio === undefined) throw new Error("início desconhecido");
  abrir(posicaoDoInicio);
  const saida: number[] = [];
  while (saida.length < quantos && borda.length > 0) {
    // Metade das vezes, o nó mais novo da borda (anda em linha); na outra metade, um qualquer (abre ramos).
    const i = acaso() < 0.5 ? borda.length - 1 : Math.floor(acaso() * borda.length);
    const [p] = borda.splice(i, 1);
    naBorda.delete(p);
    dentro.add(p);
    saida.push(arvore.nos[p].id);
    abrir(p);
  }
  return saida;
}

/** As maestrias vizinhas dos notáveis do conjunto: duas em cada três com efeito escolhido, o resto sem. */
function maestriasDe(arvore: ArvoreDoJogo, ids: number[]): { com: { no: number; efeito: number }[]; sem: number[] } {
  const com: { no: number; efeito: number }[] = [];
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
      if (vistas.size % 3 !== 0 && efeitos.length > 0) com.push({ no: no.id, efeito: efeitos[0][0] });
      else sem.push(no.id);
    }
  }
  return { com, sem };
}

const TAMANHOS = [20, 45, 80, 115];
const NIVEIS = [12, 30, 55, 80];

/** Etapa realista: início da classe + nós da árvore + maestrias + ascendência + cluster + id que não existe. */
function etapaReal(arvore: ArvoreDoJogo, inicio: number, ids: number[], extra: Partial<EtapaDeArvore> = {}): EtapaDeArvore {
  const { com, sem } = maestriasDe(arvore, ids);
  const deAscendencia = [...arvore.ascendencia.keys()].slice(0, 6);
  return etapa([inicio, ...ids, ...com.map((m) => m.no), ...sem, ...deAscendencia, 65536, 65537, 70123], {
    maestrias: com,
    versao: "3_30",
    ...extra,
  });
}

function ordenarEtapas(arvore: ArvoreDoJogo, inicio: number, etapas: EtapaDeArvore[], alvo: EtapaDeArvore): Ordem {
  const principais = (e: EtapaDeArvore) => separarNos(e, arvore).principais;
  const { marcos, depois } = sequenciaDeMarcos(etapas, alvo, principais);
  return ordenar(arvore, inicio, marcos.map(principais), depois.map(principais));
}

describe("ordem com a árvore de verdade", () => {
  const arvore = real();

  for (const classe of arvore.classes) {
    describe(`a partir de ${classe.nome}`, () => {
      const semente = classe.inicio;
      const crescimento = crescer(arvore, classe.inicio, 115, semente);
      const etapas = TAMANHOS.map((tamanho, i) =>
        etapaReal(arvore, classe.inicio, crescimento.slice(0, tamanho), { nivel_min: NIVEIS[i], titulo: `Level ${NIVEIS[i]}` }),
      );
      const principais = etapas.map((e) => separarNos(e, arvore).principais);

      it("a build inventada tem o tamanho pedido, notáveis e maestrias com e sem efeito", () => {
        expect(crescimento.length).toBe(115);
        const ultima = separarNos(etapas[3], arvore);
        expect(ultima.inicios).toEqual([classe.inicio]);
        expect(ultima.efeitos.size).toBeGreaterThan(0);
        expect(ultima.maestriasSemEfeito).toBeGreaterThan(0);
        expect(ultima.ascendencia).toBe(6);
        expect(ultima.cluster).toBe(3);
        expect(ultima.principais.length).toBe(115 + ultima.efeitos.size);
        const notaveis = crescimento.filter((id) => arvore.nos[arvore.indice.get(id) ?? 0].tipo === TIPO.NOTAVEL);
        expect(notaveis.length).toBeGreaterThan(3);
      });

      TAMANHOS.forEach((tamanho, k) => {
        it(`alvo de ${tamanho} nós: todo prefixo é ligado, o trecho do alvo é exatamente a etapa, sem solto`, () => {
          const ordem = ordenarEtapas(arvore, classe.inicio, etapas, etapas[k]);
          conferir(arvore, classe.inicio, ordem);
          expect(ordem.passos.some((p) => p.solto)).toBe(false);
          expect(ordem.ate_alvo).toBe(principais[k].length);
          expect(new Set(nosDe(ordem, 0, ordem.ate_alvo))).toEqual(new Set(principais[k]));
          // As etapas de depois completam a ordem até a última árvore.
          expect(new Set(nosDe(ordem))).toEqual(new Set(principais[3]));
          expect(ordem.manter).toEqual([...new Set(principais[3])].sort((a, b) => a - b));
          expect(ordem.devolver).toEqual([]);
        });

        it(`alvo de ${tamanho} nós: cada marco fecha antes de o seguinte começar`, () => {
          const ordem = ordenarEtapas(arvore, classe.inicio, etapas, etapas[k]);
          const quando = new Map(ordem.passos.map((p, i) => [p.no, i]));
          for (let j = 0; j < 3; j++) {
            const doMarco = new Set(principais[j]);
            let ultimoDoMarco = -1;
            let primeiroDeFora = ordem.passos.length;
            for (const [no, i] of quando) {
              if (doMarco.has(no)) ultimoDoMarco = Math.max(ultimoDoMarco, i);
              else primeiroDeFora = Math.min(primeiroDeFora, i);
            }
            expect(ultimoDoMarco).toBe(doMarco.size - 1);
            expect(primeiroDeFora).toBe(doMarco.size);
          }
        });
      });

      it("mesma entrada, mesma saída, mesmo com os nós embaralhados", () => {
        const ordem = ordenarEtapas(arvore, classe.inicio, etapas, etapas[2]);
        expect(ordenarEtapas(arvore, classe.inicio, etapas, etapas[2])).toEqual(ordem);
        const acaso = sorteio(semente + 1);
        const embaralhadas = etapas.map((e) => ({
          ...e,
          nos: e.nos
            .map((no) => ({ no, peso: acaso() }))
            .sort((a, b) => a.peso - b.peso)
            .map((x) => x.no),
        }));
        expect(ordenarEtapas(arvore, classe.inicio, embaralhadas, embaralhadas[2])).toEqual(ordem);
      });

      it("etapa única: a ordem sai só da regra do notável mais perto", () => {
        const unica = etapaReal(arvore, classe.inicio, crescimento.slice(0, 80));
        const ordem = ordenarEtapas(arvore, classe.inicio, [unica], unica);
        conferir(arvore, classe.inicio, ordem);
        const esperados = separarNos(unica, arvore).principais;
        expect(ordem.ate_alvo).toBe(esperados.length);
        expect(ordem.passos.length).toBe(esperados.length);
        expect(ordem.passos.some((p) => p.solto)).toBe(false);
        // O primeiro passo que não é nó comum é o notável (ou joia) mais perto do início.
        const primeiraMeta = ordem.passos.findIndex((p) => arvore.nos[arvore.indice.get(p.no) ?? 0].tipo !== TIPO.NORMAL);
        expect(primeiraMeta).toBeGreaterThanOrEqual(0);
        for (let i = 1; i <= primeiraMeta; i++) expect(ordem.passos[i].pai).toBe(i - 1);
        expect(ordem.passos[0].pai).toBe(-1);
      });

      it("etapas sem gatilho: as menores viram marcos e as maiores vêm depois", () => {
        const semRotulo = TAMANHOS.map((tamanho) => etapaReal(arvore, classe.inicio, crescimento.slice(0, tamanho)));
        // Uma build de outra classe, do outro lado da árvore: não tem parentesco, fica de fora.
        const vizinha = arvore.classes[(arvore.classes.indexOf(classe) + 3) % arvore.classes.length];
        const outra = etapaReal(arvore, vizinha.inicio, crescer(arvore, vizinha.inicio, 30, semente + 99));
        // Fora de ordem de propósito: quem manda é o tamanho.
        const lista = [semRotulo[3], outra, semRotulo[1], semRotulo[0], semRotulo[2]];
        const comRotulo = ordenarEtapas(arvore, classe.inicio, etapas, etapas[2]);
        const ordem = ordenarEtapas(arvore, classe.inicio, lista, semRotulo[2]);
        conferir(arvore, classe.inicio, ordem);
        expect(ordem).toEqual(comRotulo);
      });

      it("respec: os nós que só a árvore antiga tinha viram devolver", () => {
        const antiga = crescer(arvore, classe.inicio, 45, semente + 7);
        const nova = crescer(arvore, classe.inicio, 80, semente + 13);
        const etapaAntiga = etapaReal(arvore, classe.inicio, antiga, { nivel_min: 30 });
        const etapaNova = etapaReal(arvore, classe.inicio, nova, { nivel_min: 60 });
        const ordem = ordenarEtapas(arvore, classe.inicio, [etapaAntiga, etapaNova], etapaNova);
        conferir(arvore, classe.inicio, ordem);
        const daAntiga = separarNos(etapaAntiga, arvore).principais;
        const daNova = new Set(separarNos(etapaNova, arvore).principais);
        const esperado = daAntiga.filter((id) => !daNova.has(id)).sort((a, b) => a - b);
        expect(esperado.length).toBeGreaterThan(0);
        expect(ordem.devolver).toEqual(esperado);
        expect(new Set(nosDe(ordem))).toEqual(daNova);
        expect(ordem.ate_alvo).toBe(daNova.size);
        expect(ordem.passos.some((p) => p.solto)).toBe(false);
        for (const id of ordem.devolver) expect(nosDe(ordem).includes(id)).toBe(false);
      });
    });
  }

  it("ids falsos em sequência (1000, 1001…) não quebram nada", () => {
    const falsos = Array.from({ length: 120 }, (_, i) => 1000 + i);
    const marauder = arvore.classes[1].inicio;
    const menor = etapa(falsos.slice(0, 34), { nivel_min: 12 });
    const maior = etapa(falsos, { nivel_min: 60 });
    const ordem = ordenarEtapas(arvore, marauder, [menor, maior], maior);
    conferir(arvore, marauder, ordem);
    const conhecidos = falsos.filter((id) => {
      const p = arvore.indice.get(id);
      return p !== undefined && arvore.nos[p].tipo !== TIPO.INICIO && arvore.nos[p].tipo !== TIPO.MAESTRIA;
    });
    expect(ordem.passos.length).toBe(conhecidos.length);
    expect(ordem.ate_alvo).toBe(conhecidos.length);
  });

  it("a árvore inteira de uma vez: tudo entra e nada fica solto", () => {
    const todos = arvore.nos.filter((n) => n.tipo !== TIPO.INICIO && n.tipo !== TIPO.MAESTRIA).map((n) => n.id);
    const scion = arvore.classes[0].inicio;
    const ordem = ordenar(arvore, scion, [todos], []);
    conferir(arvore, scion, ordem);
    expect(ordem.passos.length).toBe(todos.length);
    expect(ordem.passos.filter((p) => p.solto).length).toBe(0);
  });
});
