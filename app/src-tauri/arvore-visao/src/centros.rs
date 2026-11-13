//! Centros de coisas redondas na foto (o primeiro passo de achar a árvore).
//!
//! O que isto faz, e só isto: contas em cima de uma foto que já está na memória. Cada ponto de
//! borda vota a `r` pontos de distância, pra frente e pra trás, na direção em que o brilho muda;
//! onde muitos votos se encontram há o centro de um círculo. Não fala com o Windows e não manda
//! nada pra lugar nenhum.
//!
//! A foto é percorrida em faixas, com janelas rolantes de poucas linhas: a memória gasta é de
//! poucos MB por fio, não importa o tamanho da foto.

use crate::imagem::{rint, Tela, PESO_B, PESO_G, PESO_R};

/// Raios procurados, em pontos numa tela de 1080 de altura (protótipo: `RAIOS_BASE`). Cobrem as
/// molduras dos nós em todos os níveis de zoom.
const RAIOS_BASE: [f64; 15] = [6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 16.0, 18.0, 20.0, 23.0, 26.0, 30.0];
/// Mudança mínima de brilho (por ponto) pra um ponto contar como borda (protótipo: `limiar_grad`).
const LIMIAR_DE_BORDA: f32 = 10.0;
/// Quadrado abaixo do qual nem vale tirar a raiz: 99 < 10², com folga pro arredondamento.
const CORTE_RAPIDO: f32 = 99.0;
/// Força mínima de um centro: 90% de uma circunferência votando (protótipo: `a > 0.9`).
const FORCA_MINIMA: f32 = 0.9;
/// Quantos centros ficam, dos mais fortes (protótipo: `maximo = 450`).
pub(crate) const MAXIMO_DE_CENTROS: usize = 450;
/// A partir desta proporção da altura sobre 1080 a média dos votos passa de 5 x 5 pra 7 x 7
/// (protótipo: `kb = 5 if f < 1.17 else 7`).
const F_DA_JANELA_MAIOR: f64 = 1.17;
/// Lado, em 1080p, da janela em que um centro tem de ser o mais forte (protótipo: `15 * f`).
const JANELA_DE_PICO: f64 = 15.0;
/// Altura mínima de uma faixa pra valer a pena abrir outro fio.
const FAIXA_MINIMA: usize = 160;

/// Um centro achado: posição fina (pontos da foto) e força.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Centro {
    pub x: f32,
    pub y: f32,
    pub forca: f32,
}

/// De onde vem o cinza: a foto como está, ou reduzida à metade (média de 2 x 2).
#[derive(Clone, Copy)]
pub(crate) enum Fonte<'a> {
    Cheia(Tela<'a>),
    Metade(Tela<'a>),
}

/// Cinza de um ponto a partir dos bytes B, G, R (na mesma conta do protótipo).
#[inline]
pub(crate) fn cinza_de(p: &[u8]) -> f32 {
    match p {
        [b, g, r, ..] => PESO_R * *r as f32 + PESO_G * *g as f32 + PESO_B * *b as f32,
        _ => 0.0,
    }
}

impl Fonte<'_> {
    pub fn largura(&self) -> usize {
        match self {
            Fonte::Cheia(t) => t.w,
            Fonte::Metade(t) => t.w / 2,
        }
    }

    pub fn altura(&self) -> usize {
        match self {
            Fonte::Cheia(t) => t.h,
            Fonte::Metade(t) => t.h / 2,
        }
    }

    /// Preenche `saida` (uma linha inteira) com o cinza da linha `y`.
    fn linha(&self, y: usize, saida: &mut [f32]) {
        match self {
            Fonte::Cheia(t) => {
                for (v, p) in saida.iter_mut().zip(t.linha(y).as_chunks::<4>().0) {
                    *v = cinza_de(p);
                }
            }
            Fonte::Metade(t) => {
                let (a, b) = (t.linha(2 * y), t.linha(2 * y + 1));
                for ((v, p), q) in saida.iter_mut().zip(a.as_chunks::<8>().0).zip(b.as_chunks::<8>().0) {
                    let (p0, p1) = p.split_at(4);
                    let (q0, q1) = q.split_at(4);
                    *v = (cinza_de(p0) + cinza_de(p1) + cinza_de(q0) + cinza_de(q1)) * 0.25;
                }
            }
        }
    }
}

