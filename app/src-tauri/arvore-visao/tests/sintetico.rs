//! Testes que sempre rodam: uma "tela da árvore" desenhada a partir do arquivo real (fundo escuro,
//! um anel em cada nó, alguns alocados) numa escala e num deslocamento conhecidos.

mod comum;

use arvore_visao::{
    conferir, fracao_que_mudou, ler, parece_arvore, raio_de_fora, registrar, zona_fixa, Arvore, Encaixe, Foto, Leitura,
    Tapume,
};

/// Cor do fundo da tela desenhada.
const FUNDO: [f32; 3] = [14.0, 12.0, 10.0];
/// Moldura de nó sem alocar: laranja apagado.
const LIVRE: [f32; 3] = [150.0, 90.0, 30.0];
/// Moldura de nó alocado: creme claro.
const ALOCADO: [f32; 3] = [230.0, 215.0, 170.0];
/// Ícone de maestria aceso (já dá pra escolher, escolhida ou não).
const MAESTRIA_ACESA: [f32; 3] = [150.0, 90.0, 40.0];
/// Efeito em volta da maestria escolhida.
const MAESTRIA_EFEITO: [f32; 3] = [200.0, 210.0, 240.0];
/// Raios (unidades da árvore) do efeito da maestria escolhida.
const EFEITO: (f32, f32) = (80.0, 98.0);

/// Raios (unidades da árvore) do anel desenhado em cada tipo: cobre a moldura e a faixa lidas.
fn anel_de(tipo: u8) -> Option<(f32, f32)> {
    match tipo {
        0 => Some((30.0, 46.0)),
        1 => Some((50.0, 74.0)),
        2 => Some((68.0, 100.0)),
        3 => Some((55.0, 72.0)),
        4 => Some((50.0, 68.0)),
        _ => None,
    }
}

/// Uma tela desenhada e o que se espera ler nela.
struct Cena {
    w: usize,
    h: usize,
    bgrx: Vec<u8>,
    encaixe: Encaixe,
    alocados: Vec<bool>,
    /// Maestrias com o ícone aceso mas sem escolher (têm de ser lidas como livres).
    acesas: Vec<bool>,
}

impl Cena {
    fn foto(&self) -> Foto<'_> {
        Foto { largura: self.w, altura: self.h, bgrx: &self.bgrx }
    }
}

/// Pinta um anel com borda suave.
#[allow(clippy::too_many_arguments)]
fn pintar(b: &mut [u8], w: usize, h: usize, cx: f32, cy: f32, r0: f32, r1: f32, cor: [f32; 3]) {
    let (x0, x1) = ((cx - r1 - 2.0).floor().max(0.0) as usize, ((cx + r1 + 2.0).ceil().max(0.0) as usize).min(w));
    let (y0, y1) = ((cy - r1 - 2.0).floor().max(0.0) as usize, ((cy + r1 + 2.0).ceil().max(0.0) as usize).min(h));
    for y in y0..y1 {
        for x in x0..x1 {
            let d = ((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2)).sqrt();
            let cobre = ((d - r0).min(r1 - d) + 0.5).clamp(0.0, 1.0);
            if cobre <= 0.0 {
                continue;
            }
            let p = &mut b[(y * w + x) * 4..(y * w + x) * 4 + 3];
            for (k, v) in p.iter_mut().enumerate() {
                let c = cor[2 - k];
                *v = (*v as f32 * (1.0 - cobre) + c * cobre).round() as u8;
            }
        }
    }
}

