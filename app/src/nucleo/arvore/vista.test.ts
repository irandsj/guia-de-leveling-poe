import { describe, expect, it } from "vitest";

import type { SituacaoDaArvore } from "../../backend";
import type { GuiaDaArvore, PassoDoGuia } from "./guia";
import { pontosAte } from "./pontos";
import { NOS_A_VISTA, serve, vistaDaArvore, type GuiaDoPainel } from "./vista";

function passo(no: number, pai: number, solto = false): PassoDoGuia {
  return { no, pai, nome: `Nó ${no}`, tipo: 0, rotulo: null, solto };
}

/** Um guia de 6 passos até o alvo (os 2 últimos soltos) e mais 2 depois dele. */
function guiaDe(extra: Partial<GuiaDaArvore> = {}): GuiaDaArvore {
  return {
    build: "sha256:a",
    versao: "0.1",
    etapa: "Level 12",
    inicio: 100,
    ordem: [
      passo(1, -1),
      passo(2, 0),
      passo(3, 1),
      passo(4, 2),
      passo(50, -1, true),
      passo(51, -1, true),
      passo(7, 3),
      passo(8, 6),
    ],
    ate_alvo: 6,
    manter: [1, 2, 3, 4, 7, 8, 50, 51],
    devolver: [90],
    texto: "Árvore até Level 12",
    numerados: 8,
    avisos: [],
    ...extra,
  };
}

function painelDe(guia: GuiaDaArvore = guiaDe()): GuiaDoPainel {
  return { guia, nomes: new Map([[90, "Nó velho"]]) };
}

/** Uma situação do mesmo guia, do jeito que o programa manda. */
function situacaoDe(guia: GuiaDaArvore, extra: Partial<SituacaoDaArvore> = {}): SituacaoDaArvore {
  return {
    aberta: true,
    vista: true,
    build: guia.build,
    ate_alvo: guia.ate_alvo,
    passos: guia.ordem.length,
    zoom: 3,
    feitos: 0,
    total: guia.ate_alvo,
    proximos: [],
    devolver: [],
    aviso: null,
    diag: null,
    ...extra,
  };
}

const NIVEL_1 = { nivel: 1, ato: 1 };

describe("a situação da foto só vale pro guia de que ela fala", () => {
  const guia = guiaDe();

  it("vale quando build, ate_alvo e passos batem", () => {
    expect(serve(guia, situacaoDe(guia, { feitos: 1, proximos: [1, 2] }))).toBe(true);
  });

  it("não vale sem situação, antes de a árvore ser vista ou sem guia no programa", () => {
    expect(serve(guia, null)).toBe(false);
    expect(serve(guia, situacaoDe(guia, { vista: false }))).toBe(false);
    expect(serve(guia, situacaoDe(guia, { build: "", ate_alvo: 0, passos: 0 }))).toBe(false);
  });

  it("não vale se for de outra build, de outra etapa ou de uma ordem de outro tamanho", () => {
    expect(serve(guia, situacaoDe(guia, { build: "sha256:b" }))).toBe(false);
    expect(serve(guia, situacaoDe(guia, { ate_alvo: 4 }))).toBe(false);
    expect(serve(guia, situacaoDe(guia, { passos: 7 }))).toBe(false);
  });

  it("não vale com índice fora da ordem", () => {
    expect(serve(guia, situacaoDe(guia, { proximos: [1, 8] }))).toBe(false);
    expect(serve(guia, situacaoDe(guia, { proximos: [-1] }))).toBe(false);
    expect(serve(guia, situacaoDe(guia, { proximos: [1.5] }))).toBe(false);
  });

  it("o nome da build é comparado com o mesmo corte de 400 letras que o programa faz", () => {
    const comprido = guiaDe({ build: "é".repeat(450) });
    expect(serve(comprido, situacaoDe(comprido, { build: "é".repeat(400) }))).toBe(true);
    expect(serve(comprido, situacaoDe(comprido, { build: "é".repeat(399) }))).toBe(false);
  });
});

