// Onde fica cada soquete no desenho dos links do balão expandido, como no item do jogo:
// até 3 gemas numa fileira; de 4 em diante, duas colunas em zigue-zague
// (1 → 2, desce, 4 ← 3, desce, 5 → 6), cada gema ligada na seguinte.

export interface Soquete {
  coluna: number;
  linha: number;
}

export interface Ligacao {
  /** Do soquete `de` pro seguinte. */
  de: number;
  /** Ligação deitada (na mesma linha) ou em pé (desce pra próxima linha). */
  deitada: boolean;
}

export function posicoesDosSoquetes(quantos: number): Soquete[] {
  const n = Math.max(0, Math.floor(quantos));
  if (n <= 3) return Array.from({ length: n }, (_, i) => ({ coluna: i, linha: 0 }));
  return Array.from({ length: n }, (_, i) => {
    const linha = Math.floor(i / 2);
    const naLinha = i % 2;
    return { linha, coluna: linha % 2 === 0 ? naLinha : 1 - naLinha };
  });
}

/** As ligações entre um soquete e o seguinte. */
export function ligacoesDosSoquetes(soquetes: readonly Soquete[]): Ligacao[] {
  return soquetes.slice(1).map((s, i) => ({ de: i, deitada: s.linha === soquetes[i].linha }));
}