/// Desenha a árvore na escala `n` com o centro da árvore em (cx, cy) da foto. Ficam alocados os
/// nós a menos de `raio_alocado` unidades do ponto (ax, ay) da árvore. As maestrias vizinhas de
/// um notável alocado acendem; metade delas (as de posição par) fica escolhida, com o efeito.
fn desenhar(arvore: &Arvore, w: usize, h: usize, n: u32, cx: f32, cy: f32, (ax, ay, raio_alocado): (f32, f32, f32)) -> Cena {
    let s = n as f32 * h as f32 / 80000.0;
    let mut bgrx = vec![0u8; w * h * 4];
    for p in bgrx.as_chunks_mut::<4>().0 {
        p.copy_from_slice(&[FUNDO[2] as u8, FUNDO[1] as u8, FUNDO[0] as u8, 255]);
    }
    let total = arvore.ids.len();
    let mut alocados = vec![false; total];
    let mut acesas = vec![false; total];
    for (i, alocado) in alocados.iter_mut().enumerate() {
        let perto = (arvore.xs[i] - ax).hypot(arvore.ys[i] - ay) < raio_alocado;
        *alocado = perto && arvore.tipos[i] <= 3;
    }
    for i in 0..total {
        if arvore.tipos[i] == 4 {
            let pode = arvore.vizinhos[i].iter().any(|j| alocados[*j as usize] && arvore.tipos[*j as usize] == 1);
            alocados[i] = pode && i % 2 == 0;
            acesas[i] = pode && i % 2 == 1;
        }
    }
    // Maestrias primeiro: o efeito fica por baixo dos nós vizinhos, como no jogo.
    for i in (0..total).filter(|i| arvore.tipos[*i] == 4) {
        let (qx, qy) = (s * arvore.xs[i] + cx, s * arvore.ys[i] + cy);
        if alocados[i] {
            pintar(&mut bgrx, w, h, qx, qy, EFEITO.0 * s, EFEITO.1 * s, MAESTRIA_EFEITO);
        }
        if alocados[i] || acesas[i] {
            let (r0, r1) = anel_de(4).unwrap();
            pintar(&mut bgrx, w, h, qx, qy, r0 * s, r1 * s, MAESTRIA_ACESA);
        }
    }
    for (i, alocado) in alocados.iter().enumerate() {
        if arvore.tipos[i] == 4 {
            continue;
        }
        let Some((r0, r1)) = anel_de(arvore.tipos[i]) else { continue };
        let cor = if *alocado { ALOCADO } else { LIVRE };
        pintar(&mut bgrx, w, h, s * arvore.xs[i] + cx, s * arvore.ys[i] + cy, r0 * s, r1 * s, cor);
    }
    Cena { w, h, bgrx, encaixe: Encaixe { n, s, tx: cx, ty: cy }, alocados, acesas }
}

/// Confere a leitura contra o desenho. Devolve (nós lidos, iguais, alocados lidos como alocados).
fn conferir_leitura(arvore: &Arvore, cena: &Cena, lido: &[Leitura]) -> (usize, usize, usize) {
    assert_eq!(lido.len(), arvore.ids.len());
    let (mut lidos, mut iguais, mut alocados) = (0, 0, 0);
    for (i, lido_aqui) in lido.iter().enumerate() {
        let lido_aqui = *lido_aqui;
        let tipo = arvore.tipos[i];
        let (qx, qy) = (cena.encaixe.s * arvore.xs[i] + cena.encaixe.tx, cena.encaixe.s * arvore.ys[i] + cena.encaixe.ty);
        let folga = raio_de_fora(tipo) * cena.encaixe.s + 1.0;
        let (w, h) = (cena.w as f32, cena.h as f32);
        // Dois pontos de margem: na beirada (da foto ou da interface fixa), tanto faz o que sair.
        let na_tela = qx > folga + 2.0 && qx < w - folga - 2.0 && qy > folga + 2.0 && qy < h - folga - 2.0;
        if !na_tela {
            if qx < -2.0 || qy < -2.0 || qx > w + 2.0 || qy > h + 2.0 {
                assert_eq!(lido_aqui, Leitura::ForaDaTela, "nó {} fora da foto", arvore.ids[i]);
            }
            continue;
        }
        // Rodapé: a leitura aceita o nó até o anel que decide encostar na barra de experiência.
        // Perto dela tanto faz o que sair; o teste próprio é `le_o_no_logo_acima_da_barra_de_xp`.
        if qy > 0.975 * h - folga - 2.0 {
            if qy > 0.978 * h + 2.0 {
                assert_eq!(lido_aqui, Leitura::Tapado, "nó {} em cima da barra de experiência", arvore.ids[i]);
            }
            continue;
        }
        if zona_fixa(qx, qy, w, h, folga + 2.0) {
            if zona_fixa(qx, qy, w, h, folga - 2.0) {
                assert_eq!(lido_aqui, Leitura::Tapado, "nó {} debaixo da interface fixa", arvore.ids[i]);
            }
            continue;
        }
        if tipo > 4 {
            assert_eq!(lido_aqui, Leitura::NaoSei, "nó {} de tipo {tipo} não é lido", arvore.ids[i]);
            continue;
        }
        // A maestria só acesa (dá pra escolher, mas não foi escolhida) nunca conta como escolhida.
        if cena.acesas[i] {
            assert_ne!(lido_aqui, Leitura::Alocado, "maestria {} só acesa lida como escolhida", arvore.ids[i]);
        }
        lidos += 1;
        let esperado = if cena.alocados[i] { Leitura::Alocado } else { Leitura::Livre };
        iguais += (lido_aqui == esperado) as usize;
        alocados += (cena.alocados[i] && lido_aqui == Leitura::Alocado) as usize;
        // O erro grave é dizer o contrário; "não sei" é tolerado em nós encostados uns nos outros.
        // Maestria fica de fora: o anel do desenho pode ser coberto pelo de um vizinho.
        if tipo != 4 {
            assert!(
                lido_aqui == esperado || lido_aqui == Leitura::NaoSei,
                "nó {} (tipo {tipo}): li {:?}, era {esperado:?}",
                arvore.ids[i],
                lido_aqui
            );
        }
    }
    (lidos, iguais, alocados)
}

