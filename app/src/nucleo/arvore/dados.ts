// A árvore de passivas do jogo, lida do arquivo enxuto `src/dados/arvore/arvore.json`
// (dados publicados pela Grinding Gear Games no skilltree-export; ver `src/dados/arvore/ORIGEM.md`).
// Só contas: quem carrega o arquivo é a ponte `src/arvore.ts`.

/** Tipos de nó, com os mesmos números do arquivo de dados. */
export const TIPO = {
  NORMAL: 0,
  NOTAVEL: 1,
  CHAVE: 2,
  JOIA: 3,
  MAESTRIA: 4,
  INICIO: 5,
  JOIA_GRANDE: 6,
  INICIO_DE_ASCENDENCIA: 7,
} as const;

/**
 * A versão do arquivo `src/dados/arvore/arvore.json`, pra tela dizer sem carregar o arquivo.
 * Um teste confere com o arquivo: ao trocar os dados (`scripts/gerar-arvore.mjs`), trocar aqui.
 */
export const VERSAO_DOS_DADOS = "3.30.0";

/** Do id 65536 pra cima são nós de joia cluster: o PoB inventa o id, a árvore do jogo não tem. */
export const PRIMEIRO_ID_DE_CLUSTER = 65536;

export interface NoDaArvore {
  id: number;
  x: number;
  y: number;
  tipo: number;
  grupo: number;
  orbita: number;
  nome: string;
}

export interface ClasseDaArvore {
  nome: string;
  /** Id do nó de início da classe. */
  inicio: number;
  /** Chaves das ascendências, na ordem do PoB (`ascendClassId` 1, 2, 3). */
  ascendencias: string[];
}

export interface ArvoreDoJogo {
  versao: string;
  /** Nomes de versão do PoB (`treeVersion`) que usam esta árvore. */
  pob: string[];
  /** Nós da árvore principal, por id crescente. */
  nos: NoDaArvore[];
  /** Id do nó -> posição em `nos`. */
  indice: Map<number, number>;
  /** Pra cada posição em `nos`, as posições dos vizinhos, por id crescente. */
  vizinhos: number[][];
  /** Pares de posições em `nos`, achatados. */
  ligacoes: number[];
  /** Índice = `classId` do PoB. */
  classes: ClasseDaArvore[];
  /** Id do efeito de maestria -> texto. */
  efeitos: Map<number, string>;
  /** Id de nó de ascendência -> nome do nó. */
  ascendencia: Map<number, string>;
  /** Id de nó de ascendência -> o resto do que se sabe dele. */
  nosDeAscendencia: Map<number, NoDeAscendencia>;
}

export interface NoDeAscendencia {
  nome: string;
  tipo: number;
  /** Nome da ascendência dona do nó ("Pathfinder"). */
  dona: string;
  /** Passos desde o início da ascendência pelas ligações (o início é 0; sem caminho, `Infinity`). */
  distancia: number;
}

