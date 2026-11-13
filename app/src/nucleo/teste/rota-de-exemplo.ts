// Só pros testes: o plano e a rota do PoB de exemplo, montados uma vez.

import { gemasNecessarias, montarPlano, type Plano } from "../plano";
import { lerPob } from "../pob";
import { montarRota, type Passo, type Rota } from "../rota";
import { POR_NIVEL, xmlDeExemplo, type PobDeExemplo } from "./pob-de-exemplo";

export function planoDeExemplo(pob: PobDeExemplo = POR_NIVEL): Plano {
  const origem = { url: null, id: null, site: "teste", hash_codigo: "sha256:teste" };
  return montarPlano(lerPob(xmlDeExemplo(pob)), origem, new Date("2026-11-10T12:00:00Z"));
}

/** O plano do Marauder de exemplo (conjuntos por nível). */
export const PLANO: Plano = planoDeExemplo();

/** A rota desse plano, com as opções padrão. */
export const ROTA: Rota = montarRota({ classe: "Marauder", bandido: "None" }, gemasNecessarias(PLANO));

/** O texto corrido de um passo, sem as cores. */
export function textoDoPasso(passo: Passo): string {
  return passo.pedacos.map((p) => p.v).join("");
}