#[test]
fn acha_o_encaixe_e_le_os_estados() {
    let arvore = comum::arvore_do_app();
    let cena = desenhar(&arvore, 1280, 720, 30, 640.3, 355.7, (300.0, -200.0, 900.0));
    let r = registrar(&cena.foto(), &arvore, None).expect("tem de achar alguma coisa");
    println!("sintético 1280x720 n=30: {r:?}");
    assert!(r.aceito, "{r:?}");
    assert_eq!(r.encaixe.n, 30);
    assert!((r.encaixe.s - cena.encaixe.s).abs() < 1e-6);
    assert!((r.encaixe.tx - 640.3).abs() <= 1.0 && (r.encaixe.ty - 355.7).abs() <= 1.0, "{r:?}");
    assert!(r.bons as f32 >= 0.9 * r.total as f32 && r.deslocados * 4 < r.bons, "{r:?}");

    // Com o zoom dado sai o mesmo encaixe; com o zoom errado, nada é aceito.
    let com_zoom = registrar(&cena.foto(), &arvore, Some(30)).expect("zoom certo");
    assert!(com_zoom.aceito);
    assert_eq!(com_zoom.encaixe, r.encaixe);
    assert!(!registrar(&cena.foto(), &arvore, Some(24)).is_some_and(|x| x.aceito));
    assert!(registrar(&cena.foto(), &arvore, Some(7)).is_none());
    assert!(registrar(&cena.foto(), &arvore, Some(41)).is_none());

    let c = conferir(&cena.foto(), &arvore, &r.encaixe, &[]);
    assert!(c.total > 20 && c.bons as f32 >= 0.9 * c.total as f32, "{c:?}");
    assert!(c.total <= r.total, "a conferência pula a interface fixa");
    // Encaixe errado: as molduras somem.
    let torto = Encaixe { tx: r.encaixe.tx + 45.0 * r.encaixe.s, ..r.encaixe };
    let c2 = conferir(&cena.foto(), &arvore, &torto, &[]);
    assert!(c2.bons * 3 < c.bons, "{c2:?}");

    let mut lido = Vec::new();
    ler(&cena.foto(), &arvore, &r.encaixe, &[], &mut lido);
    let (lidos, iguais, alocados) = conferir_leitura(&arvore, &cena, &lido);
    println!("  leitura: {iguais} de {lidos} iguais, {alocados} alocados");
    assert!(lidos > 40 && alocados > 5);
    assert!(iguais as f32 >= 0.97 * lidos as f32, "{iguais} de {lidos}");

    // Tapume em cima de tudo: nada é lido nem conferido.
    let tudo = [Tapume { x0: 0.0, y0: 0.0, x1: 1280.0, y1: 720.0 }];
    ler(&cena.foto(), &arvore, &r.encaixe, &tudo, &mut lido);
    assert!(lido.iter().all(|e| matches!(e, Leitura::Tapado | Leitura::ForaDaTela)));
    assert_eq!(conferir(&cena.foto(), &arvore, &r.encaixe, &tudo).total, 0);
    // Tapume na metade esquerda: quem está à direita continua lido.
    let meio = [Tapume { x0: 0.0, y0: 0.0, x1: 640.0, y1: 720.0 }];
    ler(&cena.foto(), &arvore, &r.encaixe, &meio, &mut lido);
    let mut lidos_a_direita = 0;
    for (i, e) in lido.iter().enumerate() {
        let qx = r.encaixe.s * arvore.xs[i] + r.encaixe.tx;
        if matches!(e, Leitura::Livre | Leitura::Alocado | Leitura::NaoSei) {
            assert!(qx > 640.0);
            lidos_a_direita += 1;
        }
    }
    assert!(lidos_a_direita > 10);
}