/** Distância de cada nó (posição na lista) até o início, pelas ligações. */
function distancias(tipos: number[], ligacoes: unknown[]): number[] {
  const vizinhos = tipos.map(() => [] as number[]);
  for (let i = 0; i + 1 < ligacoes.length; i += 2) {
    const a = ligacoes[i];
    const b = ligacoes[i + 1];
    if (!numero(a) || !numero(b) || !vizinhos[a] || !vizinhos[b]) continue;
    vizinhos[a].push(b);
    vizinhos[b].push(a);
  }
  const distancia = tipos.map(() => Infinity);
  const fila = tipos.flatMap((tipo, i) => (tipo === TIPO.INICIO_DE_ASCENDENCIA ? [i] : []));
  for (const i of fila) distancia[i] = 0;
  for (let k = 0; k < fila.length; k++) {
    for (const v of vizinhos[fila[k]]) {
      if (distancia[v] !== Infinity) continue;
      distancia[v] = distancia[fila[k]] + 1;
      fila.push(v);
    }
  }
  return distancia;
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function numero(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Monta a árvore a partir do JSON do arquivo. Devolve `null` se o formato não for o esperado. */
export function lerArvore(json: unknown): ArvoreDoJogo | null {
  if (!ehObjeto(json) || json.formato !== 1 || typeof json.versao !== "string") return null;
  if (!Array.isArray(json.nos) || !Array.isArray(json.ligacoes) || !Array.isArray(json.classes)) return null;

  const nos: NoDaArvore[] = [];
  const indice = new Map<number, number>();
  for (const linha of json.nos as unknown[]) {
    if (!Array.isArray(linha) || linha.length < 7) return null;
    const [id, x, y, tipo, grupo, orbita, nome] = linha as unknown[];
    if (!numero(id) || !numero(x) || !numero(y) || !numero(tipo) || !numero(grupo) || !numero(orbita)) return null;
    if (typeof nome !== "string" || indice.has(id)) return null;
    indice.set(id, nos.length);
    nos.push({ id, x, y, tipo, grupo, orbita, nome });
  }

  const ligacoes = json.ligacoes as unknown[];
  if (ligacoes.length % 2 !== 0) return null;
  const vizinhos: number[][] = nos.map(() => []);
  for (let i = 0; i < ligacoes.length; i += 2) {
    const a = ligacoes[i];
    const b = ligacoes[i + 1];
    if (!numero(a) || !numero(b) || !Number.isInteger(a) || !Number.isInteger(b)) return null;
    if (a < 0 || b < 0 || a >= nos.length || b >= nos.length || a === b) return null;
    if (!vizinhos[a].includes(b)) vizinhos[a].push(b);
    if (!vizinhos[b].includes(a)) vizinhos[b].push(a);
  }
  // `nos` está por id crescente, então ordenar por posição é ordenar por id.
  for (const lista of vizinhos) lista.sort((p, q) => p - q);

  const classes: ClasseDaArvore[] = [];
  for (const c of json.classes as unknown[]) {
    if (!ehObjeto(c) || typeof c.nome !== "string" || !numero(c.inicio)) return null;
    const asc = Array.isArray(c.ascendencias) ? c.ascendencias.filter((a): a is string => typeof a === "string") : [];
    classes.push({ nome: c.nome, inicio: c.inicio, ascendencias: asc });
  }

  const efeitos = new Map<number, string>();
  if (ehObjeto(json.maestrias)) {
    for (const lista of Object.values(json.maestrias)) {
      if (!Array.isArray(lista)) continue;
      for (const par of lista as unknown[]) {
        if (Array.isArray(par) && numero(par[0]) && typeof par[1] === "string") efeitos.set(par[0], par[1]);
      }
    }
  }

  const ascendencia = new Map<number, string>();
  const nosDeAscendencia = new Map<number, NoDeAscendencia>();
  if (ehObjeto(json.ascendencias)) {
    for (const [chave, a] of Object.entries(json.ascendencias)) {
      if (!ehObjeto(a) || !Array.isArray(a.nos)) continue;
      const linhas = a.nos as unknown[];
      const tipos = linhas.map((linha) => (Array.isArray(linha) && numero(linha[3]) ? linha[3] : -1));
      const distancia = distancias(tipos, Array.isArray(a.ligacoes) ? (a.ligacoes as unknown[]) : []);
      const dona = typeof a.nome === "string" ? a.nome : chave;
      linhas.forEach((linha, i) => {
        if (!Array.isArray(linha) || !numero(linha[0]) || typeof linha[6] !== "string") return;
        ascendencia.set(linha[0], linha[6]);
        nosDeAscendencia.set(linha[0], { nome: linha[6], tipo: tipos[i], dona, distancia: distancia[i] });
      });
    }
  }

  const pob = Array.isArray(json.pob) ? json.pob.filter((p): p is string => typeof p === "string") : [];
  return {
    versao: json.versao,
    pob,
    nos,
    indice,
    vizinhos,
    ligacoes: ligacoes as number[],
    classes,
    efeitos,
    ascendencia,
    nosDeAscendencia,
  };
}
