// O quadro roxo da ascendência e do panteão: com a árvore de passivas aberta (é dela que se abre a
// ascendência e o panteão), o balão diz que nós pegar em cada lab e que deuses a build usa.
// (Não desenha em cima do disco da ascendência: a leitura da tela ainda não acha o disco.)

import { useEffect, useState } from "react";

import { carregarArvore } from "../arvore";
import { ascendenciaDaBuild, labDeAgora, type AscendenciaDaBuild } from "../nucleo/ascendencia";
import type { Plano } from "../nucleo/plano";

/**
 * A ascendência e o panteão da build. A árvore é lida uma vez por build e solta logo depois:
 * só a lista pequena fica guardada. `null` até ficar pronta (ou sem plano).
 */
export function usarAscendencia(plano: Plano | null): AscendenciaDaBuild | null {
  const [pronta, setPronta] = useState<{ build: string; ascendencia: AscendenciaDaBuild } | null>(null);
  const build = plano ? `${plano.fonte.hash_codigo}|${plano.arvore.etapas.length}` : null;
  useEffect(() => {
    if (!plano || build === null) return;
    let vivo = true;
    void carregarArvore().then((arvore) => {
      if (vivo) setPronta({ build, ascendencia: ascendenciaDaBuild(plano, arvore) });
    });
    return () => {
      vivo = false;
    };
    // Só troca com a build: o plano muda de identidade a cada atualização, as etapas não.
  }, [build]);
  return pronta !== null && pronta.build === build ? pronta.ascendencia : null;
}

/** O quadro roxo. O lab que o nível já deixa fazer fica em destaque. */
export function QuadroDaAscendencia(props: { ascendencia: AscendenciaDaBuild; nivel: number }) {
  const { nome, labs, panteao } = props.ascendencia;
  const agora = labDeAgora(labs, props.nivel);
  return (
    <div className="quadro-da-ascendencia">
      <span className="rotulo-da-ascendencia">Ascendência{nome ? ` · ${nome}` : ""}</span>
      {labs.map((lab, i) => (
        <div
          key={lab.etapa}
          className={i === agora ? "lab-da-ascendencia agora" : "lab-da-ascendencia"}
          title={`Na árvore "${lab.etapa}" do PoB`}
        >
          <span className="nome-do-lab">{lab.rotulo}:</span>{" "}
          {lab.nos.map((no, j) => (
            <span key={no.nome}>
              {j > 0 && <span className="separador"> · </span>}
              <span className={no.notavel ? "no-notavel" : "no-pequeno"}>{no.nome}</span>
            </span>
          ))}
        </div>
      ))}
      {(panteao.maior || panteao.menor) && (
        <div className="panteao-da-build">
          <span className="nome-do-lab">Panteão:</span>{" "}
          {panteao.maior && <span className="no-notavel">{panteao.maior}</span>}
          {panteao.maior && <span className="fraco"> (maior)</span>}
          {panteao.maior && panteao.menor && <span className="separador"> · </span>}
          {panteao.menor && <span className="no-notavel">{panteao.menor}</span>}
          {panteao.menor && <span className="fraco"> (menor)</span>}
        </div>
      )}
    </div>
  );
}
