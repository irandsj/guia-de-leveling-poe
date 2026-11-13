//! Acesso à foto: cinza de um ponto e amostra entre pontos.
//!
//! O que isto faz, e só isto: lê bytes de uma foto que já está na memória. Não tira foto, não
//! fala com o Windows e não manda nada pra lugar nenhum.

use crate::Foto;

/// Pesos do cinza (ITU-R BT.601), os mesmos do protótipo: `0.299 R + 0.587 G + 0.114 B`.
pub(crate) const PESO_R: f32 = 0.299;
pub(crate) const PESO_G: f32 = 0.587;
pub(crate) const PESO_B: f32 = 0.114;

/// Maior lado aceito numa foto. Só uma trava contra tamanho absurdo (nenhuma tela chega perto).
pub(crate) const LADO_MAXIMO: usize = 16384;

/// Número de ângulos em que cada anel é amostrado (protótipo: `N_ANG = 24`).
pub(crate) const ANGULOS: usize = 24;

/// Foto já conferida: tem pelo menos 2 x 2 pontos e o buffer cobre todos eles.
#[derive(Clone, Copy)]
pub(crate) struct Tela<'a> {
    pub w: usize,
    pub h: usize,
    px: &'a [u8],
}

impl<'a> Tela<'a> {
    /// `None` se a foto for pequena demais, grande demais ou se o buffer for curto.
    pub fn de(foto: &Foto<'a>) -> Option<Tela<'a>> {
        let (w, h) = (foto.largura, foto.altura);
        if w < 2 || h < 2 || w > LADO_MAXIMO || h > LADO_MAXIMO {
            return None;
        }
        let bytes = w.checked_mul(h)?.checked_mul(4)?;
        let px = foto.bgrx.get(..bytes)?;
        Some(Tela { w, h, px })
    }

    /// Os bytes de uma linha (4 por ponto). Vazio se a linha não existe.
    #[inline]
    pub fn linha(&self, y: usize) -> &'a [u8] {
        let ini = y.saturating_mul(self.w * 4);
        self.px.get(ini..ini.saturating_add(self.w * 4)).unwrap_or(&[])
    }

    /// (R, G, B) de um ponto. Preto se o ponto não existe.
    #[inline]
    pub fn rgb(&self, x: usize, y: usize) -> [f32; 3] {
        if x >= self.w {
            return [0.0; 3];
        }
        let i = y.saturating_mul(self.w).saturating_add(x).saturating_mul(4);
        match self.px.get(i..i.saturating_add(3)) {
            Some([b, g, r]) => [*r as f32, *g as f32, *b as f32],
            _ => [0.0; 3],
        }
    }

    /// Cinza de um ponto, na mesma conta (e na mesma precisão) do protótipo.
    #[inline]
    pub fn cinza(&self, x: usize, y: usize) -> f32 {
        let [r, g, b] = self.rgb(x, y);
        PESO_R * r + PESO_G * g + PESO_B * b
    }

    /// Canto de cima à esquerda e frações da amostra bilinear. Fora da foto, gruda na borda
    /// (como o `np.clip` do protótipo).
    #[inline]
    fn canto(&self, x: f64, y: f64) -> (usize, usize, f64, f64) {
        let x0 = x.floor().clamp(0.0, (self.w - 2) as f64);
        let y0 = y.floor().clamp(0.0, (self.h - 2) as f64);
        // `as usize` de um número que não é número dá 0: não quebra.
        (x0 as usize, y0 as usize, x - x0, y - y0)
    }

    /// Cinza entre pontos (bilinear).
    #[inline]
    pub fn amostra_cinza(&self, x: f64, y: f64) -> f64 {
        let (x0, y0, fx, fy) = self.canto(x, y);
        let a = self.cinza(x0, y0) as f64;
        let b = self.cinza(x0 + 1, y0) as f64;
        let c = self.cinza(x0, y0 + 1) as f64;
        let d = self.cinza(x0 + 1, y0 + 1) as f64;
        (a * (1.0 - fx) + b * fx) * (1.0 - fy) + (c * (1.0 - fx) + d * fx) * fy
    }

    /// Cor (R, G, B) entre pontos (bilinear).
    #[inline]
    pub fn amostra_rgb(&self, x: f64, y: f64) -> [f64; 3] {
        let (x0, y0, fx, fy) = self.canto(x, y);
        let a = self.rgb(x0, y0);
        let b = self.rgb(x0 + 1, y0);
        let c = self.rgb(x0, y0 + 1);
        let d = self.rgb(x0 + 1, y0 + 1);
        let mut v = [0.0f64; 3];
        for (k, saida) in v.iter_mut().enumerate() {
            *saida = (a[k] as f64 * (1.0 - fx) + b[k] as f64 * fx) * (1.0 - fy)
                + (c[k] as f64 * (1.0 - fx) + d[k] as f64 * fx) * fy;
        }
        v
    }
}

/// Cosseno e seno dos 24 ângulos de amostra (0, 15, 30… graus).
pub(crate) fn direcoes() -> [(f64, f64); ANGULOS] {
    let mut d = [(0.0, 0.0); ANGULOS];
    let passo = 2.0 * std::f64::consts::PI / ANGULOS as f64;
    for (k, v) in d.iter_mut().enumerate() {
        let a = k as f64 * passo;
        *v = (a.cos(), a.sin());
    }
    d
}

/// Mediana de 24 valores (média dos dois do meio, como o `np.median`). Embaralha a entrada.
#[inline]
pub(crate) fn mediana(v: &mut [f64; ANGULOS]) -> f64 {
    v.sort_unstable_by(f64::total_cmp);
    0.5 * (v[ANGULOS / 2 - 1] + v[ANGULOS / 2])
}

/// Arredonda pro inteiro mais perto, empate pro par (o `np.rint`). Vale pra |v| < 2^51.
#[inline]
pub(crate) fn rint(v: f64) -> f64 {
    /// 1,5 x 2^52: somar e tirar deixa o processador arredondar no modo padrão (empate pro par).
    const MAGICO: f64 = 6755399441055744.0;
    (v + MAGICO) - MAGICO
}
