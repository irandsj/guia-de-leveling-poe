//! Acha onde a árvore está na foto: nível de zoom e deslocamento.
//!
//! O que isto faz, e só isto: contas em cima de uma foto que já está na memória. Casa os centros
//! redondos achados na foto com as posições dos nós da árvore: pra cada nível de zoom, cada par
//! (centro, nó) vota num deslocamento; as caixas mais votadas viram hipóteses, que são afinadas
//! e conferidas pelas molduras dos nós. Não fala com o Windows e não manda nada pra lugar nenhum.

use crate::aneis;
use crate::centros::{centros, Centro, Fonte};
use crate::imagem::{rint, Tela};
use crate::{Arvore, Encaixe, Foto, Registro, CHAVE, INICIO, JOIA, NORMAL, NOTAVEL};

/// Níveis de zoom do jogo: `s = n * altura / 80000`, `n` de 8 a 40 (medido em 184 quadros).
pub(crate) const N_MIN: u32 = 8;
pub(crate) const N_MAX: u32 = 40;
/// O divisor da fórmula da escala.
pub(crate) const DIVISOR_DA_ESCALA: f64 = 80000.0;
/// Lado da caixa de voto do deslocamento, em pontos de 1080p (protótipo: `8.0 * f`).
const CAIXA: f64 = 8.0;
/// Quantas caixas de cada escala viram hipótese (protótipo: as 3 melhores).
const CAIXAS_POR_ESCALA: usize = 3;
/// Quantas hipóteses diferentes são afinadas, no máximo (protótipo: 24).
const HIPOTESES: usize = 24;
/// Duas hipóteses da mesma escala a menos disto (em pontos de 1080p) são a mesma (protótipo: `2 * f`).
const MESMA_HIPOTESE: f64 = 2.0;
/// Alcance do voto fino em volta do deslocamento grosso, em pontos de 1080p (protótipo: `12 * f`).
const ALCANCE_FINO: f64 = 12.0;
/// Tolerâncias das três rodadas de média dos pares, em pontos de 1080p (protótipo: 4, 3, 3).
const RODADAS: [f64; 3] = [4.0, 3.0, 3.0];
/// Tolerância da contagem final de pares, em pontos de 1080p (protótipo: 3).
const TOLERANCIA_FINAL: f64 = 3.0;
/// Menos pares que isto e a média não é feita (protótipo: `len(pares) < 4`).
const PARES_MINIMOS: usize = 4;
/// Nota mínima do casamento (protótipo: `nota >= 8`, com a nota arredondada a uma casa).
const NOTA_MINIMA: f64 = 8.0;
/// Regra de aceitação A: muitas molduras, fração modesta (protótipo: 15, 0.2, 0.08).
const A_BONS: u32 = 15;
const A_FRACAO: f64 = 0.2;
const A_FOLGA: f64 = 0.08;
/// Regra de aceitação B: poucas molduras (zoom alto), fração alta (protótipo: 8, 0.6, 0.3).
const B_BONS: u32 = 8;
const B_FRACAO: f64 = 0.6;
const B_FOLGA: f64 = 0.3;
/// Deslocamento do controle, em unidades da árvore (protótipo: 45, um raio de anel).
const DESLOCAMENTO_DO_CONTROLE: f64 = 45.0;
/// Acima desta altura a procura é feita numa foto reduzida à metade.
const ALTURA_PRA_REDUZIR: usize = 1600;
/// Menor lado em que faz sentido procurar a árvore.
const LADO_MINIMO: usize = 64;
/// Lado da célula da grade de nós, em unidades da árvore. Maior que o alcance do voto fino no
/// zoom mínimo (12 * 80000 / (1080 * 8) = 111).
const CELULA: f32 = 128.0;
/// Fios usados, no máximo.
const FIOS: usize = 4;

/// Os nós que entram no casamento (tudo menos maestria e encaixe grande), com uma grade pra
/// achar depressa os que ficam perto de um ponto.
pub(crate) struct Pontos {
    xs: Vec<f32>,
    ys: Vec<f32>,
    minx: f32,
    maxx: f32,
    miny: f32,
    maxy: f32,
    /// Grade: `inicio[c]..inicio[c + 1]` são as posições em `itens` dos nós da célula `c`.
    gx: usize,
    gy: usize,
    inicio: Vec<u32>,
    itens: Vec<u32>,
}

