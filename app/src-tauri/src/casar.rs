//! Acha o ícone de uma gema numa foto da tela.
//!
//! Só contas: não fala com o Windows nem com o jogo, então dá pra testar com fotos guardadas.
//!
//! O método é correlação normalizada (ZNCC) só nos pontos opacos do ícone. Primeiro uma
//! passada grossa, em cinza e com a foto reduzida; depois uma fina, em cores e no tamanho
//! real, em volta dos melhores lugares da grossa. A nota vai de -1 a 1; ícone certo no
//! tamanho certo dá perto de 0,9, e ícone errado fica abaixo de 0,7.
//!
//! Na janela de recompensa o jogo desenha um selo "!" no canto de cima à direita de cada gema.
//! Lá, os pontos do ícone embaixo do selo ficam de fora da conta. Sem isso, gema com desenho
//! naquele canto (como a Kinetic Bolt) cai pra perto do limiar. Na loja não tem selo.

/// Nota mínima pra dizer "é esta gema".
pub const LIMIAR: f32 = 0.78;
/// Selo "!" da recompensa, em frações do lado do ícone: centro e raio (com folga).
/// Medido num print de 2000x1125: raio de uns 11 pontos num ícone de 62, centro em (0,78; 0,20).
const SELO_X: f32 = 0.78;
const SELO_Y: f32 = 0.20;
const SELO_RAIO: f32 = 0.22;
/// Nota mínima na passada grossa pra valer a pena olhar de perto.
const LIMIAR_GROSSO: f32 = 0.45;
/// Quantos lugares da passada grossa são olhados de perto.
const CANDIDATOS: usize = 4;
/// O ícone reduzido da passada grossa fica com mais ou menos este lado, em pixels.
const LADO_GROSSO: usize = 20;
/// Ponto do ícone conta quando é opaco de verdade (fora da borda meio transparente).
const ALFA_MINIMO: f32 = 128.0;

/// Foto da tela (ou de um pedaço dela), 3 bytes por ponto: vermelho, verde, azul.
pub struct Foto {
    pub largura: usize,
    pub altura: usize,
    pub rgb: Vec<u8>,
}

/// Onde o ícone aparece na tela.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Lugar {
    /// Janela de recompensa da quest: com selo "!" no canto de cima à direita.
    Recompensa,
    /// Loja do vendedor: foto como veio.
    Loja,
}

/// O ponto (x, y) de um ícone de lado `lado` fica embaixo do selo "!" da recompensa?
fn embaixo_do_selo(x: usize, y: usize, lado: usize) -> bool {
    let (cx, cy, raio) = (SELO_X * lado as f32, SELO_Y * lado as f32, SELO_RAIO * lado as f32);
    let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
    dx * dx + dy * dy <= raio * raio
}

/// Ícone quadrado com transparência, 4 bytes por ponto.
#[derive(Clone)]
pub struct Icone {
    pub lado: usize,
    pub rgba: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Achado {
    /// Canto de cima à esquerda, em pontos da foto.
    pub x: usize,
    pub y: usize,
    pub lado: usize,
    pub nota: f32,
}

impl Icone {
    pub fn novo(lado: usize, rgba: Vec<u8>) -> Option<Icone> {
        (lado >= 8 && rgba.len() == lado * lado * 4).then_some(Icone { lado, rgba })
    }

