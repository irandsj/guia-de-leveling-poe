// O que aparece durante o jogo: situação, passos, layout da zona, gemas, conjunto, árvore e itens.
// Aqui ninguém clica (a janela deixa o clique passar), a não ser no modo de edição.

import { useEffect, useMemo, useState, type MouseEventHandler, type ReactNode } from "react";

import { avisosDeSempre, vistaDaArvore, type GuiaDoPainel } from "../arvore";
import type { SituacaoDaArvore } from "../backend";
import { conjuntosEmOrdem, type ConjuntoNaOrdem, type EscolhaDeGemas, type EscolhaDeItens } from "../nucleo/conjuntos";
import { linksDoLeveling, proximaMudanca, usarLinksDoLeveling } from "../nucleo/links-leveling";
import { vistaDoPainel, type PainelDeLayout } from "../nucleo/layouts";
import type { Experiencia } from "../nucleo/experiencia";
import type { EtapaDeArvore, EtapaDeGemas, EtapaDeItens, ItemDoPlano, Plano } from "../nucleo/plano";
import {
  alternarBloco,
  BLOCOS,
  BLOCOS_PADRAO,
  moverBloco,
  type Blocos,
  type IdDoBloco,
  type Mostrar,
} from "../nucleo/preferencias";
import type { Recordes } from "../nucleo/recordes";
import { nomeDaZona, type GemaDoPasso, type Rota } from "../nucleo/rota";
import type { Sessao, SituacaoDaSessao } from "../nucleo/sessao";
import { ligacoesDosSoquetes, posicoesDosSoquetes } from "../nucleo/soquetes";
import { formatarTempo, lerTimer, type EstadoTimer } from "../nucleo/timer";
import {
  gemasDoAto,
  gemasQueSairam,
  gruposDoConjunto,
  itensEmLinha,
  itensQueMudam,
  linhasDeItens,
  linkDaGema,
  chaveDaMarca,
  comprasQueFicaram,
  type GrupoDoConjunto,
  type ItemCurto,
  type LinhaDeItem,
  moedasDoAto,
  nomeCurtoDaMoeda,
  nomeCurtoDoItem,
  passosAVista,
  posicaoNoAto,
  proximaParada,
} from "../nucleo/vista";
import { FotoDoItem } from "./FotoDoItem";
import { Cor, IconeDaGema, LinhaDeGema, Pedacos } from "./Pedacos";

/**
 * O cronômetro: só ele se redesenha a cada segundo, e só enquanto está contando. Com recorde do
 * ato (e o ato cronometrado desde o começo), o tempo do ato fica verde enquanto está abaixo dele
 * e vermelho quando passa.
 */
