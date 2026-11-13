// Entende o que o jogador colou: o XML do PoB, um código do PoB ou o link de um site de builds.
//
// A tabela de endereços "crus" segue a do próprio Path of Building (src/Modules/BuildSiteTools.lua)
// e foi conferida ao vivo no estudo `leveling/conhecimento/fontes-de-build.md`.

export type Entrada =
  | { tipo: "vazio" }
  | { tipo: "xml"; xml: string }
  | { tipo: "codigo"; codigo: string }
  /** Link de um PoB hospedado: baixar o primeiro endereço que responder com um código. */
  | { tipo: "link"; site: string; id: string; enderecos: string[]; pagina: string }
  /** Página de guia do Maxroll: baixar uma vez e listar os PoBs que ela cita. */
  | { tipo: "guia-maxroll"; endereco: string }
  /** Planner do Maxroll: um JSON que pode trazer o código do PoB dentro. */
  | { tipo: "planner-maxroll"; id: string; endereco: string; pagina: string }
  | { tipo: "desconhecido"; motivo: string };

/**
 * Chave do Maxroll. Ficou desligada em 12/11/2026 (os guias de leveling de lá são em texto e a
 * importação não trazia os itens certos) e foi religada no mesmo dia pra testar, depois da correção
 * do "Early Game". Desligada, o link do Maxroll é recusado antes de qualquer pedido.
 */
export const MAXROLL_LIGADO = true;

/** Os sites que o jogador pode colar, pros textos da tela. */
export const SITES_DE_BUILD = MAXROLL_LIGADO ? "pobb.in, poe.ninja, Maxroll, pastebin" : "pobb.in, poe.ninja, pastebin";

export const MAXROLL_DESLIGADO =
  "O Maxroll está desligado por enquanto: os guias de lá são em texto e os itens não vêm certos. Use o link do pobb.in ou do poe.ninja, ou cole o código do Path of Building.";

const ID_SIMPLES = /^[A-Za-z0-9_-]{1,64}$/;
const ID_COM_PASTAS = /^[A-Za-z0-9_-]{1,64}(\/[A-Za-z0-9_-]{1,64}){0,3}$/;

function link(site: string, id: string, enderecos: string[], pagina: string): Entrada {
  return { tipo: "link", site, id, enderecos, pagina };
}

function naoEntendi(motivo: string): Entrada {
  return { tipo: "desconhecido", motivo };
}

/** Monta o link a partir do site e do id. Também serve pro protocolo `pob://site/id`. */
function porSite(site: string, id: string): Entrada | null {
  switch (site) {
    case "maxroll":
      if (!ID_SIMPLES.test(id)) return null;
      return link(
        "Maxroll",
        id,
        [`https://maxroll.gg/poe/api/pob/${id}`],
        `https://maxroll.gg/poe/pob/${id}`,
      );
    case "pobbin":
      if (!ID_COM_PASTAS.test(id)) return null;
      return link(
        "pobb.in",
        id,
        [`https://pobb.in/pob/${id}`, `https://pobb.in/${id}/raw`],
        `https://pobb.in/${id}`,
      );
    case "poeninja":
      if (!ID_SIMPLES.test(id)) return null;
      return link(
        "poe.ninja",
        id,
        [`https://poe.ninja/poe1/pob/raw/${id}`],
        `https://poe.ninja/poe1/pob/${id}`,
      );
    case "pastebin":
      if (!ID_SIMPLES.test(id)) return null;
      return link(
        "Pastebin",
        id,
        [`https://pastebin.com/raw/${id}`],
        `https://pastebin.com/${id}`,
      );
    case "pastebinproxy":
      if (!ID_SIMPLES.test(id)) return null;
      return link(
        "PastebinP",
        id,
        [`https://pastebinp.com/raw/${id}`],
        `https://pastebinp.com/${id}`,
      );
    case "rentry":
      if (!ID_SIMPLES.test(id)) return null;
      return link(
        "Rentry",
        id,
        [`https://rentry.co/paste/${id}/raw`],
        `https://rentry.co/${id}`,
      );
    case "poedb":
      if (!ID_SIMPLES.test(id)) return null;
      return link(
        "poedb",
        id,
        [`https://poedb.tw/pob/${id}/raw`],
        `https://poedb.tw/pob/${id}`,
      );
    case "pobcodes":
      if (!ID_SIMPLES.test(id)) return null;
      return link(
        "pob.codes",
        id,
        [`https://api.pob.codes/${id}/raw`],
        `https://pob.codes/b/${id}`,
      );
    default:
      return null;
  }
}