    /// O mesmo ícone em outro tamanho (média por área, com a cor pesada pela opacidade).
    pub fn redimensionado(&self, lado: usize) -> Icone {
        if lado == self.lado {
            return self.clone();
        }
        let origem = self.lado as f32;
        let passo = origem / lado as f32;
        let mut rgba = vec![0u8; lado * lado * 4];
        for y in 0..lado {
            let (y0, y1) = (y as f32 * passo, (y + 1) as f32 * passo);
            for x in 0..lado {
                let (x0, x1) = (x as f32 * passo, (x + 1) as f32 * passo);
                let mut soma = [0f32; 4];
                let mut area = 0f32;
                let mut sy = y0.floor() as usize;
                while (sy as f32) < y1 && sy < self.lado {
                    let peso_y = (y1.min(sy as f32 + 1.0) - y0.max(sy as f32)).max(0.0);
                    let mut sx = x0.floor() as usize;
                    while (sx as f32) < x1 && sx < self.lado {
                        let peso = peso_y * (x1.min(sx as f32 + 1.0) - x0.max(sx as f32)).max(0.0);
                        let p = &self.rgba[(sy * self.lado + sx) * 4..][..4];
                        let alfa = p[3] as f32 * peso;
                        soma[0] += p[0] as f32 * alfa;
                        soma[1] += p[1] as f32 * alfa;
                        soma[2] += p[2] as f32 * alfa;
                        soma[3] += alfa;
                        area += peso;
                        sx += 1;
                    }
                    sy += 1;
                }
                let destino = &mut rgba[(y * lado + x) * 4..][..4];
                if soma[3] > 0.0 && area > 0.0 {
                    destino[0] = (soma[0] / soma[3]).round() as u8;
                    destino[1] = (soma[1] / soma[3]).round() as u8;
                    destino[2] = (soma[2] / soma[3]).round() as u8;
                    destino[3] = (soma[3] / area).round() as u8;
                }
            }
        }
        Icone { lado, rgba }
    }
}

/// A foto em cinza e reduzida `fator` vezes (média de cada bloco).
pub struct FotoGrossa {
    pub fator: usize,
    largura: usize,
    altura: usize,
    cinza: Vec<f32>,
}

impl FotoGrossa {
    pub fn nova(foto: &Foto, fator: usize) -> FotoGrossa {
        let fator = fator.max(1);
        let largura = foto.largura / fator;
        let altura = foto.altura / fator;
        let mut cinza = vec![0f32; largura * altura];
        let divisor = (fator * fator * 3) as f32;
        for y in 0..altura {
            for x in 0..largura {
                let mut soma = 0u32;
                for dy in 0..fator {
                    let linha = ((y * fator + dy) * foto.largura + x * fator) * 3;
                    for v in &foto.rgb[linha..linha + fator * 3] {
                        soma += *v as u32;
                    }
                }
                cinza[y * largura + x] = soma as f32 / divisor;
            }
        }
        FotoGrossa { fator, largura, altura, cinza }
    }
}

/// Em quantas vezes reduzir a foto pra procurar um ícone deste tamanho.
pub fn fator_pro_lado(lado: usize) -> usize {
    (lado / LADO_GROSSO).max(1)
}

/// O ícone pronto pra comparar: só os pontos opacos, já com a média tirada.
struct Molde {
    lado: usize,
    /// Posição do ponto dentro do quadrado (y * lado + x).
    pontos: Vec<u32>,
    /// Um valor por ponto (cinza) ou três (cores), com média zero.
    valores: Vec<f32>,
    canais: usize,
    norma: f32,
}

impl Molde {
    fn novo(icone: &Icone, em_cores: bool, lugar: Lugar) -> Option<Molde> {
        let canais = if em_cores { 3 } else { 1 };
        let lado = icone.lado;
        let mut pontos = Vec::new();
        let mut valores = Vec::new();
        for (i, p) in icone.rgba.chunks_exact(4).enumerate() {
            if (p[3] as f32) < ALFA_MINIMO {
                continue;
            }
            if lugar == Lugar::Recompensa && embaixo_do_selo(i % lado, i / lado, lado) {
                continue;
            }
            pontos.push(i as u32);
            if em_cores {
                valores.extend([p[0] as f32, p[1] as f32, p[2] as f32]);
            } else {
                valores.push((p[0] as f32 + p[1] as f32 + p[2] as f32) / 3.0);
            }
        }
        if pontos.len() < 30 {
            return None;
        }
        let media = valores.iter().sum::<f32>() / valores.len() as f32;
        let mut norma = 0f32;
        for v in &mut valores {
            *v -= media;
            norma += *v * *v;
        }
        let norma = norma.sqrt();
        (norma > 1.0).then_some(Molde { lado: icone.lado, pontos, valores, canais, norma })
    }