/// Os raios em pontos pra esta foto, sem repetição, em ordem crescente.
fn raios_pra(f: f64) -> Vec<i64> {
    let mut r: Vec<i64> = RAIOS_BASE.iter().map(|b| rint(b * f) as i64).filter(|r| *r >= 1).collect();
    r.sort_unstable();
    r.dedup();
    r
}

/// Medidas comuns a todas as faixas.
struct Plano {
    w: usize,
    h: usize,
    raios: Vec<f32>,
    pesos: Vec<f64>,
    rmax: usize,
    /// Lado da média dos votos (5 ou 7) e a metade dele.
    kb: usize,
    hb: usize,
    /// Metade do lado da janela de pico.
    hj: usize,
}

/// Acha os centros. `f` = altura da foto / 1080. `fios` = quantos fios pode usar (1 a 4).
pub(crate) fn centros(fonte: &Fonte, f: f64, fios: usize) -> Vec<Centro> {
    let (w, h) = (fonte.largura(), fonte.altura());
    if w < 3 || h < 3 || !f.is_finite() || f <= 0.0 || f > 16.0 {
        return Vec::new();
    }
    let raios = raios_pra(f);
    let Some(rmax) = raios.iter().copied().max() else { return Vec::new() };
    let pesos = raios.iter().map(|r| 1.0 / (2.0 * std::f64::consts::PI * *r as f64)).collect();
    let kb = if f < F_DA_JANELA_MAIOR { 5 } else { 7 };
    let kj = (rint(JANELA_DE_PICO * f) as usize) | 1;
    let plano = Plano {
        w,
        h,
        raios: raios.iter().map(|r| *r as f32).collect(),
        pesos,
        rmax: rmax as usize,
        kb,
        hb: kb / 2,
        // A posição fina olha 2 linhas pra cada lado: a janela nunca é menor que isso.
        hj: (kj / 2).max(2),
    };

    let partes = fios.clamp(1, 4).min((h / FAIXA_MINIMA).max(1));
    let mut picos: Vec<Centro> = Vec::new();
    if partes == 1 {
        picos = faixa(fonte, &plano, 0, h);
    } else {
        let plano = &plano;
        let por_faixa: Vec<Vec<Centro>> = std::thread::scope(|s| {
            // A primeira faixa fica com este fio; as outras, cada uma com um fio a mais.
            let fios: Vec<_> = (1..partes)
                .map(|i| {
                    let (y0, y1) = (h * i / partes, h * (i + 1) / partes);
                    (y0, y1, crate::abrir_fio(s, move || faixa(fonte, plano, y0, y1)))
                })
                .collect();
            let mut todas = vec![faixa(fonte, plano, 0, h / partes)];
            for (y0, y1, fio) in fios {
                todas.push(match fio {
                    // Um fio que morreu conta como faixa sem picos (não acontece: o código não dá pânico).
                    Some(f) => f.join().unwrap_or_default(),
                    // O sistema não abriu o fio: a faixa é feita aqui mesmo.
                    None => faixa(fonte, plano, y0, y1),
                });
            }
            todas
        });
        for p in por_faixa {
            picos.extend(p);
        }
    }
    // Os mais fortes primeiro; empate na ordem da foto (de cima pra baixo, da esquerda pra direita).
    picos.sort_by(|a, b| b.forca.total_cmp(&a.forca));
    picos.truncate(MAXIMO_DE_CENTROS);
    picos
}

/// Janela rolante de linhas: guarda as últimas `cap` linhas, cada uma no lugar `y % cap`.
struct Rolo {
    w: usize,
    cap: usize,
    dados: Vec<f32>,
}

impl Rolo {
    fn novo(w: usize, cap: usize) -> Rolo {
        Rolo { w, cap: cap.max(1), dados: vec![0.0; w * cap.max(1)] }
    }

    #[inline]
    fn linha(&self, y: usize) -> &[f32] {
        let i = (y % self.cap) * self.w;
        self.dados.get(i..i + self.w).unwrap_or(&[])
    }

    #[inline]
    fn linha_mut(&mut self, y: usize) -> &mut [f32] {
        let i = (y % self.cap) * self.w;
        self.dados.get_mut(i..i + self.w).unwrap_or(&mut [])
    }
}