/** Planner do Maxroll: os dados vêm de planners.maxroll.gg, num pedido só. */
function plannerDoMaxroll(id: string): Entrada {
  return {
    tipo: "planner-maxroll",
    id,
    endereco: `https://planners.maxroll.gg/profiles/load/poe/${id}`,
    pagina: `https://maxroll.gg/poe/planner/${id}`,
  };
}

/** Tira o `/raw` e as barras sobrando do caminho. Devolve as partes. */
function partes(caminho: string): string[] {
  return caminho.split("/").filter((p) => p.length > 0);
}

function deUrl(url: URL, profundidade: number): Entrada {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const p = partes(url.pathname);

  // Links do YouTube vêm embrulhados: youtube.com/redirect?q=<link de verdade>.
  if ((host === "youtube.com" || host === "m.youtube.com") && p[0] === "redirect") {
    const dentro = url.searchParams.get("q");
    if (dentro && profundidade < 2) return interpretarEntrada(dentro, profundidade + 1);
    return naoEntendi("O link do YouTube não trazia o endereço do PoB.");
  }

  let achado: Entrada | null = null;
  switch (host) {
    case "maxroll.gg": {
      if (p[0] !== "poe") return naoEntendi("Esse link do Maxroll não é de Path of Exile 1.");
      if (p[1] === "pob" && p[2]) achado = porSite("maxroll", p[2]);
      else if (p[1] === "api" && p[2] === "pob" && p[3]) achado = porSite("maxroll", p[3]);
      else if ((p[1] === "planner" || p[1] === "poe-planner") && p[2] && ID_SIMPLES.test(p[2])) {
        return plannerDoMaxroll(p[2]);
      } else if (p.length >= 2 && p.every((x) => /^[A-Za-z0-9_-]{1,120}$/.test(x))) {
        return { tipo: "guia-maxroll", endereco: `https://maxroll.gg/${p.join("/")}` };
      }
      break;
    }
    // O link que a página do guia usa nos blocos do planner, e o endereço dos dados colado direto.
    case "backend.maxroll.gg":
      if (p[0] === "poe" && (p[1] === "planner" || p[1] === "poe-planner") && p[2] && ID_SIMPLES.test(p[2])) {
        return plannerDoMaxroll(p[2]);
      }
      break;
    case "planners.maxroll.gg":
      if (p[0] === "profiles" && p[1] === "load" && p[2] === "poe" && p[3] && ID_SIMPLES.test(p[3])) {
        return plannerDoMaxroll(p[3]);
      }
      break;
    case "pobb.in": {
      let q = p;
      if (q[0] === "pob") q = q.slice(1);
      if (q[q.length - 1] === "raw") q = q.slice(0, -1);
      if (q.length > 0) achado = porSite("pobbin", q.join("/"));
      break;
    }
    case "poe.ninja": {
      const i = p.indexOf("pob");
      if (i >= 0) {
        const resto = p.slice(i + 1).filter((x) => x !== "raw");
        if (resto[0]) achado = porSite("poeninja", resto[0]);
      } else {
        return naoEntendi(
          "No poe.ninja, abra o personagem, clique em PoB e cole o link que aparece (poe.ninja/poe1/pob/…) ou o código.",
        );
      }
      break;
    }
    case "pastebin.com":
    case "pastebinp.com": {
      const q = p[0] === "raw" ? p.slice(1) : p;
      if (q[0]) achado = porSite(host === "pastebin.com" ? "pastebin" : "pastebinproxy", q[0]);
      break;
    }
    case "rentry.co": {
      const q = p[0] === "paste" ? p.slice(1) : p;
      if (q[0]) achado = porSite("rentry", q[0]);
      break;
    }
    case "poedb.tw": {
      const i = p.indexOf("pob");
      if (i >= 0 && p[i + 1]) achado = porSite("poedb", p[i + 1]);
      break;
    }
    case "pob.codes":
    case "api.pob.codes": {
      const q = p.filter((x) => x !== "b" && x !== "raw");
      if (q[0]) achado = porSite("pobcodes", q[0]);
      break;
    }
    default:
      return naoEntendi(
        `Não conheço o site "${host}". Aceito pobb.in, poe.ninja, ${MAXROLL_LIGADO ? "Maxroll, " : ""}Pastebin, Rentry, poedb e pob.codes. Ou cole o código do PoB direto.`,
      );
  }
  return achado ?? naoEntendi("O link não tem o identificador do PoB. Confira se copiou inteiro.");
}