#[test]
fn acha_em_1080_com_zoom_baixo() {
    let arvore = comum::arvore_do_app();
    let cena = desenhar(&arvore, 1920, 1080, 14, 951.6, 548.2, (-2500.0, 1500.0, 1200.0));
    let r = registrar(&cena.foto(), &arvore, None).expect("tem de achar alguma coisa");
    println!("sintético 1920x1080 n=14: {r:?}");
    assert!(r.aceito && r.encaixe.n == 14, "{r:?}");
    assert!((r.encaixe.tx - 951.6).abs() <= 1.0 && (r.encaixe.ty - 548.2).abs() <= 1.0, "{r:?}");
    let mut lido = Vec::new();
    ler(&cena.foto(), &arvore, &r.encaixe, &[], &mut lido);
    let (lidos, iguais, _) = conferir_leitura(&arvore, &cena, &lido);
    println!("  leitura: {iguais} de {lidos} iguais");
    assert!(iguais as f32 >= 0.97 * lidos as f32, "{iguais} de {lidos}");
}

#[test]
fn foto_alta_e_procurada_pela_metade() {
    let arvore = comum::arvore_do_app();
    // 1700 de altura: passa do limite, a procura é feita em 850 e o encaixe volta na escala cheia.
    let cena = desenhar(&arvore, 1600, 1700, 16, 812.4, 845.8, (0.0, 0.0, 700.0));
    let r = registrar(&cena.foto(), &arvore, None).expect("tem de achar alguma coisa");
    println!("sintético 1600x1700 n=16: {r:?}");
    assert!(r.aceito && r.encaixe.n == 16, "{r:?}");
    assert!((r.encaixe.s - cena.encaixe.s).abs() < 1e-6);
    assert!((r.encaixe.tx - 812.4).abs() <= 1.0 && (r.encaixe.ty - 845.8).abs() <= 1.0, "{r:?}");
    let mut lido = Vec::new();
    ler(&cena.foto(), &arvore, &r.encaixe, &[], &mut lido);
    let (lidos, iguais, _) = conferir_leitura(&arvore, &cena, &lido);
    println!("  leitura: {iguais} de {lidos} iguais");
    assert!(iguais as f32 >= 0.97 * lidos as f32, "{iguais} de {lidos}");
}