    fn nota(&self, soma: f32, quadrados: f32, cruzado: f32) -> f32 {
        let n = self.valores.len() as f32;
        let variancia = quadrados - soma * soma / n;
        // Lugar liso (uma cor só) não se parece com ícone nenhum.
        if variancia < n * 4.0 {
            return -1.0;
        }
        cruzado / (variancia.sqrt() * self.norma)
    }

    /// Quantos pontos cada ponto do molde fica depois do canto, numa foto desta largura. A conta
    /// (com uma divisão) é feita uma vez por procura, não uma vez por lugar olhado.
    fn deslocamentos(&self, largura: usize) -> Vec<usize> {
        let lado = self.lado;
        self.pontos.iter().map(|&p| (p as usize / lado) * largura + p as usize % lado).collect()
    }

    /// `deslocamentos` é `self.deslocamentos(foto.largura)`.
    fn nota_no_cinza(&self, foto: &FotoGrossa, deslocamentos: &[usize], x: usize, y: usize) -> f32 {
        let (mut soma, mut quadrados, mut cruzado) = (0f32, 0f32, 0f32);
        let base = y * foto.largura + x;
        for (desloca, valor) in deslocamentos.iter().zip(&self.valores) {
            let v = foto.cinza[base + desloca];
            soma += v;
            quadrados += v * v;
            cruzado += v * valor;
        }
        self.nota(soma, quadrados, cruzado)
    }

    /// `deslocamentos` é `self.deslocamentos(foto.largura)`.
    fn nota_nas_cores(&self, foto: &Foto, deslocamentos: &[usize], x: usize, y: usize) -> f32 {
        debug_assert_eq!(self.canais, 3);
        let (mut soma, mut quadrados, mut cruzado) = (0f32, 0f32, 0f32);
        let base = y * foto.largura + x;
        for (desloca, valor) in deslocamentos.iter().zip(self.valores.chunks_exact(3)) {
            let i = (base + desloca) * 3;
            for c in 0..3 {
                let v = foto.rgb[i + c] as f32;
                soma += v;
                quadrados += v * v;
                cruzado += v * valor[c];
            }
        }
        self.nota(soma, quadrados, cruzado)
    }
}

/// Os melhores lugares da passada grossa, em pontos da foto reduzida, sem vizinhos repetidos.
fn passada_grossa(foto: &FotoGrossa, molde: &Molde) -> Vec<(usize, usize, f32)> {
    let mut melhores: Vec<(usize, usize, f32)> = Vec::new();
    if foto.largura < molde.lado || foto.altura < molde.lado {
        return melhores;
    }
    let perto = (molde.lado / 2).max(2);
    let deslocamentos = molde.deslocamentos(foto.largura);
    for y in 0..=foto.altura - molde.lado {
        for x in 0..=foto.largura - molde.lado {
            let nota = molde.nota_no_cinza(foto, &deslocamentos, x, y);
            if nota < LIMIAR_GROSSO {
                continue;
            }
            if let Some(vizinho) = melhores
                .iter_mut()
                .find(|m| m.0.abs_diff(x) < perto && m.1.abs_diff(y) < perto)
            {
                if nota > vizinho.2 {
                    *vizinho = (x, y, nota);
                }
                continue;
            }
            if melhores.len() < CANDIDATOS {
                melhores.push((x, y, nota));
            } else if let Some(pior) = melhores.iter_mut().min_by(|a, b| a.2.total_cmp(&b.2)) {
                if nota > pior.2 {
                    *pior = (x, y, nota);
                }
            }
        }
    }
    melhores
}

/// O melhor lugar num quadrado de busca da foto inteira.
fn melhor_na_vizinhanca(
    foto: &Foto,
    molde: &Molde,
    centro: (usize, usize),
    raio: usize,
    passo: usize,
) -> Option<Achado> {
    if foto.largura < molde.lado || foto.altura < molde.lado {
        return None;
    }
    let (x_max, y_max) = (foto.largura - molde.lado, foto.altura - molde.lado);
    let deslocamentos = molde.deslocamentos(foto.largura);
    let mut melhor: Option<Achado> = None;
    let mut y = centro.1.saturating_sub(raio);
    while y <= (centro.1 + raio).min(y_max) {
        let mut x = centro.0.saturating_sub(raio);
        while x <= (centro.0 + raio).min(x_max) {
            let nota = molde.nota_nas_cores(foto, &deslocamentos, x, y);
            if melhor.map_or(true, |m| nota > m.nota) {
                melhor = Some(Achado { x, y, lado: molde.lado, nota });
            }
            x += passo;
        }
        y += passo;
    }
    melhor
}

/// O ícone pronto pra conferir num lugar já sabido (uma casa do inventário), sem passada grossa:
/// em cores, no tamanho esperado e um ponto maior e menor.
pub(crate) struct MoldeFixo {
    /// O do tamanho esperado primeiro.
    moldes: Vec<Molde>,
}

impl MoldeFixo {
    pub(crate) fn novo(icone: &Icone, lado: usize, lugar: Lugar) -> Option<MoldeFixo> {
        let lado = lado.max(9);
        let molde = |l: usize| Molde::novo(&icone.redimensionado(l), true, lugar);
        let mut moldes = vec![molde(lado)?];
        moldes.extend([lado - 1, lado + 1].into_iter().filter_map(molde));
        Some(MoldeFixo { moldes })
    }

