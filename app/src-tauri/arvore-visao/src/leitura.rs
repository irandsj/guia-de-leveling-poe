//! Lê o estado de cada nó (alocado, livre, não sei) num encaixe já conhecido.
//!
//! O que isto faz, e só isto: contas em cima de uma foto que já está na memória. Olha a cor de
//! três anéis em volta de cada nó: a faixa que só acende quando o nó está alocado, a moldura e
//! o fundo. Não fala com o Windows e não manda nada pra lugar nenhum.

use crate::aneis::{em_tapume, encaixe_valido};
use crate::imagem::{direcoes, mediana, Tela, ANGULOS};
use crate::{raio_de_fora, Arvore, Encaixe, Foto, Leitura, Tapume, CHAVE, JOIA, MAESTRIA, NORMAL, NOTAVEL};

/// Onde a moldura sem alocar é mais clara, em unidades da árvore (protótipo: `MOLDURA`).
const MOLDURA_NORMAL: &[f64] = &[34.0, 36.0];
const MOLDURA_NOTAVEL: &[f64] = &[66.0, 68.0];
const MOLDURA_CHAVE: &[f64] = &[86.0, 94.0];
const MOLDURA_JOIA: &[f64] = &[61.0, 67.0];
/// A faixa que só acende quando o nó está alocado (protótipo: `FAIXA`).
const FAIXA_NORMAL: &[f64] = &[40.0, 42.0];
const FAIXA_NOTAVEL: &[f64] = &[56.0, 58.0];
const FAIXA_CHAVE: &[f64] = &[74.0, 78.0];
const FAIXA_JOIA: &[f64] = &[60.0, 62.0, 64.0];
/// O ícone da maestria (protótipo: `MAESTRIA`). Acende já quando ela pode ser escolhida (um
/// notável do grupo pego), então sozinho não diz que foi escolhida.
const FAIXA_MAESTRIA: &[f64] = &[56.0, 60.0, 64.0];
/// O efeito em volta do ícone, que só aparece forte com a maestria escolhida (protótipo:
/// `MAESTRIA_EFEITO`).
const EFEITO_MAESTRIA: &[f64] = &[82.0, 88.0, 96.0];
/// Brilho mínimo da faixa de um nó alocado (protótipo: `L_ALOCADO`).
const L_ALOCADO: f64 = 128.0;
/// Quão alaranjada a faixa pode ser e ainda contar como alocada: (R - B) / brilho (protótipo: `COR_MAX`).
const COR_MAX: f64 = 0.42;
/// O mesmo pra keystone: a moldura dela alocada é dourada clara, (R - B) / brilho de 0,50 a 0,55
/// (num print do jogo, 2 de 2). O laranja do destaque da busca dá 0,71 ou mais, e a faixa de uma
/// keystone livre não passa de 77 de brilho.
const COR_MAX_CHAVE: f64 = 0.65;
/// Abaixo deste brilho a faixa é de um nó livre (protótipo: `L_LIVRE`).
const L_LIVRE: f64 = 112.0;
/// Quanto a faixa alocada tem de ser mais clara que o fundo (protótipo: `CONTRASTE`).
const CONTRASTE: f64 = 45.0;
/// Quanto a moldura tem de ser mais clara que o fundo pra dizer "livre" (protótipo: `MOLD_MIN`).
const MOLD_MIN: f64 = 15.0;
/// Canal mais forte do ícone de uma maestria acesa (protótipo: `V_MAESTRIA`).
const V_MAESTRIA: f64 = 52.0;
/// Canal mais forte do efeito de uma maestria escolhida (protótipo: `V_EFEITO`). Na bancada, as
/// escolhidas deram 129 ou mais (57 casos, 24 maestrias diferentes); as acesas sem escolha, mesmo
/// com o mouse em cima (que mostra o efeito apagado), 87 ou menos.
const V_EFEITO: f64 = 110.0;
/// Dos 24 ângulos, ficam os 12 do meio em brilho: fora os 6 mais escuros e os 6 mais claros
/// (protótipo: `aparada`, `[6:18]`).
const APARA: usize = 6;

/// Brilho de uma cor (R, G, B), nos pesos do cinza.
#[inline]
fn luma(c: &[f64; 3]) -> f64 {
    0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
}

/// Cor média de alguns raios, em cada um dos 24 ângulos em volta de (qx, qy).
#[inline]
fn anel_rgb(tela: &Tela, dir: &[(f64, f64); ANGULOS], qx: f64, qy: f64, s: f64, raios: &[f64]) -> [[f64; 3]; ANGULOS] {
    let mut cores = [[0.0f64; 3]; ANGULOS];
    for (cor, (cos, sen)) in cores.iter_mut().zip(dir.iter()) {
        for r in raios {
            let c = tela.amostra_rgb(qx + r * s * cos, qy + r * s * sen);
            for (soma, v) in cor.iter_mut().zip(c) {
                *soma += v;
            }
        }
        let n = raios.len().max(1) as f64;
        cor.iter_mut().for_each(|v| *v /= n);
    }
    cores
}

/// Mediana do brilho dos 24 ângulos.
#[inline]
fn brilho_mediano(cores: &[[f64; 3]; ANGULOS]) -> f64 {
    let mut l = [0.0f64; ANGULOS];
    for (v, c) in l.iter_mut().zip(cores) {
        *v = luma(c);
    }
    mediana(&mut l)
}

