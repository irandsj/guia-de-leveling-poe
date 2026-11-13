//! Conferência pelas molduras: no lugar previsto de cada nó há um anel mais claro que o fundo?
//!
//! O que isto faz, e só isto: contas em cima de uma foto que já está na memória. Não fala com o
//! Windows e não manda nada pra lugar nenhum.

use crate::imagem::{direcoes, mediana, Tela, ANGULOS};
use crate::{Arvore, Tapume, CHAVE, JOIA, NORMAL, NOTAVEL};

/// Anel de cada tipo, em unidades da árvore: dois raios em cima da moldura e um de fora, no
/// fundo (protótipo: `ANEL`; medido nos quadros de estudo).
const ANEL_NORMAL: (f64, f64, f64) = (34.0, 36.0, 56.0);
const ANEL_NOTAVEL: (f64, f64, f64) = (66.0, 68.0, 88.0);
const ANEL_CHAVE: (f64, f64, f64) = (86.0, 94.0, 122.0);
const ANEL_JOIA: (f64, f64, f64) = (61.0, 67.0, 88.0);
/// Quanto a moldura tem de ser mais clara que o fundo, em níveis de cinza (protótipo: `limiar = 15`).
const CONTRASTE_DA_MOLDURA: f64 = 15.0;

/// Os raios do anel do tipo. `None` pros tipos que não têm moldura conferida.
fn anel_de(tipo: u8) -> Option<(f64, f64, f64)> {
    match tipo {
        NORMAL => Some(ANEL_NORMAL),
        NOTAVEL => Some(ANEL_NOTAVEL),
        CHAVE => Some(ANEL_CHAVE),
        JOIA => Some(ANEL_JOIA),
        _ => None,
    }
}

/// O ponto (x, y) cai dentro de algum tapume, com `folga` pontos em volta?
pub(crate) fn em_tapume(x: f64, y: f64, folga: f64, tapumes: &[Tapume]) -> bool {
    tapumes.iter().any(|t| {
        x > t.x0 as f64 - folga && x < t.x1 as f64 + folga && y > t.y0 as f64 - folga && y < t.y1 as f64 + folga
    })
}

/// O encaixe serve pra fazer conta? (números de verdade e escala dentro do possível)
pub(crate) fn encaixe_valido(s: f64, tx: f64, ty: f64) -> bool {
    s.is_finite() && tx.is_finite() && ty.is_finite() && s > 1.0e-4 && s < 100.0 && tx.abs() < 1.0e7 && ty.abs() < 1.0e7
}

/// Conta os nós com a moldura no lugar: (bons, conferidos). Só entram os nós que cabem inteiros
/// na foto. Com `pular_fixas`, os que estão debaixo da interface fixa ou de um tapume ficam de fora.
pub(crate) fn contar(
    tela: &Tela,
    arvore: &Arvore,
    s: f64,
    tx: f64,
    ty: f64,
    tapumes: &[Tapume],
    pular_fixas: bool,
) -> (u32, u32) {
    if !encaixe_valido(s, tx, ty) {
        return (0, 0);
    }
    let dir = direcoes();
    let (w, h) = (tela.w as f64, tela.h as f64);
    let (mut bons, mut total) = (0u32, 0u32);
    for ((x, y), tipo) in arvore.xs.iter().zip(&arvore.ys).zip(&arvore.tipos) {
        let Some((ra, rb, rf)) = anel_de(*tipo) else { continue };
        let (qx, qy) = (s * *x as f64 + tx, s * *y as f64 + ty);
        let m = rf * s + 1.0;
        if !(qx > m && qx < w - m && qy > m && qy < h - m) {
            continue;
        }
        if pular_fixas
            && (crate::porta::zona_fixa(qx, qy, w, h, m) || em_tapume(qx, qy, m, tapumes))
        {
            continue;
        }
        let mut anel = [0.0f64; ANGULOS];
        let mut fora = [0.0f64; ANGULOS];
        for ((a, f), (cos, sen)) in anel.iter_mut().zip(fora.iter_mut()).zip(dir.iter()) {
            let va = tela.amostra_cinza(qx + ra * s * cos, qy + ra * s * sen);
            let vb = tela.amostra_cinza(qx + rb * s * cos, qy + rb * s * sen);
            *a = 0.5 * (va + vb);
            *f = tela.amostra_cinza(qx + rf * s * cos, qy + rf * s * sen);
        }
        total += 1;
        if mediana(&mut anel) - mediana(&mut fora) > CONTRASTE_DA_MOLDURA {
            bons += 1;
        }
    }
    (bons, total)
}