    /// A melhor nota do ícone com o canto até uns `raio` pontos de `canto` (passe ou não do limiar).
    pub(crate) fn nota_em_volta(&self, foto: &Foto, canto: (usize, usize), raio: usize) -> f32 {
        let principal = &self.moldes[0];
        // 1. No tamanho esperado, de 2 em 2 pontos.
        let Some(perto) = melhor_na_vizinhanca(foto, principal, canto, raio, 2) else {
            return -1.0;
        };
        // 2. Ponto a ponto em volta do melhor, nos três tamanhos.
        let mut melhor = perto.nota;
        for molde in &self.moldes {
            let diferenca = molde.lado as i32 - principal.lado as i32;
            let perto_daqui = (
                (perto.x as i32 - diferenca / 2).max(0) as usize,
                (perto.y as i32 - diferenca / 2).max(0) as usize,
            );
            if let Some(a) = melhor_na_vizinhanca(foto, molde, perto_daqui, 1, 1) {
                melhor = melhor.max(a.nota);
            }
        }
        melhor
    }
}

/// Confere se o ícone continua no lugar em que foi achado da última vez (barato).
pub fn conferir(foto: &Foto, icone: &Icone, antes: Achado, lugar: Lugar) -> Option<Achado> {
    let molde = Molde::novo(&icone.redimensionado(antes.lado), true, lugar)?;
    melhor_na_vizinhanca(foto, &molde, (antes.x, antes.y), 1, 1).filter(|a| a.nota >= LIMIAR)
}

/// Procura o ícone na foto, num tamanho perto de `lado`. Devolve o melhor lugar se passar do limiar.
///
/// `grossa` é a foto reduzida por `fator_pro_lado(lado)`; quem chama faz uma vez e usa pra todos os ícones.
pub fn procurar(foto: &Foto, grossa: &FotoGrossa, icone: &Icone, lado: usize, lugar: Lugar) -> Option<Achado> {
    melhor_lugar(foto, grossa, icone, lado, lugar).filter(|a| a.nota >= LIMIAR)
}

/// O melhor lugar do ícone na foto, passe ou não do limiar (a prova com print mostra a nota).
pub(crate) fn melhor_lugar(foto: &Foto, grossa: &FotoGrossa, icone: &Icone, lado: usize, lugar: Lugar) -> Option<Achado> {
    let fator = grossa.fator;
    let lado_grosso = ((lado as f32 / fator as f32).round() as usize).max(8);
    let molde_grosso = Molde::novo(&icone.redimensionado(lado_grosso), false, lugar)?;
    let candidatos = passada_grossa(grossa, &molde_grosso);
    if candidatos.is_empty() {
        return None;
    }

    let molde = Molde::novo(&icone.redimensionado(lado), true, lugar)?;
    let mut melhor: Option<Achado> = None;
    for (x, y, _) in candidatos {
        // 1. No tamanho esperado, de 2 em 2 pontos, em volta do lugar da passada grossa.
        let Some(perto) = melhor_na_vizinhanca(foto, &molde, (x * fator, y * fator), fator + 2, 2) else {
            continue;
        };
        if perto.nota < LIMIAR_GROSSO {
            continue;
        }
        // 2. Ponto a ponto, e também um pouco maior e um pouco menor (a nota cai rápido com o tamanho).
        for diferenca in -2i32..=2 {
            let lado_agora = (lado as i32 + diferenca).max(8) as usize;
            let outro;
            let molde_agora = if diferenca == 0 {
                &molde
            } else {
                match Molde::novo(&icone.redimensionado(lado_agora), true, lugar) {
                    Some(m) => {
                        outro = m;
                        &outro
                    }
                    None => continue,
                }
            };
            // Tamanho diferente cresce pro lado e pra baixo: o canto anda metade da diferença.
            let canto = (
                (perto.x as i32 - diferenca / 2).max(0) as usize,
                (perto.y as i32 - diferenca / 2).max(0) as usize,
            );
            if let Some(a) = melhor_na_vizinhanca(foto, molde_agora, canto, 2, 1) {
                if melhor.map_or(true, |m| a.nota > m.nota) {
                    melhor = Some(a);
                }
            }
        }
    }
    melhor
}

#[cfg(test)]
mod testes {
    use super::*;

