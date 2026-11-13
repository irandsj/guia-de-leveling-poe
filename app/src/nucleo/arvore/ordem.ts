// A ordem em que os nós da build entram: separa os nós de cada etapa do PoB, escolhe os marcos
// (as etapas que vêm antes do alvo) e monta uma sequência em que cada nó já está ligado ao que veio antes.
// Só contas, sem aleatoriedade: a mesma entrada dá sempre a mesma saída.

import type { EtapaDeArvore } from "../plano";
import { PRIMEIRO_ID_DE_CLUSTER, TIPO, type ArvoreDoJogo } from "./dados";

/** Os nós de uma etapa do PoB, já separados por tipo. */
export interface NosDaEtapa {
  /** Ids da árvore principal que contam (sem o início da classe e sem maestria sem efeito), na ordem do PoB. */
  principais: number[];
  /** Id da maestria -> id do efeito escolhido. */
  efeitos: Map<number, number>;
  /** Ids de início de classe que vieram na etapa. */
  inicios: number[];
  /** Quantos são da árvore de ascendência. */
  ascendencia: number;
  /** Quantos são de joia cluster (id inventado pelo PoB). */
  cluster: number;
  /** Quantos a árvore do guia não conhece. */
  desconhecidos: number;
  /** Maestrias sem efeito escolhido: o PoB não aloca. */
  maestriasSemEfeito: number;
}

/** Separa os nós de uma etapa (seção 3.1 do desenho). Nada aqui é erro: conta e segue. */
export function separarNos(etapa: EtapaDeArvore, arvore: ArvoreDoJogo): NosDaEtapa {
  const escolhidos = new Map<number, number>();
  for (const m of etapa.maestrias) {
    if (!escolhidos.has(m.no)) escolhidos.set(m.no, m.efeito);
  }
  const saida: NosDaEtapa = {
    principais: [],
    efeitos: new Map(),
    inicios: [],
    ascendencia: 0,
    cluster: 0,
    desconhecidos: 0,
    maestriasSemEfeito: 0,
  };
  const vistos = new Set<number>();
  for (const id of etapa.nos) {
    if (vistos.has(id)) continue;
    vistos.add(id);
    const posicao = arvore.indice.get(id);
    const no = posicao === undefined ? undefined : arvore.nos[posicao];
    if (no === undefined) {
      if (arvore.ascendencia.has(id)) saida.ascendencia += 1;
      else if (id >= PRIMEIRO_ID_DE_CLUSTER) saida.cluster += 1;
      else saida.desconhecidos += 1;
      continue;
    }
    if (no.tipo === TIPO.INICIO) {
      saida.inicios.push(id);
      continue;
    }
    if (no.tipo === TIPO.MAESTRIA) {
      const efeito = escolhidos.get(id);
      if (efeito === undefined) {
        saida.maestriasSemEfeito += 1;
        continue;
      }
      saida.efeitos.set(id, efeito);
    }
    saida.principais.push(id);
  }
  return saida;
}

/**
 * O id do início da classe: o nó de início que veio na etapa alvo (se vier mais de um, o da classe do
 * plano); sem nenhum, a classe do plano pelo nome. `null` = não dá pra saber de onde a árvore começa.
 */
export function acharInicio(alvo: NosDaEtapa, classe: string, arvore: ArvoreDoJogo): number | null {
  const nome = classe.trim().toLowerCase();
  const daClasse = nome === "" ? undefined : arvore.classes.find((c) => c.nome.toLowerCase() === nome);
  if (alvo.inicios.length > 0) {
    if (daClasse !== undefined && alvo.inicios.includes(daClasse.inicio)) return daClasse.inicio;
    return alvo.inicios[0];
  }
  if (daClasse === undefined) return null;
  const posicao = arvore.indice.get(daClasse.inicio);
  if (posicao === undefined || arvore.nos[posicao].tipo !== TIPO.INICIO) return null;
  return daClasse.inicio;
}

/** A mesma regra de `conjuntos.ts`: a etapa tem rótulo de nível ou de ato. */
function temGatilho(etapa: EtapaDeArvore): boolean {
  return etapa.nivel_min !== null || etapa.ato_min !== null;
}

/** Fração mínima de nós em comum pra duas árvores sem rótulo serem a mesma build em momentos diferentes. */
const PARENTESCO_MINIMO = 0.6;

/** Os marcos (etapas anteriores + alvo, na ordem) e as etapas que vêm depois do alvo. */
export interface Marcos<T> {
  /** O último é sempre o alvo. */
  marcos: T[];
  depois: T[];
}

/**
 * Escolhe os marcos (seção 3.2 do desenho). `principais` devolve os nós principais de uma etapa.
 * Com rótulos, os marcos são as etapas com gatilho antes do alvo e a "inicial" (a árvore sem rótulo
 * que o PoB manda pegar antes da primeira com rótulo). Se o alvo não estiver em `etapas`, o único marco é ele.
 */
