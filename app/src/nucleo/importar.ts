// Importação: o que o jogador colou (link, código ou XML) → plano de leveling.
// A internet entra por `baixar`, que no app é o comando do Rust (só HTTPS, só os sites da
// lista). Cada importação faz um pedido só por endereço, sem repetir e sem insistir.

import {
  interpretarEntrada,
  linksDePobNoMaxroll,
  MAXROLL_DESLIGADO,
  MAXROLL_LIGADO,
  pareceHtml,
  plannersNoMaxroll,
  type Entrada,
} from "./links";
import { montarPlano, type OrigemDoCodigo, type Plano } from "./plano";
import { efeitosDeMaestria, lerPlannerMaxroll, SEM_MAESTRIAS, type EfeitoDeMaestria } from "./planner-maxroll";
import { decodificarCodigo, lerPob } from "./pob";

export type Baixar = (url: string) => Promise<string>;

/**
 * As maestrias do planner do Maxroll saem do arquivo da árvore, carregado só quando a build vem do planner.
 * Sem o arquivo, a build entra sem as maestrias.
 */
async function maestriasDaArvore(): Promise<EfeitoDeMaestria> {
  try {
    const modulo = await import("../dados/arvore/arvore.json?raw");
    return efeitosDeMaestria(JSON.parse(modulo.default) as unknown);
  } catch {
    return SEM_MAESTRIAS;
  }
}

export type ResultadoDaImportacao =
  | { tipo: "plano"; plano: Plano }
  /** A página de guia cita um ou mais PoBs: o jogador escolhe qual importar. */
  | { tipo: "escolher"; pagina: string; opcoes: { id: string; link: string }[] }
  | { tipo: "erro"; mensagem: string };

function mensagemDe(erro: unknown): string {
  if (erro instanceof Error && erro.message) return erro.message;
  if (typeof erro === "string" && erro) return erro;
  return "Erro desconhecido.";
}

function erro(mensagem: string): ResultadoDaImportacao {
  return { tipo: "erro", mensagem };
}

/** Junta a dica de colar o código, a não ser que a mensagem já fale disso. */
function comDica(mensagem: string): string {
  if (/código do PoB/i.test(mensagem)) return mensagem;
  return `${mensagem} Se o link não funcionar, cole o código do PoB.`;
}

/** Resumo do código, pra saber se a build mudou numa nova importação. */
export async function hashDoCodigo(codigo: string): Promise<string> {
  const limpo = codigo.replace(/\s+/g, "");
  try {
    const resumo = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(limpo));
    const hex = Array.from(new Uint8Array(resumo), (b) => b.toString(16).padStart(2, "0")).join("");
    return `sha256:${hex}`;
  } catch {
    // Sem a API de criptografia: um resumo simples (FNV-1a) já serve pra comparar.
    let h = 0x811c9dc5;
    for (let i = 0; i < limpo.length; i++) {
      h ^= limpo.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return `fnv1a:${(h >>> 0).toString(16).padStart(8, "0")}`;
  }
}

const PARECE_CODIGO = /^[A-Za-z0-9+/_=-]{100,}$/;

/** Alguns sites embrulham o código em JSON. Devolve o código que estiver dentro. */
function desembrulhar(resposta: string): string {
  const texto = resposta.trim();
  if (!texto.startsWith("{") && !texto.startsWith('"')) return texto;
  try {
    const valor: unknown = JSON.parse(texto);
    if (typeof valor === "string") return valor.trim();
    if (typeof valor === "object" && valor !== null) {
      for (const dentro of Object.values(valor)) {
        if (typeof dentro === "string" && PARECE_CODIGO.test(dentro.trim())) return dentro.trim();
      }
    }
  } catch {
    // Não era JSON: segue com o texto como veio.
  }
  return texto;
}

async function doCodigo(
  codigo: string,
  origem: Omit<OrigemDoCodigo, "hash_codigo">,
  agora: Date,
): Promise<Plano> {
  const pob = lerPob(decodificarCodigo(codigo));
  return montarPlano(pob, { ...origem, hash_codigo: await hashDoCodigo(codigo) }, agora);
}

