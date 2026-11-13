//! A porta (a tela parece a da árvore?), o "parou de mexer?" e a interface fixa do jogo.
//!
//! O que isto faz, e só isto: contas baratas em cima de fotos pequenas que já estão na memória.
//! Não fala com o Windows e não manda nada pra lugar nenhum.

use crate::imagem::Tela;
use crate::Foto;

/// Cinza abaixo do qual um ponto é "bem escuro" e fração mínima deles. Nos quadros aceitos do
/// estudo a fração mínima foi 0,657 (mediana 0,807).
const ESCURO_A: f32 = 32.0;
const FRACAO_A: f64 = 0.60;
/// Cinza abaixo do qual um ponto é "escuro" e fração mínima deles (mínima medida: 0,768).
const ESCURO_B: f32 = 48.0;
const FRACAO_B: f64 = 0.72;
/// Cinza médio máximo da tela da árvore (máximo medido: 37,1).
const MEDIA_MAXIMA: f64 = 45.0;
/// Diferença de cinza a partir da qual um ponto "mudou" entre duas fotos pequenas.
const MUDOU: f32 = 12.0;

/// Faixa de cima da interface (pontos, busca, aplicar): metade da largura e altura, em frações
/// da altura da foto (protótipo: `zona_fixa`).
const TOPO_MEIA_LARGURA: f64 = 0.34;
const TOPO_ALTURA: f64 = 0.175;
/// Cantos de baixo (globos e barra): largura de cada um e onde começam, em frações da altura.
const BAIXO_LARGURA: f64 = 0.53;
const BAIXO_INICIO: f64 = 0.775;
/// Rodapé: onde começa, em fração da altura.
const RODAPE_INICIO: f64 = 0.975;
/// Primeira linha da barra de experiência, em fração da altura (medido: 0,9785 a 0,9787 em fotos
/// de 1080, 1125 e 1440 de altura; protótipo: `BARRA_XP`).
const BARRA_XP: f64 = 0.978;

/// O `parece_arvore` público. Ver a descrição em `lib.rs`.
pub(crate) fn parece_arvore(pequena: &Foto) -> bool {
    let Some(tela) = Tela::de(pequena) else { return false };
    let (mut a, mut b, mut soma) = (0usize, 0usize, 0.0f64);
    for y in 0..tela.h {
        for p in tela.linha(y).as_chunks::<4>().0 {
            let c = crate::centros::cinza_de(p);
            a += (c < ESCURO_A) as usize;
            b += (c < ESCURO_B) as usize;
            soma += c as f64;
        }
    }
    let n = (tela.w * tela.h) as f64;
    a as f64 / n >= FRACAO_A && b as f64 / n >= FRACAO_B && soma / n <= MEDIA_MAXIMA
}

/// O `fracao_que_mudou` público. Ver a descrição em `lib.rs`.
pub(crate) fn fracao_que_mudou(a: &Foto, b: &Foto) -> f32 {
    let (Some(ta), Some(tb)) = (Tela::de(a), Tela::de(b)) else { return 1.0 };
    if ta.w != tb.w || ta.h != tb.h {
        return 1.0;
    }
    let mut mudaram = 0usize;
    for y in 0..ta.h {
        for (p, q) in ta.linha(y).as_chunks::<4>().0.iter().zip(tb.linha(y).as_chunks::<4>().0) {
            let d = crate::centros::cinza_de(p) - crate::centros::cinza_de(q);
            mudaram += (d.abs() > MUDOU) as usize;
        }
    }
    mudaram as f32 / (ta.w * ta.h) as f32
}

/// O `zona_fixa` público, em 64 bits. Ver a descrição em `lib.rs`.
pub(crate) fn zona_fixa(x: f64, y: f64, w: f64, h: f64, folga: f64) -> bool {
    let rodape = y > RODAPE_INICIO * h - folga;
    cima_ou_cantos(x, y, w, h, folga) || rodape
}

/// A zona fixa vista pela leitura de um nó (protótipo: `zona_fixa_leitura`). Em cima e nos cantos
/// é a mesma; no rodapé basta o anel que decide o estado (raio `decide`, em pontos da foto) ficar
/// acima da barra de experiência. O fundo e a moldura são medianas de 24 pontos e aguentam alguns
/// deles em cima da barra. Antes, com a folga inteira, um notável pego logo acima da barra ficava
/// "tapado" e o guia nunca via que ele foi pego.
pub(crate) fn zona_fixa_leitura(x: f64, y: f64, w: f64, h: f64, folga: f64, decide: f64) -> bool {
    cima_ou_cantos(x, y, w, h, folga) || y + decide > BARRA_XP * h
}

/// Faixa de cima (pontos, busca, aplicar) e os cantos de baixo (globos e barra de habilidades).
fn cima_ou_cantos(x: f64, y: f64, w: f64, h: f64, folga: f64) -> bool {
    let topo = (x - w / 2.0).abs() < TOPO_MEIA_LARGURA * h + folga && y < TOPO_ALTURA * h + folga;
    let baixo = (x < BAIXO_LARGURA * h + folga || x > w - BAIXO_LARGURA * h - folga) && y > BAIXO_INICIO * h - folga;
    topo || baixo
}