impl Pontos {
    /// `None` se a árvore tiver nós de menos ou for grande demais pra ser a do jogo.
    pub fn de(arvore: &Arvore) -> Option<Pontos> {
        let mut xs = Vec::new();
        let mut ys = Vec::new();
        for ((x, y), tipo) in arvore.xs.iter().zip(&arvore.ys).zip(&arvore.tipos) {
            if matches!(*tipo, NORMAL | NOTAVEL | CHAVE | JOIA | INICIO) && x.is_finite() && y.is_finite() {
                xs.push(*x);
                ys.push(*y);
            }
        }
        if xs.len() < 4 || xs.len() > 20000 {
            return None;
        }
        let min = |v: &[f32]| v.iter().copied().fold(f32::INFINITY, f32::min);
        let max = |v: &[f32]| v.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        let (minx, maxx, miny, maxy) = (min(&xs), max(&xs), min(&ys), max(&ys));
        // A árvore do jogo cabe em ±13000; 400 mil já é absurdo.
        if maxx - minx > 4.0e5 || maxy - miny > 4.0e5 {
            return None;
        }
        let gx = ((maxx - minx) / CELULA) as usize + 1;
        let gy = ((maxy - miny) / CELULA) as usize + 1;
        let mut p = Pontos { xs, ys, minx, maxx, miny, maxy, gx, gy, inicio: vec![0; gx * gy + 1], itens: Vec::new() };
        let celulas: Vec<usize> = (0..p.xs.len()).map(|i| p.celula_de(i)).collect();
        for c in &celulas {
            if let Some(v) = p.inicio.get_mut(*c + 1) {
                *v += 1;
            }
        }
        let mut soma = 0u32;
        for v in p.inicio.iter_mut() {
            soma += *v;
            *v = soma;
        }
        let mut prox = p.inicio.clone();
        p.itens = vec![0; p.xs.len()];
        for (i, c) in celulas.iter().enumerate() {
            if let Some(lugar) = prox.get_mut(*c) {
                if let Some(v) = p.itens.get_mut(*lugar as usize) {
                    *v = i as u32;
                }
                *lugar += 1;
            }
        }
        Some(p)
    }

    fn celula_de(&self, i: usize) -> usize {
        let cx = self.xs.get(i).map_or(0, |x| ((*x - self.minx) / CELULA) as usize).min(self.gx - 1);
        let cy = self.ys.get(i).map_or(0, |y| ((*y - self.miny) / CELULA) as usize).min(self.gy - 1);
        cy * self.gx + cx
    }

    fn len(&self) -> usize {
        self.xs.len()
    }

    #[inline]
    fn ponto(&self, i: usize) -> (f32, f32) {
        match (self.xs.get(i), self.ys.get(i)) {
            (Some(x), Some(y)) => (*x, *y),
            _ => (0.0, 0.0),
        }
    }

    /// Chama `f(posição)` pra cada nó a menos de `raio` (unidades da árvore, com sobra) de (mx, my).
    #[inline]
    fn perto(&self, mx: f64, my: f64, raio: f64, mut f: impl FnMut(usize)) {
        if !(mx.is_finite() && my.is_finite() && raio.is_finite()) {
            return;
        }
        let cel = CELULA as f64;
        let faixa = |v: f64, min: f32, n: usize| -> Option<(usize, usize)> {
            let a = ((v - raio - min as f64) / cel).floor();
            let b = ((v + raio - min as f64) / cel).floor();
            if b < 0.0 || a >= n as f64 {
                return None;
            }
            Some((a.max(0.0) as usize, (b as usize).min(n - 1)))
        };
        let (Some((x0, x1)), Some((y0, y1))) = (faixa(mx, self.minx, self.gx), faixa(my, self.miny, self.gy)) else {
            return;
        };
        for cy in y0..=y1 {
            let (a, b) = (cy * self.gx + x0, cy * self.gx + x1 + 1);
            let (Some(ini), Some(fim)) = (self.inicio.get(a), self.inicio.get(b)) else { continue };
            if let Some(itens) = self.itens.get(*ini as usize..*fim as usize) {
                for i in itens {
                    f(*i as usize);
                }
            }
        }
    }
}