#[test]
fn foto_preta_e_foto_de_ruido_nao_sao_aceitas() {
    let arvore = comum::arvore_do_app();
    let (w, h) = (960, 540);
    let preta = vec![0u8; w * h * 4];
    assert!(!registrar(&Foto { largura: w, altura: h, bgrx: &preta }, &arvore, None).is_some_and(|r| r.aceito));
    // Ruído determinístico (gerador congruente).
    let mut semente = 12345u32;
    let ruido: Vec<u8> = (0..w * h * 4)
        .map(|_| {
            semente = semente.wrapping_mul(1664525).wrapping_add(1013904223);
            (semente >> 24) as u8
        })
        .collect();
    let foto = Foto { largura: w, altura: h, bgrx: &ruido };
    assert!(!registrar(&foto, &arvore, None).is_some_and(|r| r.aceito));
    assert!(!registrar(&foto, &arvore, Some(20)).is_some_and(|r| r.aceito));
    // Ruído escuro com manchas: também não.
    let manchas: Vec<u8> = ruido.iter().map(|v| if *v > 250 { 200 } else { v / 16 }).collect();
    assert!(!registrar(&Foto { largura: w, altura: h, bgrx: &manchas }, &arvore, None).is_some_and(|r| r.aceito));
}

#[test]
fn nunca_da_panico_com_entrada_ruim() {
    let arvore = comum::arvore_do_app();
    let vazia = Foto { largura: 0, altura: 0, bgrx: &[] };
    let curto = vec![7u8; 100];
    let curta = Foto { largura: 1920, altura: 1080, bgrx: &curto };
    let um = Foto { largura: 1, altura: 1, bgrx: &[1, 2, 3, 4] };
    let gigante = Foto { largura: usize::MAX, altura: usize::MAX, bgrx: &curto };
    let pequena_dados = vec![30u8; 80 * 70 * 4];
    let pequena = Foto { largura: 80, altura: 70, bgrx: &pequena_dados };
    let encaixes = [
        Encaixe { n: 20, s: 0.27, tx: 100.0, ty: 100.0 },
        Encaixe { n: 0, s: 0.0, tx: 0.0, ty: 0.0 },
        Encaixe { n: 20, s: -1.0, tx: 0.0, ty: 0.0 },
        Encaixe { n: 20, s: f32::NAN, tx: f32::NAN, ty: f32::NAN },
        Encaixe { n: 20, s: f32::INFINITY, tx: f32::NEG_INFINITY, ty: 0.0 },
        Encaixe { n: u32::MAX, s: 1e30, tx: -1e30, ty: 1e30 },
        Encaixe { n: 20, s: 1e-30, tx: 40.0, ty: 35.0 },
        Encaixe { n: 20, s: 0.001, tx: 40.0, ty: 35.0 },
    ];
    let tapumes = [
        Tapume { x0: f32::NAN, y0: 0.0, x1: f32::INFINITY, y1: f32::NAN },
        Tapume { x0: 50.0, y0: 50.0, x1: -50.0, y1: -50.0 },
    ];
    let mut lido = vec![Leitura::Alocado; 3];
    for foto in [vazia, curta, um, gigante, pequena] {
        for zoom in [None, Some(0), Some(8), Some(40), Some(u32::MAX)] {
            let r = registrar(&foto, &arvore, zoom);
            assert!(!r.is_some_and(|r| r.aceito));
        }
        for e in &encaixes {
            let c = conferir(&foto, &arvore, e, &tapumes);
            assert!(c.bons <= c.total);
            ler(&foto, &arvore, e, &tapumes, &mut lido);
            assert_eq!(lido.len(), arvore.ids.len());
            assert!(!lido.contains(&Leitura::Alocado));
        }
        let _ = parece_arvore(&foto);
        let f = fracao_que_mudou(&foto, &pequena);
        assert!((0.0..=1.0).contains(&f));
    }
    // Árvores esquisitas.
    let nenhuma = Arvore::nova(vec![], vec![], vec![], vec![], &[]).unwrap();
    let uma = Arvore::nova(vec![1, 2], vec![0.0, 1e30], vec![0.0, -1e30], vec![0, 200], &[0, 1]).unwrap();
    assert!(Arvore::nova(vec![1], vec![f32::NAN], vec![0.0], vec![0], &[]).is_none());
    assert!(Arvore::nova(vec![1], vec![0.0], vec![0.0], vec![0], &[0, 5]).is_none());
    for a in [&nenhuma, &uma] {
        assert!(!registrar(&pequena, a, None).is_some_and(|r| r.aceito));
        for e in &encaixes {
            let _ = conferir(&pequena, a, e, &tapumes);
            ler(&pequena, a, e, &tapumes, &mut lido);
            assert_eq!(lido.len(), a.ids.len());
        }
    }
    // Árvore com os vetores públicos mexidos (tamanhos que não batem).
    let mut torta = comum::arvore_do_app();
    torta.xs.truncate(10);
    torta.vizinhos.truncate(3);
    torta.tipos.truncate(700);
    let cena_dados = vec![20u8; 640 * 360 * 4];
    let cena = Foto { largura: 640, altura: 360, bgrx: &cena_dados };
    let _ = registrar(&cena, &torta, None);
    let _ = conferir(&cena, &torta, &encaixes[0], &[]);
    ler(&cena, &torta, &encaixes[0], &[], &mut lido);
    assert_eq!(lido.len(), torta.ids.len());
}

