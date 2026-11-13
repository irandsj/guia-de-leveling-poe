// Preferências do jogador (arquivo "preferencias"). O que vier quebrado do disco vira o padrão.

import { OPCOES_PADRAO, type OpcoesRota } from "./rota";

export const ESCALA_MIN = 0.8;
export const ESCALA_MAX = 1.6;
/** Opacidade do fundo do balão no jogo: 0 = só o texto, 1 = fundo sólido. */
export const OPACIDADE_MIN = 0;
export const OPACIDADE_MAX = 1;

/** O que aparece na tela durante o jogo (fora do modo de edição). */
export interface Mostrar {
  /** Os dois passos seguintes. */
  proximos: boolean;
  gemas_do_ato: boolean;
  conjunto: boolean;
  arvore: boolean;
  itens: boolean;
}

/**
 * As caixas de "mostrar durante o jogo". A árvore saiu da lista: a seção dela não aparece mais no
 * jogo (o desenho em cima da árvore do jogo já mostra os pontos); `mostrar.arvore` fica guardado.
 */
export const SECOES: { chave: keyof Mostrar; nome: string }[] = [
  { chave: "proximos", nome: "Próximos 2 passos" },
  { chave: "gemas_do_ato", nome: "Gemas do ato" },
  { chave: "conjunto", nome: "Conjunto de gemas" },
  { chave: "itens", nome: "Itens" },
];

/**
 * Os blocos do balão no jogo (expandido e detalhado), na ordem padrão. Cada um fecha e abre sozinho
 * e muda de lugar com os outros (as setas no cabeçalho do bloco). Fechado, fica só o cabeçalho, colado
 * no bloco de cima.
 */
export type IdDoBloco = "missoes" | "gemas" | "conjunto" | "itens" | "proximos";

export const BLOCOS: readonly { id: IdDoBloco; nome: string }[] = [
  { id: "missoes", nome: "Missões" },
  { id: "gemas", nome: "Gemas" },
  { id: "conjunto", nome: "Conjunto" },
  { id: "itens", nome: "Itens" },
  { id: "proximos", nome: "Próximos conjuntos" },
];

export interface Blocos {
  /** Todos os blocos, de cima pra baixo. */
  ordem: IdDoBloco[];
  /** Os que estão fechados (só o cabeçalho). */
  fechados: IdDoBloco[];
}

export const BLOCOS_PADRAO: Blocos = { ordem: BLOCOS.map((b) => b.id), fechados: [] };

function ehBloco(valor: unknown): valor is IdDoBloco {
  return BLOCOS.some((b) => b.id === valor);
}

/** Lista de blocos sem repetido e sem desconhecido. */
function soBlocos(valor: unknown): IdDoBloco[] {
  return Array.isArray(valor) ? [...new Set(valor.filter(ehBloco))] : [];
}

/** Lê os blocos do disco. Bloco que faltar na ordem (um novo, de versão mais nova) entra no lugar padrão. */
export function lerBlocos(valor: unknown): Blocos {
  if (typeof valor !== "object" || valor === null) return BLOCOS_PADRAO;
  const v = valor as Record<string, unknown>;
  const ordem = soBlocos(v.ordem);
  for (const [i, { id }] of BLOCOS.entries()) {
    if (ordem.includes(id)) continue;
    // Entra logo depois do que vem antes dele na ordem padrão (ou no começo).
    const antes = BLOCOS.slice(0, i).map((b) => b.id).filter((b) => ordem.includes(b)).pop();
    ordem.splice(antes ? ordem.indexOf(antes) + 1 : 0, 0, id);
  }
  return { ordem, fechados: soBlocos(v.fechados) };
}

/** Os blocos na ordem da tela, com os fechados entre parênteses: "Missões · (Gemas) · Conjunto…". */
export function ordemDosBlocos(blocos: Blocos): string {
  return blocos.ordem
    .map((id) => {
      const nome = BLOCOS.find((b) => b.id === id)?.nome ?? id;
      return blocos.fechados.includes(id) ? `(${nome})` : nome;
    })
    .join(" · ");
}

/** Está tudo como veio: ordem padrão e nenhum fechado. */
export function blocosNoPadrao(blocos: Blocos): boolean {
  return blocos.fechados.length === 0 && blocos.ordem.every((id, i) => id === BLOCOS_PADRAO.ordem[i]);
}

/** Fecha o bloco aberto, abre o fechado. */
export function alternarBloco(blocos: Blocos, id: IdDoBloco): Blocos {
  const fechados = blocos.fechados.includes(id)
    ? blocos.fechados.filter((b) => b !== id)
    : [...blocos.fechados, id];
  return { ...blocos, fechados };
}

/**
 * Troca o bloco de lugar com o vizinho de cima (`-1`) ou de baixo (`1`). Conta só os blocos que estão
 * aparecendo (`visiveis`, na ordem da tela): um bloco vazio agora (sem itens nesta fase, ou desligado
 * nas opções) não gasta um clique sem nada mudar na tela. No topo ou no fim, não muda nada.
 */
export function moverBloco(blocos: Blocos, id: IdDoBloco, sentido: 1 | -1, visiveis: readonly IdDoBloco[]): Blocos {
  const aqui = visiveis.indexOf(id);
  const vizinho = aqui >= 0 ? visiveis[aqui + sentido] : undefined;
  if (!vizinho) return blocos;
  const ordem = blocos.ordem.filter((b) => b !== id);
  const lugar = ordem.indexOf(vizinho) + (sentido === 1 ? 1 : 0);
  ordem.splice(lugar, 0, id);
  return { ...blocos, ordem };
}

