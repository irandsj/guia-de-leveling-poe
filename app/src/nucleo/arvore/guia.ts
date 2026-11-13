// O guia da árvore: a ordem dos nós até a etapa alvo, pronta pro painel e pro desenho por cima do jogo.
// Os tipos são o contrato com a ponte e com o Rust. Só contas: quem manda pro Rust é a ponte `src/arvore.ts`.

import { arvoreAlvo, etapasDaArvore, type Situacao } from "../conjuntos";
import type { EtapaDeArvore, Plano } from "../plano";
import { TIPO, type ArvoreDoJogo } from "./dados";
import { acharInicio, ordenar, separarNos, sequenciaDeMarcos, type NosDaEtapa } from "./ordem";

export interface PassoDoGuia {
  /** Id do nó. */
  no: number;
  /** Posição em `ordem` do passo de onde se chega neste; -1 = início da classe. */
  pai: number;
  nome: string;
  tipo: number;
  /** Só maestria: o texto do efeito a escolher. */
  rotulo: string | null;
  /** Sem caminho pelos nós da build (ex.: pontes da Ascendant): nunca leva número. */
  solto: boolean;
}

export interface GuiaDaArvore {
  /** `plano.fonte.hash_codigo`: mudou, o Rust esquece o que viu. */
  build: string;
  /** Versão dos dados da árvore. */
  versao: string;
  /** Título da etapa alvo ("" se não tiver). */
  etapa: string;
  /** Id do nó de início da classe. */
  inicio: number;
  ordem: PassoDoGuia[];
  /** `ordem[0..ate_alvo)` fecha a etapa alvo. */
  ate_alvo: number;
  manter: number[];
  devolver: number[];
  /** Linha de situação pro desenho. */
  texto: string;
  /** Quantos próximos levam número no desenho. */
  numerados: number;
  avisos: string[];
}

/** As posições dos nós, do jeito que o Rust recebe (uma vez por versão). */
export interface ArvoreParaOSistema {
  versao: string;
  ids: number[];
  xs: number[];
  ys: number[];
  tipos: number[];
  /** Pares de posições, achatados. */
  ligacoes: number[];
}

/** Quantos próximos nós levam número no desenho por cima do jogo. */
export const NUMERADOS = 8;

/** O Rust recusa texto com mais de 400 caracteres; o maior efeito de maestria da 3.30.0 tem 201. */
const MAIOR_TEXTO = 300;

/** Começo do aviso de PoB feito em outra versão da árvore (ver `avisosDeSempre`). */
const AVISO_DE_VERSAO = "O PoB usa a árvore ";

/** Aviso de PoB com uma árvore só (nenhuma etapa antes nem depois do alvo): a ordem inteira é deduzida. */
export const AVISO_DE_ORDEM_ESTIMADA =
  "Ordem estimada: o PoB não traz etapas da árvore, então o guia escolhe a ordem sozinho (o notável mais perto primeiro)";

/** Nós de ascendência da Ascendant que abrem o início de outra classe. */
const PONTE_DA_ASCENDANT = /^Path of the /;

/**
 * Os avisos do guia que o painel mostra sempre, e não só no modo de edição: os que dizem que os
 * números na tela podem não bater com o jogo ou com o que o autor da build pensou.
 */
export function avisosDeSempre(guia: GuiaDaArvore): string[] {
  return guia.avisos.filter((a) => a === AVISO_DE_ORDEM_ESTIMADA || a.startsWith(AVISO_DE_VERSAO));
}

/** O título da etapa vai pra caixa de situação do desenho, que é uma linha só. */
const MAIOR_TITULO = 60;

/** Uma linha só, sem espaço sobrando e com tamanho limitado. */
function encurtar(texto: string, maximo: number): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  const letras = [...limpo];
  return letras.length <= maximo ? limpo : `${letras.slice(0, maximo - 1).join("").trimEnd()}…`;
}

/** "3_28" -> "3.28", como o jogo escreve. */
function versaoLegivel(versao: string): string {
  return versao.replace(/_/g, ".");
}

function plural(n: number, um: string, varios: string): string {
  return n === 1 ? `1 ${um}` : `${n} ${varios}`;
}

/**
 * Monta o guia pra etapa que vale agora. Devolve `null` quando não há o que guiar: PoB sem árvore,
 * início da classe desconhecido ou etapa alvo sem nenhum nó que a árvore do guia conheça.
 */