describe("o que o painel mostra da árvore", () => {
  it("foto de outro guia: cai na estimativa pelo nível, sem os próximos nem o 'tirar' do guia antigo", () => {
    const guia = guiaDe();
    // A etapa antiga estava completa: sem o conserto, o painel diria "completa" na etapa nova.
    const antiga = situacaoDe(guia, { build: "sha256:outra", feitos: 6, total: 6, proximos: [], devolver: [90] });
    const vista = vistaDaArvore(painelDe(guia), antiga, NIVEL_1, false);
    const semFoto = vistaDaArvore(painelDe(guia), null, NIVEL_1, false);
    expect(vista.estimada).toBe(true);
    expect(vista.tirar).toEqual([]);
    expect(vista.faltam).toBe(semFoto.faltam);
    expect(vista.faltam).toBeGreaterThan(0);
    expect(vista.linhas).toEqual(semFoto.linhas);
    // Mesma build, outra etapa (o `ate_alvo` é outro): também não vale.
    const outraEtapa = situacaoDe(guia, { ate_alvo: 3, total: 3, feitos: 3 });
    expect(vistaDaArvore(painelDe(guia), outraEtapa, NIVEL_1, false).estimada).toBe(true);
  });

  it("árvore vista: os próximos levam os números da foto e o resto antes deles está feito", () => {
    const guia = guiaDe();
    const situacao = situacaoDe(guia, { feitos: 2, proximos: [2, 3, 6, 7], devolver: [90, 91] });
    const jogo = vistaDaArvore(painelDe(guia), situacao, NIVEL_1, false);
    expect(jogo.estimada).toBe(false);
    expect(jogo.aberta).toBe(true);
    expect(jogo.faltam).toBe(4);
    expect(jogo.linhas.map((l) => [l.indice, l.numero])).toEqual([[2, 1], [3, 2], [6, 3]].slice(0, NOS_A_VISTA));
    // Faltam 4, 2 da etapa estão listados (o terceiro listado é de depois do alvo).
    expect(jogo.mais).toBe(2);
    expect(jogo.mais_sem_caminho).toBe(false);
    expect(jogo.tirar).toEqual(["Nó velho", "nó 91"]);

    const edicao = vistaDaArvore(painelDe(guia), situacao, NIVEL_1, true);
    expect(edicao.linhas.map((l) => [l.indice, l.numero, l.feito])).toEqual([
      [0, null, true],
      [1, null, true],
      [2, 1, false],
      [3, 2, false],
      [4, null, false],
      [5, null, false],
      [6, 3, false],
      [7, 4, false],
    ]);
    expect(edicao.mais).toBe(0);
  });

  it("árvore vista, sem próximos e faltando só nós sem caminho: os pegos levam ✓ e o painel diz o que falta", () => {
    const guia = guiaDe();
    const situacao = situacaoDe(guia, { feitos: 4, total: 6, proximos: [] });
    const edicao = vistaDaArvore(painelDe(guia), situacao, NIVEL_1, true);
    expect(edicao.faltam).toBe(2);
    expect(edicao.linhas.map((l) => [l.indice, l.feito])).toEqual([
      [0, true],
      [1, true],
      [2, true],
      [3, true],
      [4, false],
      [5, false],
    ]);
    const jogo = vistaDaArvore(painelDe(guia), situacao, NIVEL_1, false);
    expect(jogo.linhas).toEqual([]);
    expect(jogo.mais).toBe(2);
    expect(jogo.mais_sem_caminho).toBe(true);
  });

  it("etapa completa: tudo feito, nada a mais", () => {
    const guia = guiaDe({ ordem: guiaDe().ordem.filter((p) => !p.solto).map((p, i) => ({ ...p, pai: i - 1 })), ate_alvo: 4 });
    const situacao = situacaoDe(guia, { feitos: 4, total: 4 });
    const edicao = vistaDaArvore(painelDe(guia), situacao, NIVEL_1, true);
    expect(edicao.faltam).toBe(0);
    expect(edicao.linhas.every((l) => l.feito)).toBe(true);
    const jogo = vistaDaArvore(painelDe(guia), situacao, NIVEL_1, false);
    expect([jogo.mais, jogo.mais_sem_caminho]).toEqual([0, false]);
  });

  it("completa = não sobrou nó com caminho pra pegar na etapa (os soltos não seguram)", () => {
    const guia = guiaDe();
    // Vista: sem próximos no trecho do alvo, mesmo faltando os 2 soltos.
    expect(vistaDaArvore(painelDe(guia), situacaoDe(guia, { feitos: 4, total: 6, proximos: [] }), NIVEL_1, false).completa).toBe(true);
    expect(vistaDaArvore(painelDe(guia), situacaoDe(guia, { feitos: 3, total: 6, proximos: [3] }), NIVEL_1, false).completa).toBe(false);
    // Estimada: os pontos do nível já cobrem os 4 nós com caminho.
    expect(vistaDaArvore(painelDe(guia), null, { nivel: 3, ato: 1 }, false).completa).toBe(false);
    expect(vistaDaArvore(painelDe(guia), null, { nivel: 30, ato: 3 }, false).completa).toBe(true);
  });

  it("antes de ver a árvore: supõe os pontos do nível gastos na ordem, pulando os soltos", () => {
    const guia = guiaDe();
    const onde = { nivel: 3, ato: 1 };
    const gastos = pontosAte(onde.nivel, onde.ato);
    expect(gastos).toBe(2);
    const vista = vistaDaArvore(painelDe(guia), null, onde, true);
    expect(vista.estimada).toBe(true);
    expect(vista.aberta).toBe(false);
    expect(vista.faltam).toBe(4);
    expect(vista.linhas.map((l) => [l.indice, l.numero, l.feito])).toEqual([
      [0, null, true],
      [1, null, true],
      [2, 1, false],
      [3, 2, false],
      [4, null, false],
      [5, null, false],
    ]);
    expect(vista.mais_sem_caminho).toBe(false);
    expect(vistaDaArvore(painelDe(guia), null, onde, false).mais).toBe(2);
  });
});
