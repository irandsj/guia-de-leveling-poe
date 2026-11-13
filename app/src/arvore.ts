// Ponte do guia da árvore de passivas: carrega os dados da árvore, monta o guia da build e manda ao programa
// as posições dos nós (uma vez por versão) e a ordem a seguir. Também prepara o que o painel mostra.
// (Quem decide a ordem é `nucleo/arvore`. Quem olha a tela e desenha por cima do jogo é o lado Rust, `arvore/`.)

import { useEffect, useRef, useState } from "react";

import type { Backend } from "./backend";
import { lerArvore, type ArvoreDoJogo } from "./nucleo/arvore/dados";
import { chaveDoGuia, montarGuia, paraOSistema, type GuiaDaArvore } from "./nucleo/arvore/guia";
import type { GuiaDoPainel } from "./nucleo/arvore/vista";
import { arvoreAlvo, type Situacao } from "./nucleo/conjuntos";
import type { Plano } from "./nucleo/plano";

// A conta do que o painel mostra é pura e mora no núcleo; daqui só sai de novo pra tela.
export { avisosDeSempre } from "./nucleo/arvore/guia";
export { NOS_A_VISTA, vistaDaArvore } from "./nucleo/arvore/vista";
export type { GuiaDoPainel, LinhaDeNo, VistaDaArvore } from "./nucleo/arvore/vista";

/**
 * Lê o arquivo de dados da árvore. Devolve `null` se não der.
 * (A CSP barra `fetch` de arquivo próprio, por isso é `import`. Quem chama usa a árvore já analisada e
 * solta: ela não fica guardada em estado nem em variável de módulo. O texto cru do arquivo fica: módulo
 * carregado não é solto, então uns 0,2 a 0,4 MB ficam no cache de módulos até o app fechar, e cada troca
 * de build ou de etapa analisa esse texto de novo.)
 */
export async function carregarArvore(): Promise<ArvoreDoJogo | null> {
  try {
    const modulo = await import("./dados/arvore/arvore.json?raw");
    return lerArvore(JSON.parse(modulo.default) as unknown);
  } catch (erro) {
    console.error("Árvore de passivas: não consegui ler os dados.", erro);
    return null;
  }
}

// O que já foi mandado ao programa, pra não mandar de novo o que não mudou.
let versaoEnviada: string | null = null;
let chaveEnviada: string | null = null;
let pedido = 0;
let fila: Promise<void> = Promise.resolve();

/**
 * Manda ao programa a árvore (se a versão ainda não foi) e o guia (se mudou). `null` desliga o desenho.
 * Os envios saem um de cada vez, na ordem; se chegar um pedido mais novo antes, o antigo é pulado.
 */
function enviar(backend: Backend, arvore: ArvoreDoJogo | null, guia: GuiaDaArvore | null): Promise<void> {
  const meu = ++pedido;
  fila = fila.then(async () => {
    if (meu !== pedido) return;
    try {
      if (guia !== null && arvore !== null && versaoEnviada !== arvore.versao) {
        await backend.definirArvore(paraOSistema(arvore));
        versaoEnviada = arvore.versao;
      }
      const chave = chaveDoGuia(guia);
      if (chave === chaveEnviada) return;
      await backend.definirGuiaDaArvore(guia);
      chaveEnviada = chave;
    } catch (erro) {
      console.error("Árvore de passivas:", erro);
    }
  });
  return fila;
}

/**
 * Monta o guia da árvore quando a build, a etapa alvo ou a preferência mudam, manda ao programa e devolve
 * o que o painel mostra. Sem build, com a preferência desligada ou se algo falhar, devolve `null`
 * (e o painel fica como era antes de existir o guia).
 */
export function usarGuiaDaArvore(
  plano: Plano | null,
  situacao: Situacao | null,
  ligado: boolean,
  backend: Backend,
  /** Etapas já completadas antes do nível delas (ver `arvoreAlvo`). */
  minimo = 0,
  /** Etapa que o jogador escolheu na mão (setas ou lista do balão). */
  escolhida: number | null = null,
): GuiaDoPainel | null {
  const [montado, setMontado] = useState<{ chave: string; painel: GuiaDoPainel | null }>({ chave: "", painel: null });
  const alvo = plano && situacao ? arvoreAlvo(plano, situacao, minimo, escolhida) : null;
  const chave = ligado && plano && alvo ? `${plano.fonte.hash_codigo}|${alvo.id}` : "";

  // O nível e o ato mais novos, pra hora em que os dados da árvore terminarem de carregar.
  const situacaoRef = useRef(situacao);
  useEffect(() => {
    situacaoRef.current = situacao;
  });

  useEffect(() => {
    let vivo = true;
    if (chave === "" || !plano) {
      setMontado({ chave: "", painel: null });
      void enviar(backend, null, null);
      return;
    }
    void (async () => {
      const arvore = await carregarArvore();
      if (!vivo) return;
      const s = situacaoRef.current;
      let guia: GuiaDaArvore | null = null;
      try {
        guia = arvore && s ? montarGuia(plano, s, arvore, minimo, escolhida) : null;
      } catch (erro) {
        console.error("Árvore de passivas: não consegui montar o guia.", erro);
      }
      const nomes = new Map<number, string>();
      if (guia && arvore) {
        for (const id of guia.devolver) {
          const posicao = arvore.indice.get(id);
          if (posicao !== undefined) nomes.set(id, arvore.nos[posicao].nome);
        }
      }
      setMontado({ chave, painel: guia ? { guia, nomes } : null });
      await enviar(backend, arvore, guia);
    })();
    return () => {
      vivo = false;
    };
    // (`minimo` e `escolhida` já entram na `chave`, pelo id da etapa alvo.)
  }, [chave, plano, backend]);

  // Enquanto o guia novo não chega, o antigo não vale pra outra build nem pra outra etapa.
  return montado.chave === chave ? montado.painel : null;
}