#[test]
fn porta_e_parou() {
    fn foto(b: &[u8]) -> Foto<'_> {
        Foto { largura: 240, altura: 135, bgrx: b }
    }
    let escura = vec![20u8; 240 * 135 * 4];
    let clara = vec![120u8; 240 * 135 * 4];
    assert!(parece_arvore(&foto(&escura)));
    assert!(!parece_arvore(&foto(&clara)));
    // Um terço de pontos claros: escuros de menos.
    let mut mista = escura.clone();
    for p in mista.as_chunks_mut::<4>().0.iter_mut().step_by(3) {
        p.fill(200);
    }
    assert!(!parece_arvore(&foto(&mista)));
    // A tela da árvore desenhada passa na porta (foto 1/8).
    let arvore = comum::arvore_do_app();
    let cena = desenhar(&arvore, 1280, 720, 30, 640.3, 355.7, (300.0, -200.0, 900.0));
    let mut oitavo = Vec::new();
    for y in (0..720).step_by(8) {
        for x in (0..1280).step_by(8) {
            oitavo.extend_from_slice(&cena.bgrx[(y * 1280 + x) * 4..(y * 1280 + x) * 4 + 4]);
        }
    }
    assert!(parece_arvore(&Foto { largura: 160, altura: 90, bgrx: &oitavo }));

    assert_eq!(fracao_que_mudou(&foto(&escura), &foto(&escura)), 0.0);
    assert_eq!(fracao_que_mudou(&foto(&escura), &foto(&clara)), 1.0);
    let f = fracao_que_mudou(&foto(&escura), &foto(&mista));
    assert!((f - 1.0 / 3.0).abs() < 0.01, "{f}");
    // Mudança pequena de brilho não conta.
    let quase = vec![28u8; 240 * 135 * 4];
    assert_eq!(fracao_que_mudou(&foto(&escura), &foto(&quase)), 0.0);
    // Tamanhos diferentes: mudou tudo.
    assert_eq!(fracao_que_mudou(&foto(&escura), &Foto { largura: 160, altura: 90, bgrx: &oitavo }), 1.0);
}

#[test]
fn zona_fixa_e_raio_de_fora() {
    let (w, h) = (1920.0, 1080.0);
    assert!(zona_fixa(960.0, 50.0, w, h, 0.0)); // cabeçalho
    assert!(!zona_fixa(200.0, 50.0, w, h, 0.0)); // canto de cima: árvore
    assert!(zona_fixa(100.0, 1000.0, w, h, 0.0)); // canto de baixo à esquerda
    assert!(zona_fixa(1850.0, 1000.0, w, h, 0.0)); // canto de baixo à direita
    assert!(!zona_fixa(960.0, 1000.0, w, h, 0.0)); // meio de baixo: árvore
    assert!(zona_fixa(960.0, 1070.0, w, h, 0.0)); // rodapé
    assert!(!zona_fixa(960.0, 540.0, w, h, 0.0)); // meio
    assert!(!zona_fixa(960.0, 200.0, w, h, 0.0));
    assert!(zona_fixa(960.0, 200.0, w, h, 20.0)); // com folga encosta no cabeçalho
    assert_eq!(raio_de_fora(0), 56.0);
    assert_eq!(raio_de_fora(2), 122.0);
}