/// Os centros achados, em colunas.
struct Cands {
    xs: Vec<f32>,
    ys: Vec<f32>,
}

/// Medidas da foto em que a procura é feita (a cheia ou a reduzida).
#[derive(Clone, Copy)]
struct Quadro {
    w: usize,
    h: usize,
    /// Altura sobre 1080.
    f: f64,
}

/// Uma caixa bem votada: nota, zoom e deslocamento grosso.
#[derive(Clone, Copy)]
struct Voto {
    nota: f64,
    n: u32,
    s: f64,
    tx: f64,
    ty: f64,
}

/// Rascunhos de um fio da votação, reaproveitados de uma escala pra outra.
#[derive(Default)]
struct Rascunho {
    hist: Vec<u16>,
    ix: Vec<i32>,
    iy: Vec<i32>,
}

/// Vota o deslocamento numa escala e junta em `saida` as 3 caixas mais votadas. As contas são em
/// 32 bits e na mesma ordem do protótipo, pra cada voto cair na mesma caixa.
fn votar_escala(c: &Cands, p: &Pontos, q: Quadro, n: u32, s: f64, r: &mut Rascunho, saida: &mut Vec<Voto>) {
    let caixa = CAIXA * q.f;
    let (s32, caixa32) = (s as f32, caixa as f32);
    let x0 = -s32 * p.maxx - caixa32;
    let y0 = -s32 * p.maxy - caixa32;
    let nx = (((q.w as f32 - s32 * p.minx) - x0) / caixa32) as i64 + 3;
    let ny = (((q.h as f32 - s32 * p.miny) - y0) / caixa32) as i64 + 3;
    // Trava: a grade de votos nunca passa de 64 MB (no jogo fica em poucos MB).
    if nx < 2 || ny < 2 || nx.saturating_mul(ny) > (1 << 25) {
        return;
    }
    let (nx, ny) = (nx as usize, ny as usize);
    r.hist.clear();
    r.hist.resize(nx * ny, 0);
    r.ix.resize(c.xs.len(), 0);
    r.iy.resize(c.ys.len(), 0);
    for j in 0..p.len() {
        let (mx, my) = p.ponto(j);
        let (a, b) = (s32 * mx, s32 * my);
        for (i, x) in r.ix.iter_mut().zip(&c.xs) {
            *i = (((*x - a) - x0) / caixa32) as i32;
        }
        for (i, y) in r.iy.iter_mut().zip(&c.ys) {
            *i = (((*y - b) - y0) / caixa32) as i32;
        }
        for (ix, iy) in r.ix.iter().zip(&r.iy) {
            // O índice sai sempre dentro da grade; a conferência é só pra nunca dar pânico.
            if *ix >= 0 && (*ix as usize) < nx && *iy >= 0 {
                if let Some(v) = r.hist.get_mut(*iy as usize * nx + *ix as usize) {
                    *v = v.saturating_add(1);
                }
            }
        }
    }
    // As 3 janelas 2 x 2 mais votadas (a janela pega o pico que caiu na divisa de duas caixas).
    let mut melhores: [(u32, usize, usize); CAIXAS_POR_ESCALA] = [(0, 0, 0); CAIXAS_POR_ESCALA];
    let mut quantos = 0usize;
    let mut corte = 0u32;
    for jy in 0..ny - 1 {
        let (Some(cima), Some(baixo)) = (r.hist.get(jy * nx..(jy + 1) * nx), r.hist.get((jy + 1) * nx..(jy + 2) * nx))
        else {
            break;
        };
        for (jx, (a, b)) in cima.windows(2).zip(baixo.windows(2)).enumerate() {
            let v = match (a, b) {
                ([a0, a1], [b0, b1]) => *a0 as u32 + *a1 as u32 + *b0 as u32 + *b1 as u32,
                _ => 0,
            };
            if quantos == CAIXAS_POR_ESCALA && v <= corte {
                continue;
            }
            // Entra no lugar certo (ordem decrescente; empate fica com quem veio antes).
            let mut novo = (v, jy, jx);
            for m in melhores.iter_mut().take(quantos) {
                if novo.0 > m.0 {
                    std::mem::swap(m, &mut novo);
                }
            }
            if quantos < CAIXAS_POR_ESCALA {
                if let Some(m) = melhores.get_mut(quantos) {
                    *m = novo;
                }
                quantos += 1;
            }
            if quantos == CAIXAS_POR_ESCALA {
                corte = melhores[CAIXAS_POR_ESCALA - 1].0;
            }
        }
    }
    let (wf, hf) = (q.w as f32, q.h as f32);
    for (v, jy, jx) in melhores.iter().take(quantos) {
        let tx = x0 + ((*jx + 1) as f64 * caixa) as f32;
        let ty = y0 + ((*jy + 1) as f64 * caixa) as f32;
        let mut na_tela = 0usize;
        for (x, y) in p.xs.iter().zip(&p.ys) {
            let (qx, qy) = (s32 * *x + tx, s32 * *y + ty);
            if qx > 0.0 && qx < wf && qy > 0.0 && qy < hf {
                na_tela += 1;
            }
        }
        let acaso = c.xs.len() as f64 * na_tela as f64 * (2.0 * caixa) * (2.0 * caixa) / (q.w as f64 * q.h as f64);
        saida.push(Voto { nota: (*v as f64 - acaso) / (acaso + 1.0).sqrt(), n, s, tx: tx as f64, ty: ty as f64 });
    }
}