    /// Números "aleatórios" que se repetem a cada teste.
    struct Dado(u64);
    impl Dado {
        fn proximo(&mut self) -> u8 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (self.0 >> 33) as u8
        }
    }

    /// Ícone redondo com manchas, 78 por 78, com borda transparente.
    fn icone_de_teste(semente: u64) -> Icone {
        let lado = 78;
        let mut dado = Dado(semente);
        // Manchas grandes (blocos de 6) pra sobreviver à redução.
        let blocos: Vec<[u8; 3]> = (0..13 * 13).map(|_| [dado.proximo(), dado.proximo(), dado.proximo()]).collect();
        let mut rgba = vec![0u8; lado * lado * 4];
        for y in 0..lado {
            for x in 0..lado {
                let (dx, dy) = (x as f32 - 38.5, y as f32 - 38.5);
                if (dx * dx + dy * dy).sqrt() > 34.0 {
                    continue;
                }
                let cor = blocos[(y / 6) * 13 + x / 6];
                rgba[(y * lado + x) * 4..][..4].copy_from_slice(&[cor[0], cor[1], cor[2], 255]);
            }
        }
        Icone::novo(lado, rgba).unwrap()
    }

    fn fundo(largura: usize, altura: usize) -> Foto {
        let mut dado = Dado(7);
        let rgb = (0..largura * altura * 3).map(|_| dado.proximo() / 3 + 20).collect();
        Foto { largura, altura, rgb }
    }

    fn colar(foto: &mut Foto, icone: &Icone, x: usize, y: usize) {
        for iy in 0..icone.lado {
            for ix in 0..icone.lado {
                let p = &icone.rgba[(iy * icone.lado + ix) * 4..][..4];
                if p[3] > 128 {
                    let i = ((y + iy) * foto.largura + x + ix) * 3;
                    foto.rgb[i..i + 3].copy_from_slice(&p[..3]);
                }
            }
        }
    }