/**
 * Tamanho do balão fora da edição, do maior pro menor: tudo com fotos e soquetes (expandido),
 * tudo (detalhado), só o essencial (resumido), ou só uma bolinha pra abrir de novo.
 */
export type Forma = "expandido" | "detalhado" | "resumido" | "bolinha";

/** Do maior pro menor: o "+" do balão sobe um degrau, o "−" desce um. */
export const FORMAS: readonly Forma[] = ["expandido", "detalhado", "resumido", "bolinha"];

export interface Preferencias {
  /** Começo de liga: inclui os passos de quem não tem itens guardados. */
  liga_nova: boolean;
  /** Fazer a quest da Biblioteca no ato 3. */
  biblioteca: boolean;
  /** O painel de layout estava aberto da última vez. */
  layout_aberto: boolean;
  /** Leitura de tela: moldura piscando na gema certa (recompensa de quest e loja). */
  marcar_gemas: boolean;
  /** Leitura de tela: desenhar por cima da árvore de passivas do jogo os próximos pontos da build. */
  guia_da_arvore: boolean;
  /** Avisar quando o jogo não está com o filtro de itens que o guia criou pra build. */
  avisar_filtro: boolean;
  /** Tamanho do texto: 1 = normal. */
  escala: number;
  /** Opacidade do fundo do balão fora da edição, de 0 a 1 (o texto fica sempre inteiro). */
  opacidade: number;
  forma: Forma;
  mostrar: Mostrar;
  /** A ordem dos blocos do balão e os que estão fechados. */
  blocos: Blocos;
}

export const PREFERENCIAS_PADRAO: Preferencias = {
  liga_nova: OPCOES_PADRAO.liga_nova,
  biblioteca: OPCOES_PADRAO.biblioteca,
  layout_aberto: false,
  marcar_gemas: true,
  guia_da_arvore: true,
  avisar_filtro: true,
  escala: 1,
  opacidade: 0.9,
  forma: "detalhado",
  mostrar: { proximos: true, gemas_do_ato: true, conjunto: true, arvore: true, itens: true },
  blocos: BLOCOS_PADRAO,
};

function logico(valor: unknown, padrao: boolean): boolean {
  return typeof valor === "boolean" ? valor : padrao;
}

function limitarEscala(valor: number): number {
  return Math.round(Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, valor)) * 10) / 10;
}

function limitarOpacidade(valor: number): number {
  return Math.round(Math.min(OPACIDADE_MAX, Math.max(OPACIDADE_MIN, valor)) * 10) / 10;
}

function numero(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor);
}

export function lerPreferencias(valor: unknown): Preferencias {
  const p = PREFERENCIAS_PADRAO;
  if (typeof valor !== "object" || valor === null) return p;
  const v = valor as Record<string, unknown>;
  const m = (typeof v.mostrar === "object" && v.mostrar !== null ? v.mostrar : {}) as Record<string, unknown>;
  return {
    liga_nova: logico(v.liga_nova, p.liga_nova),
    biblioteca: logico(v.biblioteca, p.biblioteca),
    layout_aberto: logico(v.layout_aberto, p.layout_aberto),
    marcar_gemas: logico(v.marcar_gemas, p.marcar_gemas),
    guia_da_arvore: logico(v.guia_da_arvore, p.guia_da_arvore),
    avisar_filtro: logico(v.avisar_filtro, p.avisar_filtro),
    escala: numero(v.escala) ? limitarEscala(v.escala) : p.escala,
    opacidade: numero(v.opacidade) ? limitarOpacidade(v.opacidade) : p.opacidade,
    forma: FORMAS.includes(v.forma as Forma) ? (v.forma as Forma) : p.forma,
    mostrar: {
      proximos: logico(m.proximos, p.mostrar.proximos),
      gemas_do_ato: logico(m.gemas_do_ato, p.mostrar.gemas_do_ato),
      conjunto: logico(m.conjunto, p.mostrar.conjunto),
      arvore: logico(m.arvore, p.mostrar.arvore),
      itens: logico(m.itens, p.mostrar.itens),
    },
    blocos: lerBlocos(v.blocos),
  };
}

export function opcoesDaRota(p: Preferencias): OpcoesRota {
  return { liga_nova: p.liga_nova, biblioteca: p.biblioteca };
}

/** Aumenta ou diminui o texto um degrau. */
export function mudarEscala(p: Preferencias, sentido: 1 | -1): Preferencias {
  return { ...p, escala: limitarEscala(p.escala + sentido * 0.1) };
}

/** Deixa o fundo do balão mais ou menos transparente, 10% por vez. */
export function mudarOpacidade(p: Preferencias, sentido: 1 | -1): Preferencias {
  return { ...p, opacidade: limitarOpacidade(p.opacidade + sentido * 0.1) };
}

/** A cor do fundo do balão com a opacidade escolhida (a mesma cor do `--fundo` do estilo). */
export function corDoFundo(opacidade: number): string {
  return `rgba(14, 12, 11, ${limitarOpacidade(opacidade)})`;
}

/**
 * A forma seguinte na tecla de trocar o tamanho do balão: bolinha → detalhado → expandido →
 * bolinha. O resumido (só pelos botões) vai pro expandido, que é o que vem depois do meio.
 */
export function proximaFormaDaTecla(forma: Forma): Forma {
  switch (forma) {
    case "bolinha":
      return "detalhado";
    case "detalhado":
    case "resumido":
      return "expandido";
    case "expandido":
      return "bolinha";
  }
}
