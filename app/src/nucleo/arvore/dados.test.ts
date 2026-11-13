import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { lerArvore, PRIMEIRO_ID_DE_CLUSTER, TIPO, VERSAO_DOS_DADOS } from "./dados";

const ARQUIVO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "dados", "arvore", "arvore.json");
const json: unknown = JSON.parse(readFileSync(ARQUIVO, "utf8"));

describe("arquivo de dados da árvore", () => {
  const arvore = lerArvore(json);

  it("o arquivo que vai no app é lido inteiro", () => {
    expect(arvore).not.toBeNull();
    if (!arvore) return;
    expect(arvore.versao).toBe("3.30.0");
    // A tela de opções diz esta versão sem carregar o arquivo: as duas têm de andar juntas.
    expect(VERSAO_DOS_DADOS).toBe(arvore.versao);
    expect(arvore.pob).toEqual(["3_30", "3_30_ruthless"]);
    expect(arvore.nos.length).toBe(2321);
    expect(arvore.ligacoes.length).toBe(2703 * 2);
    expect(arvore.classes.length).toBe(7);
    expect(arvore.indice.size).toBe(2321);
    expect(arvore.efeitos.size).toBeGreaterThan(300);
    expect(arvore.ascendencia.size).toBeGreaterThan(300);
  });

  it("os nós estão por id crescente, com coordenadas de verdade e sem id de cluster", () => {
    if (!arvore) return;
    for (let i = 0; i < arvore.nos.length; i++) {
      const no = arvore.nos[i];
      if (i > 0) expect(no.id).toBeGreaterThan(arvore.nos[i - 1].id);
      expect(arvore.indice.get(no.id)).toBe(i);
      expect(Number.isFinite(no.x) && Number.isFinite(no.y)).toBe(true);
      expect(no.id).toBeLessThan(PRIMEIRO_ID_DE_CLUSTER);
      expect(no.tipo).toBeGreaterThanOrEqual(TIPO.NORMAL);
      expect(no.tipo).toBeLessThanOrEqual(TIPO.JOIA_GRANDE);
    }
  });

  it("quantos nós há de cada tipo", () => {
    if (!arvore) return;
    const quantos = new Map<number, number>();
    for (const no of arvore.nos) quantos.set(no.tipo, (quantos.get(no.tipo) ?? 0) + 1);
    expect(quantos.get(TIPO.NORMAL)).toBe(1476);
    expect(quantos.get(TIPO.NOTAVEL)).toBe(454);
    expect(quantos.get(TIPO.CHAVE)).toBe(48);
    expect(quantos.get(TIPO.JOIA)).toBe(15);
    expect(quantos.get(TIPO.MAESTRIA)).toBe(315);
    expect(quantos.get(TIPO.INICIO)).toBe(7);
    expect(quantos.get(TIPO.JOIA_GRANDE)).toBe(6);
  });

  it("os vizinhos são simétricos, sem repetição, por id crescente, e batem com as ligações", () => {
    if (!arvore) return;
    let pontas = 0;
    arvore.vizinhos.forEach((lista, i) => {
      pontas += lista.length;
      expect(new Set(lista).size).toBe(lista.length);
      expect(lista.includes(i)).toBe(false);
      for (let k = 0; k < lista.length; k++) {
        if (k > 0) expect(lista[k]).toBeGreaterThan(lista[k - 1]);
        expect(arvore.vizinhos[lista[k]].includes(i)).toBe(true);
      }
    });
    expect(pontas).toBe(2703 * 2);
    expect(arvore.vizinhos.every((lista) => lista.length > 0)).toBe(true);
  });

  it("cada classe começa num nó de início diferente, que tem vizinhos", () => {
    if (!arvore) return;
    expect(arvore.classes.map((c) => c.nome)).toEqual([
      "Scion",
      "Marauder",
      "Ranger",
      "Witch",
      "Duelist",
      "Templar",
      "Shadow",
    ]);
    const inicios = new Set(arvore.classes.map((c) => c.inicio));
    expect(inicios.size).toBe(7);
    for (const classe of arvore.classes) {
      const posicao = arvore.indice.get(classe.inicio);
      expect(posicao).toBeDefined();
      if (posicao === undefined) continue;
      expect(arvore.nos[posicao].tipo).toBe(TIPO.INICIO);
      expect(arvore.vizinhos[posicao].length).toBeGreaterThanOrEqual(2);
      expect(classe.ascendencias.length).toBe(3);
    }
  });

  it("toda maestria só se liga a notáveis", () => {
    if (!arvore) return;
    arvore.nos.forEach((no, i) => {
      if (no.tipo !== TIPO.MAESTRIA) return;
      expect(arvore.vizinhos[i].length).toBeGreaterThan(0);
      for (const v of arvore.vizinhos[i]) expect(arvore.nos[v].tipo).toBe(TIPO.NOTAVEL);
    });
  });

  it("nenhum id de ascendência repete um id da árvore principal", () => {
    if (!arvore) return;
    for (const id of arvore.ascendencia.keys()) expect(arvore.indice.has(id)).toBe(false);
  });
});

describe("formato do arquivo", () => {
  const minimo = () => ({
    formato: 1,
    versao: "0.0",
    pob: ["0_0"],
    nos: [
      [1, 0, 0, 5, 0, 0, "A"],
      [2, 10, 0, 0, 0, 0, "B"],
    ],
    ligacoes: [0, 1],
    classes: [{ nome: "A", inicio: 1, ascendencias: [] }],
  });

  it("aceita o mínimo e junta ligação repetida", () => {
    const arvore = lerArvore({ ...minimo(), ligacoes: [0, 1, 1, 0] });
    expect(arvore?.vizinhos).toEqual([[1], [0]]);
    expect(arvore?.efeitos.size).toBe(0);
  });

  it("recusa o que não é o formato esperado, sem estourar", () => {
    expect(lerArvore(null)).toBeNull();
    expect(lerArvore("texto")).toBeNull();
    expect(lerArvore([])).toBeNull();
    expect(lerArvore({ ...minimo(), formato: 2 })).toBeNull();
    expect(lerArvore({ ...minimo(), ligacoes: [0] })).toBeNull();
    expect(lerArvore({ ...minimo(), ligacoes: [0, 2] })).toBeNull();
    expect(lerArvore({ ...minimo(), ligacoes: [0, 0] })).toBeNull();
    expect(lerArvore({ ...minimo(), ligacoes: [0, 0.5] })).toBeNull();
    expect(lerArvore({ ...minimo(), nos: [[1, 0, 0, 5, 0, 0, "A"], [1, 0, 0, 0, 0, 0, "B"]] })).toBeNull();
    expect(lerArvore({ ...minimo(), nos: [[1, 0, 0, 5, 0, 0]] })).toBeNull();
    expect(lerArvore({ ...minimo(), nos: [[1, Number.NaN, 0, 5, 0, 0, "A"]] })).toBeNull();
    expect(lerArvore({ ...minimo(), classes: [{ nome: "A" }] })).toBeNull();
  });
});