/// Estado de uma faixa: as janelas rolantes de cada etapa e até onde cada uma já andou.
struct Esteira<'p> {
    p: &'p Plano,
    /// Votos (64 bits, pra soma sair igual à do protótipo), `mascara + 1` linhas.
    votos: Vec<f64>,
    mascara: usize,
    /// Faixa de linhas de votos que interessam.
    v_lo: usize,
    v_hi: usize,
    /// Votos já fechados, em 32 bits: as últimas `kb` linhas.
    fechados: Rolo,
    /// Média dos votos (a "força"): as últimas linhas, o bastante pra janela de pico.
    forca: Rolo,
    /// Rascunho de uma linha (soma na vertical).
    coluna: Vec<f64>,
    /// Próxima linha de força a calcular, e o fim.
    prox_a: usize,
    a_hi: usize,
    /// Próxima linha em que procurar picos, e o fim.
    prox_p: usize,
    p_hi: usize,
    picos: Vec<Centro>,
}

/// Acha os picos das linhas `y0..y1`. Olha as linhas em volta que forem precisas.
fn faixa(fonte: &Fonte, p: &Plano, y0: usize, y1: usize) -> Vec<Centro> {
    let (w, h) = (p.w, p.h);
    let a_lo = y0.saturating_sub(p.hj);
    let a_hi = (y1 + p.hj).min(h);
    let v_lo = a_lo.saturating_sub(p.hb);
    let v_hi = (a_hi + p.hb).min(h);
    let s_lo = v_lo.saturating_sub(p.rmax);
    let s_hi = (v_hi + p.rmax).min(h);
    let linhas = (2 * p.rmax + 1).next_power_of_two();
    let mut e = Esteira {
        p,
        votos: vec![0.0; linhas * w],
        mascara: linhas - 1,
        v_lo,
        v_hi,
        fechados: Rolo::novo(w, p.kb),
        forca: Rolo::novo(w, 2 * p.hj + 1),
        coluna: vec![0.0; w],
        prox_a: a_lo,
        a_hi,
        prox_p: y0,
        p_hi: y1,
        picos: Vec::new(),
    };
    if s_lo >= s_hi {
        return e.picos;
    }

    // Três linhas de cinza: a de cima, a atual e a de baixo.
    let mut cima = vec![0.0f32; w];
    let mut meio = vec![0.0f32; w];
    let mut baixo = vec![0.0f32; w];
    if s_lo > 0 {
        fonte.linha(s_lo - 1, &mut cima);
    }
    fonte.linha(s_lo, &mut meio);
    if s_lo + 1 < h {
        fonte.linha(s_lo + 1, &mut baixo);
    }
    let mut prox_fechar = v_lo;
    for y in s_lo..s_hi {
        e.votar_linha(y, &cima, &meio, &baixo);
        if y >= p.rmax {
            let r = y - p.rmax;
            if r == prox_fechar && r < v_hi {
                e.fechar(r);
                prox_fechar = r + 1;
            }
        }
        std::mem::swap(&mut cima, &mut meio);
        std::mem::swap(&mut meio, &mut baixo);
        if y + 2 < h {
            fonte.linha(y + 2, &mut baixo);
        }
    }
    while prox_fechar < v_hi {
        e.fechar(prox_fechar);
        prox_fechar += 1;
    }
    e.picos
}

