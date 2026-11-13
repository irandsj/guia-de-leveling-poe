// O filtro de itens da build, em passos. Logo depois de importar a build, o guia olha o que ela usa
// (bases, links, gemas, únicos) e pergunta se o jogador quer que isso brilhe no chão. Se sim,
// pergunta em qual dos filtros dele pôr os destaques (os arquivos da pasta do jogo e os filtros
// online que ele segue no site) e cria um filtro NOVO com o nome da build ("Elementalist
// Leveling"): os destaques em cima e o filtro dele inteiro embaixo. O filtro do jogador não muda.
// O jogo não troca de filtro sozinho: no fim o guia diz onde escolher o novo. E, enquanto o jogo
// estiver noutro filtro, o balão avisa (`usarFiltroErrado`), com uma caixa pra não avisar mais.

import { useEffect, useMemo, useState } from "react";

import { backend, type FiltroGravado, type FiltrosDoJogo } from "../backend";
import type { TabelaDeArtes } from "../nucleo/artes-itens";
import {
  filtroDaBuild,
  filtroErrado,
  limparNome,
  LIMITE_DO_NOME,
  nomeDoFiltro,
  resumoDoFiltro,
  temOQueDestacar,
  textoDoFiltroErrado,
  type FiltroDaBuild as Destaques,
  type FiltroErrado,
  type FiltroNoJogo,
} from "../nucleo/filtro";
import type { Plano } from "../nucleo/plano";

/** Valor de "sem filtro base". */
const SEM_BASE = "";

/** De quanto em quanto tempo o guia confere qual filtro o jogo está usando. */
const OLHAR_O_FILTRO_A_CADA_MS = 10_000;

/**
 * O jogo está com o filtro que o jogador criou pra esta build? Confere a cada 10 s (o jogo grava
 * a troca de filtro na hora) e logo ao entrar e sair da edição, onde o filtro é criado. `null` = está
 * certo, o jogador não criou filtro pra esta build, ou desligou o aviso.
 */