export function sequenciaDeMarcos<T extends EtapaDeArvore>(
  etapas: T[],
  alvo: T,
  principais: (etapa: T) => Iterable<number>,
): Marcos<T> {
  const posicao = etapas.indexOf(alvo);
  if (posicao < 0) return { marcos: [alvo], depois: [] };

  if (etapas.some(temGatilho)) {
    const antes = etapas.slice(0, posicao).filter((e) => temGatilho(e) || e.inicial);
    return { marcos: [...antes, alvo], depois: etapas.slice(posicao + 1) };
  }

  const doAlvo = new Set(principais(alvo));
  const menores: { etapa: T; tamanho: number }[] = [];
  const maiores: { etapa: T; tamanho: number }[] = [];
  for (const etapa of etapas) {
    if (etapa === alvo) continue;
    const dela = new Set(principais(etapa));
    if (dela.size === 0 || doAlvo.size === 0) continue;
    let comuns = 0;
    for (const id of dela) if (doAlvo.has(id)) comuns += 1;
    if (dela.size < doAlvo.size && comuns / dela.size >= PARENTESCO_MINIMO) {
      menores.push({ etapa, tamanho: dela.size });
    } else if (dela.size > doAlvo.size && comuns / doAlvo.size >= PARENTESCO_MINIMO) {
      maiores.push({ etapa, tamanho: dela.size });
    }
  }
  // `sort` é estável: no empate de tamanho fica a ordem do PoB.
  menores.sort((a, b) => a.tamanho - b.tamanho);
  maiores.sort((a, b) => a.tamanho - b.tamanho);
  return { marcos: [...menores.map((m) => m.etapa), alvo], depois: maiores.map((m) => m.etapa) };
}

/** Um nó na ordem. */
export interface PassoDaOrdem {
  /** Id do nó. */
  no: number;
  /** Posição na ordem do passo de onde se chega neste; -1 = início da classe. */
  pai: number;
  /** Sem caminho pelos nós da build: fica no fim do trecho do alvo e nunca leva número. */
  solto: boolean;
}

export interface Ordem {
  passos: PassoDaOrdem[];
  /** `passos[0..ate_alvo)` fecha a etapa alvo. */
  ate_alvo: number;
  /** Ids que a build quer (alvo + etapas de depois), por id crescente. */
  manter: number[];
  /** Ids que só os marcos antigos tinham, por id crescente. */
  devolver: number[];
}

/** O nó conta como meta de um trecho: notável, pedra angular ou encaixe de joia. */
function ehMeta(tipo: number): boolean {
  return tipo === TIPO.NOTAVEL || tipo === TIPO.CHAVE || tipo === TIPO.JOIA || tipo === TIPO.JOIA_GRANDE;
}

/**
 * Monta a ordem (seção 3.3 do desenho). `marcos` são os nós principais de cada marco, o último é o alvo;
 * `depois`, os das etapas que vêm depois. Ids que a árvore não conhece são ignorados.
 */