function Relogio({ timer, recorde }: { timer: EstadoTimer; recorde: number | null }) {
  const [, tique] = useState(0);
  const rodando = timer.desde !== null;
  useEffect(() => {
    if (!rodando) return;
    const id = setInterval(() => tique((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [rodando]);
  const leitura = lerTimer(timer, Date.now());
  const comparar = recorde !== null && timer.inteiro;
  const classeDoAto = comparar ? (leitura.ato_ms <= recorde ? "no-ritmo" : "atrasado") : undefined;
  return (
    <span
      className={rodando ? "relogio" : "relogio parado"}
      title={recorde !== null ? `Recorde do ato ${timer.ato}: ${formatarTempo(recorde)}` : undefined}
    >
      {rodando ? "" : "⏸ "}
      {formatarTempo(leitura.total_ms)}
      <span className="fraco">
        {" (ato "}
        <span className={classeDoAto}>{formatarTempo(leitura.ato_ms)}</span>
        {comparar && ` / ${formatarTempo(recorde)}`})
      </span>
    </span>
  );
}

/** Perda de experiência abaixo disto fica amarela; daqui pra cima, vermelha. */
const PERDA_QUE_PREOCUPA = 15;

/** Quanto de experiência a zona dá: verde sem perda, amarelo perdendo pouco, vermelho perdendo muito. */
function AvisoDeXp({ xp }: { xp: Experiencia }) {
  const classe = xp.perda === 0 ? "xp bom" : xp.perda < PERDA_QUE_PREOCUPA ? "xp meio" : "xp ruim";
  const lado =
    xp.diferenca > 0
      ? `${xp.diferenca} acima da zona`
      : xp.diferenca < 0
        ? `${-xp.diferenca} abaixo da zona`
        : "no nível da zona";
  return (
    <span
      className={classe}
      title={`Zona nível ${xp.nivel_da_zona}, você ${lado}. Até ${xp.faixa_segura} níveis de diferença não perde nada.`}
    >
      XP {xp.perda === 0 ? "100%" : `−${xp.perda}%`}
    </span>
  );
}

function Situacao(props: {
  rota: Rota;
  sessao: Sessao;
  situacao: SituacaoDaSessao;
  recordes?: Recordes;
  /** Botões de trocar a forma do balão (fora da edição). */
  botoes?: ReactNode;
  /** Segurar a linha (com Alt) arrasta o balão. */
  aoSegurar?: MouseEventHandler;
}) {
  const { rota, sessao, situacao } = props;
  const recorde = props.recordes?.atos[String(sessao.timer.ato)]?.ms ?? null;
  const pos = posicaoNoAto(rota, sessao.passo);
  const passo = passosAVista(rota, sessao.passo, 0)[0];
  const zona = sessao.zona_nome ?? (passo ? nomeDaZona(passo.zona) : "");
  return (
    <div className={props.aoSegurar ? "situacao barra" : "situacao"} onMouseDown={props.aoSegurar}>
      <span className="ato">Ato {pos.ato}</span>
      <span>
        {pos.numero}/{pos.total}
      </span>
      {zona && <span className="zona-atual">{zona}</span>}
      <span>
        nv {situacao.nivel_conhecido ? "" : "~"}
        {situacao.nivel}
      </span>
      {situacao.xp && <AvisoDeXp xp={situacao.xp} />}
      <Relogio timer={sessao.timer} recorde={recorde} />
      {sessao.mortes > 0 && <span className="mortes">☠ {sessao.mortes}</span>}
      {props.botoes}
    </div>
  );
}

function Passos(props: {
  rota: Rota;
  sessao: Sessao;
  situacao: SituacaoDaSessao;
  proximos: boolean;
  /** Quantos passos seguintes mostrar quando `proximos` (o padrão são 2). */
  quantos?: number;
  /** O cartão da próxima gema já mostra as gemas do passo: aqui não repete. */
  semGemas: boolean;
  /** Balão resumido: só o texto do passo, sem as dicas. */
  curto?: boolean;
}) {
  const { rota, sessao, situacao } = props;
  const [atual, ...seguintes] = passosAVista(rota, sessao.passo, props.proximos ? (props.quantos ?? 2) : 0);
  if (!atual) return null;
  return (
    <ol className="passos">
      <li className="passo atual">
        <div className="passo-texto">
          <Pedacos pedacos={atual.pedacos} nivel={situacao.nivel_conhecido ? situacao.nivel : null} />
        </div>
        {!props.curto &&
          atual.dicas.map((dica, i) => (
          <div key={i} className="dica">
            <Pedacos pedacos={dica} />
          </div>
        ))}
        {atual.gemas.length > 0 && !props.semGemas && (
          <ul className="gemas">
            {atual.gemas.map((gema, i) => (
              <LinhaDeGema key={i} gema={gema} />
            ))}
          </ul>
        )}
      </li>
      {seguintes.map((passo) => (
        <li key={passo.indice} className="passo proximo">
          <Pedacos pedacos={passo.pedacos} />
          {passo.gemas.length > 0 && (
            <span className="marca-gema"> ◆ {passo.gemas.length === 1 ? "1 gema" : `${passo.gemas.length} gemas`}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

interface PropsDoLayout {
  painel: PainelDeLayout;
  edicao: boolean;
  /** Texto da tecla do layout ("F6"). */
  tecla: string;
  aoEscolher: (posicao: number | null) => void;
}

function Layout({ painel, edicao, tecla, aoEscolher }: PropsDoLayout) {
  if (!painel.aberto) return null;
  const vista = vistaDoPainel(painel);
  if (vista === null) {
    return <section className="secao fraco">Layout: sem imagens pra esta zona.</section>;
  }
  const naGrade = vista.atual === null;
  const oQueATeclaFaz = naGrade ? "ver o primeiro" : vista.atual === vista.total ? "fechar" : "próximo";
  return (
    <section className="secao layout">
      <div className="titulo">
        Layout · {nomeDaZona(vista.area_id)}
        <span className="fraco">
          {" · "}
          {naGrade ? `${vista.total} possíveis` : `${vista.atual} de ${vista.total}`}
          {tecla && ` · ${tecla}: ${oQueATeclaFaz}`}
        </span>
      </div>
      <div className={naGrade ? "grade" : "grade grande"}>
        {vista.imagens.map((imagem) => {
          const conteudo = (
            <>
              <img src={imagem.endereco} alt="" draggable={false} />
              {imagem.escolhe !== null && <span className="etiqueta">{imagem.escolhe + 1}</span>}
              {imagem.nome.startsWith("x") && <span className="etiqueta">dica</span>}
            </>
          );
          return edicao && imagem.escolhe !== null ? (
            <button
              key={imagem.nome}
              className="quadro"
              title="Ver o caminho deste layout"
              onClick={() => aoEscolher(imagem.escolhe)}
            >
              {conteudo}
            </button>
          ) : (
            <div key={imagem.nome} className="quadro">
              {conteudo}
            </div>
          );
        })}
      </div>
      {edicao && !naGrade && vista.total > 1 && (
        <div className="linha-de-botoes">
          <button onClick={() => aoEscolher(null)}>Ver todos os layouts</button>
        </div>
      )}
    </section>
  );
}

/** O que fazer com a gema, curto: "Recompensa · Nessa" / "Comprar · Nessa". */
function acaoDaGema(gema: GemaDoPasso): string {
  return gema.tipo === "quest" ? `Recompensa · ${gema.npc}` : `Comprar · ${gema.npc}`;
}

function quandoChega(faltam: number): string {
  if (faltam === 0) return "agora";
  return faltam === 1 ? "no próximo passo" : `em ${faltam} passos`;
}

/** Pra qual link da build a gema serve: assim dá pra ver que ela é desta build. */
function PraQueLink({ plano, gema, curto = false }: { plano: Plano; gema: GemaDoPasso; curto?: boolean }) {
  const link = linkDaGema(plano, gema);
  if (!link) return null;
  return curto ? <span className="cartao-link"> · {link}</span> : <div className="cartao-link">pro {link}</div>;
}

/**
 * O quadradinho de "comprei/peguei". Só dá pra clicar com Alt segurado ou no modo de edição
 * (no resto do tempo o clique atravessa o guia e vai pro jogo).
 */
function Marca({ gema, marcas }: { gema: GemaDoPasso; marcas: Marcas }) {
  const chave = chaveDaMarca(gema);
  const feita = marcas.lista.includes(chave);
  // Não é "marca": esse nome é das caixas de opção do modo de edição (Edicao.tsx).
  const classe = feita ? "quadrado-gema feita" : "quadrado-gema";
  if (!marcas.clicavel) return <span className={classe}>{feita ? "✓" : ""}</span>;
  const titulo = `${feita ? "Desmarcar" : "Marcar"} ${gema.nome} como ${gema.tipo === "quest" ? "pega" : "comprada"}`;
  return (
    <button className={classe} title={titulo} aria-label={titulo} aria-pressed={feita} onClick={() => marcas.aoMarcar(chave)}>
      {feita ? "✓" : ""}
    </button>
  );
}

interface Marcas {
  lista: readonly string[];
  /** Dá pra clicar agora (Alt segurado ou modo de edição). */
  clicavel: boolean;
  /** Como fazer pra marcar quando não dá pra clicar. */
  comoMarcar: string;
  aoMarcar: (chave: string) => void;
}

/** Quantas compras esquecidas cabem no cartão; o resto vira "+N". */
const ESQUECIDAS_A_VISTA = 6;

/**
 * O destaque durante o jogo: a próxima gema a pegar, grande e com o ícone, o que fazer e quando;
 * as compras que ficaram pra trás sem marcar; embaixo, as moedas pra guardar pro resto do ato.
 * Cada gema tem um quadradinho pra marcar como comprada/pega.
 */
/** Tem o que mostrar no cartão da próxima gema (`ProximaGema`). */
function temCartaoDeGema(rota: Rota, passo: number, marcadas: readonly string[]): boolean {
  return (
    proximaParada(rota, passo, marcadas) !== null ||
    moedasDoAto(rota, passo, marcadas).length > 0 ||
    comprasQueFicaram(rota, passo, marcadas).length > 0
  );
}

function ProximaGema(props: { plano: Plano; rota: Rota; passo: number; marcas: Marcas }) {
  const { plano, rota, passo, marcas } = props;
  const parada = proximaParada(rota, passo, marcas.lista);
  const moedas = moedasDoAto(rota, passo, marcas.lista);
  const ficaram = comprasQueFicaram(rota, passo, marcas.lista);
  if (!parada && moedas.length === 0 && ficaram.length === 0) return null;
  const [primeira, ...outras] = parada?.gemas ?? [];
  const feita = (g: GemaDoPasso) => marcas.lista.includes(chaveDaMarca(g));
  return (
    <section className="cartao-gema">
      {parada && primeira && (
        <div className="cartao-principal">
          <IconeDaGema gemId={primeira.gem_id} cor={primeira.cor} grande />
          <div>
            <div className="cartao-nome">
              <Marca gema={primeira} marcas={marcas} />
              {primeira.nome}
              {primeira.quantidade > 1 && <span className="fraco"> ×{primeira.quantidade}</span>}
            </div>
            <div className={primeira.tipo === "quest" ? "cartao-acao recompensa" : "cartao-acao compra"}>
              {acaoDaGema(primeira)}
              {primeira.custo && <span className="cartao-custo"> · 1 {nomeCurtoDaMoeda(primeira.custo)}</span>}
            </div>
            <div className={parada.faltam === 0 ? "cartao-quando agora" : "cartao-quando"}>
              {quandoChega(parada.faltam)}
              {primeira.quest && <span className="fraco"> · {primeira.quest}</span>}
            </div>
            <PraQueLink plano={plano} gema={primeira} />
          </div>
        </div>
      )}
      {outras.length > 0 && (
        <ul className="cartao-outras">
          {outras.map((gema, i) => (
            <li key={i} className={feita(gema) ? "feita" : undefined}>
              <Marca gema={gema} marcas={marcas} />
              <IconeDaGema gemId={gema.gem_id} cor={gema.cor} />
              <span className="nome-da-gema">{gema.nome}</span>
              {gema.quantidade > 1 && <span className="fraco"> ×{gema.quantidade}</span>}
              <span className="fraco">
                {" · "}
                {acaoDaGema(gema)}
              </span>
              {gema.custo && <span className="cartao-custo"> · 1 {nomeCurtoDaMoeda(gema.custo)}</span>}
              <PraQueLink plano={plano} gema={gema} curto />
            </li>
          ))}
        </ul>
      )}
      {ficaram.length > 0 && (
        <div className="ficaram">
          <div>
            Ficou pra trás, comprou?{" "}
            <span className="fraco">
              {marcas.clicavel ? "clique no quadrado pra marcar" : marcas.comoMarcar}
            </span>
          </div>
          <ul className="cartao-outras">
            {ficaram.slice(0, ESQUECIDAS_A_VISTA).map((gema) => (
              <li key={chaveDaMarca(gema)}>
                <Marca gema={gema} marcas={marcas} />
                <IconeDaGema gemId={gema.gem_id} cor={gema.cor} />
                {gema.nome.replace(/ Support$/, "")}
                <span className="fraco"> · {gema.npc}</span>
                {gema.custo && <span className="cartao-custo"> · 1 {nomeCurtoDaMoeda(gema.custo)}</span>}
              </li>
            ))}
          </ul>
          {ficaram.length > ESQUECIDAS_A_VISTA && <div className="fraco">+{ficaram.length - ESQUECIDAS_A_VISTA}</div>}
        </div>
      )}
      {moedas.length > 0 && (
        <div className="guardar">
          Guarde pras gemas do ato:{" "}
          {moedas.map((m, i) => (
            <span key={m.nome}>
              {i > 0 && " · "}
              <b>{m.quantidade}</b> {m.nome}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/** O cartão da gema no balão resumido: uma linha com a próxima gema e quantas mais tem. */
function ProximaGemaCurta(props: { rota: Rota; passo: number; marcas: Marcas }) {
  const { rota, passo, marcas } = props;
  const parada = proximaParada(rota, passo, marcas.lista);
  const ficaram = comprasQueFicaram(rota, passo, marcas.lista);
  const [primeira, ...outras] = parada?.gemas ?? [];
  if (!primeira && ficaram.length === 0) return null;
  return (
    <section className="cartao-gema curto">
      {parada && primeira && (
        <div className="cartao-linha">
          <Marca gema={primeira} marcas={marcas} />
          <IconeDaGema gemId={primeira.gem_id} cor={primeira.cor} />
          <span className="nome-da-gema">{primeira.nome}</span>
          <span className={primeira.tipo === "quest" ? "recompensa" : "compra"}> · {acaoDaGema(primeira)}</span>
          <span className={parada.faltam === 0 ? "cartao-quando agora" : "fraco"}> · {quandoChega(parada.faltam)}</span>
          {outras.length > 0 && <span className="fraco"> · +{outras.length}</span>}
        </div>
      )}
      {ficaram.length > 0 && (
        <div className="fraco">
          {ficaram.length === 1 ? "1 compra ficou pra trás" : `${ficaram.length} compras ficaram pra trás`}
        </div>
      )}
    </section>
  );
}

/** Durante o jogo só cabem as próximas paradas; o modo de edição mostra o ato inteiro. */
const PARADAS_DE_GEMA_A_VISTA = 2;

function GemasDoAto(props: {
  rota: Rota;
  passo: number;
  edicao: boolean;
  /** Quantas paradas mostrar fora da edição. */
  paradas?: number;
  /** Pula a ida à zona deste passo (o cartão da próxima gema já mostra ela). */
  pularVisitaDe?: number | null;
}) {
  const { rota, passo, edicao } = props;
  let todos = gemasDoAto(rota, passo).filter((grupo) => grupo.faltam > 0);
  if (props.pularVisitaDe != null && rota.passos[props.pularVisitaDe]) {
    const inicio = props.pularVisitaDe;
    let fim = inicio;
    while (fim + 1 < rota.passos.length && rota.passos[fim + 1].zona === rota.passos[inicio].zona) fim++;
    todos = todos.filter((grupo) => grupo.passo < inicio || grupo.passo > fim);
  }
  if (todos.length === 0) return null;
  const grupos = edicao ? todos : todos.slice(0, props.paradas ?? PARADAS_DE_GEMA_A_VISTA);
  const depois = todos.slice(grupos.length).reduce((soma, grupo) => soma + grupo.gemas.length, 0);
  return (
    <section className="secao">
      <div className="titulo">{props.pularVisitaDe != null ? "Depois, no ato" : "Próximas gemas do ato"}</div>
      {grupos.map((grupo) => (
        <div key={grupo.passo} className="grupo">
          <div className="fraco">
            em {grupo.faltam} {grupo.faltam === 1 ? "passo" : "passos"} · <Pedacos pedacos={rota.passos[grupo.passo].pedacos} />
          </div>
          <ul className="gemas">
            {grupo.gemas.map((gema, i) => (
              <LinhaDeGema key={i} gema={gema} />
            ))}
          </ul>
        </div>
      ))}
      {depois > 0 && (
        <div className="fraco">
          e mais {depois} {depois === 1 ? "gema" : "gemas"} até o fim do ato
        </div>
      )}
    </section>
  );
}

/** PoB com um conjunto só costuma vir sem título: aí fica só o nome da seção. */
function comTitulo(rotulo: string, titulo: string, semTitulo: string): string {
  return titulo ? `${rotulo}: ${titulo}` : semTitulo;
}

/**
 * O que ainda falta pro próximo conjunto entrar, quando o título dele não diz
 * (o título "Level 12 - 38" já diz; "Act 2" com uma habilidade de nível 12, não).
 */
function quandoEntra(etapa: EtapaDeGemas, situacao: SituacaoDaSessao): string {
  if (etapa.nivel_min !== null) return "";
  const falta: string[] = [];
  if (etapa.ato_min !== null && situacao.ato < etapa.ato_min) falta.push(`no ato ${etapa.ato_min}`);
  if (etapa.nivel_gatilho !== null && situacao.nivel < etapa.nivel_gatilho) {
    falta.push(`a partir do nível ${etapa.nivel_gatilho}`);
  }
  return falta.length > 0 ? ` (${falta.join(", ")})` : "";
}

/** Os grupos de um conjunto de gemas em linhas de texto (balão detalhado), com as novas em destaque. */
function LinhasDoConjunto({ etapa }: { etapa: EtapaDeGemas }) {
  return (
    <>
      {gruposDoConjunto(etapa).map((grupo, i) => (
        <div key={i} className={grupo.principal ? "ligacao principal" : "ligacao"}>
          {grupo.rotulo && (
            <span className="fraco">
              {grupo.rotulo}
              {grupo.gemas.length > 0 ? ": " : ""}
            </span>
          )}
          {grupo.gemas.map((gema, j) => (
            <span key={j} className={gema.nova ? "gema-do-conjunto nova" : "gema-do-conjunto"}>
              {j > 0 && <span className="fraco"> + </span>}
              <Cor cor={gema.cor} />
              {gema.nome}
              {gema.quantidade > 1 ? ` ×${gema.quantidade}` : ""}
            </span>
          ))}
        </div>
      ))}
    </>
  );
}

interface PropsDoConjunto {
  plano: Plano;
  escolha: EscolhaDeGemas;
  situacao: SituacaoDaSessao;
  trocou: boolean;
  /** O bloco do próximo conjunto aparece embaixo: aí a linha "próximo: …" sai daqui. */
  semProximo?: boolean;
}

function Conjunto(props: PropsDoConjunto) {
  const { plano, escolha, situacao, trocou } = props;
  const etapa = escolha.etapa;
  if (!etapa) return null;
  const sairam = gemasQueSairam(plano, etapa);
  return (
    <section className={trocou ? "secao conjunto trocou" : "secao conjunto"}>
      <div className="titulo">
        {comTitulo(trocou ? "Conjunto novo" : "Conjunto", etapa.titulo, "Conjunto de gemas")}
        {!escolha.automatica && <span className="fraco"> · fixado à mão</span>}
      </div>
      <LinhasDoConjunto etapa={etapa} />
      {sairam.length > 0 && <div className="fraco">sai: {sairam.join(", ")}</div>}
      {escolha.proxima && !props.semProximo && (
        <div className="fraco">
          próximo: {escolha.proxima.titulo || "(sem nome)"}
          {escolha.entra !== null && escolha.entra !== escolha.proxima.nivel_min
            ? ` (entra no nível ${escolha.entra})`
            : quandoEntra(escolha.proxima, situacao)}
        </div>
      )}
    </section>
  );
}

/* ---------- Balão expandido: links em soquetes, como no item do jogo ---------- */

/** Tamanho do soquete e o vão entre dois, em `em` (crescem junto com o tamanho do texto). */
const SOQUETE = 2.1;
const VAO = 0.75;
const PASSO_DO_SOQUETE = SOQUETE + VAO;
const em = (n: number) => `${n.toFixed(3)}em`;

function corDoSoquete(cor: string): string {
  if (cor === "strength") return "r";
  if (cor === "dexterity") return "g";
  if (cor === "intelligence") return "b";
  return "w";
}

interface GemaNoSoquete {
  gem_id: string | null;
  cor: string;
  nome: string;
  suporte?: boolean;
  quantidade?: number;
  nova?: boolean;
}

const semSupport = (nome: string) => nome.replace(/ Support$/, "");

/**
 * As gemas de um link desenhadas como no item: um soquete com a foto de cada gema, ligado no seguinte.
 * Até 3 gemas numa fileira; de 4 em diante, duas colunas em zigue-zague (`nucleo/soquetes.ts`).
 */
function Soquetes({ gemas }: { gemas: readonly GemaNoSoquete[] }) {
  const soquetes = posicoesDosSoquetes(gemas.length);
  if (soquetes.length === 0) return null;
  const colunas = Math.max(...soquetes.map((s) => s.coluna)) + 1;
  const linhas = Math.max(...soquetes.map((s) => s.linha)) + 1;
  const meio = SOQUETE / 2;
  return (
    <div
      className="soquetes"
      style={{ width: em(colunas * PASSO_DO_SOQUETE - VAO), height: em(linhas * PASSO_DO_SOQUETE - VAO) }}
      aria-hidden="true"
    >
      {ligacoesDosSoquetes(soquetes).map((ligacao) => {
        const a = soquetes[ligacao.de];
        const b = soquetes[ligacao.de + 1];
        return (
          <span
            key={`l${ligacao.de}`}
            className={ligacao.deitada ? "ligacao-soquete deitada" : "ligacao-soquete em-pe"}
            style={{
              left: em(Math.min(a.coluna, b.coluna) * PASSO_DO_SOQUETE + meio),
              top: em(Math.min(a.linha, b.linha) * PASSO_DO_SOQUETE + meio),
            }}
          />
        );
      })}
      {gemas.map((gema, i) => (
        <span
          key={i}
          className={`soquete soquete-${corDoSoquete(gema.cor)}${gema.nova ? " nova" : ""}`}
          title={gema.nome}
          style={{ left: em(soquetes[i].coluna * PASSO_DO_SOQUETE), top: em(soquetes[i].linha * PASSO_DO_SOQUETE) }}
        >
          {gema.gem_id ? <IconeDaGema gemId={gema.gem_id} cor={gema.cor} /> : <Cor cor={gema.cor} />}
        </span>
      ))}
    </div>
  );
}

/** Um link no expandido: os soquetes à esquerda e o nome de cada gema, na mesma ordem, à direita. */
function CartaoDoLink(props: { gemas: readonly GemaNoSoquete[]; titulo: string; principal: boolean; nota?: string }) {
  const { gemas, titulo, principal } = props;
  return (
    <div className={principal ? "cartao-link-gemas principal" : "cartao-link-gemas"}>
      <div className="cabeca-do-link">
        <span className="selo-link">{gemas.length}L</span>
        {titulo && <span className="fraco">{titulo}</span>}
      </div>
      <div className="corpo-do-link">
        <Soquetes gemas={gemas} />
        <ol className="nomes-do-link">
          {gemas.map((gema, i) => (
            <li key={i} className={[gema.suporte ? "" : "ativa", gema.nova ? "nova" : ""].join(" ").trim() || undefined}>
              {semSupport(gema.nome)}
              {(gema.quantidade ?? 1) > 1 && <span className="fraco"> ×{gema.quantidade}</span>}
            </li>
          ))}
        </ol>
      </div>
      {props.nota && <div className="fraco">{props.nota}</div>}
    </div>
  );
}

/** Gemas que não formam link (aura, maldição, movimento): numa linha, com o ícone. */
function GemasSoltas({ rotulo, gemas }: { rotulo: string; gemas: readonly GemaNoSoquete[] }) {
  if (gemas.length === 0) return null;
  return (
    <div className="gemas-soltas">
      <span className="fraco">{rotulo}</span>
      {gemas.map((gema, i) => (
        <span key={i} className={gema.nova ? "nova" : undefined}>
          {i > 0 && <span className="fraco">, </span>}
          <GemaPequena gema={gema} />
        </span>
      ))}
    </div>
  );
}

/** Os grupos de um conjunto de gemas no expandido: 2 gemas ou mais viram cartão de soquetes; as soltas, uma linha. */
function CartoesDoConjunto({ etapa }: { etapa: EtapaDeGemas }) {
  const grupos = gruposDoConjunto(etapa);
  const blocos: ReactNode[] = [];
  const soltas: GrupoDoConjunto["gemas"] = [];
  // Título de seção do PoB (grupo sem gemas) só fica se vier algum cartão depois dele.
  let tituloPendente: ReactNode = null;
  grupos.forEach((grupo, i) => {
    if (grupo.gemas.length === 0) {
      tituloPendente = (
        <div key={`t${i}`} className="titulo-de-grupo">
          {grupo.rotulo}
        </div>
      );
      return;
    }
    if (grupo.gemas.length === 1 && !grupo.principal) {
      soltas.push(...grupo.gemas);
      return;
    }
    if (tituloPendente) blocos.push(tituloPendente);
    tituloPendente = null;
    blocos.push(<CartaoDoLink key={i} gemas={grupo.gemas} titulo={grupo.rotulo} principal={grupo.principal} />);
  });
  return (
    <>
      {blocos.length > 0 && <div className="grade-de-links">{blocos}</div>}
      <GemasSoltas rotulo={blocos.length > 0 ? "também: " : "gemas: "} gemas={soltas} />
    </>
  );
}

/** O conjunto de gemas do PoB no expandido, em cartões de soquetes. */
function ConjuntoEmSoquetes(props: PropsDoConjunto) {
  const { plano, escolha, situacao, trocou } = props;
  const etapa = escolha.etapa;
  if (!etapa) return null;
  const sairam = gemasQueSairam(plano, etapa);
  return (
    <section className={trocou ? "secao conjunto trocou" : "secao conjunto"}>
      <div className="titulo">
        {comTitulo(trocou ? "Conjunto novo" : "Conjunto", etapa.titulo, "Conjunto de gemas")}
        {!escolha.automatica && <span className="fraco"> · fixado à mão</span>}
      </div>
      <CartoesDoConjunto etapa={etapa} />
      {sairam.length > 0 && <div className="fraco">sai: {sairam.join(", ")}</div>}
      {escolha.proxima && !props.semProximo && (
        <div className="fraco">
          próximo: {escolha.proxima.titulo || "(sem nome)"}
          {escolha.entra !== null && escolha.entra !== escolha.proxima.nivel_min
            ? ` (entra no nível ${escolha.entra})`
            : quandoEntra(escolha.proxima, situacao)}
        </div>
      )}
    </section>
  );
}

/**
 * Posição, em `ordem`, do conjunto que vem depois do de agora: o próximo que entra sozinho; sem
 * ele, o seguinte da lista (o "Ubers" depois do "Level 82+"). `-1` = não vem nenhum.
 */
function indiceDoProximo(ordem: readonly ConjuntoNaOrdem[], escolha: EscolhaDeGemas, agora: number): number {
  const proximo = escolha.proxima ? ordem.findIndex((c) => c.etapa === escolha.proxima) : -1;
  if (proximo >= 0) return proximo;
  return agora >= 0 && agora + 1 < ordem.length ? agora + 1 : -1;
}

/**
 * Em que conjunto, de `ordem`, o bloco dos próximos conjuntos começa: o próximo ou, com os links do
 * leveling em cima, o de agora. `-1` = não tem bloco.
 */
function inicioDoQueVem(ordem: readonly ConjuntoNaOrdem[], escolha: EscolhaDeGemas, comOAtual: boolean): number {
  const agora = escolha.etapa ? ordem.findIndex((c) => c.etapa === escolha.etapa) : -1;
  return comOAtual && agora >= 0 ? agora : indiceDoProximo(ordem, escolha, agora);
}

interface PropsDoQueVem {
  plano: Plano;
  escolha: EscolhaDeGemas;
  situacao: SituacaoDaSessao;
  clicavel: boolean;
  /** Expandido: cartões de soquetes; detalhado: linhas de texto. */
  emSoquetes: boolean;
  /**
   * Em cima estão os links do leveling (tirados do conjunto de agora, que é de endgame): o
   * conjunto de agora ainda não apareceu inteiro, então o bloco começa nele.
   */
  comOAtual: boolean;
}

/**
 * O conjunto de gemas que vem depois do de agora, inteiro, embaixo dos links e dos itens: pra já ir
 * juntando as gemas dele quando a chance aparece (as que ele traz de novo ficam em destaque).
 * ◀ ▶ andam pelos outros conjuntos da build, pra frente e pra trás (o de agora, que já está em cima,
 * fica de fora), e "voltar pro próximo" volta. Mexe só neste bloco: o de cima, os itens e a árvore
 * ficam como estão. Quando o conjunto de agora troca, o bloco volta sozinho pro próximo.
 *
 * Com os links do leveling em cima (conjunto de agora de endgame, como o "Level 68" no nível 36),
 * o bloco começa no conjunto de agora, inteiro: é o kit que se monta até o nível em que ele vale.
 */
function ConjuntoQueVem({ plano, escolha, situacao, clicavel, emSoquetes, comOAtual }: PropsDoQueVem) {
  const ordem = useMemo(() => conjuntosEmOrdem(plano), [plano]);
  const [escolhido, setEscolhido] = useState<{ de: string | null; indice: number } | null>(null);
  const agora = escolha.etapa ? ordem.findIndex((c) => c.etapa === escolha.etapa) : -1;
  // O conjunto que as setas pulam, por já estar inteiro em cima (com os links do leveling, nenhum).
  const pular = comOAtual ? -1 : agora;
  const proximo = inicioDoQueVem(ordem, escolha, comOAtual);
  if (proximo < 0) return null;
  const de = escolha.etapa?.id ?? null;
  const indice =
    escolhido && escolhido.de === de && escolhido.indice < ordem.length && escolhido.indice !== pular
      ? escolhido.indice
      : proximo;
  /** Pra onde a seta leva (pulando o conjunto que já está em cima); `null` = acabou a lista. */
  const vizinho = (passo: number): number | null => {
    let novo = indice + passo;
    if (novo === pular) novo += passo;
    return novo >= 0 && novo < ordem.length ? novo : null;
  };
  const andar = (passo: number) => {
    const novo = vizinho(passo);
    if (novo !== null) setEscolhido(novo === proximo ? null : { de, indice: novo });
  };
  const { etapa, nivel } = ordem[indice];
  const ehOProximo = indice === proximo;
  const ehOAtual = indice === agora;
  const rotulo = ehOAtual
    ? "Conjunto inteiro"
    : ehOProximo
      ? "Próximo conjunto"
      : agora < 0 || indice > agora
        ? "Mais à frente"
        : "Conjunto de antes";
  let quando = "";
  if (ehOAtual) quando = escolha.entra !== null ? ` · até o nível ${escolha.entra}` : "";
  else if (ehOProximo && escolha.entra !== null) quando = ` · entra no nível ${escolha.entra}`;
  else if (ehOProximo && quandoEntra(etapa, situacao)) quando = quandoEntra(etapa, situacao);
  else if (nivel !== null && nivel > 1) quando = ` · ${ehOProximo || indice > agora ? "entra no" : "do"} nível ${nivel}`;
  return (
    <section className={ehOProximo ? "secao conjunto-que-vem" : "secao conjunto-que-vem fora-do-proximo"}>
      <div className="linha-do-seletor">
        <button
          className="seta-da-arvore"
          disabled={!clicavel || vizinho(-1) === null}
          title="Conjunto de gemas anterior"
          onClick={() => andar(-1)}
        >
          ◀
        </button>
        <div className="etapa-da-arvore">
          <span className="titulo">
            {rotulo}: {etapa.titulo || "(sem nome)"}
          </span>
          <span className="fraco">
            {quando} · {indice + 1}/{ordem.length}
          </span>
        </div>
        <button
          className="seta-da-arvore"
          disabled={!clicavel || vizinho(1) === null}
          title="Conjunto de gemas seguinte"
          onClick={() => andar(1)}
        >
          ▶
        </button>
      </div>
      {!ehOProximo && clicavel && (
        <div className="fraco">
          <button className="link-da-arvore" onClick={() => setEscolhido(null)}>
            {comOAtual ? "voltar pro de agora" : "voltar pro próximo"}
          </button>
        </div>
      )}
      {emSoquetes ? <CartoesDoConjunto etapa={etapa} /> : <LinhasDoConjunto etapa={etapa} />}
    </section>
  );
}

/** Os links do leveling (PoB só de endgame) no expandido, em soquetes. */
function LinksDoLevelingEmSoquetes({ etapa, nivel }: { etapa: EtapaDeGemas; nivel: number }) {
  const { links, soltas } = linksDoLeveling(etapa, nivel);
  const proxima = proximaMudanca(etapa, nivel);
  if (links.length === 0 && soltas.length === 0 && !proxima) return null;
  return (
    <section className="secao links-leveling">
      <div className="titulo">Links pro leveling</div>
      {links.length > 0 && (
        <div className="grade-de-links">
          {links.map((link, i) => (
            <CartaoDoLink
              key={i}
              gemas={[link.habilidade, ...link.suportes]}
              titulo={link.ate ? `até o ${link.ate.nome}, nv ${link.ate.nivel}` : ""}
              principal={link.principal}
            />
          ))}
        </div>
      )}
      <GemasSoltas rotulo={links.length > 0 ? "também: " : "usar: "} gemas={soltas} />
      {proxima && (
        <div className="fraco">
          nv {proxima.nivel}: entra {proxima.gemas.map(semSupport).join(", ")}
        </div>
      )}
    </section>
  );
}

function GemaPequena({ gema }: { gema: { gem_id: string | null; cor: string; nome: string } }) {
  return (
    <span className="gema-do-link">
      {gema.gem_id ? <IconeDaGema gemId={gema.gem_id} cor={gema.cor} /> : <Cor cor={gema.cor} />}
      {gema.nome.replace(/ Support$/, "")}
    </span>
  );
}

/**
 * Os links pro leveling, quando o PoB só tem conjunto de endgame: o que já dá pra ligar no nível
 * de agora, e o próximo nível em que entra gema nova.
 */
/** Durante o jogo, poucos links e poucas gemas soltas; o modo de edição mostra tudo. */
const LINKS_A_VISTA = 3;
const SOLTAS_A_VISTA = 4;

function LinksIniciais({ etapa, nivel, edicao }: { etapa: EtapaDeGemas; nivel: number; edicao: boolean }) {
  const todos = linksDoLeveling(etapa, nivel);
  const proxima = proximaMudanca(etapa, nivel);
  if (todos.links.length === 0 && todos.soltas.length === 0 && !proxima) return null;
  const links = edicao ? todos.links : todos.links.slice(0, LINKS_A_VISTA);
  const soltas = edicao ? todos.soltas : todos.soltas.slice(0, SOLTAS_A_VISTA);
  const escondidas = todos.links.length - links.length + todos.soltas.length - soltas.length;
  return (
    <section className="secao links-leveling">
      <div className="titulo">Links pro leveling</div>
      {links.map((link, i) => (
        <div key={i} className={link.principal ? "link-leveling principal" : "link-leveling"}>
          <span className="selo-link">{link.suportes.length + 1}L</span>
          <GemaPequena gema={link.habilidade} />
          {link.suportes.map((s, j) => (
            <span key={j}>
              <span className="fraco"> + </span>
              <GemaPequena gema={s} />
            </span>
          ))}
          {link.ate && (
            <span className="fraco">
              {" "}
              (até o {link.ate.nome}, nv {link.ate.nivel})
            </span>
          )}
        </div>
      ))}
      {soltas.length > 0 && (
        <div className="link-leveling">
          <span className="fraco">{links.length > 0 ? "também: " : "usar: "}</span>
          {soltas.map((s, i) => (
            <span key={i}>
              {i > 0 && <span className="fraco">, </span>}
              <GemaPequena gema={s} />
            </span>
          ))}
          {escondidas > 0 && <span className="fraco"> +{escondidas}</span>}
        </div>
      )}
      {proxima && (
        <div className="fraco">
          nv {proxima.nivel}: entra {proxima.gemas.map((n) => n.replace(/ Support$/, "")).join(", ")}
        </div>
      )}
      {edicao && (
        <div className="fraco">
          O PoB só tem conjunto de endgame ({etapa.titulo || "sem nome"}): estes links saem dele, com as gemas
          que o nível já permite. O conjunto completo aparece a partir dos mapas.
        </div>
      )}
    </section>
  );
}

interface PropsDaArvore {
  etapa: EtapaDeArvore | null;
  /** O guia da árvore; sem ele, fica só a linha com a conta de nós. */
  guia?: GuiaDoPainel | null;
  /** O que a foto da tela mostrou da árvore do jogo. */
  situacao?: SituacaoDaArvore | null;
  /** Nível e ato do personagem, pra estimar os pontos antes de ver a árvore. */
  onde: SituacaoDaSessao;
  edicao: boolean;
  /** Quantos nós listar fora da edição (o expandido mostra mais). */
  aVista?: number;
  /** O título já está no seletor de etapas, logo acima. */
  semTitulo?: boolean;
}

function Arvore({ etapa, guia, situacao, onde, edicao, aVista, semTitulo }: PropsDaArvore) {
  if (!etapa) return null;
  if (!guia) {
    if (semTitulo) return null;
    const novos = etapa.nos_novos > 0 && etapa.nos_novos < etapa.nos.length ? ` (+${etapa.nos_novos})` : "";
    return (
      <section className="secao">
        <div className="titulo">
          {comTitulo("Árvore até", etapa.titulo, "Árvore do PoB")}
          <span className="fraco">
            {" · "}
            {etapa.nos.length} nós{novos}
          </span>
        </div>
      </section>
    );
  }
  const vista = vistaDaArvore(guia, situacao ?? null, onde, edicao, aVista);
  const til = vista.estimada ? "~" : "";
  return (
    <section className={vista.aberta ? "secao arvore aberta" : "secao arvore"}>
      {!semTitulo && (
        <div className="titulo">
          {comTitulo("Árvore até", etapa.titulo, "Árvore do PoB")}
          <span className="fraco">
            {" · "}
            {vista.faltam > 0 ? `faltam ${til}${vista.faltam}` : `${til}completa`}
          </span>
        </div>
      )}
      {vista.linhas.length > 0 && (
        <ol className="nos-da-arvore">
          {vista.linhas.map((linha) => (
            <li key={linha.indice} className={linha.feito ? "no-da-arvore feito" : "no-da-arvore"}>
              <span className="no-numero">{linha.numero ?? (linha.feito ? "✓" : "")}</span>
              <span>
                {linha.nome}
                {linha.efeito && <span className="no-efeito"> · {linha.efeito}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {(vista.mais > 0 || vista.tirar.length > 0) && (
        <div className="fraco">
          {vista.mais > 0 &&
            (vista.mais_sem_caminho
              ? `${vista.mais} ${vista.mais === 1 ? "nó" : "nós"} sem caminho: o guia não põe número, pegue pelo PoB`
              : `e mais ${vista.mais} ${vista.mais === 1 ? "nó" : "nós"} até esta etapa`)}
          {vista.mais > 0 && vista.tirar.length > 0 && " · "}
          {vista.tirar.length > 0 && <span className="no-a-tirar">tirar: {vista.tirar.join(", ")}</span>}
        </div>
      )}
      {vista.estimada && vista.faltam > 0 && (
        <div className="fraco">pelo nível; abra a árvore no jogo pra conferir</div>
      )}
      {vista.aviso && <div className="aviso-da-arvore">{vista.aviso}</div>}
      {(edicao ? guia.guia.avisos : avisosDeSempre(guia.guia)).map((texto, i) => (
        <div key={i} className="aviso-da-arvore">
          {texto}
        </div>
      ))}
      {edicao && vista.diag && <div className="fraco">{vista.diag}</div>}
    </section>
  );
}

/** As etapas da árvore do PoB (as que têm nível ou ato) e como andar entre elas. */
export interface NavegarArvore {
  etapas: EtapaDeArvore[];
  /** Posição, em `etapas`, da etapa que o guia mostra agora. */
  atual: number;
  /** Posição da etapa que o nível do personagem pede (a automática). */
  automatica: number;
  /** Põe a etapa na mão (`null` volta pra automática). */
  escolher: (indice: number | null) => void;
  andar: (passos: number) => void;
}

interface PropsDoSeletor {
  nav: NavegarArvore;
  clicavel: boolean;
  guia?: GuiaDoPainel | null;
  situacao?: SituacaoDaArvore | null;
  onde: SituacaoDaSessao;
}

/**
 * ◀ Árvore até X (3/7) ▶ — volta e avança entre as etapas da árvore do PoB (pra achar a maestria que
 * ficou pra trás quando o nível já levou o guia pra etapa seguinte). Clicar no título abre a lista
 * das etapas. Com a árvore aberta no jogo, as setas do teclado fazem o mesmo (← ↓ volta, → ↑ avança).
 */
function SeletorDaArvore({ nav, clicavel, guia, situacao, onde }: PropsDoSeletor) {
  const [lista, setLista] = useState(false);
  const total = nav.etapas.length;
  if (total < 2 || nav.atual < 0) return null;
  const etapa = nav.etapas[nav.atual];
  const naMao = nav.atual !== nav.automatica;
  const vista = guia ? vistaDaArvore(guia, situacao ?? null, onde, false) : null;
  const til = vista?.estimada ? "~" : "";
  return (
    <section className={situacao?.aberta ? "secao seletor-da-arvore aberta" : "secao seletor-da-arvore"}>
      <div className="linha-do-seletor">
        <button
          className="seta-da-arvore"
          disabled={!clicavel || nav.atual === 0}
          title="Etapa anterior (com a árvore aberta: ← ou ↓)"
          onClick={() => nav.andar(-1)}
        >
          ◀
        </button>
        <button
          className="etapa-da-arvore"
          disabled={!clicavel}
          title="Escolher a etapa da árvore"
          onClick={() => setLista((aberta) => !aberta)}
        >
          <span className="titulo">{comTitulo("Árvore até", etapa.titulo, "Árvore do PoB")}</span>
          <span className="fraco">
            {" "}
            {nav.atual + 1}/{total}
            {vista && (vista.faltam > 0 ? ` · faltam ${til}${vista.faltam}` : ` · ${til}completa`)}
          </span>
        </button>
        <button
          className="seta-da-arvore"
          disabled={!clicavel || nav.atual === total - 1}
          title="Próxima etapa (com a árvore aberta: → ou ↑)"
          onClick={() => nav.andar(1)}
        >
          ▶
        </button>
      </div>
      {naMao && (
        <div className="fraco">
          {nav.atual < nav.automatica ? "etapa de antes, " : "etapa da frente, "}
          escolhida na mão
          {clicavel && (
            <>
              {" · "}
              <button className="link-da-arvore" onClick={() => nav.escolher(null)}>
                voltar pra do nível
              </button>
            </>
          )}
        </div>
      )}
      {lista && clicavel && (
        <ol className="lista-da-arvore">
          {nav.etapas.map((e, i) => (
            <li key={e.id}>
              <button
                className={i === nav.atual ? "escolhido" : undefined}
                onClick={() => {
                  setLista(false);
                  nav.escolher(i);
                }}
              >
                {i + 1}. {e.titulo || "sem nome"}
                {i === nav.automatica && <span className="fraco"> · a do nível</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

interface PropsDosItens {
  escolha: EscolhaDeItens | null;
  unicos: ItemDoPlano[];
}

/** Quantos itens do próximo conjunto a faixa de baixo mostra. */
const PROXIMOS_NA_FAIXA = 3;

/** "12" = os itens até o nível 12 (o PoB rotula muito conjunto de itens só com o número). */
function tituloDosItens(etapa: EtapaDeItens): string {
  const so = /^\s*(\d{1,3})\s*(\+?)\s*$/.exec(etapa.titulo);
  if (so) return so[2] ? `Itens do nível ${so[1]} em diante` : `Itens até o nível ${so[1]}`;
  return comTitulo("Itens", etapa.titulo, "Itens da build");
}

/** O conjunto de itens no rótulo curto da faixa ("até o nível 12"); sem número, o título do PoB. */
function rotuloDaFaixa(etapa: EtapaDeItens): string {
  const so = /^\s*(\d{1,3})\s*(\+?)\s*$/.exec(etapa.titulo);
  if (so) return so[2] ? `do nível ${so[1]} em diante` : `até o nível ${so[1]}`;
  return etapa.titulo;
}

function ListaCurta({ itens }: { itens: ItemCurto[] }) {
  return (
    <>
      {itens.map((item, i) => (
        <span key={i} className="item-curto">
          {i > 0 && <span className="fraco"> · </span>}
          <FotoDoItem item={item} />
          <span className={`raridade-${item.raridade.toLowerCase()}`}>{item.nome}</span>
          {item.quantidade > 1 && <span className="fraco"> ×{item.quantidade}</span>}
        </span>
      ))}
    </>
  );
}

/**
 * Os itens no pé do balão, durante o jogo: o conjunto da fase numa linha e, embaixo, o que muda no
 * próximo. Fica fora da parte que o balão corta, então aparece sempre. A lista completa, por espaço,
 * fica no modo de edição.
 */
export function FaixaDeItens({ escolha, trocou }: { escolha: EscolhaDeItens; trocou: boolean }) {
  const etapa = escolha.etapa;
  if (!etapa || etapa.itens.length === 0) return null;
  const agora = itensEmLinha(linhasDeItens(etapa.itens));
  const proxima = escolha.proxima;
  const depois = proxima ? itensEmLinha(itensQueMudam(etapa.itens, proxima.itens)) : [];
  const rotulo = rotuloDaFaixa(etapa);
  return (
    <section className={trocou ? "faixa-itens trocou" : "faixa-itens"}>
      <div>
        <span className="titulo">{trocou ? "Itens novos" : "Itens"}</span>
        <span className="fraco">{rotulo ? ` ${rotulo}: ` : ": "}</span>
        <ListaCurta itens={agora} />
      </div>
      {proxima && depois.length > 0 && (
        <div>
          <span className="fraco">
            {escolha.entra !== null ? `no nível ${escolha.entra}: ` : `depois (${proxima.titulo || "sem nome"}): `}
          </span>
          <ListaCurta itens={depois.slice(0, PROXIMOS_NA_FAIXA)} />
          {depois.length > PROXIMOS_NA_FAIXA && <span className="fraco"> +{depois.length - PROXIMOS_NA_FAIXA}</span>}
        </div>
      )}
    </section>
  );
}

function ItensDaLinha({ linha }: { linha: LinhaDeItem }) {
  return (
    <>
      {linha.itens.map((item, i) => (
        <span key={i}>
          {i > 0 && <span className="fraco">, </span>}
          <span className={`raridade-${item.raridade.toLowerCase()}`}>{item.nome}</span>
          {item.quantidade > 1 && <span className="fraco"> ×{item.quantidade}</span>}
          {item.base && <span className="fraco"> ({item.base})</span>}
        </span>
      ))}
    </>
  );
}

/** A lista completa dos itens, um espaço por linha, com os únicos: é a do modo de edição. */
function Itens({ escolha, unicos }: PropsDosItens) {
  const etapa = escolha?.etapa ?? null;
  const proxima = escolha?.proxima ?? null;
  const trocas = etapa && proxima ? itensQueMudam(etapa.itens, proxima.itens) : [];
  if (!etapa && unicos.length === 0) return null;
  return (
    <section className="secao">
      {etapa && etapa.itens.length > 0 && (
        <>
          <div className="titulo">{tituloDosItens(etapa)}</div>
          <ul className="itens">
            {linhasDeItens(etapa.itens).map((linha) => (
              <li key={linha.espaco}>
                <span className="fraco">{linha.espaco}: </span>
                <ItensDaLinha linha={linha} />
              </li>
            ))}
          </ul>
        </>
      )}
      {proxima && trocas.length > 0 && (
        <div className="itens-depois">
          <span className="fraco">
            {escolha?.entra != null ? `depois do nível ${escolha.entra}: ` : `próximo (${proxima.titulo || "sem nome"}): `}
          </span>
          {trocas.map((linha, i) => (
            <span key={linha.espaco}>
              {i > 0 && <span className="fraco"> · </span>}
              <span className="fraco">{linha.espaco} </span>
              <ItensDaLinha linha={{ ...linha, itens: linha.itens.map((item) => ({ ...item, base: null })) }} />
            </span>
          ))}
        </div>
      )}
      {unicos.length > 0 && (
        <div>
          <span className="fraco">Únicos pra procurar: </span>
          <span className="raridade-unique">{unicos.map((u) => u.nome).join(", ")}</span>
        </div>
      )}
    </section>
  );
}

/** Um item no expandido: o espaço em cima, a foto grande no meio e o nome embaixo, na cor da raridade. */
function QuadroDoItem({ espaco, item }: { espaco: string; item: LinhaDeItem["itens"][number] }) {
  const raridade = item.raridade.toLowerCase();
  const titulo = item.base && item.base !== item.nome ? `${item.nome} (${item.base})` : item.nome;
  return (
    <div className={`quadro-item borda-${raridade}`} title={titulo}>
      <span className="quadro-item-espaco">{espaco}</span>
      <FotoDoItem item={item} grande />
      <span className={`quadro-item-nome raridade-${raridade}`}>
        {nomeCurtoDoItem(item)}
        {item.quantidade > 1 && <span className="fraco"> ×{item.quantidade}</span>}
      </span>
    </div>
  );
}

/** Quantos itens do próximo conjunto o expandido mostra antes do "+N". */
const PROXIMOS_NO_EXPANDIDO = 6;

/** Tem o que mostrar na seção de itens (o conjunto da fase ou os únicos da build). */
function temItens(escolha: EscolhaDeItens | null, unicos: readonly ItemDoPlano[]): boolean {
  return (escolha?.etapa?.itens.length ?? 0) > 0 || unicos.length > 0;
}

/**
 * Os itens no expandido: o conjunto da fase em quadros com a foto; embaixo, o que muda e os únicos.
 * As receitas de vendedor (`dicasDoAto`) saíram da tela em 12/11/2026, a pedido do usuário; os dados
 * continuam no plano.
 */
function ItensComFotos(props: PropsDosItens & { trocou: boolean }) {
  const { escolha, unicos, trocou } = props;
  const etapa = escolha?.etapa ?? null;
  const proxima = escolha?.proxima ?? null;
  const depois = etapa && proxima ? itensEmLinha(itensQueMudam(etapa.itens, proxima.itens)) : [];
  const comItens = etapa !== null && etapa.itens.length > 0;
  if (!temItens(escolha, unicos)) return null;
  return (
    <section className={trocou ? "secao itens-expandido trocou" : "secao itens-expandido"}>
      {etapa && comItens && (
        <>
          <div className="titulo">{trocou ? `Novos: ${tituloDosItens(etapa)}` : tituloDosItens(etapa)}</div>
          <div className="grade-de-itens">
            {linhasDeItens(etapa.itens).flatMap((linha) =>
              linha.itens.map((item, i) => <QuadroDoItem key={`${linha.espaco}-${i}`} espaco={linha.espaco} item={item} />),
            )}
          </div>
        </>
      )}
      {proxima && depois.length > 0 && (
        <div className="itens-depois">
          <span className="fraco">
            {escolha?.entra != null ? `no nível ${escolha.entra}: ` : `depois (${proxima.titulo || "sem nome"}): `}
          </span>
          <ListaCurta itens={depois.slice(0, PROXIMOS_NO_EXPANDIDO)} />
          {depois.length > PROXIMOS_NO_EXPANDIDO && <span className="fraco"> +{depois.length - PROXIMOS_NO_EXPANDIDO}</span>}
        </div>
      )}
      {unicos.length > 0 && (
        <div className="itens-depois">
          <span className="fraco">Únicos pra procurar: </span>
          <ListaCurta
            itens={unicos.map((u) => ({ nome: u.nome, base: u.base || null, raridade: u.raridade || "UNIQUE", quantidade: 1 }))}
          />
        </div>
      )}
    </section>
  );
}

/** O que vai num bloco do balão. */
interface PecaDoBloco {
  corpo: ReactNode;
  /** Uma linha do que tem dentro, no cabeçalho do bloco fechado. */
  resumo?: ReactNode;
  /** Novidade dentro (o conjunto ou os itens acabaram de trocar): o cabeçalho fica verde. */
  novo?: boolean;
}

interface PropsDoBloco extends PecaDoBloco {
  id: IdDoBloco;
  fechado: boolean;
  /** Alt segurado: os botões do cabeçalho aceitam clique. */
  clicavel: boolean;
  primeiro: boolean;
  ultimo: boolean;
  aoAlternar: () => void;
  aoMover: (sentido: 1 | -1) => void;
}

/**
 * Um bloco do balão: um cabeçalho fino (o nome, ▾ aberto / ▸ fechado e, com Alt, ▲ ▼ pra trocar de
 * lugar) e o conteúdo. Fechado, fica só o cabeçalho, com o resumo do que tem dentro.
 */
function Bloco(props: PropsDoBloco) {
  const nome = BLOCOS.find((b) => b.id === props.id)?.nome ?? props.id;
  const classes = ["bloco-do-balao"];
  if (props.fechado) classes.push("fechado");
  if (props.novo) classes.push("novo");
  const so = (acao: () => void) => () => {
    if (props.clicavel) acao();
  };
  return (
    <div className={classes.join(" ")} data-bloco={props.id}>
      <div className="cabeca-do-bloco">
        <button
          className="nome-do-bloco"
          title={`${props.fechado ? "Abrir" : "Fechar"} o bloco (segure Alt e clique)`}
          aria-expanded={!props.fechado}
          onClick={so(props.aoAlternar)}
        >
          <span className="seta-do-bloco" aria-hidden>
            {props.fechado ? "▸" : "▾"}
          </span>
          {nome}
        </button>
        {props.fechado && props.resumo && <span className="resumo-do-bloco">{props.resumo}</span>}
        <span className="risco-do-bloco" aria-hidden />
        <span className="setas-do-bloco">
          <button
            title="Subir o bloco (segure Alt e clique)"
            aria-label={`Subir ${nome}`}
            disabled={props.primeiro}
            onClick={so(() => props.aoMover(-1))}
          >
            ▲
          </button>
          <button
            title="Descer o bloco (segure Alt e clique)"
            aria-label={`Descer ${nome}`}
            disabled={props.ultimo}
            onClick={so(() => props.aoMover(1))}
          >
            ▼
          </button>
        </span>
      </div>
      {!props.fechado && <div className="corpo-do-bloco">{props.corpo}</div>}
    </div>
  );
}

export interface PropsDoJogo {
  plano: Plano;
  rota: Rota;
  sessao: Sessao;
  situacao: SituacaoDaSessao;
  /** Melhor tempo de cada ato, pra comparar com o ato de agora. */
  recordes?: Recordes;
  escolha: EscolhaDeGemas;
  arvore: EtapaDeArvore | null;
  /** O guia da árvore de passivas; `null` = sem guia, a seção fica só com a conta de nós. */
  guiaDaArvore?: GuiaDoPainel | null;
  /** O que a foto da tela mostrou da árvore do jogo. */
  situacaoDaArvore?: SituacaoDaArvore | null;
  /** Andar entre as etapas da árvore (aparece com a árvore aberta no jogo e no modo de edição). */
  navegarArvore?: NavegarArvore | null;
  /** O conjunto de itens da vez e o próximo. */
  itens: EscolhaDeItens | null;
  mostrar: Mostrar;
  /** A ordem dos blocos do balão no jogo e os que estão fechados (padrão: todos abertos). */
  blocos?: Blocos;
  /** Muda a ordem ou abre/fecha um bloco (recebe a conta, pra rodar em cima do valor mais novo). */
  aoMudarBlocos?: (mudar: (blocos: Blocos) => Blocos) => void;
  painel: PainelDeLayout;
  edicao: boolean;
  /** O conjunto de gemas acabou de trocar. */
  trocou: boolean;
  teclaDoLayout: string;
  /** Dá pra clicar nos quadradinhos agora (Alt segurado ou modo de edição). */
  clicavel: boolean;
  /** Como marcar as gemas quando não dá pra clicar ("segure Alt e clique no quadrado"). */
  comoMarcar: string;
  aoMarcarGema: (chave: string) => void;
  aoEscolherLayout: (posicao: number | null) => void;
  /** Balão resumido: só a linha de cima, o passo atual e a próxima gema. */
  resumido?: boolean;
  /** Balão expandido: o guia e, embaixo, os links em soquetes e as fotos dos itens. */
  expandido?: boolean;
  /** O conjunto de itens acabou de trocar (o expandido destaca os itens novos). */
  trocouItens?: boolean;
  /** Botões de trocar a forma do balão, na linha de cima. */
  botoes?: ReactNode;
  /** Segurar a linha de cima (com Alt) arrasta o balão. */
  aoSegurarBarra?: MouseEventHandler;
  /** O quadro roxo da ascendência e do panteão (com a árvore de passivas aberta), junto das setas da árvore. */
  ascendencia?: ReactNode;
}

export function Jogo(props: PropsDoJogo) {
  const { plano, rota, sessao, situacao, mostrar } = props;
  // Com a árvore do jogo aberta, a seção dela sobe pra perto do passo.
  const arvoreEmCima = Boolean(props.guiaDaArvore && props.situacaoDaArvore?.aberta);
  // PoB só de endgame, na campanha: no lugar do 6L final, os links que dá pra montar agora.
  const comLinksDoLeveling = usarLinksDoLeveling(props.escolha.etapa, situacao.nivel, props.escolha.automatica);
  const ordemDosConjuntos = useMemo(() => conjuntosEmOrdem(plano), [plano]);
  // A seção da árvore só aparece no modo de edição: no jogo, o desenho em cima da árvore de
  // passivas (tecla P) já mostra os próximos pontos. Fica guardada pra voltar se fizer falta
  // (era a opção `mostrar.arvore`).
  const arvore = props.edicao && (
    <Arvore
      etapa={props.arvore}
      guia={props.guiaDaArvore}
      situacao={props.situacaoDaArvore}
      onde={situacao}
      edicao={props.edicao}
      semTitulo={Boolean(props.navegarArvore)}
    />
  );
  // As setas das etapas da árvore: no jogo, só com a árvore aberta (tecla P); na edição, sempre.
  const arvoreAberta = Boolean(props.situacaoDaArvore?.aberta);
  const seletor = props.navegarArvore && (arvoreAberta || props.edicao) && (
    <SeletorDaArvore
      nav={props.navegarArvore}
      clicavel={props.clicavel}
      guia={props.guiaDaArvore}
      situacao={props.situacaoDaArvore}
      onde={situacao}
    />
  );
  const marcas: Marcas = {
    lista: sessao.marcadas,
    clicavel: props.clicavel,
    comoMarcar: props.comoMarcar,
    aoMarcar: props.aoMarcarGema,
  };
  // O próximo conjunto de gemas, inteiro, no fim do balão. Com os links do leveling em cima, ele
  // começa no conjunto de agora, inteiro (na edição o de agora já aparece inteiro, aí não).
  const comQueVem = mostrar.conjunto;
  const queVem = (emSoquetes: boolean) =>
    comQueVem && (
      <ConjuntoQueVem
        plano={plano}
        escolha={props.escolha}
        situacao={situacao}
        clicavel={props.clicavel}
        emSoquetes={emSoquetes}
        comOAtual={comLinksDoLeveling && !props.edicao}
      />
    );
  const barra = (
    <Situacao
      rota={rota}
      sessao={sessao}
      situacao={situacao}
      recordes={props.recordes}
      botoes={props.botoes}
      aoSegurar={props.aoSegurarBarra}
    />
  );
  if (props.resumido) {
    return (
      <>
        {barra}
        <Passos rota={rota} sessao={sessao} situacao={situacao} proximos={false} semGemas curto />
        <ProximaGemaCurta rota={rota} passo={sessao.passo} marcas={marcas} />
        {seletor}
        {props.ascendencia}
      </>
    );
  }
  if (!props.edicao) {
    // No jogo (expandido e detalhado) o balão é feito de blocos: cada um fecha e abre sozinho e troca
    // de lugar com os outros (cabeçalho do bloco, segurando Alt). Fixos em cima de todos ficam a
    // linha de cima e o que abre por tecla: as setas e a ascendência (árvore aberta, tecla P) e o
    // layout da zona (F6).
    // No expandido o balão cresce pra baixo, com os links em soquetes e os itens com foto. Ficaram
    // de fora (por enquanto) as gemas do resto do ato, que sobem sozinhas pra "próxima gema"
    // conforme o passo anda, e a seção da árvore, que o desenho em cima da árvore do jogo (tecla P)
    // já mostra. Os dois continuam no modo de edição.
    // No detalhado os itens não são bloco: ficam na faixa do pé (`FaixaDeItens`, no App), fora da
    // parte que o balão corta quando não cabe.
    const expandido = Boolean(props.expandido);
    const blocos = props.blocos ?? BLOCOS_PADRAO;
    const pecas: Partial<Record<IdDoBloco, PecaDoBloco>> = {};
    const atual = passosAVista(rota, sessao.passo, 0)[0];
    if (atual) {
      pecas.missoes = {
        corpo: (
          <Passos
            rota={rota}
            sessao={sessao}
            situacao={situacao}
            proximos={mostrar.proximos}
            semGemas={mostrar.gemas_do_ato}
          />
        ),
        resumo: <Pedacos pedacos={atual.pedacos} />,
      };
    }
    if (mostrar.gemas_do_ato && temCartaoDeGema(rota, sessao.passo, marcas.lista)) {
      const nomes = proximaParada(rota, sessao.passo, marcas.lista)?.gemas.map((g) => g.nome) ?? [];
      pecas.gemas = {
        corpo: <ProximaGema plano={plano} rota={rota} passo={sessao.passo} marcas={marcas} />,
        resumo: nomes.length > 0 ? nomes.join(", ") : undefined,
      };
    }
    const etapa = props.escolha.etapa;
    if (mostrar.conjunto && etapa) {
      let corpo: ReactNode;
      if (comLinksDoLeveling) {
        corpo = expandido ? (
          <LinksDoLevelingEmSoquetes etapa={etapa} nivel={situacao.nivel} />
        ) : (
          <LinksIniciais etapa={etapa} nivel={situacao.nivel} edicao={false} />
        );
      } else {
        const conjunto = { plano, escolha: props.escolha, situacao, trocou: props.trocou, semProximo: comQueVem };
        corpo = expandido ? <ConjuntoEmSoquetes {...conjunto} /> : <Conjunto {...conjunto} />;
      }
      pecas.conjunto = {
        corpo,
        resumo: comLinksDoLeveling ? "links pro leveling" : etapa.titulo || undefined,
        novo: props.trocou && !comLinksDoLeveling,
      };
    }
    const unicos = plano.itens.unicos_desejados;
    if (expandido && mostrar.itens && temItens(props.itens, unicos)) {
      const etapaDosItens = props.itens?.etapa;
      pecas.itens = {
        corpo: <ItensComFotos escolha={props.itens} unicos={unicos} trocou={props.trocouItens ?? false} />,
        resumo: etapaDosItens && etapaDosItens.itens.length > 0 ? tituloDosItens(etapaDosItens) : "únicos pra procurar",
        novo: props.trocouItens,
      };
    }
    const inicio = comQueVem ? inicioDoQueVem(ordemDosConjuntos, props.escolha, comLinksDoLeveling) : -1;
    if (inicio >= 0) {
      pecas.proximos = {
        corpo: queVem(expandido),
        resumo: ordemDosConjuntos[inicio].etapa.titulo || undefined,
      };
    }
    const visiveis = blocos.ordem.filter((id) => pecas[id]);
    const mudar = props.aoMudarBlocos;
    return (
      <>
        {barra}
        {seletor}
        {props.ascendencia}
        <Layout painel={props.painel} edicao={false} tecla={props.teclaDoLayout} aoEscolher={props.aoEscolherLayout} />
        {visiveis.map((id, i) => (
          <Bloco
            key={id}
            id={id}
            {...pecas[id]!}
            fechado={blocos.fechados.includes(id)}
            clicavel={props.clicavel && Boolean(mudar)}
            primeiro={i === 0}
            ultimo={i === visiveis.length - 1}
            aoAlternar={() => mudar?.((b) => alternarBloco(b, id))}
            aoMover={(sentido) => mudar?.((b) => moverBloco(b, id, sentido, visiveis))}
          />
        ))}
      </>
    );
  }
  return (
    <>
      {barra}
      <Passos
        rota={rota}
        sessao={sessao}
        situacao={situacao}
        proximos={mostrar.proximos}
        semGemas={mostrar.gemas_do_ato && !props.edicao}
      />
      {mostrar.gemas_do_ato && (
        <ProximaGema
          plano={plano}
          rota={rota}
          passo={sessao.passo}
          marcas={marcas}
        />
      )}
      {arvoreAberta && seletor}
      {arvoreAberta && props.ascendencia}
      {arvoreEmCima && arvore}
      <Layout
        painel={props.painel}
        edicao={props.edicao}
        tecla={props.teclaDoLayout}
        aoEscolher={props.aoEscolherLayout}
      />
      {/* O conjunto novo sobe pra perto do passo enquanto é novidade. */}
      {mostrar.conjunto && props.trocou && !comLinksDoLeveling && (
        <Conjunto plano={plano} escolha={props.escolha} situacao={situacao} trocou semProximo={comQueVem} />
      )}
      {mostrar.conjunto && comLinksDoLeveling && props.escolha.etapa && (
        <LinksIniciais etapa={props.escolha.etapa} nivel={situacao.nivel} edicao={props.edicao} />
      )}
      {mostrar.gemas_do_ato && props.edicao && <GemasDoAto rota={rota} passo={sessao.passo} edicao />}
      {/* Com os links do leveling, o conjunto de endgame só aparece no modo de edição. */}
      {mostrar.conjunto && !props.trocou && (!comLinksDoLeveling || props.edicao) && (
        <Conjunto plano={plano} escolha={props.escolha} situacao={situacao} trocou={false} semProximo={comQueVem} />
      )}
      {queVem(false)}
      {!arvoreAberta && seletor}
      {!arvoreAberta && props.ascendencia}
      {!arvoreEmCima && arvore}
      {/* Durante o jogo, os itens vão na faixa do pé do balão (`FaixaDeItens`, no App). */}
      {mostrar.itens && props.edicao && (
        <Itens escolha={props.itens} unicos={plano.itens.unicos_desejados} />
      )}
    </>
  );
}
