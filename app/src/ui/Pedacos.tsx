// O texto de um passo, pintado pelo tipo de cada pedaço, e a linha de uma gema.

import { Fragment, useState } from "react";

import { enderecoDoIcone } from "../nucleo/alvos";
import type { GemaDoPasso, Pedaco } from "../nucleo/rota";
import { comoPegar } from "../nucleo/vista";

const SETAS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
const NOME_DA_SETA = [
  "pra cima",
  "pra cima e direita",
  "pra direita",
  "pra baixo e direita",
  "pra baixo",
  "pra baixo e esquerda",
  "pra esquerda",
  "pra cima e esquerda",
];

interface PropsDosPedacos {
  pedacos: Pedaco[];
  /** Nível do personagem, quando o jogo já disse: marca a zona que pede mais nível. */
  nivel?: number | null;
}

export function Pedacos({ pedacos, nivel = null }: PropsDosPedacos) {
  return (
    <>
      {pedacos.map((p, i) => {
        if (p.t === "texto") return <Fragment key={i}>{p.v}</Fragment>;
        if (p.t === "seta") {
          const dir = (((p.dir ?? 0) % 8) + 8) % 8;
          return (
            <span key={i} className="p-seta" role="img" aria-label={NOME_DA_SETA[dir]}>
              {SETAS[dir]}
            </span>
          );
        }
        const baixo = p.t === "zona" && nivel !== null && p.nivel !== undefined && nivel < p.nivel;
        return (
          <Fragment key={i}>
            <span className={p.t === "zona" && p.cidade ? "p-zona p-cidade" : `p-${p.t}`}>{p.v}</span>
            {baixo && <span className="p-nivel"> (pede nível {p.nivel})</span>}
          </Fragment>
        );
      })}
    </>
  );
}

/** A bolinha da cor do atributo da gema. */
export function Cor({ cor }: { cor: string }) {
  const classe = ["strength", "dexterity", "intelligence"].includes(cor) ? cor : "none";
  return <span className={`cor cor-${classe}`} aria-hidden="true" />;
}

/** O ícone da gema (public/gemas). Gema sem arte ainda (nova da liga): fica a bolinha da cor. */
export function IconeDaGema({ gemId, cor, grande = false }: { gemId: string; cor: string; grande?: boolean }) {
  const [falhou, setFalhou] = useState(false);
  if (falhou) return <Cor cor={cor} />;
  return (
    <img
      className={grande ? "icone-gema grande" : "icone-gema"}
      src={enderecoDoIcone(gemId)}
      alt=""
      draggable={false}
      onError={() => setFalhou(true)}
    />
  );
}

export function LinhaDeGema({ gema }: { gema: GemaDoPasso }) {
  return (
    <li className="gema">
      <IconeDaGema gemId={gema.gem_id} cor={gema.cor} />
      <span className="gema-nome">{gema.nome}</span>
      {gema.quantidade > 1 && <span className="fraco"> ×{gema.quantidade}</span>}
      <span className="fraco"> · {comoPegar(gema)}</span>
    </li>
  );
}
