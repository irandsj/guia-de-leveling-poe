// O que a seção "Árvore" do painel mostra: junta o guia com o que a foto da tela viu, ou, antes de a
// árvore ser vista, com a conta de pontos pelo nível. Só contas, sem tela: quem desenha é `ui/Jogo.tsx`.

import type { SituacaoDaArvore } from "../../backend";
import type { Situacao } from "../conjuntos";
import type { GuiaDaArvore } from "./guia";
import { pontosAte } from "./pontos";

/** Durante o jogo só cabem os primeiros nós; o modo de edição mostra a etapa inteira. */
export const NOS_A_VISTA = 3;

/** O Rust corta `build` neste tanto de letras (`MAXIMO_DE_LETRAS`, em `src-tauri/src/arvore/mod.rs`). */
const MAIOR_BUILD = 400;

/** O guia e o pouco da árvore que o painel precisa além dele. */
export interface GuiaDoPainel {
  guia: GuiaDaArvore;
  /** Nome de cada nó de `guia.devolver` (eles não estão em `guia.ordem`). */
  nomes: Map<number, string>;
}

/** Uma linha da lista de nós do painel. */
export interface LinhaDeNo {
  /** Posição em `guia.ordem`. */
  indice: number;
  /** O mesmo número desenhado por cima da árvore do jogo; `null` = sem número. */
  numero: number | null;
  nome: string;
  /** Só maestria: o efeito a escolher. */
  efeito: string | null;
  /** Já foi pego (visto na tela, ou suposto pela conta de pontos). */
  feito: boolean;
}

/** O que a seção "Árvore" do painel mostra. */
export interface VistaDaArvore {
  /** `true` = a árvore do jogo ainda não foi vista: tudo sai da conta de pontos, e leva `~`. */
  estimada: boolean;
  /** A árvore do jogo está aberta na tela agora. */
  aberta: boolean;
  /** Quantos nós faltam pra fechar a etapa alvo. */
  faltam: number;
  /** Não sobrou nó com caminho pra pegar na etapa alvo: hora de seguir pra próxima etapa. */
  completa: boolean;
  linhas: LinhaDeNo[];
  /** Quantos nós da etapa ainda faltam além dos listados. */
  mais: number;
  /** Os `mais` são todos nós sem caminho (sem número no desenho): o resto da etapa já foi pego. */
  mais_sem_caminho: boolean;
  /** Nomes dos nós pegos que a build não quer mais. */
  tirar: string[];
  aviso: string | null;
  diag: string | null;
}

/**
 * O que veio da foto é deste guia? O programa diz de qual guia é a situação (`build`, `ate_alvo`, `passos`);
 * logo depois de trocar de build ou de etapa ainda chega coisa do guia antigo, e ela não vale pro novo.
 */
export function serve(guia: GuiaDaArvore, situacao: SituacaoDaArvore | null): situacao is SituacaoDaArvore {
  if (situacao === null || !situacao.vista) return false;
  const build = [...guia.build].slice(0, MAIOR_BUILD).join("");
  if (situacao.build !== build || situacao.ate_alvo !== guia.ate_alvo || situacao.passos !== guia.ordem.length) {
    return false;
  }
  return situacao.proximos.every((i) => Number.isInteger(i) && i >= 0 && i < guia.ordem.length);
}

/**
 * Junta o guia com o que a foto mostrou. Antes de a árvore ser vista (ou enquanto a foto é de outro guia),
 * supõe que os pontos ganhos até aqui (`pontosAte`) foram gastos seguindo a ordem.
 * `todos` = a etapa inteira (modo de edição); senão, os `aVista` próximos (o balão expandido mostra mais).
 */
export function vistaDaArvore(
  painel: GuiaDoPainel,
  situacao: SituacaoDaArvore | null,
  onde: Situacao,
  todos: boolean,
  aVista: number = NOS_A_VISTA,
): VistaDaArvore {
  const { guia, nomes } = painel;
  const ordem = guia.ordem;
  const alvo = Math.max(0, Math.min(guia.ate_alvo, ordem.length));

  let proximos: number[];
  let faltam: number;
  let tirar: string[] = [];
  /** Antes desta posição, o que não é próximo nem solto já foi pego. */
  let limite: number;
  let estimada = true;
  if (serve(guia, situacao)) {
    estimada = false;
    proximos = situacao.proximos;
    faltam = Math.max(0, situacao.total - situacao.feitos);
    // Sem próximos, o que falta são só nós sem caminho: todo o resto do trecho já foi pego.
    limite = proximos.length > 0 ? Math.max(...proximos) : alvo;
    tirar = situacao.devolver.map((id) => nomes.get(id) ?? `nó ${id}`);
  } else {
    const pontos = pontosAte(onde.nivel, onde.ato);
    const gastos = Number.isFinite(pontos) ? Math.max(0, Math.min(Math.floor(pontos), alvo)) : 0;
    proximos = [];
    for (let i = gastos; i < alvo && proximos.length < guia.numerados; i++) {
      if (!ordem[i].solto) proximos.push(i);
    }
    faltam = alvo - gastos;
    limite = gastos;
  }

  const numeroDe = new Map<number, number>();
  proximos.forEach((indice, i) => numeroDe.set(indice, i + 1));
  const escolhidos = todos
    ? [...Array.from({ length: alvo }, (_, i) => i), ...proximos.filter((i) => i >= alvo)]
    : proximos.slice(0, Math.max(1, aVista));
  const linhas = escolhidos.map((indice): LinhaDeNo => {
    const passo = ordem[indice];
    const numero = numeroDe.get(indice) ?? null;
    return {
      indice,
      numero,
      nome: passo.nome,
      efeito: passo.rotulo,
      feito: numero === null && !passo.solto && indice < limite,
    };
  });
  const listadosDaEtapa = linhas.filter((l) => l.numero !== null && l.indice < alvo).length;
  const mais = todos ? 0 : Math.max(0, faltam - listadosDaEtapa);
  let soltos = 0;
  for (let i = 0; i < alvo; i++) if (ordem[i].solto) soltos += 1;

  return {
    estimada,
    aberta: situacao?.aberta ?? false,
    faltam,
    // (Os nós sem caminho nunca ficam "feitos" nem levam número: não seguram a etapa.)
    completa: alvo > 0 && !proximos.some((i) => i < alvo),
    linhas,
    mais,
    mais_sem_caminho: !estimada && mais > 0 && proximos.length === 0 && soltos >= mais,
    tirar,
    aviso: situacao?.aviso ?? null,
    diag: situacao?.diag ?? null,
  };
}