export function usarFiltroErrado(plano: Plano | null, ligado: boolean, edicao: boolean): FiltroErrado | null {
  const [noJogo, setNoJogo] = useState<FiltroNoJogo | null>(null);
  const olhar = plano !== null && ligado;
  useEffect(() => {
    if (!olhar) return;
    let vivo = true;
    const ler = () =>
      backend
        .filtroNoJogo()
        .then((lido) => {
          if (vivo) setNoJogo((antes) => (JSON.stringify(antes) === JSON.stringify(lido) ? antes : lido));
        })
        .catch(() => undefined);
    void ler();
    const id = window.setInterval(() => void ler(), OLHAR_O_FILTRO_A_CADA_MS);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, [olhar, edicao]);
  return useMemo(() => (olhar && plano && noJogo ? filtroErrado(plano, noJogo) : null), [olhar, plano, noJogo]);
}

/** O aviso no balão: o jogo está noutro filtro. A caixa desliga o aviso (religa nas Opções). */
export function AvisoDoFiltro({
  errado,
  clicavel,
  comoClicar,
  aoDesligar,
}: {
  errado: FiltroErrado;
  /** Dá pra clicar agora (edição ou Alt segurado). */
  clicavel: boolean;
  /** Como fazer o balão aceitar o clique ("segure Alt e clique"). */
  comoClicar: string;
  aoDesligar: () => void;
}) {
  return (
    <div className="aviso aviso-do-filtro">
      <div>{textoDoFiltroErrado(errado)}</div>
      <label className="marca">
        <input type="checkbox" checked={false} disabled={!clicavel} onChange={(e) => e.target.checked && aoDesligar()} />
        <span>
          Não avisar mais <span className="fraco">({clicavel ? "religa nas Opções" : comoClicar})</span>
        </span>
      </label>
    </div>
  );
}

type Passo = "fechado" | "perguntar" | "escolher" | "pronto";

function textoDoErro(erro: unknown): string {
  if (typeof erro === "string") return erro;
  if (erro instanceof Error) return erro.message;
  return String(erro);
}

/** Os destaques da build (a tabela de artes é grande: só é carregada aqui). */
async function destaquesDaBuild(plano: Plano): Promise<Destaques> {
  const tabela = (await import("../dados/artes-itens.json")).default as TabelaDeArtes;
  return filtroDaBuild(plano, tabela);
}

export function FiltroDaBuild({
  plano,
  perguntar,
  aoResponder,
  aoTerminar,
  aoCriar,
}: {
  plano: Plano;
  /** Logo depois de importar a build: começa perguntando se o jogador quer o filtro. */
  perguntar: boolean;
  /** O jogador respondeu à pergunta (sim ou não): não pergunta de novo se o bloco fechar e abrir. */
  aoResponder: () => void;
  /** "Pronto": sai da edição pra o jogador ir trocar o filtro no jogo. */
  aoTerminar: () => void;
  /** O filtro foi criado (o aviso de filtro errado volta a valer). */
  aoCriar?: () => void;
}) {
  const [passo, setPasso] = useState<Passo>(perguntar ? "perguntar" : "fechado");
  const [destaques, setDestaques] = useState<Destaques | null>(null);
  const [filtros, setFiltros] = useState<FiltrosDoJogo | null>(null);
  const [base, setBase] = useState(SEM_BASE);
  const [nome, setNome] = useState(() => nomeDoFiltro(plano));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gravado, setGravado] = useState<FiltroGravado | null>(null);

  useEffect(() => {
    let vivo = true;
    destaquesDaBuild(plano)
      .then((lidos) => vivo && setDestaques(lidos))
      .catch((falha) => vivo && setErro(textoDoErro(falha)));
    return () => {
      vivo = false;
    };
  }, [plano]);

  // A lista de filtros é lida de novo cada vez que o jogador vai escolher (pode ter baixado outro).
  useEffect(() => {
    if (passo !== "escolher") return;
    let vivo = true;
    backend
      .filtrosDoJogo()
      .then((lidos) => {
        if (!vivo) return;
        setFiltros(lidos);
        setBase((atual) =>
          atual !== SEM_BASE && lidos.filtros.some((f) => f.arquivo === atual)
            ? atual
            : (lidos.base_sugerida ?? lidos.filtros[0]?.arquivo ?? SEM_BASE),
        );
      })
      .catch((falha) => vivo && setErro(textoDoErro(falha)));
    return () => {
      vivo = false;
    };
  }, [passo]);

  async function criar() {
    if (!destaques) return;
    setOcupado(true);
    setErro(null);
    try {
      const feito = await backend.aplicarFiltro(limparNome(nome), destaques.texto, base === SEM_BASE ? null : base);
      setGravado(feito);
      setPasso("pronto");
      aoCriar?.();
    } catch (falha) {
      setErro(textoDoErro(falha));
    } finally {
      setOcupado(false);
    }
  }

  if (passo === "fechado") {
    return (
      <div className="filtro-da-build">
        <div className="linha-de-botoes">
          <span className="fraco">Filtro de itens: destacar no chão o que a build usa.</span>
          <button disabled={!destaques} onClick={() => setPasso("escolher")}>
            Criar filtro…
          </button>
        </div>
      </div>
    );
  }

  if (passo === "perguntar") {
    const responder = (proximo: Passo) => {
      aoResponder();
      setPasso(proximo);
    };
    return (
      <div className="filtro-da-build passo-a-passo">
        <div className="numero-do-passo">Passo 2 de 2 · Filtro de itens</div>
        {destaques === null ? (
          <div className="fraco">Olhando os itens da build…</div>
        ) : !temOQueDestacar(destaques) ? (
          <>
            <div>Não achei na build itens que dê pra destacar no chão.</div>
            <div className="linha-de-botoes">
              <button
                className="principal"
                onClick={() => {
                  aoResponder();
                  aoTerminar();
                }}
              >
                Ok, vamos jogar
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              Dá pra fazer os itens da build brilharem no chão: borda roxa e ícone no minimapa, só na campanha. Achei{" "}
              <strong>{resumoDoFiltro(destaques)}</strong>.
            </div>
            <div>Quer que eu crie um filtro de itens com eles?</div>
            <div className="linha-de-botoes">
              <button className="principal" onClick={() => responder("escolher")}>
                Sim, criar o filtro
              </button>
              <button onClick={() => responder("fechado")}>Agora não</button>
            </div>
          </>
        )}
        {erro && <div className="erro">{erro}</div>}
      </div>
    );
  }

  if (passo === "pronto" && gravado) {
    const online = base.startsWith("OnlineFilters/");
    return (
      <div className="filtro-da-build passo-a-passo pronto">
        <div className="numero-do-passo">Filtro criado ✓</div>
        <div>
          {gravado.trocou ? "Atualizei" : "Criei"} o filtro <strong className="selecionavel">{gravado.nome}</strong>
          {gravado.base ? (
            <>
              {" "}
              em cima do <strong>{gravado.base}</strong> (que continua igual)
            </>
          ) : null}
          . Destaca {destaques ? resumoDoFiltro(destaques) : "os itens da build"}.
        </div>
        {gravado.ja_escolhido ? (
          <div>
            O jogo já está com ele. Pra valer agora: <strong>Esc › Options › Game › Item Filter</strong> e clique no botão de
            recarregar ao lado do nome.
          </div>
        ) : (
          <div>
            Agora troque no jogo: <strong>Esc › Options › Game › Item Filter</strong> e escolha{" "}
            <strong>"{gravado.nome}"</strong>.
          </div>
        )}
        {online && (
          <div className="fraco">
            O filtro novo é uma cópia: quando o seu filtro online mudar no site, crie de novo aqui.
          </div>
        )}
        <div className="fraco selecionavel">
          {gravado.pasta}\{gravado.arquivo}
        </div>
        <div className="linha-de-botoes">
          <button className="principal" onClick={aoTerminar}>
            Ok, vou trocar no jogo
          </button>
          <button onClick={() => setPasso("escolher")}>Criar de novo</button>
        </div>
      </div>
    );
  }

  // Escolher em qual filtro pôr os destaques e o nome do novo.
  const limpo = limparNome(nome);
  const semPasta = filtros !== null && !filtros.existe;
  const doGuia = filtros?.do_guia.some((arquivo) => arquivo.toLowerCase() === `${limpo}.filter`.toLowerCase()) ?? false;
  return (
    <div className="filtro-da-build passo-a-passo">
      <div className="numero-do-passo">Filtro de itens</div>
      <div>
        Em qual dos seus filtros eu ponho os destaques? Ele não muda: eu crio um filtro novo, com os destaques da build em
        cima e o seu filtro inteiro embaixo.
      </div>
      {filtros === null ? (
        <div className="fraco">Procurando os seus filtros…</div>
      ) : semPasta ? (
        <div className="erro">Não achei a pasta do jogo ({filtros.pasta}). Abra o jogo uma vez e volte aqui.</div>
      ) : (
        <div className="lista-de-filtros" role="radiogroup" aria-label="Filtro base">
          {filtros.filtros.map((f) => (
            <label key={f.arquivo} className={`opcao-de-filtro${base === f.arquivo ? " escolhida" : ""}`}>
              <input
                type="radio"
                name="filtro-base"
                checked={base === f.arquivo}
                disabled={ocupado}
                onChange={() => setBase(f.arquivo)}
              />
              <span>
                {f.nome}
                {f.arquivo === filtros.base_sugerida && (
                  <span className="fraco">{f.arquivo === filtros.escolhido ? " · o que está no jogo" : " · sugerido"}</span>
                )}
              </span>
            </label>
          ))}
          <label className={`opcao-de-filtro${base === SEM_BASE ? " escolhida" : ""}`}>
            <input
              type="radio"
              name="filtro-base"
              checked={base === SEM_BASE}
              disabled={ocupado}
              onChange={() => setBase(SEM_BASE)}
            />
            <span>
              Nenhum <span className="fraco">· só os destaques; o resto do chão aparece sem filtro</span>
            </span>
          </label>
          {filtros.filtros.length === 0 && (
            <div className="fraco">Não achei filtros seus na pasta do jogo nem filtros online.</div>
          )}
        </div>
      )}
      <div className="campo">
        <label className="rotulo" htmlFor="nome-do-filtro">
          Nome do filtro novo
        </label>
        <input
          id="nome-do-filtro"
          className="nome-do-filtro"
          type="text"
          value={nome}
          maxLength={LIMITE_DO_NOME + 10}
          spellCheck={false}
          disabled={ocupado}
          onChange={(e) => setNome(e.target.value)}
        />
      </div>
      {limpo !== "" && (
        <div className="fraco">
          No jogo vai aparecer como "{limpo}".{doGuia ? " Já existe um com esse nome que eu criei antes: troco pelo novo." : ""}
        </div>
      )}
      <div className="linha-de-botoes">
        <button
          className="principal"
          disabled={ocupado || !destaques || filtros === null || semPasta || limpo === ""}
          onClick={() => void criar()}
        >
          {ocupado ? "Criando…" : "Criar o filtro"}
        </button>
        <button disabled={ocupado} onClick={() => setPasso("fechado")}>
          Cancelar
        </button>
      </div>
      {erro && <div className="erro">{erro}</div>}
    </div>
  );
}