/// Média aparada: brilho e cor dos 12 ângulos do meio (em brilho).
#[inline]
fn aparada(cores: &[[f64; 3]; ANGULOS]) -> (f64, [f64; 3]) {
    let mut ordem = [(0.0f64, 0usize); ANGULOS];
    for (k, (o, c)) in ordem.iter_mut().zip(cores).enumerate() {
        *o = (luma(c), k);
    }
    ordem.sort_by(|a, b| a.0.total_cmp(&b.0));
    let (mut l, mut cor) = (0.0f64, [0.0f64; 3]);
    let meio = ordem.iter().skip(APARA).take(ANGULOS - 2 * APARA);
    for (brilho, k) in meio {
        l += *brilho;
        if let Some(c) = cores.get(*k) {
            for (soma, v) in cor.iter_mut().zip(c) {
                *soma += *v;
            }
        }
    }
    let n = (ANGULOS - 2 * APARA) as f64;
    (l / n, [cor[0] / n, cor[1] / n, cor[2] / n])
}

/// O `ler` público. Ver a descrição em `lib.rs`.
pub(crate) fn ler(foto: &Foto, arvore: &Arvore, encaixe: &Encaixe, tapumes: &[Tapume], saida: &mut Vec<Leitura>) {
    saida.clear();
    saida.resize(arvore.ids.len(), Leitura::ForaDaTela);
    let (s, tx, ty) = (encaixe.s as f64, encaixe.tx as f64, encaixe.ty as f64);
    let Some(tela) = Tela::de(foto) else { return };
    if !encaixe_valido(s, tx, ty) {
        return;
    }
    let dir = direcoes();
    let (w, h) = (tela.w as f64, tela.h as f64);
    for (((x, y), tipo), estado) in arvore.xs.iter().zip(&arvore.ys).zip(&arvore.tipos).zip(saida.iter_mut()) {
        let (qx, qy) = (s * *x as f64 + tx, s * *y as f64 + ty);
        let rf = raio_de_fora(*tipo) as f64;
        let fora = rf * s + 1.0;
        if !(qx > fora && qx < w - fora && qy > fora && qy < h - fora) {
            continue;
        }
        // O anel que decide o estado (o mais de fora dos que dizem "alocado").
        let decide = match *tipo {
            NORMAL => FAIXA_NORMAL,
            NOTAVEL => FAIXA_NOTAVEL,
            CHAVE => FAIXA_CHAVE,
            JOIA => FAIXA_JOIA,
            MAESTRIA => EFEITO_MAESTRIA,
            _ => &[],
        };
        let decide = decide.iter().copied().fold(0.0f64, f64::max) * s;
        if crate::porta::zona_fixa_leitura(qx, qy, w, h, fora, decide) || em_tapume(qx, qy, fora, tapumes) {
            *estado = Leitura::Tapado;
            continue;
        }
        let (faixa, moldura, cor_max) = match *tipo {
            NORMAL => (FAIXA_NORMAL, MOLDURA_NORMAL, COR_MAX),
            NOTAVEL => (FAIXA_NOTAVEL, MOLDURA_NOTAVEL, COR_MAX),
            CHAVE => (FAIXA_CHAVE, MOLDURA_CHAVE, COR_MAX_CHAVE),
            JOIA => (FAIXA_JOIA, MOLDURA_JOIA, COR_MAX),
            MAESTRIA => {
                // Escolhida: ícone aceso E efeito forte em volta. Só o ícone aceso é "dá pra
                // escolher" (antes isso contava como escolhida e o guia pulava a maestria).
                let forte = |raios: &[f64]| {
                    let (_, cor) = aparada(&anel_rgb(&tela, &dir, qx, qy, s, raios));
                    cor[0].max(cor[1]).max(cor[2])
                };
                let escolhida = forte(FAIXA_MAESTRIA) >= V_MAESTRIA && forte(EFEITO_MAESTRIA) >= V_EFEITO;
                *estado = if escolhida { Leitura::Alocado } else { Leitura::Livre };
                continue;
            }
            // Início de classe, encaixe grande e o que mais aparecer: está na tela, mas não é lido.
            _ => {
                *estado = Leitura::NaoSei;
                continue;
            }
        };
        let fundo = brilho_mediano(&anel_rgb(&tela, &dir, qx, qy, s, &[rf]));
        let (l, cor) = aparada(&anel_rgb(&tela, &dir, qx, qy, s, faixa));
        let c = (cor[0] - cor[2]) / l.max(1.0);
        let alocado = l >= L_ALOCADO && c <= cor_max && l - fundo >= CONTRASTE;
        *estado = if alocado {
            Leitura::Alocado
        } else if l < L_LIVRE || c > cor_max {
            // Só agora a moldura é medida: quase todo nó livre passa por aqui.
            let mold = brilho_mediano(&anel_rgb(&tela, &dir, qx, qy, s, moldura)) - fundo;
            if mold >= MOLD_MIN {
                Leitura::Livre
            } else {
                Leitura::NaoSei
            }
        } else {
            Leitura::NaoSei
        };
    }
    // Maestria só vale escolhida com um vizinho alocado (regra do jogo: precisa de um notável do grupo).
    for i in 0..saida.len() {
        if arvore.tipos.get(i) != Some(&MAESTRIA) || saida.get(i) != Some(&Leitura::Alocado) {
            continue;
        }
        let com_vizinho = arvore.vizinhos.get(i).is_some_and(|v| {
            v.iter().any(|j| arvore.tipos.get(*j as usize) != Some(&MAESTRIA) && saida.get(*j as usize) == Some(&Leitura::Alocado))
        });
        if !com_vizinho {
            if let Some(e) = saida.get_mut(i) {
                *e = Leitura::NaoSei;
            }
        }
    }
}