export function montarGuia(
  plano: Plano,
  situacao: Situacao,
  arvore: ArvoreDoJogo,
  minimo = 0,
  escolhida: number | null = null,
): GuiaDaArvore | null {
  const alvo = arvoreAlvo(plano, situacao, minimo, escolhida);
  if (alvo === null) return null;

  const separados = new Map<EtapaDeArvore, NosDaEtapa>();
  const nosDe = (etapa: EtapaDeArvore): NosDaEtapa => {
    let nos = separados.get(etapa);
    if (nos === undefined) {
      nos = separarNos(etapa, arvore);
      separados.set(etapa, nos);
    }
    return nos;
  };

  const doAlvo = nosDe(alvo);
  if (doAlvo.principais.length === 0) return null;
  const inicio = acharInicio(doAlvo, plano.personagem.classe, arvore);
  if (inicio === null) return null;

  const { marcos, depois } = sequenciaDeMarcos(plano.arvore.etapas, alvo, (e) => nosDe(e).principais);
  const resultado = ordenar(
    arvore,
    inicio,
    marcos.map((e) => nosDe(e).principais),
    depois.map((e) => nosDe(e).principais),
  );

  // O efeito da maestria é o da etapa alvo; se ela só entra depois, o da primeira etapa que a tem.
  const efeitoDe = (no: number): number | undefined => {
    for (const etapa of [alvo, ...depois]) {
      const efeito = nosDe(etapa).efeitos.get(no);
      if (efeito !== undefined) return efeito;
    }
    return undefined;
  };

  const ordem: PassoDoGuia[] = [];
  for (const passo of resultado.passos) {
    const posicao = arvore.indice.get(passo.no);
    if (posicao === undefined) continue;
    const no = arvore.nos[posicao];
    let rotulo: string | null = null;
    if (no.tipo === TIPO.MAESTRIA) {
      const efeito = efeitoDe(passo.no);
      const texto = efeito === undefined ? undefined : arvore.efeitos.get(efeito);
      rotulo = texto === undefined ? null : encurtar(texto, MAIOR_TEXTO);
    }
    ordem.push({
      no: passo.no,
      pai: passo.pai,
      nome: encurtar(no.nome, MAIOR_TEXTO),
      tipo: no.tipo,
      rotulo,
      solto: passo.solto,
    });
  }

  const avisos: string[] = [];
  if (alvo.versao !== "" && !arvore.pob.includes(alvo.versao)) {
    avisos.push(
      `${AVISO_DE_VERSAO}${encurtar(versaoLegivel(alvo.versao), 20)} e o guia conhece a ${arvore.versao}: alguns nós podem estar em outro lugar`,
    );
  }
  if (doAlvo.cluster > 0) {
    avisos.push(`${plural(doAlvo.cluster, "nó de joia cluster ficou", "nós de joia cluster ficaram")} de fora`);
  }
  if (doAlvo.desconhecidos > 0) {
    avisos.push(
      `${plural(doAlvo.desconhecidos, "nó do PoB não existe", "nós do PoB não existem")} na árvore ${arvore.versao}`,
    );
  }
  const soltos = ordem.reduce((n, p, i) => (i < resultado.ate_alvo && p.solto ? n + 1 : n), 0);
  if (soltos > 0) {
    // A ordem só parte do início da classe: o pedaço pendurado no início de outra classe fica de fora.
    const pontes = [...new Set(alvo.nos)]
      .map((id) => arvore.ascendencia.get(id))
      .filter((nome): nome is string => nome !== undefined && PONTE_DA_ASCENDANT.test(nome));
    const motivo =
      pontes.length > 0
        ? `: o guia ainda não guia os nós que vêm depois de ${pontes.map((p) => `"${encurtar(p, 40)}"`).join(", ")}`
        : "";
    avisos.push(`${plural(soltos, "nó sem caminho ficou", "nós sem caminho ficaram")} sem número${motivo}`);
  }
  if (marcos.length === 1 && depois.length === 0) avisos.push(AVISO_DE_ORDEM_ESTIMADA);

  const etapa = encurtar(alvo.titulo, MAIOR_TITULO);
  // "(3/7)": qual etapa é essa entre as do PoB (as setas do teclado andam entre elas).
  const comGatilho = etapasDaArvore(plano);
  const posicao = comGatilho.indexOf(alvo);
  const contagem = comGatilho.length > 1 && posicao >= 0 ? ` (${posicao + 1}/${comGatilho.length})` : "";
  return {
    build: plano.fonte.hash_codigo,
    versao: arvore.versao,
    etapa,
    inicio,
    ordem,
    ate_alvo: resultado.ate_alvo,
    manter: resultado.manter,
    devolver: resultado.devolver,
    texto: etapa === "" ? "Árvore da build" : `Árvore até ${etapa}${contagem}`,
    numerados: NUMERADOS,
    avisos,
  };
}

/** Mistura um texto num número de 32 bits (FNV-1a). Não é segurança: é só pra notar mudança. */
function resumo(texto: string, semente: number): string {
  let h = semente >>> 0;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

/**
 * Muda quando qualquer coisa do guia muda: serve pra não mandar o mesmo guia de novo pro Rust.
 * Leva um resumo do guia inteiro (ordem, pais, rótulos, listas e avisos), não só os tamanhos.
 */
export function chaveDoGuia(guia: GuiaDaArvore | null): string {
  if (guia === null) return "";
  const tudo = JSON.stringify([
    guia.build,
    guia.versao,
    guia.etapa,
    guia.inicio,
    guia.ordem.map((p) => [p.no, p.pai, p.nome, p.tipo, p.rotulo, p.solto]),
    guia.ate_alvo,
    guia.manter,
    guia.devolver,
    guia.texto,
    guia.numerados,
    guia.avisos,
  ]);
  // Duas sementes diferentes: 64 bits de resumo, pra uma troca não passar por coincidência.
  return [
    guia.build,
    guia.versao,
    guia.etapa,
    guia.ordem.length,
    guia.ate_alvo,
    resumo(tudo, 2166136261),
    resumo(tudo, 0x9e3779b9),
  ].join("|");
}

/** Só o que o Rust precisa da árvore: ids, posições, tipos e ligações. */
export function paraOSistema(arvore: ArvoreDoJogo): ArvoreParaOSistema {
  return {
    versao: arvore.versao,
    ids: arvore.nos.map((n) => n.id),
    xs: arvore.nos.map((n) => n.x),
    ys: arvore.nos.map((n) => n.y),
    tipos: arvore.nos.map((n) => n.tipo),
    ligacoes: arvore.ligacoes,
  };
}