/// Vota em todas as escalas pedidas (em até 4 fios) e devolve as caixas da maior nota pra menor.
fn votar(c: &Cands, p: &Pontos, q: Quadro, escalas: &[(u32, f64)]) -> Vec<Voto> {
    let fios = FIOS.min(std::thread::available_parallelism().map_or(1, |n| n.get())).min(escalas.len()).max(1);
    let mut votos: Vec<Voto> = Vec::new();
    if fios == 1 {
        let mut r = Rascunho::default();
        for (n, s) in escalas {
            votar_escala(c, p, q, *n, *s, &mut r, &mut votos);
        }
    } else {
        let proxima = std::sync::atomic::AtomicUsize::new(0);
        let proxima = &proxima;
        // O trabalho de um fio: pega a próxima escala da fila até acabar.
        let consumir = move || {
            let mut r = Rascunho::default();
            let mut meus = Vec::new();
            // As escalas maiores (grade maior) primeiro, pra alocar uma vez só.
            loop {
                let k = proxima.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let Some((n, s)) = escalas.len().checked_sub(k + 1).and_then(|i| escalas.get(i)) else {
                    break;
                };
                votar_escala(c, p, q, *n, *s, &mut r, &mut meus);
            }
            meus
        };
        let partes: Vec<Vec<Voto>> = std::thread::scope(|e| {
            // Este fio também trabalha. Fio a mais que o sistema não abrir não faz falta: as
            // escalas dele ficam pra quem existir.
            let extras: Vec<_> = (1..fios).filter_map(|_| crate::abrir_fio(e, consumir)).collect();
            let mut partes = vec![consumir()];
            partes.extend(extras.into_iter().map(|f| f.join().unwrap_or_default()));
            partes
        });
        for parte in partes {
            votos.extend(parte);
        }
    }
    // Do maior pro menor, como a ordenação de tuplas (nota, s, tx, ty) do protótipo.
    votos.sort_by(|a, b| {
        b.nota.total_cmp(&a.nota).then(b.s.total_cmp(&a.s)).then(b.tx.total_cmp(&a.tx)).then(b.ty.total_cmp(&a.ty))
    });
    votos
}