impl Esteira<'_> {
    /// Um ponto de borda em (x, y), com a mudança de brilho (gx, gy), vota nos centros possíveis.
    #[inline]
    // O `!(a > b)` é de propósito: valor que não é número também sai.
    #[allow(clippy::neg_cmp_op_on_partial_ord)]
    fn votar_ponto(&mut self, x: usize, y: usize, gx: f32, gy: f32) {
        let mag = ((gx as f64) * (gx as f64) + (gy as f64) * (gy as f64)).sqrt() as f32;
        if !(mag > LIMIAR_DE_BORDA) {
            return;
        }
        let (ux, uy) = (gx / mag, gy / mag);
        let (xf, yf) = (x as f64, y as f64);
        let (w, lo, hi) = (self.p.w as i64, self.v_lo as i64, self.v_hi as i64);
        for (r, peso) in self.p.raios.iter().zip(self.p.pesos.iter()) {
            let dx = (*r * ux) as f64;
            let dy = (*r * uy) as f64;
            for (vx, vy) in [(xf + dx, yf + dy), (xf - dx, yf - dy)] {
                let (px, py) = (rint(vx) as i64, rint(vy) as i64);
                if px >= 0 && px < w && py >= lo && py < hi {
                    let i = ((py as usize) & self.mascara) * self.p.w + px as usize;
                    if let Some(v) = self.votos.get_mut(i) {
                        *v += *peso;
                    }
                }
            }
        }
    }

    /// Os pontos de borda da linha `y` votam. Na primeira e na última linha a mudança na
    /// vertical vale zero; na primeira e na última coluna, a na horizontal (como no protótipo).
    fn votar_linha(&mut self, y: usize, cima: &[f32], meio: &[f32], baixo: &[f32]) {
        let w = self.p.w;
        let no_meio = y > 0 && y + 1 < self.p.h;
        if no_meio {
            for x in [0, w - 1] {
                if let (Some(c), Some(b)) = (cima.get(x), baixo.get(x)) {
                    let gy = (*b - *c) * 0.5;
                    if gy * gy > CORTE_RAPIDO {
                        self.votar_ponto(x, y, 0.0, gy);
                    }
                }
            }
        }
        let (Some(cima), Some(baixo)) = (cima.get(1..), baixo.get(1..)) else { return };
        // Cada janela de 3 pontos de `meio` tem no centro o ponto x = i + 1.
        for (i, ((m, c), b)) in meio.windows(3).zip(cima).zip(baixo).enumerate() {
            let gx = match m {
                [e, _, d] => (*d - *e) * 0.5,
                _ => 0.0,
            };
            let gy = if no_meio { (*b - *c) * 0.5 } else { 0.0 };
            if gx * gx + gy * gy > CORTE_RAPIDO {
                self.votar_ponto(i + 1, y, gx, gy);
            }
        }
    }

    /// A linha `r` de votos não recebe mais nada: passa pra 32 bits e libera o lugar.
    fn fechar(&mut self, r: usize) {
        let w = self.p.w;
        let i = (r & self.mascara) * w;
        if let Some(origem) = self.votos.get_mut(i..i + w) {
            for (d, o) in self.fechados.linha_mut(r).iter_mut().zip(origem.iter_mut()) {
                *d = *o as f32;
                *o = 0.0;
            }
        }
        let ultima = self.p.h - 1;
        while self.prox_a < self.a_hi && (self.prox_a + self.p.hb).min(ultima) <= r {
            let y = self.prox_a;
            self.media(y);
            self.prox_a += 1;
            while self.prox_p < self.p_hi && (self.prox_p + self.p.hj).min(ultima) <= y {
                let linha = self.prox_p;
                self.procurar_picos(linha);
                self.prox_p += 1;
            }
        }
    }

    /// Linha `y` da força: soma dos votos numa janela `kb` x `kb` (a borda repete), na mesma
    /// ordem de contas do protótipo (média na vertical, média na horizontal, vezes `kb²`).
    fn media(&mut self, y: usize) {
        let (w, h, kb, hb) = (self.p.w, self.p.h, self.p.kb, self.p.hb);
        let k = kb as f64;
        self.coluna.iter_mut().for_each(|v| *v = 0.0);
        for d in 0..kb {
            let yy = (y + d).saturating_sub(hb).min(h - 1);
            for (soma, v) in self.coluna.iter_mut().zip(self.fechados.linha(yy)) {
                *soma += *v as f64;
            }
        }
        self.coluna.iter_mut().for_each(|v| *v /= k);
        let coluna = &self.coluna;
        let vezes = (kb * kb) as f32;
        let saida = self.forca.linha_mut(y);
        // O miolo, onde a janela cabe inteira.
        if let Some(miolo) = saida.get_mut(hb..w.saturating_sub(hb)) {
            for (s, j) in miolo.iter_mut().zip(coluna.windows(kb)) {
                let soma: f64 = j.iter().sum();
                *s = (soma / k) as f32 * vezes;
            }
        }
        // As beiradas, repetindo a borda.
        for x in (0..hb.min(w)).chain(w.saturating_sub(hb).max(hb)..w) {
            let mut soma = 0.0f64;
            for d in 0..kb {
                let xx = (x + d).saturating_sub(hb).min(w - 1);
                soma += coluna.get(xx).copied().unwrap_or(0.0);
            }
            if let Some(s) = saida.get_mut(x) {
                *s = (soma / k) as f32 * vezes;
            }
        }
    }

    /// Picos da linha `y`: pontos fortes que são os maiores da janela em volta.
    // O `!(a > b)` é de propósito: valor que não é número também sai.
    #[allow(clippy::neg_cmp_op_on_partial_ord)]
    fn procurar_picos(&mut self, y: usize) {
        let (w, h, hj) = (self.p.w, self.p.h, self.p.hj);
        let (y_lo, y_hi) = (y.saturating_sub(hj), (y + hj).min(h - 1));
        let linha = self.forca.linha(y);
        for (x, v) in linha.iter().enumerate() {
            if !(*v > FORCA_MINIMA) {
                continue;
            }
            let (x_lo, x_hi) = (x.saturating_sub(hj), (x + hj).min(w - 1));
            let maior = |l: &[f32]| l.get(x_lo..=x_hi).is_some_and(|j| j.iter().any(|u| *u > *v));
            if maior(linha) || (y_lo..=y_hi).any(|yy| yy != y && maior(self.forca.linha(yy))) {
                continue;
            }
            // Posição fina: centro de massa (menos o mínimo) da janela 5 x 5.
            let (cx_lo, cx_hi) = (x.saturating_sub(2), (x + 2).min(w - 1));
            let (cy_lo, cy_hi) = (y.saturating_sub(2), (y + 2).min(h - 1));
            let mut minimo = f64::INFINITY;
            for yy in cy_lo..=cy_hi {
                if let Some(j) = self.forca.linha(yy).get(cx_lo..=cx_hi) {
                    for u in j {
                        minimo = minimo.min(*u as f64);
                    }
                }
            }
            let (mut tot, mut sx, mut sy) = (0.0f64, 0.0f64, 0.0f64);
            for yy in cy_lo..=cy_hi {
                if let Some(j) = self.forca.linha(yy).get(cx_lo..=cx_hi) {
                    for (k, u) in j.iter().enumerate() {
                        let peso = *u as f64 - minimo;
                        tot += peso;
                        sx += peso * (cx_lo + k) as f64;
                        sy += peso * yy as f64;
                    }
                }
            }
            let (fx, fy) = if tot > 0.0 { ((sx / tot) as f32, (sy / tot) as f32) } else { (x as f32, y as f32) };
            self.picos.push(Centro { x: fx, y: fy, forca: *v });
        }
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::Foto;

    #[test]
    fn raios_de_1080_e_de_1440() {
        assert_eq!(raios_pra(1.0), vec![6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 23, 26, 30]);
        assert_eq!(raios_pra(1440.0 / 1080.0), vec![8, 9, 11, 12, 13, 15, 16, 17, 19, 21, 24, 27, 31, 35, 40]);
    }

    /// Desenha um disco claro num fundo escuro.
    fn com_disco(w: usize, h: usize, cx: f32, cy: f32, raio: f32) -> Vec<u8> {
        let mut b = vec![0u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let d = ((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2)).sqrt();
                let v = ((raio + 0.5 - d).clamp(0.0, 1.0) * 200.0) as u8 + 10;
                b[(y * w + x) * 4..(y * w + x) * 4 + 3].fill(v);
            }
        }
        b
    }

    #[test]
    fn acha_o_centro_de_um_disco_e_nao_depende_dos_fios() {
        let (w, h) = (400, 720);
        let b = com_disco(w, h, 180.3, 361.6, 10.0);
        let tela = Tela::de(&Foto { largura: w, altura: h, bgrx: &b }).unwrap();
        let um = centros(&Fonte::Cheia(tela), 1.0, 1);
        let quatro = centros(&Fonte::Cheia(tela), 1.0, 4);
        assert!(!um.is_empty());
        assert!((um[0].x - 180.3).abs() < 0.6 && (um[0].y - 361.6).abs() < 0.6, "{:?}", um[0]);
        assert_eq!(um.len(), quatro.len());
        for (a, b) in um.iter().zip(&quatro) {
            assert_eq!((a.x, a.y, a.forca), (b.x, b.y, b.forca));
        }
    }

    /// Se o sistema recusar abrir fios, as faixas são feitas no próprio fio e o resultado é o mesmo.
    #[test]
    fn sem_conseguir_abrir_fios_da_o_mesmo() {
        let (w, h) = (400, 720);
        let b = com_disco(w, h, 180.3, 361.6, 10.0);
        let tela = Tela::de(&Foto { largura: w, altura: h, bgrx: &b }).unwrap();
        let normal = centros(&Fonte::Cheia(tela), 1.0, 4);
        let (sem_fios, recusas) = crate::fios_recusados::com_recusa(|| centros(&Fonte::Cheia(tela), 1.0, 4));
        assert_eq!(recusas, 3);
        assert!(!normal.is_empty());
        assert_eq!(normal.len(), sem_fios.len());
        for (a, b) in normal.iter().zip(&sem_fios) {
            assert_eq!((a.x, a.y, a.forca), (b.x, b.y, b.forca));
        }
    }

    #[test]
    fn foto_lisa_nao_tem_centro() {
        let b = vec![40u8; 64 * 64 * 4];
        let tela = Tela::de(&Foto { largura: 64, altura: 64, bgrx: &b }).unwrap();
        assert!(centros(&Fonte::Cheia(tela), 64.0 / 1080.0, 4).is_empty());
        assert!(centros(&Fonte::Metade(tela), 32.0 / 1080.0, 4).is_empty());
    }

    /// Compara com os centros do protótipo, quadro a quadro. Só roda com a bancada.
    #[test]
    fn prova_dos_centros() {
        let Ok(pasta) = std::env::var("GUIA_PROVA_ARVORE") else {
            println!("prova_dos_centros: sem GUIA_PROVA_ARVORE, pulei");
            return;
        };
        let pasta = std::path::PathBuf::from(pasta);
        let indice: serde_json::Value =
            serde_json::from_slice(&std::fs::read(pasta.join("indice.json")).unwrap()).unwrap();
        let (mut quadros, mut iguais, mut total, mut achados) = (0, 0, 0usize, 0usize);
        for item in indice.as_array().unwrap() {
            let nome = item["arquivo"].as_str().unwrap();
            let (w, h) = (item["largura"].as_u64().unwrap() as usize, item["altura"].as_u64().unwrap() as usize);
            let rgb = std::fs::read(pasta.join("rgb").join(format!("{nome}.rgb"))).unwrap();
            let mut bgrx = vec![0u8; w * h * 4];
            for (d, o) in bgrx.as_chunks_mut::<4>().0.iter_mut().zip(rgb.as_chunks::<3>().0) {
                d.copy_from_slice(&[o[2], o[1], o[0], 255]);
            }
            let esperado: serde_json::Value = serde_json::from_slice(
                &std::fs::read(pasta.join("esperado").join(format!("{nome}.json"))).unwrap(),
            )
            .unwrap();
            let esperado: Vec<(f64, f64, f64)> = esperado["centros"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| (c[0].as_f64().unwrap(), c[1].as_f64().unwrap(), c[2].as_f64().unwrap()))
                .collect();
            let tela = Tela::de(&Foto { largura: w, altura: h, bgrx: &bgrx }).unwrap();
            let meus = centros(&Fonte::Cheia(tela), h as f64 / 1080.0, 4);
            // Quantos centros do protótipo têm um igual aqui (0,011 ponto, 0,002 de força).
            let mut casou = 0;
            for e in &esperado {
                if meus.iter().any(|m| {
                    (m.x as f64 - e.0).abs() < 0.011 && (m.y as f64 - e.1).abs() < 0.011 && (m.forca as f64 - e.2).abs() < 0.002
                }) {
                    casou += 1;
                }
            }
            quadros += 1;
            total += esperado.len();
            achados += casou;
            if casou == esperado.len() && meus.len() == esperado.len() {
                iguais += 1;
            } else {
                println!("  centros diferentes em {nome}: {casou} de {} (aqui {})", esperado.len(), meus.len());
            }
        }
        println!("prova_dos_centros: {iguais} de {quadros} quadros idênticos; {achados} de {total} centros");
        assert!(achados as f64 >= 0.995 * total as f64);
    }
}