const SITES_CONHECIDOS =
  /\b((?:www\.)?(?:pobb\.in|poe\.ninja|maxroll\.gg|pastebin\.com|pastebinp\.com|rentry\.co|poedb\.tw|pob\.codes)\/[^\s<>"']+)/i;

/** Descobre o que é o texto colado. Não acessa a internet. */
export function interpretarEntrada(bruto: string, profundidade = 0): Entrada {
  const aparado = bruto.trim();
  // O XML vem antes de tirar os "<" e ">" que às vezes embrulham um link.
  if (/^(<\?xml|<PathOfBuilding)/i.test(aparado)) return { tipo: "xml", xml: aparado };

  const texto = aparado.replace(/^["'<]+|["'>]+$/g, "");
  if (!texto) return { tipo: "vazio" };

  // Protocolo do próprio PoB: pob://pobbin/<id>, pob://maxroll/<id>...
  const protocolo = /^pob:\/{0,2}([A-Za-z]+)\/([^\s?#]+)/i.exec(texto);
  if (protocolo) {
    const achado = porSite(protocolo[1].toLowerCase(), protocolo[2].replace(/\/+$/, ""));
    return achado ?? naoEntendi(`Não conheço o site "${protocolo[1]}" desse link pob://.`);
  }

  const comEsquema = /https?:\/\/[^\s<>"']+/i.exec(texto);
  const semEsquema = comEsquema ? null : SITES_CONHECIDOS.exec(texto);
  const endereco = comEsquema ? comEsquema[0] : semEsquema ? `https://${semEsquema[1]}` : null;
  if (endereco) {
    let url: URL;
    try {
      url = new URL(endereco.replace(/[).,;]+$/, ""));
    } catch {
      return naoEntendi("O link está incompleto ou com algum caractere estranho.");
    }
    return deUrl(url, profundidade);
  }

  const semEspacos = texto.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/_=-]{40,}$/.test(semEspacos)) return { tipo: "codigo", codigo: semEspacos };

  return naoEntendi(
    `Não reconheci o que foi colado. Cole o link da build (${SITES_DE_BUILD}…) ou o código do PoB.`,
  );
}

/** Link de PoB do Maxroll: inteiro, relativo (`href="/poe/pob/ID"`) ou no JSON da página (`\/`). */
const POB_DO_MAXROLL = /(?:maxroll\.gg|["'(=])\\?\/poe\\?\/pob\\?\/([A-Za-z0-9]{6,12})\b/g;
/** A lista de PoBs que a página do guia traz no JSON: `"pobLinks":[{"name":"","link":"ID"}]`. */
const LISTA_DE_POBS = /"pobLinks"\s*:\s*\[([^\]]*)\]/g;
const ID_NA_LISTA = /"link"\s*:\s*"([A-Za-z0-9]{6,12})"/g;

/** Procura os PoBs citados no HTML de um guia do Maxroll. */
export function linksDePobNoMaxroll(html: string): string[] {
  const achados = new Set<string>();
  for (const m of html.matchAll(POB_DO_MAXROLL)) achados.add(m[1]);
  for (const lista of html.matchAll(LISTA_DE_POBS)) {
    for (const m of lista[1].matchAll(ID_NA_LISTA)) achados.add(m[1]);
  }
  return [...achados];
}

/**
 * Planner do Maxroll citado na página: o bloco embutido (`data-poe-profile="ID"`) ou o link
 * (`maxroll.gg/poe/planner/ID`, `backend.maxroll.gg/poe/poe-planner/ID`), também no JSON da página (`\/`).
 */
const PLANNER_DO_MAXROLL = /(?:maxroll\.gg|["'(=])\\?\/poe\\?\/(?:poe-)?planner\\?\/([A-Za-z0-9]{6,12})\b/g;
const BLOCO_DO_PLANNER = /data-poe-profile\s*=\s*\\?["']([A-Za-z0-9]{6,12})\\?["']/g;

/** Procura os planners citados no HTML de um guia do Maxroll, na ordem em que aparecem. */
export function plannersNoMaxroll(html: string): string[] {
  const achados: { id: string; posicao: number }[] = [];
  for (const re of [BLOCO_DO_PLANNER, PLANNER_DO_MAXROLL]) {
    for (const m of html.matchAll(re)) achados.push({ id: m[1], posicao: m.index ?? 0 });
  }
  achados.sort((a, b) => a.posicao - b.posicao);
  return [...new Set(achados.map((a) => a.id))];
}

/** A resposta de um site é HTML (página de erro, bloqueio) em vez do código do PoB? */
export function pareceHtml(texto: string): boolean {
  const comeco = texto.slice(0, 400).trimStart().toLowerCase();
  return comeco.startsWith("<!doctype") || comeco.startsWith("<html") || comeco.includes("<head");
}