    #[test]
    fn acha_o_icone_no_lugar_e_no_tamanho_certos() {
        let icone = icone_de_teste(1);
        let mut foto = fundo(600, 400);
        colar(&mut foto, &icone.redimensionado(62), 311, 147);
        let grossa = FotoGrossa::nova(&foto, fator_pro_lado(62));
        let achado = procurar(&foto, &grossa, &icone, 62, Lugar::Loja).expect("devia achar");
        assert!(achado.x.abs_diff(311) <= 1 && achado.y.abs_diff(147) <= 1, "{achado:?}");
        assert_eq!(achado.lado, 62);
        assert!(achado.nota > 0.9, "{achado:?}");
    }

    #[test]
    fn acha_mesmo_com_o_tamanho_um_pouco_diferente_do_esperado() {
        let icone = icone_de_teste(1);
        let mut foto = fundo(600, 400);
        colar(&mut foto, &icone.redimensionado(64), 200, 90);
        let grossa = FotoGrossa::nova(&foto, fator_pro_lado(62));
        let achado = procurar(&foto, &grossa, &icone, 62, Lugar::Loja).expect("devia achar");
        assert_eq!(achado.lado, 64, "{achado:?}");
        assert!(achado.x.abs_diff(200) <= 1 && achado.y.abs_diff(90) <= 1, "{achado:?}");
    }

    #[test]
    fn nao_confunde_com_outro_icone() {
        let certo = icone_de_teste(1);
        let outro = icone_de_teste(2);
        let mut foto = fundo(600, 400);
        colar(&mut foto, &outro.redimensionado(62), 311, 147);
        let grossa = FotoGrossa::nova(&foto, fator_pro_lado(62));
        assert_eq!(procurar(&foto, &grossa, &certo, 62, Lugar::Loja), None);
    }

    #[test]
    fn conferir_ve_que_o_icone_continua_e_que_sumiu() {
        let icone = icone_de_teste(1);
        let mut foto = fundo(600, 400);
        colar(&mut foto, &icone.redimensionado(62), 311, 147);
        let grossa = FotoGrossa::nova(&foto, fator_pro_lado(62));
        let achado = procurar(&foto, &grossa, &icone, 62, Lugar::Loja).unwrap();
        assert!(conferir(&foto, &icone, achado, Lugar::Loja).is_some());
        assert!(conferir(&fundo(600, 400), &icone, achado, Lugar::Loja).is_none());
    }

    #[test]
    fn icone_de_tamanho_errado_e_recusado() {
        assert!(Icone::novo(78, vec![0; 10]).is_none());
        assert!(Icone::novo(78, vec![0; 78 * 78 * 4]).is_some());
    }

    /// Pinta um selo "!" redondo (aro laranja, miolo escuro) no canto do ícone, como a recompensa faz.
    fn pintar_selo(foto: &mut Foto, x: usize, y: usize, lado: usize) {
        let (cx, cy, raio) = (x as f32 + 0.78 * lado as f32, y as f32 + 0.20 * lado as f32, 0.17 * lado as f32);
        for py in 0..foto.altura {
            for px in 0..foto.largura {
                let d = ((px as f32 + 0.5 - cx).powi(2) + (py as f32 + 0.5 - cy).powi(2)).sqrt();
                if d <= raio {
                    let cor = if d > raio * 0.7 { [190, 95, 30] } else { [40, 15, 5] };
                    foto.rgb[(py * foto.largura + px) * 3..][..3].copy_from_slice(&cor);
                }
            }
        }
    }