/// Pra cada centro, o nó mais perto (se estiver a menos de `tol` pontos). Pares (centro, nó).
fn casar(c: &Cands, p: &Pontos, s: f64, tx: f64, ty: f64, tol: f64, pares: &mut Vec<(u32, u32)>) {
    pares.clear();
    let (s32, tx32, ty32) = (s as f32, tx as f32, ty as f32);
    let tol2 = (tol * tol) as f32;
    let raio = tol / s * 1.05 + 2.0;
    for (i, (cx, cy)) in c.xs.iter().zip(&c.ys).enumerate() {
        let mut melhor: Option<(f32, usize)> = None;
        p.perto((*cx as f64 - tx) / s, (*cy as f64 - ty) / s, raio, |j| {
            let (mx, my) = p.ponto(j);
            let (dx, dy) = (*cx - (s32 * mx + tx32), *cy - (s32 * my + ty32));
            let d2 = dx * dx + dy * dy;
            // O mais perto; no empate, o de menor posição (como o `argmin`).
            if melhor.is_none_or(|(m, k)| d2 < m || (d2 == m && j < k)) {
                melhor = Some((d2, j));
            }
        });
        if let Some((d2, j)) = melhor {
            if d2 < tol2 {
                pares.push((i as u32, j as u32));
            }
        }
    }
}

/// Soma em 32 bits na mesma ordem do `numpy` (soma aos pares), pra média sair idêntica.
fn soma_aos_pares(a: &[f32]) -> f32 {
    let n = a.len();
    if n < 8 {
        let mut r = 0.0f32;
        for v in a {
            r += *v;
        }
        return r;
    }
    if n <= 128 {
        let mut r = [0.0f32; 8];
        let (blocos, resto) = a.as_chunks::<8>();
        let mut blocos = blocos.iter();
        if let Some(b) = blocos.next() {
            r = *b;
        }
        for b in blocos {
            for (x, y) in r.iter_mut().zip(b) {
                *x += *y;
            }
        }
        let mut res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
        for v in resto {
            res += *v;
        }
        return res;
    }
    let mut meio = n / 2;
    meio -= meio % 8;
    let (a, b) = a.split_at(meio);
    soma_aos_pares(a) + soma_aos_pares(b)
}

/// Média em 32 bits como a do `numpy`.
fn media32(a: &[f32]) -> f32 {
    (0.0f32 + soma_aos_pares(a)) / a.len() as f32
}

/// Voto fino: entre os pares a menos de 12 pontos (em 1080p) do deslocamento grosso, o
/// deslocamento mais votado, de 1 em 1 ponto.
fn afinar(c: &Cands, p: &Pontos, q: Quadro, s: f64, tx: f64, ty: f64, hist: &mut Vec<u32>) -> (f64, f64) {
    let alc = ALCANCE_FINO * q.f;
    let alc32 = alc as f32;
    let n = (2.0 * alc) as usize + 1;
    if n > 4096 {
        return (tx, ty);
    }
    let (s32, tx32, ty32) = (s as f32, tx as f32, ty as f32);
    let (x_max, y_max) = ((q.w as f64 + alc) as f32, (q.h as f64 + alc) as f32);
    hist.clear();
    hist.resize(n * n, 0);
    let mut algum = false;
    let raio = alc / s * 1.05 + 2.0;
    for (cx, cy) in c.xs.iter().zip(&c.ys) {
        p.perto((*cx as f64 - tx) / s, (*cy as f64 - ty) / s, raio, |j| {
            let (mx, my) = p.ponto(j);
            let (qx, qy) = (s32 * mx + tx32, s32 * my + ty32);
            if !(qx > -alc32 && qx < x_max && qy > -alc32 && qy < y_max) {
                return;
            }
            let (dx, dy) = (*cx - qx, *cy - qy);
            if dx.abs() <= alc32 && dy.abs() <= alc32 {
                algum = true;
                let ix = rint((dx + alc32) as f64) as usize;
                let iy = rint((dy + alc32) as f64) as usize;
                // Como no protótipo: o que cai além do fim da grade é cortado.
                if let Some(v) = hist.get_mut(iy * n + ix) {
                    *v += 1;
                }
            }
        });
    }
    if !algum {
        return (tx, ty);
    }
    // Soma numa janela 3 x 3 (5 x 5 em telas maiores), repetindo a borda; fica o primeiro máximo.
    let k = if q.f < 1.17 { 1usize } else { 2 };
    let (mut melhor, mut jx, mut jy) = (0u32, 0usize, 0usize);
    let mut primeiro = true;
    for y in 0..n {
        for x in 0..n {
            let mut soma = 0u32;
            for dy in 0..=2 * k {
                let yy = (y + dy).saturating_sub(k).min(n - 1);
                for dx in 0..=2 * k {
                    let xx = (x + dx).saturating_sub(k).min(n - 1);
                    soma += hist.get(yy * n + xx).copied().unwrap_or(0);
                }
            }
            if primeiro || soma > melhor {
                (melhor, jx, jy) = (soma, x, y);
                primeiro = false;
            }
        }
    }
    (tx + jx as f64 - alc, ty + jy as f64 - alc)
}

