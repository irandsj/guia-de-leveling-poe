// Qual foto é de cada item do PoB. O único vai pelo nome; o resto, pela base (o raro tem a base
// numa linha própria; o mágico tem a base no meio do nome, entre o prefixo e o sufixo).
// A tabela sai de scripts/gerar-artes-itens.mjs.

export interface TabelaDeArtes {
  /** Nome da base ("Leather Cap") → arte ("Armours/Helmets/HelmetDex1"). */
  bases: Record<string, string>;
  /** Nome do único ("Goldrim") → arte. */
  unicos: Record<string, string>;
}

export interface ItemComArte {
  nome: string;
  base: string | null;
  /** "NORMAL", "MAGIC", "RARE" ou "UNIQUE", como o PoB escreve. */
  raridade: string;
}

/** O PoB escreve "Superior Leather Cap" e "Synthesised Iron Ring": a base é o resto. */
const RE_ENFEITE = /^(?:Superior|Synthesised)\s+/i;

const porTabela = new WeakMap<TabelaDeArtes, { basesDoMaior: string[]; achadas: Map<string, string | null> }>();

function memoria(tabela: TabelaDeArtes) {
  let m = porTabela.get(tabela);
  if (!m) {
    const basesDoMaior = Object.keys(tabela.bases).sort((a, b) => b.length - a.length);
    m = { basesDoMaior, achadas: new Map() };
    porTabela.set(tabela, m);
  }
  return m;
}

/** `trecho` aparece inteiro dentro de `texto`, como palavras ("Ring" não casa com "Ringmail"). */
function temAsPalavras(texto: string, trecho: string): boolean {
  for (let i = texto.indexOf(trecho); i >= 0; i = texto.indexOf(trecho, i + 1)) {
    const fim = i + trecho.length;
    if ((i === 0 || texto[i - 1] === " ") && (fim === texto.length || texto[fim] === " ")) return true;
  }
  return false;
}

/** O nome da base do item como a tabela conhece ("Leather Cap"), ou `null`. */
export function baseConhecida(tabela: TabelaDeArtes, item: ItemComArte): string | null {
  const base = item.base?.trim().replace(RE_ENFEITE, "");
  if (base && tabela.bases[base]) return base;
  const limpo = item.nome.trim().replace(RE_ENFEITE, "");
  if (tabela.bases[limpo]) return limpo;
  // O nome do raro e do único não tem a base dentro: sem a linha da base, não dá pra saber.
  if (item.raridade === "RARE" || item.raridade === "UNIQUE") return null;
  // Mágico: "Seething Divine Life Flask of Staunching". A maior base que cabe inteira no nome
  // ("Divine Life Flask", não "Life Flask").
  for (const candidata of memoria(tabela).basesDoMaior) {
    if (candidata.length <= limpo.length && temAsPalavras(limpo, candidata)) return candidata;
  }
  return null;
}

function procurar(tabela: TabelaDeArtes, item: ItemComArte): string | null {
  const nome = item.nome.trim();
  if (item.raridade === "UNIQUE" && tabela.unicos[nome]) return tabela.unicos[nome];
  const base = baseConhecida(tabela, item);
  return base ? tabela.bases[base] : null;
}

/** A arte do item ("Armours/Helmets/HelmetDex1"), ou `null` se a tabela não conhece. */
export function arteDoItem(tabela: TabelaDeArtes, item: ItemComArte): string | null {
  const { achadas } = memoria(tabela);
  const chave = `${item.raridade}|${item.nome}|${item.base ?? ""}`;
  let arte = achadas.get(chave);
  if (arte === undefined) {
    arte = procurar(tabela, item);
    achadas.set(chave, arte);
  }
  return arte;
}