    #[test]
    fn na_recompensa_acha_mesmo_com_o_selo_por_cima() {
        let icone = icone_de_teste(1);
        let mut foto = fundo(600, 400);
        colar(&mut foto, &icone.redimensionado(62), 311, 147);
        pintar_selo(&mut foto, 311, 147, 62);
        let grossa = FotoGrossa::nova(&foto, fator_pro_lado(62));
        let achado = procurar(&foto, &grossa, &icone, 62, Lugar::Recompensa).expect("devia achar");
        assert!(achado.x.abs_diff(311) <= 1 && achado.y.abs_diff(147) <= 1, "{achado:?}");
        assert!(achado.nota > 0.9, "{achado:?}");
        assert!(conferir(&foto, &icone, achado, Lugar::Recompensa).is_some());
        // Sem tapar o selo (como na loja), a nota cai.
        let sem_tapar = melhor_lugar(&foto, &grossa, &icone, 62, Lugar::Loja).map_or(-1.0, |a| a.nota);
        assert!(sem_tapar < achado.nota - 0.05, "sem tapar {sem_tapar}, tapando {}", achado.nota);
    }

    #[test]
    fn na_recompensa_nao_confunde_com_outro_icone() {
        let certo = icone_de_teste(1);
        let outro = icone_de_teste(2);
        let mut foto = fundo(600, 400);
        colar(&mut foto, &outro.redimensionado(62), 311, 147);
        pintar_selo(&mut foto, 311, 147, 62);
        let grossa = FotoGrossa::nova(&foto, fator_pro_lado(62));
        assert_eq!(procurar(&foto, &grossa, &certo, 62, Lugar::Recompensa), None);
    }

    /// Prova com print de verdade. Só roda com `GUIA_PROVA_VISAO` apontando pra uma pasta com:
    /// `tela.rgb` (3 bytes por ponto) e `tela.txt` ("largura altura lado", e "loja" no fim se o
    /// print for da loja; sem isso é da recompensa), e um `<nome>.rgba` de 78x78 por ícone, mais
    /// `esperado.txt` com linhas "<nome> <x> <y>" ou "<nome> nao". Mostra a nota de todos antes
    /// de dizer quais falharam.
    #[test]
    fn prova_com_print_de_verdade() {
        let Ok(pasta) = std::env::var("GUIA_PROVA_VISAO") else { return };
        let pasta = std::path::Path::new(&pasta);
        let texto = std::fs::read_to_string(pasta.join("tela.txt")).unwrap();
        let partes: Vec<&str> = texto.split_whitespace().collect();
        let numeros: Vec<usize> = partes[..3].iter().map(|n| n.parse().unwrap()).collect();
        let lugar = if partes.get(3) == Some(&"loja") { Lugar::Loja } else { Lugar::Recompensa };
        let foto = Foto { largura: numeros[0], altura: numeros[1], rgb: std::fs::read(pasta.join("tela.rgb")).unwrap() };
        let lado = numeros[2];
        println!("{lugar:?}");
        let grossa = FotoGrossa::nova(&foto, fator_pro_lado(lado));
        let mut falhas = Vec::new();
        for linha in std::fs::read_to_string(pasta.join("esperado.txt")).unwrap().lines() {
            let partes: Vec<&str> = linha.split_whitespace().collect();
            let icone = Icone::novo(78, std::fs::read(pasta.join(format!("{}.rgba", partes[0]))).unwrap()).unwrap();
            let inicio = std::time::Instant::now();
            let melhor = melhor_lugar(&foto, &grossa, &icone, lado, lugar);
            println!("{:28} {:?} em {:?}", partes[0], melhor, inicio.elapsed());
            let achado = melhor.filter(|a| a.nota >= LIMIAR);
            if partes[1] == "nao" {
                if achado.is_some() {
                    falhas.push(format!("{} achado sem estar lá: {achado:?}", partes[0]));
                }
            } else {
                let (x, y): (usize, usize) = (partes[1].parse().unwrap(), partes[2].parse().unwrap());
                match achado {
                    Some(a) if a.x.abs_diff(x) <= 3 && a.y.abs_diff(y) <= 3 => {}
                    _ => falhas.push(format!("{} devia estar em ({x}, {y}): {achado:?}", partes[0])),
                }
            }
        }
        assert!(falhas.is_empty(), "{falhas:#?}");
    }
}
