// Os botões de busca da loja: uma janelinha à parte que o programa põe logo abaixo do campo de
// busca ("Type keywords here...") do Baú ou da janela de compra do vendedor, só enquanto o guia vê
// um deles aberto. Segure Alt e clique pra pôr a busca (o "regex") direto nesse campo.
//
// As buscas vêm do balão (que sabe a build e o conjunto de gemas de agora), passando pelo Rust.

import { useEffect, useRef, useState } from "react";

import { backend } from "../backend";
import type { Busca } from "../nucleo/busca";

/** O que aconteceu com o último clique, pra mostrar por uns segundos. */
interface AvisoDaBusca {
  texto: string;
  erro: boolean;
}

const COMO = "segure Alt e clique pra pôr no campo de busca";

function textoDoErro(erro: unknown): string {
  return typeof erro === "string" ? erro : erro instanceof Error ? erro.message : String(erro);
}

/** A janelinha inteira: os botões numa linha, o texto de cada busca na dica do botão. */
export function JanelaDaBusca() {
  const [buscas, setBuscas] = useState<Busca[]>([]);
  const [altSegurado, setAltSegurado] = useState(false);
  const [aviso, setAviso] = useState<AvisoDaBusca | null>(null);
  const tempoDoAviso = useRef<number | undefined>(undefined);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    let parar: (() => void) | undefined;
    void backend
      .ouvir({ buscas: setBuscas, estado: (estado) => setAltSegurado(estado.alt_segurado) })
      .then((pararDeOuvir) => {
        if (vivo) parar = pararDeOuvir;
        else pararDeOuvir();
      });
    void backend
      .lerBuscas()
      .then((lidas) => vivo && setBuscas(lidas))
      .catch(() => undefined);
    return () => {
      vivo = false;
      parar?.();
    };
  }, []);

  // A janela fica do tamanho dos botões (e do aviso, quando tem).
  useEffect(() => {
    const elemento = raiz.current;
    if (!elemento) return;
    let ultimo = "";
    const medir = () => {
      const { width, height } = elemento.getBoundingClientRect();
      const tamanho = `${Math.ceil(width)}x${Math.ceil(height)}`;
      if (tamanho === ultimo || width < 1) return;
      ultimo = tamanho;
      void backend.medirBusca(Math.ceil(width), Math.ceil(height)).catch(() => undefined);
    };
    const observador = new ResizeObserver(medir);
    observador.observe(elemento);
    medir();
    return () => observador.disconnect();
  }, []);

  async function buscar(busca: Busca) {
    const avisarPorUmTempo = (novo: AvisoDaBusca, ms: number) => {
      window.clearTimeout(tempoDoAviso.current);
      setAviso(novo);
      tempoDoAviso.current = window.setTimeout(() => setAviso(null), ms);
    };
    avisarPorUmTempo({ texto: "Solte o Alt…", erro: false }, 5000);
    try {
      await backend.aplicarBusca(busca.texto);
      avisarPorUmTempo({ texto: "Posta no jogo.", erro: false }, 3000);
    } catch (erro) {
      avisarPorUmTempo({ texto: textoDoErro(erro), erro: true }, 6000);
    }
  }

  return (
    <div ref={raiz} className={altSegurado ? "janela-da-busca alt" : "janela-da-busca"}>
      {buscas.map((busca) => (
        <button
          key={busca.chave}
          className="botao-de-busca"
          title={`${busca.dica} (${COMO}):\n${busca.texto}`}
          aria-label={`Pôr a busca ${busca.rotulo} no jogo`}
          onClick={() => void buscar(busca)}
        >
          ⌕ {busca.rotulo}
        </button>
      ))}
      {aviso && <span className={aviso.erro ? "aviso-da-busca erro" : "aviso-da-busca"}>{aviso.texto}</span>}
    </div>
  );
}