/// Quantos nós caem na foto, com `tol` pontos de folga (o `dentro` do protótipo).
fn dentro(p: &Pontos, q: Quadro, s: f64, tx: f64, ty: f64, tol: f64) -> usize {
    let (s32, tx32, ty32, tol32) = (s as f32, tx as f32, ty as f32, tol as f32);
    let (x_max, y_max) = ((q.w as f64 + tol) as f32, (q.h as f64 + tol) as f32);
    p.xs.iter()
        .zip(&p.ys)
        .filter(|(x, y)| {
            let (qx, qy) = (s32 * **x + tx32, s32 * **y + ty32);
            qx > -tol32 && qx < x_max && qy > -tol32 && qy < y_max
        })
        .count()
}

/// Rascunhos do ajuste fino, reaproveitados de uma hipótese pra outra.
#[derive(Default)]
struct Ajuste {
    hist: Vec<u32>,
    pares: Vec<(u32, u32)>,
    dx: Vec<f32>,
    dy: Vec<f32>,
}

/// Escala presa: voto fino e depois a média dos pares (só o deslocamento é ajustado).
/// Devolve (tx, ty, nota).
fn refinar(c: &Cands, p: &Pontos, q: Quadro, s: f64, tx: f64, ty: f64, a: &mut Ajuste) -> (f64, f64, f64) {
    let (mut tx, mut ty) = afinar(c, p, q, s, tx, ty, &mut a.hist);
    let s32 = s as f32;
    for tol in RODADAS {
        casar(c, p, s, tx, ty, tol * q.f, &mut a.pares);
        if a.pares.len() < PARES_MINIMOS {
            break;
        }
        a.dx.clear();
        a.dy.clear();
        for (i, j) in &a.pares {
            let (mx, my) = p.ponto(*j as usize);
            if let (Some(cx), Some(cy)) = (c.xs.get(*i as usize), c.ys.get(*i as usize)) {
                a.dx.push(*cx - s32 * mx);
                a.dy.push(*cy - s32 * my);
            }
        }
        if a.dx.is_empty() {
            break;
        }
        tx = media32(&a.dx) as f64;
        ty = media32(&a.dy) as f64;
    }
    let tol = TOLERANCIA_FINAL * q.f;
    casar(c, p, s, tx, ty, tol, &mut a.pares);
    let acaso = c.xs.len() as f64 * dentro(p, q, s, tx, ty, tol) as f64 * std::f64::consts::PI * tol * tol
        / (q.w as f64 * q.h as f64);
    (tx, ty, a.pares.len() as f64 - acaso)
}

/// A regra de aceitação do protótipo (`aceita`), com a nota arredondada a uma casa como lá.
pub(crate) fn aceita(nota: f64, bons: u32, total: u32, deslocados: u32) -> bool {
    let nota = rint(nota * 10.0) / 10.0;
    let t = total.max(1) as f64;
    let (fr, fd) = (bons as f64 / t, deslocados as f64 / t);
    nota >= NOTA_MINIMA
        && ((bons >= A_BONS && fr >= A_FRACAO && fr - fd >= A_FOLGA)
            || (bons >= B_BONS && fr >= B_FRACAO && fr - fd >= B_FOLGA))
}