/// A maestria com o ícone aceso (um notável do grupo pego) ainda não foi escolhida: tem de ser
/// lida como livre. Antes ela contava como escolhida e o guia pulava pra etapa seguinte.
#[test]
fn maestria_acesa_nao_conta_como_escolhida() {
    let arvore = comum::arvore_do_app();
    let (w, h, n) = (1920usize, 1080usize, 20u32);
    let s = n as f32 * h as f32 / 80000.0;
    // Uma maestria de posição par (fica escolhida no desenho) e uma ímpar (só acesa).
    let com_notavel = |m: &usize| {
        arvore.tipos[*m] == 4 && arvore.vizinhos[*m].iter().any(|j| arvore.tipos[*j as usize] == 1)
    };
    let par = (0..arvore.ids.len()).filter(com_notavel).find(|m| m % 2 == 0).expect("maestria par");
    let impar = (0..arvore.ids.len()).filter(com_notavel).find(|m| m % 2 == 1).expect("maestria ímpar");
    for (m, esperado) in [(par, Leitura::Alocado), (impar, Leitura::Livre)] {
        let j = *arvore.vizinhos[m].iter().find(|j| arvore.tipos[**j as usize] == 1).unwrap() as usize;
        // A maestria no meio da foto; pego só o notável vizinho dela.
        let (cx, cy) = (w as f32 / 2.0 - s * arvore.xs[m], h as f32 / 2.0 - s * arvore.ys[m]);
        let cena = desenhar(&arvore, w, h, n, cx, cy, (arvore.xs[j], arvore.ys[j], 10.0));
        assert!(cena.alocados[j] && (cena.alocados[m] || cena.acesas[m]));
        let mut lido = Vec::new();
        ler(&cena.foto(), &arvore, &cena.encaixe, &[], &mut lido);
        assert_eq!(lido[j], Leitura::Alocado, "o notável vizinho");
        assert_eq!(lido[m], esperado, "maestria {} ({})", arvore.ids[m], if m == par { "escolhida" } else { "só acesa" });
    }
}

/// Um notável pego logo acima da barra de experiência tem de ser lido (antes ficava "tapado" e o
/// guia nunca via que ele foi pego). Com a faixa dele em cima da barra, aí sim fica tapado.
#[test]
fn le_o_no_logo_acima_da_barra_de_xp() {
    let arvore = comum::arvore_do_app();
    let (w, h, n) = (1920usize, 1080usize, 14u32);
    let s = n as f32 * h as f32 / 80000.0;
    let i = (0..arvore.ids.len()).find(|i| arvore.tipos[*i] == 1).expect("um notável");
    let (x, y) = (arvore.xs[i], arvore.ys[i]);
    let barra = 0.978 * h as f32;
    for (topo_da_faixa, esperado) in [(barra - 1.5, Leitura::Alocado), (barra + 2.0, Leitura::Tapado)] {
        // Põe o notável no meio da largura, com a faixa (raio 58) terminando em `topo_da_faixa`.
        let (cx, cy) = (w as f32 / 2.0 - s * x, topo_da_faixa - 58.0 * s - s * y);
        let mut cena = desenhar(&arvore, w, h, n, cx, cy, (x, y, 10.0));
        assert!(cena.alocados[i]);
        // A barra de experiência: uma linha clara e o resto mais escuro, até o fim da foto.
        for linha in barra.ceil() as usize..h {
            let cor: u8 = if linha < barra.ceil() as usize + 2 { 75 } else { 30 };
            cena.bgrx[linha * w * 4..(linha + 1) * w * 4].iter_mut().for_each(|v| *v = cor);
        }
        let mut lido = Vec::new();
        ler(&cena.foto(), &arvore, &cena.encaixe, &[], &mut lido);
        let qy = s * y + cy;
        assert!(zona_fixa(w as f32 / 2.0, qy, w as f32, h as f32, raio_de_fora(1) * s + 1.0), "a regra antiga tapava");
        assert_eq!(lido[i], esperado, "notável em y = {qy:.1}, faixa até {topo_da_faixa:.1}, barra em {barra:.1}");
    }
}
