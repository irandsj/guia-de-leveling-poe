// A foto do item (a arte do jogo). A tabela nome → arte só carrega quando a primeira foto aparece;
// cada foto é pedida uma vez por abertura do guia (o programa guarda na pasta de dados e só baixa
// a primeira vez).

import { useEffect, useState } from "react";

import { backend } from "../backend";
import { arteDoItem, type ItemComArte, type TabelaDeArtes } from "../nucleo/artes-itens";

let tabela: TabelaDeArtes | null = null;
let carregandoTabela: Promise<TabelaDeArtes | null> | null = null;

function carregarTabela(): Promise<TabelaDeArtes | null> {
  carregandoTabela ??= import("../dados/artes-itens.json")
    .then((modulo) => (tabela = modulo.default as TabelaDeArtes))
    .catch(() => null);
  return carregandoTabela;
}

/** Arte → foto pronta (`null` = o site não tem, ou não deu pra baixar). */
const prontas = new Map<string, string | null>();
const pedidas = new Map<string, Promise<void>>();

function pedirFoto(arte: string): Promise<void> {
  let pedido = pedidas.get(arte);
  if (!pedido) {
    pedido = backend
      .fotoDoItem(arte)
      .catch(() => null)
      .then((foto) => void prontas.set(arte, foto));
    pedidas.set(arte, pedido);
  }
  return pedido;
}

/** A foto do item: o endereço, `null` se não tem foto, `undefined` enquanto carrega. */
export function usarFotoDoItem(item: ItemComArte): string | null | undefined {
  const [, redesenhar] = useState(0);
  const arte = tabela ? arteDoItem(tabela, item) : undefined;
  useEffect(() => {
    let vivo = true;
    const avisar = () => vivo && redesenhar((n) => n + 1);
    if (arte === undefined) void carregarTabela().then(avisar);
    else if (arte !== null && !prontas.has(arte)) void pedirFoto(arte).then(avisar);
    return () => {
      vivo = false;
    };
  }, [arte]);
  if (arte === null) return null;
  if (arte === undefined || !prontas.has(arte)) return undefined;
  return prontas.get(arte) ?? null;
}

/**
 * A foto do item. A pequena vai no meio do texto (na faixa de itens) e some se não tiver foto;
 * a grande é o quadro do expandido e, sem foto, fica o quadro vazio na cor da raridade.
 */
export function FotoDoItem({ item, grande = false }: { item: ItemComArte; grande?: boolean }) {
  const foto = usarFotoDoItem(item);
  const classe = grande ? "foto-item grande" : "foto-item";
  if (foto) return <img className={classe} src={foto} alt="" draggable={false} />;
  if (foto === null && !grande) return null;
  return <span className={`${classe} vazia`} aria-hidden="true" />;
}
