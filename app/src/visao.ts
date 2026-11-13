// Ponte da leitura de tela: abre o ícone de cada gema procurada e manda os pontos dele ao programa.
// (Quem decide quais gemas procurar é `nucleo/alvos`. Quem olha a tela é o lado Rust, `visao.rs`.)

import { backend, type AlvoDaTela, type GemaDaBuildParaTela } from "./backend";
import { enderecoDoIcone, type AlvoDeGema } from "./nucleo/alvos";

/** Lado dos ícones de gema, em pontos. */
const LADO = 78;

const guardados = new Map<string, number[] | null>();

function pontosDoIcone(endereco: string): Promise<number[] | null> {
  const ja = guardados.get(endereco);
  if (ja !== undefined) return Promise.resolve(ja);
  return new Promise((resolver) => {
    const imagem = new Image();
    const terminar = (pontos: number[] | null) => {
      guardados.set(endereco, pontos);
      resolver(pontos);
    };
    imagem.onerror = () => terminar(null);
    imagem.onload = () => {
      const tela = document.createElement("canvas");
      tela.width = LADO;
      tela.height = LADO;
      const desenho = tela.getContext("2d", { willReadFrequently: true });
      const { naturalWidth: largura, naturalHeight: altura } = imagem;
      // Ícone de outro tamanho (76, 80, 78x77…) é ampliado ou reduzido pra 78; só não serve se não for quase quadrado.
      if (!desenho || !largura || !altura || Math.abs(largura - altura) > 0.05 * Math.max(largura, altura)) {
        return terminar(null);
      }
      desenho.drawImage(imagem, 0, 0, LADO, LADO);
      terminar(Array.from(desenho.getImageData(0, 0, LADO, LADO).data));
    };
    imagem.src = endereco;
  });
}

let pedido = 0;

/** Diz ao programa quais gemas procurar na tela do jogo. Lista vazia desliga a leitura de tela. */
export async function mandarAlvos(alvos: AlvoDeGema[]): Promise<void> {
  const meu = ++pedido;
  const prontos: AlvoDaTela[] = [];
  for (const alvo of alvos) {
    const rgba = await pontosDoIcone(alvo.icone);
    if (rgba) prontos.push({ id: alvo.gem_id, tipo: alvo.tipo, lado: LADO, rgba });
  }
  // Chegou um pedido mais novo enquanto os ícones abriam: este não vale mais.
  if (meu !== pedido) return;
  await backend.definirAlvos(prontos);
}

let pedidoDaBuild = 0;

/** No máximo quantas gemas da build vão ao programa (o mesmo limite do lado Rust). */
const MAXIMO_DE_GEMAS_DA_BUILD = 80;

/**
 * Diz ao programa todas as gemas da rota: com o inventário aberto na cidade, ele confere a grade com
 * elas e avisa das que estão lá.
 */
export async function mandarGemasDaBuild(gemIds: string[]): Promise<void> {
  const meu = ++pedidoDaBuild;
  const prontas: GemaDaBuildParaTela[] = [];
  for (const id of gemIds.slice(0, MAXIMO_DE_GEMAS_DA_BUILD)) {
    const rgba = await pontosDoIcone(enderecoDoIcone(id));
    if (rgba) prontas.push({ id, lado: LADO, rgba });
  }
  if (meu !== pedidoDaBuild) return;
  await backend.definirGemasDaBuild(prontas);
}
