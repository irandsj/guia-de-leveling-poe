// O balão do guia fora do modo de edição: quatro formas (expandido, detalhado, resumido e bolinha)
// e o arrastar. Fora da edição a janela só aceita clique com o Alt segurado (ver alt.rs), então
// tudo aqui é "segure Alt e clique/arraste".

import { useEffect, type MouseEvent as EventoDoMouse, type RefObject } from "react";

import { FORMAS, type Forma } from "../nucleo/preferencias";

/** Quanto o mouse precisa andar, segurado, pra virar arrastar (e não clique). */
const PIXELS_PRA_ARRASTAR = 4;

/** Abaixo disso a janela ainda está na largura da bolinha (o balão tem no mínimo 260). */
const LARGURA_DE_MEDIR = 160;

/**
 * Segurar e mover arrasta a janela; soltar sem mover é um clique (`aoClicar`).
 * Sem `aoClicar`, apertar num botão de dentro não arrasta (o botão cuida do clique).
 */
export function segurarPraArrastar(arrastar: () => void, aoClicar?: () => void) {
  return (e: EventoDoMouse) => {
    if (e.button !== 0) return;
    if (!aoClicar && (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const x0 = e.screenX;
    const y0 = e.screenY;
    const parar = () => {
      window.removeEventListener("mousemove", mover);
      window.removeEventListener("mouseup", soltar);
    };
    const mover = (m: MouseEvent) => {
      if (Math.abs(m.screenX - x0) + Math.abs(m.screenY - y0) < PIXELS_PRA_ARRASTAR) return;
      parar();
      arrastar();
    };
    const soltar = () => {
      parar();
      aoClicar?.();
    };
    window.addEventListener("mousemove", mover);
    window.addEventListener("mouseup", soltar);
  };
}

const NOMES: Record<Forma, string> = {
  expandido: "Expandir: fotos dos itens e links em soquetes",
  detalhado: "Guia normal",
  resumido: "Resumir",
  bolinha: "Virar bolinha",
};

/**
 * Os botões do canto: "+" sobe uma forma (resumido → detalhado → expandido), "−" desce uma
 * (sem virar bolinha), "•" vira bolinha e a engrenagem abre as opções (o modo de edição, onde
 * também se arruma o lugar e o tamanho do guia). A linha onde eles ficam também arrasta o balão.
 */
export function BotoesDaForma({
  forma,
  aoMudar,
  aoConfigurar,
}: {
  forma: Forma;
  aoMudar: (forma: Forma) => void;
  aoConfigurar?: () => void;
}) {
  const i = FORMAS.indexOf(forma);
  const maior = i > 0 ? FORMAS[i - 1] : null;
  const menor = i >= 0 && FORMAS[i + 1] && FORMAS[i + 1] !== "bolinha" ? FORMAS[i + 1] : null;
  const botoes: [Forma, string][] = [];
  if (menor) botoes.push([menor, "−"]);
  if (maior) botoes.push([maior, "+"]);
  if (forma !== "bolinha") botoes.push(["bolinha", "•"]);
  return (
    <span className="botoes-da-forma">
      <span className="pegador" title="Segure Alt e arraste pra mudar o guia de lugar" aria-hidden>
        ⠿
      </span>
      {botoes.map(([f, simbolo]) => (
        <button key={f} title={`${NOMES[f]} (segure Alt e clique)`} aria-label={NOMES[f]} onClick={() => aoMudar(f)}>
          {simbolo}
        </button>
      ))}
      {aoConfigurar && (
        <button
          className="engrenagem"
          title="Opções: importar a build, mudar o guia de lugar e de tamanho (segure Alt e clique)"
          aria-label="Opções"
          onClick={aoConfigurar}
        >
          ⚙
        </button>
      )}
    </span>
  );
}

/**
 * O guia minimizado: só uma bolinha. Segure Alt e clique pra abrir, ou arraste pra mudar de lugar.
 */
export function Bolinha(props: {
  ato: number | null;
  numero: string | null;
  aoAbrir: () => void;
  arrastar: () => void;
}) {
  return (
    <div className="bolinha-janela">
      <button
        className="bolinha"
        title="Abrir o guia (segure Alt e clique; segure Alt e arraste pra mudar de lugar)"
        aria-label="Abrir o guia"
        onMouseDown={segurarPraArrastar(props.arrastar, props.aoAbrir)}
      >
        {props.ato === null ? (
          <span className="bolinha-ato">G</span>
        ) : (
          <>
            <span className="bolinha-ato">A{props.ato}</span>
            {props.numero && <span className="bolinha-passo">{props.numero}</span>}
          </>
        )}
      </button>
    </div>
  );
}

/**
 * Avisa o programa da forma do balão, pra janela ficar do tamanho dele (assim o resto da tela
 * não fica coberto). No resumido e no expandido, mede a altura do conteúdo sempre que ela muda
 * (a largura é sempre a do detalhado: os dois só crescem pra baixo).
 * Na edição o programa usa o tamanho detalhado sozinho.
 */
export function usarFormaDaJanela(
  forma: Forma,
  edicao: boolean,
  ativo: boolean,
  painel: RefObject<HTMLDivElement | null>,
  definir: (forma: Forma, altura?: number) => Promise<void>,
) {
  useEffect(() => {
    if (!ativo || edicao) return;
    if (forma === "bolinha") {
      void definir(forma).catch(() => undefined);
      return;
    }
    if (forma !== "resumido" && forma !== "expandido") {
      void definir(forma).catch(() => undefined);
      return;
    }
    const el = painel.current;
    if (!el) return;
    let ultima = 0;
    let pediuALargura = false;
    const medir = () => {
      // Voltando da bolinha, a janela ainda tem a largura dela: medido assim, o texto quebra em
      // mil linhas e a altura sai gigante (e a janela pulava pro topo da tela). Primeiro pede a
      // largura do balão; o observador mede de novo quando ela chegar.
      if (window.innerWidth < LARGURA_DE_MEDIR) {
        if (!pediuALargura) {
          pediuALargura = true;
          void definir(forma).catch(() => undefined);
        }
        return;
      }
      const altura = Math.ceil(el.getBoundingClientRect().height);
      if (altura <= 0 || altura === ultima) return;
      ultima = altura;
      void definir(forma, altura).catch(() => undefined);
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, [forma, edicao, ativo, painel, definir]);
}