/** Guia, planner ou link de PoB do Maxroll (também o `pob://maxroll/…`). */
function ehDoMaxroll(entrada: Entrada): boolean {
  return (
    entrada.tipo === "guia-maxroll" ||
    entrada.tipo === "planner-maxroll" ||
    (entrada.tipo === "link" && entrada.site === "Maxroll")
  );
}

/**
 * Importa o que foi colado. Nunca lança erro: devolve a mensagem pronta pra mostrar.
 * `maxroll` segue a chave `MAXROLL_LIGADO`; os testes ligam pra continuar conferindo o código guardado.
 */
export async function importar(
  colado: string,
  baixar: Baixar,
  agora: Date = new Date(),
  maxroll: boolean = MAXROLL_LIGADO,
): Promise<ResultadoDaImportacao> {
  const entrada = interpretarEntrada(colado);
  // Desligado: recusa antes de qualquer pedido à internet.
  if (!maxroll && ehDoMaxroll(entrada)) return erro(MAXROLL_DESLIGADO);
  try {
    switch (entrada.tipo) {
      case "vazio":
        return erro("Cole o link da build ou o código do PoB.");
      case "desconhecido":
        return erro(entrada.motivo);
      case "xml":
        return {
          tipo: "plano",
          plano: await doCodigo(entrada.xml, { url: null, id: null, site: "XML colado" }, agora),
        };
      case "codigo":
        return {
          tipo: "plano",
          plano: await doCodigo(entrada.codigo, { url: null, id: null, site: "código colado" }, agora),
        };
      case "link": {
        let ultimo = "";
        // O site não entregou nada que preste: vale lembrar que dá pra colar o código.
        let semResposta = true;
        for (const endereco of entrada.enderecos) {
          let resposta: string;
          try {
            resposta = await baixar(endereco);
          } catch (e) {
            ultimo = mensagemDe(e);
            semResposta = true;
            continue;
          }
          if (pareceHtml(resposta)) {
            ultimo = `O ${entrada.site} respondeu com uma página em vez do código (link apagado, errado ou bloqueado).`;
            semResposta = true;
            continue;
          }
          try {
            const origem = { url: entrada.pagina, id: entrada.id, site: entrada.site };
            return { tipo: "plano", plano: await doCodigo(desembrulhar(resposta), origem, agora) };
          } catch (e) {
            // Veio um código, mas ele não abre (PoE 2, cortado...): a mensagem já diz o que é.
            ultimo = mensagemDe(e);
            semResposta = false;
          }
        }
        return erro(semResposta ? comDica(ultimo) : ultimo);
      }
      case "guia-maxroll": {
        const html = await baixar(entrada.endereco);
        const ids = linksDePobNoMaxroll(html);
        if (ids.length > 0) {
          return {
            tipo: "escolher",
            pagina: entrada.endereco,
            opcoes: ids.map((id) => ({ id, link: `https://maxroll.gg/poe/pob/${id}` })),
          };
        }
        // Guia sem PoB (os de leveling por classe, por exemplo): só o planner. Cada opção é uma
        // importação nova, com o seu pedido.
        const planners = plannersNoMaxroll(html);
        if (planners.length > 0) {
          return {
            tipo: "escolher",
            pagina: entrada.endereco,
            opcoes: planners.map((id) => ({ id, link: `https://maxroll.gg/poe/planner/${id}` })),
          };
        }
        return erro(
          "Não achei PoB nem planner nessa página do Maxroll. Abra o guia, clique no botão do Path of Building e cole o link (maxroll.gg/poe/pob/…) ou o código.",
        );
      }
      case "planner-maxroll": {
        const resposta = await baixar(entrada.endereco);
        if (pareceHtml(resposta)) {
          return erro(
            "O Maxroll respondeu com uma página em vez dos dados do planner (link apagado, errado ou bloqueado). Se não funcionar, cole o código do PoB.",
          );
        }
        const lido = lerPlannerMaxroll(resposta, await maestriasDaArvore(), entrada.pagina);
        const origem = { url: entrada.pagina, id: entrada.id, site: "Maxroll (planner)" };
        const plano = montarPlano(lido.pob, { ...origem, hash_codigo: await hashDoCodigo(resposta) }, agora);
        plano.avisos.unshift(...lido.avisos);
        return { tipo: "plano", plano };
      }
    }
  } catch (e) {
    return erro(mensagemDe(e));
  }
}