/// O `registrar` público. Ver a descrição em `lib.rs`.
pub(crate) fn registrar(foto: &Foto, arvore: &Arvore, so_este_zoom: Option<u32>) -> Option<Registro> {
    let tela = Tela::de(foto)?;
    if tela.w < LADO_MINIMO || tela.h < LADO_MINIMO {
        return None;
    }
    if so_este_zoom.is_some_and(|n| !(N_MIN..=N_MAX).contains(&n)) {
        return None;
    }
    let pontos = Pontos::de(arvore)?;
    // Foto alta demais: procura na metade (média de 2 x 2) e devolve o encaixe na escala cheia.
    let metade = tela.h > ALTURA_PRA_REDUZIR;
    let fonte = if metade { Fonte::Metade(tela) } else { Fonte::Cheia(tela) };
    let q = Quadro { w: fonte.largura(), h: fonte.altura(), f: fonte.altura() as f64 / 1080.0 };
    let divisor = if metade { 2.0 * DIVISOR_DA_ESCALA } else { DIVISOR_DA_ESCALA };

    let fios = FIOS.min(std::thread::available_parallelism().map_or(1, |n| n.get()));
    let achados: Vec<Centro> = centros(&fonte, q.f, fios);
    if achados.is_empty() {
        return None;
    }
    let c = Cands { xs: achados.iter().map(|c| c.x).collect(), ys: achados.iter().map(|c| c.y).collect() };

    let escala = |n: u32| n as f64 * tela.h as f64 / divisor;
    let escalas: Vec<(u32, f64)> = match so_este_zoom {
        Some(n) => vec![(n, escala(n))],
        None => (N_MIN..=N_MAX).map(|n| (n, escala(n))).collect(),
    };
    let votos = votar(&c, &pontos, q, &escalas);

    // As hipóteses, da mais votada pra menos; repetida (mesma escala, quase o mesmo lugar) não conta.
    let perto = MESMA_HIPOTESE * q.f;
    let mut vistas: Vec<(u32, f64, f64)> = Vec::new();
    let mut melhor: Option<(f64, u32, f64, f64, f64)> = None;
    let mut ajuste = Ajuste::default();
    for v in &votos {
        let repetida =
            |tx: f64, ty: f64, vistas: &[(u32, f64, f64)]| vistas.iter().any(|x| x.0 == v.n && (tx - x.1).abs() < perto && (ty - x.2).abs() < perto);
        if repetida(v.tx, v.ty, &vistas) {
            continue;
        }
        let (tx, ty, nota) = refinar(&c, &pontos, q, v.s, v.tx, v.ty, &mut ajuste);
        if repetida(tx, ty, &vistas) {
            continue;
        }
        vistas.push((v.n, tx, ty));
        if melhor.is_none_or(|m| nota > m.0) {
            melhor = Some((nota, v.n, v.s, tx, ty));
        }
        if vistas.len() >= HIPOTESES {
            break;
        }
    }
    let (nota, n, s, tx, ty) = melhor?;
    if !(nota.is_finite() && tx.is_finite() && ty.is_finite()) {
        return None;
    }

    // De volta à foto cheia: o ponto i da metade é a média dos pontos 2i e 2i + 1 (centro em 2i + 0,5).
    let (s, tx, ty) = if metade { (2.0 * s, 2.0 * tx + 0.5, 2.0 * ty + 0.5) } else { (s, tx, ty) };
    let (bons, total) = aneis::contar(&tela, arvore, s, tx, ty, &[], false);
    let d = DESLOCAMENTO_DO_CONTROLE * s;
    let mut deslocados = 0;
    for (ax, ay) in [(d, 0.0), (-d, 0.0), (0.0, d), (0.0, -d)] {
        deslocados = deslocados.max(aneis::contar(&tela, arvore, s, tx + ax, ty + ay, &[], false).0);
    }
    Some(Registro {
        encaixe: Encaixe { n, s: s as f32, tx: tx as f32, ty: ty as f32 },
        nota: nota as f32,
        bons,
        total,
        deslocados,
        aceito: aceita(nota, bons, total, deslocados),
    })
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn regra_de_aceitacao() {
        assert!(aceita(20.0, 40, 100, 5));
        assert!(!aceita(7.9, 40, 100, 5));
        assert!(aceita(7.96, 40, 100, 5));
        assert!(!aceita(20.0, 14, 60, 0));
        assert!(aceita(10.8, 21, 29, 2));
        assert!(!aceita(20.0, 30, 100, 25));
        assert!(!aceita(20.0, 0, 0, 0));
    }

    /// Se o sistema recusar abrir fios, este fio vota todas as escalas e o resultado é o mesmo.
    #[test]
    fn votar_sem_conseguir_abrir_fios_da_o_mesmo() {
        let n = 300;
        let xs: Vec<f32> = (0..n).map(|i| ((i * 7919) % 20011) as f32 - 10000.0).collect();
        let ys: Vec<f32> = (0..n).map(|i| ((i * 104729) % 20021) as f32 - 10000.0).collect();
        let a = Arvore::nova((0..n as u32).collect(), xs.clone(), ys.clone(), vec![0; n], &[]).unwrap();
        let p = Pontos::de(&a).unwrap();
        let q = Quadro { w: 1920, h: 1080, f: 1.0 };
        // Os centros são os nós vistos na escala 14, com o meio da árvore em (960, 540).
        let s = 14.0 * 1080.0 / DIVISOR_DA_ESCALA;
        let c = Cands {
            xs: xs.iter().map(|x| s as f32 * *x + 960.0).collect(),
            ys: ys.iter().map(|y| s as f32 * *y + 540.0).collect(),
        };
        let escalas: Vec<(u32, f64)> = (10..=18).map(|n| (n, n as f64 * 1080.0 / DIVISOR_DA_ESCALA)).collect();
        let lista = |v: Vec<Voto>| v.iter().map(|v| (v.nota, v.n, v.s, v.tx, v.ty)).collect::<Vec<_>>();
        let normal = lista(votar(&c, &p, q, &escalas));
        let (sem_fios, recusas) = crate::fios_recusados::com_recusa(|| lista(votar(&c, &p, q, &escalas)));
        let fios = FIOS.min(std::thread::available_parallelism().map_or(1, |n| n.get()));
        assert_eq!(recusas, fios - 1);
        assert_eq!(normal.len(), escalas.len() * CAIXAS_POR_ESCALA);
        assert_eq!(normal.first().map(|v| v.1), Some(14));
        assert_eq!(normal, sem_fios);
    }

    #[test]
    fn soma_como_o_numpy() {
        let v: Vec<f32> = (0..300).map(|i| (i as f32 * 0.37).sin() * 3.0 - 4321.7).collect();
        for n in [0, 1, 7, 8, 9, 127, 128, 129, 300] {
            let exata: f64 = v[..n].iter().map(|x| *x as f64).sum();
            assert!((soma_aos_pares(&v[..n]) as f64 - exata).abs() <= 0.5 * (n as f64 + 1.0));
        }
        assert_eq!(soma_aos_pares(&[1.0, 2.0, 3.0]), 6.0);
    }

    #[test]
    fn grade_acha_os_vizinhos() {
        let n = 400;
        let xs: Vec<f32> = (0..n).map(|i| ((i * 7919) % 20011) as f32 - 10000.0).collect();
        let ys: Vec<f32> = (0..n).map(|i| ((i * 104729) % 20021) as f32 - 10000.0).collect();
        let a = Arvore::nova((0..n as u32).collect(), xs.clone(), ys.clone(), vec![0; n], &[]).unwrap();
        let p = Pontos::de(&a).unwrap();
        for k in 0..50 {
            let (mx, my) = (xs[k * 7] as f64 + 13.0, ys[k * 7] as f64 - 9.0);
            let mut achados = Vec::new();
            p.perto(mx, my, 300.0, |j| achados.push(j));
            for j in 0..n {
                let d = ((xs[j] as f64 - mx).powi(2) + (ys[j] as f64 - my).powi(2)).sqrt();
                if d <= 300.0 {
                    assert!(achados.contains(&j));
                }
            }
        }
    }
}
