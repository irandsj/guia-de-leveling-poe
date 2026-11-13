// Complemento da 3.30 aos dados do exile-leveling (cópia de 02/08/2026, ainda sem a liga).
//
// A cópia em `src/terceiros/exile-leveling/` não é editada; este arquivo acrescenta, ao carregar,
// o que as patch notes oficiais da 3.30 trouxeram de gema nova
// (https://www.pathofexile.com/forum/view-thread/4013680).
// Quando o exile-leveling publicar os dados da 3.30, copiar de novo e apagar daqui o que já vier
// lá (o `acrescentar` não escreve por cima de nada que já exista).
//
// - Arcane Link (Inteligência), texto oficial: "offered to the Scion for completing Breaking the
//   Seal, and can be purchased from Petarus and Vanja by the Marauder, Duelist and Templar".
//   SUPOSIÇÕES (as notas não dizem): o id segue o padrão das outras Links
//   (`SkillGemArcaneLink`); o nível exigido é 34, igual a todas as Links; o Scion também compra
//   (ele compra todas as Links da Petarus e Vanja); a Lilly Roth vende no ato 6, como as outras.
//   Se o id do PoB vier diferente, o `pob.ts` acha a gema pelo nome.
//   Ícone: `public/gemas/SkillGemArcaneLink.webp`, feito do PNG oficial da GGG (ver
//   `scripts/baixar-icones.mjs`).
// - Fireball of Radiation: é transfigurada da Fireball. O PoB grava transfigurada com o id da
//   gema base (mais um `variantId`), então ela já cai na Fireball: compra-se a Fireball e
//   transfigura no Divine Font do Labirinto. Não precisa entrada nova.

import { Data } from "../terceiros/exile-leveling/src/data";
import type { GameData } from "../terceiros/exile-leveling/src/types";

export const ARCANE_LINK = "Metadata/Items/Gems/SkillGemArcaneLink";

const GEMAS_NOVAS: GameData.Gem[] = [
  {
    id: ARCANE_LINK,
    name: "Arcane Link",
    primary_attribute: "intelligence",
    required_level: 34,
    is_support: false,
  },
];

/** Recompensas novas: quest → oferta → gema. */
const RECOMPENSAS_NOVAS: { quest: string; oferta: string; gema: string; quest_classes?: string[]; vendedor?: GameData.VendorReward }[] = [
  {
    quest: "a4q2",
    oferta: "a4q2",
    gema: ARCANE_LINK,
    quest_classes: ["Scion"],
    vendedor: { classes: ["Scion", "Marauder", "Duelist", "Templar"], npc: "Petarus and Vanja" },
  },
  { quest: "a6q4", oferta: "a6q4", gema: ARCANE_LINK, vendedor: { classes: [], npc: "Lilly Roth" } },
];

function acrescentar(): void {
  for (const gema of GEMAS_NOVAS) if (!Data.Gems[gema.id]) Data.Gems[gema.id] = gema;
  for (const r of RECOMPENSAS_NOVAS) {
    const oferta = Data.Quests[r.quest]?.reward_offers[r.oferta];
    if (!oferta) continue;
    if (r.quest_classes && !oferta.quest[r.gema]) oferta.quest[r.gema] = { classes: r.quest_classes };
    if (r.vendedor && !oferta.vendor[r.gema]) oferta.vendor[r.gema] = r.vendedor;
  }
}

acrescentar();