export function ordenar(
  arvore: ArvoreDoJogo,
  inicio: number,
  marcos: Iterable<number>[],
  depois: Iterable<number>[],
): Ordem {
  const total = arvore.nos.length;
  const posicaoDoInicio = arvore.indice.get(inicio) ?? -1;

  /** Ids -> posições em `arvore.nos`, só os que podem entrar na ordem. */
  const posicoes = (ids: Iterable<number>): Set<number> => {
    const saida = new Set<number>();
    for (const id of ids) {
      const p = arvore.indice.get(id);
      if (p !== undefined && arvore.nos[p].tipo !== TIPO.INICIO) saida.add(p);
    }
    return saida;
  };
  const dosMarcos = marcos.map(posicoes);
  const deDepois = depois.map(posicoes);
  const alvo = dosMarcos.length > 0 ? dosMarcos[dosMarcos.length - 1] : new Set<number>();

  const passos: PassoDaOrdem[] = [];
  /** Posição em `arvore.nos` -> posição em `passos`; -1 = ainda não entrou. */
  const passoDe = new Array<number>(total).fill(-1);
  /** Nós já na ordem que servem de ponto de partida (sem maestria e sem solto), na ordem em que entraram. */
  const fontes: number[] = [];
  const ehMaestria = (p: number) => arvore.nos[p].tipo === TIPO.MAESTRIA;
  /** O nó já está na ordem e dá pra chegar nele (não é maestria nem solto). */
  const firme = (p: number) => passoDe[p] >= 0 && !ehMaestria(p) && !passos[passoDe[p]].solto;

  const por = (p: number, pai: number) => {
    passoDe[p] = passos.length;
    passos.push({ no: arvore.nos[p].id, pai, solto: false });
    if (!ehMaestria(p)) fontes.push(p);
  };

  /** Põe, das candidatas, as maestrias pendentes que têm vizinho já feito (sempre o notável dela). */
  const porMaestrias = (pendentes: Set<number>, candidatas: number[]): boolean => {
    let andou = false;
    for (const m of candidatas) {
      if (!pendentes.has(m) || !ehMaestria(m)) continue;
      const pai = arvore.vizinhos[m].find(firme);
      if (pai === undefined) continue;
      pendentes.delete(m);
      por(m, passoDe[pai]);
      andou = true;
    }
    return andou;
  };

  const distancia = new Array<number>(total).fill(-1);
  const veioDe = new Array<number>(total).fill(-1);
  /** O passo de onde se chega em `p` pela busca; -1 quando é o início da classe. */
  const paiDe = (p: number) => (veioDe[p] >= 0 ? passoDe[veioDe[p]] : -1);

  const ordenarLote = (pendentes: Set<number>) => {
    // Cada volta põe pelo menos um nó ou acaba; o limite é só um cinto de segurança.
    for (let volta = 0; volta <= total && pendentes.size > 0; volta++) {
      // 1. Maestrias cujo notável já está feito. Posição crescente = id crescente.
      const entrouMaestria = porMaestrias(
        pendentes,
        [...pendentes].sort((a, b) => a - b),
      );

      // 2. Busca em largura a partir do início e de tudo o que já está feito.
      const alcancados: number[] = [];
      const fila: number[] = [];
      if (posicaoDoInicio >= 0) fila.push(posicaoDoInicio);
      for (const f of fontes) fila.push(f);
      for (const f of fila) distancia[f] = 0;
      for (let i = 0; i < fila.length; i++) {
        const atual = fila[i];
        for (const v of arvore.vizinhos[atual]) {
          if (distancia[v] >= 0 || !pendentes.has(v) || ehMaestria(v)) continue;
          distancia[v] = distancia[atual] + 1;
          veioDe[v] = atual;
          fila.push(v);
          alcancados.push(v);
        }
      }

      let meta: number | undefined;
      if (alcancados.length > 0) {
        alcancados.sort((a, b) => distancia[a] - distancia[b] || a - b);
        meta = alcancados.find((p) => ehMeta(arvore.nos[p].tipo));
        if (meta !== undefined) {
          // 3. O caminho até a meta mais próxima, do mais perto pro mais longe, e as maestrias dela.
          const caminho: number[] = [];
          for (let p = meta; p >= 0 && distancia[p] > 0; p = veioDe[p]) caminho.push(p);
          for (let i = caminho.length - 1; i >= 0; i--) {
            const p = caminho[i];
            pendentes.delete(p);
            por(p, paiDe(p));
          }
        } else {
          // 4. Sem meta: tudo o que dá pra alcançar, na ordem da busca.
          for (const p of alcancados) {
            pendentes.delete(p);
            por(p, paiDe(p));
          }
        }
      }

      // Limpa as marcas da busca pra próxima volta.
      for (const f of fila) {
        distancia[f] = -1;
        veioDe[f] = -1;
      }
      if (meta !== undefined) porMaestrias(pendentes, arvore.vizinhos[meta]);
      // 5. Nada andou: acabou o lote (o que sobrou fica pro próximo).
      if (alcancados.length === 0 && !entrouMaestria) break;
    }
  };

  // Trecho do alvo: a cada marco, o que ele e os anteriores têm em comum com o alvo.
  const acumulado = new Set<number>();
  for (const marco of dosMarcos) {
    for (const p of marco) acumulado.add(p);
    const lote = new Set<number>();
    for (const p of acumulado) if (alvo.has(p) && passoDe[p] < 0) lote.add(p);
    ordenarLote(lote);
  }
  // Os do alvo que ficaram sem caminho (ex.: pontes da Ascendant): no fim do trecho, por id, sem número.
  const soltos = [...alvo].filter((p) => passoDe[p] < 0).sort((a, b) => a - b);
  for (const p of soltos) {
    passoDe[p] = passos.length;
    passos.push({ no: arvore.nos[p].id, pai: -1, solto: true });
  }
  const ate_alvo = passos.length;

  const manter = new Set<number>(alvo);
  for (const etapa of deDepois) {
    for (const p of etapa) manter.add(p);
    const lote = new Set<number>();
    for (const p of etapa) if (passoDe[p] < 0) lote.add(p);
    ordenarLote(lote);
  }

  const devolver = new Set<number>();
  for (let j = 0; j < dosMarcos.length - 1; j++) {
    for (const p of dosMarcos[j]) if (!manter.has(p)) devolver.add(p);
  }
  const ids = (conjunto: Set<number>) => [...conjunto].sort((a, b) => a - b).map((p) => arvore.nos[p].id);
  return { passos, ate_alvo, manter: ids(manter), devolver: ids(devolver) };
}
