//! Bancada de telas: fotos reais do jogo levadas pra vários tamanhos de tela (720p a 4K, 16:10,
//! 4:3, 21:9 e 32:9), pra ver se o reconhecimento das gemas, dos painéis e da árvore aguenta cada um.
//!
//! Só roda com `GUIA_BANCADA_TELAS` apontando pra pasta feita por `scripts/bancada-telas.py`
//! (as fotos não vão pro repositório). A resposta de cada foto no tamanho original é a referência:
//! nos outros tamanhos o guia tem que ver a mesma coisa, no lugar equivalente.
//!
//! Como cada formato é feito, a partir da foto 16:9:
//! - a foto vai pra altura nova (o jogo desenha a interface proporcional à altura da tela);
//! - o inventário fica preso na direita e os painéis da esquerda (baú, mundo) na esquerda;
//! - as janelas de recompensa e de compra ficam no meio do espaço livre à esquerda do inventário
//!   (como se vê em 1080p: compra de 280 a 976, recompensa de 296 a 956);
//! - a árvore fica no meio, com fundo escuro dos lados (ou corta os dois lados).
//!
//! Rodar (o `opt-level` deixa a conta das gemas no tempo de verdade):
//! `GUIA_BANCADA_TELAS=<pasta> cargo test --config "profile.dev.package.guia-leveling.opt-level=3" bancada -- --nocapture --test-threads 1`

use crate::casar::{fator_pro_lado, melhor_lugar, Foto, FotoGrossa, Icone, Lugar, LIMIAR};
use crate::paineis::{
    faixa_da_compra, juntar, ler, ler_compra, nota_da_compra, nota_da_recompensa, notas, tamanho_da_foto, Leitura,
    LARGURA_DO_PAINEL,
};
use crate::visao::{largura_olhada, loja_de, recortar, Loja, FRACAO_NA_LOJA, FRACAO_NA_RECOMPENSA};
use std::path::{Path, PathBuf};
use std::time::Instant;

/// Os tamanhos de tela provados: (nome, largura, altura).
const FORMATOS: [(&str, usize, usize); 13] = [
    ("1280x720", 1280, 720),
    ("1366x768", 1366, 768),
    ("1600x900", 1600, 900),
    ("1920x1080", 1920, 1080),
    ("2560x1440", 2560, 1440),
    ("3840x2160", 3840, 2160),
    ("1680x1050 16:10", 1680, 1050),
    ("1920x1200 16:10", 1920, 1200),
    ("1024x768 4:3", 1024, 768),
    ("2560x1080 21:9", 2560, 1080),
    ("3440x1440 21:9", 3440, 1440),
    ("5120x1440 32:9", 5120, 1440),
    ("1600x837 janela", 1600, 837),
];

/// Cor do fundo posto dos lados da árvore numa tela mais larga.
const FUNDO_DA_ARVORE: [u8; 3] = [9, 9, 11];

pub(crate) struct Quadro {
    pub(crate) nome: String,
    pub(crate) tipo: String,
    pub(crate) foto: Foto,
}

pub(crate) fn pasta() -> Option<PathBuf> {
    std::env::var("GUIA_BANCADA_TELAS").ok().map(PathBuf::from)
}

pub(crate) fn quadros(pasta: &Path, tipos: &[&str]) -> Vec<Quadro> {
    let lista = std::fs::read_to_string(pasta.join("lista.txt")).expect("lista.txt");
    let mut saida = Vec::new();
    for linha in lista.lines() {
        let partes: Vec<&str> = linha.split_whitespace().collect();
        if partes.len() < 4 || !tipos.contains(&partes[3]) {
            continue;
        }
        let (largura, altura): (usize, usize) = (partes[1].parse().unwrap(), partes[2].parse().unwrap());
        let rgb = std::fs::read(pasta.join("quadros").join(format!("{}.rgb", partes[0]))).unwrap();
        assert_eq!(rgb.len(), largura * altura * 3, "{}", partes[0]);
        saida.push(Quadro { nome: partes[0].into(), tipo: partes[3].into(), foto: Foto { largura, altura, rgb } });
    }
    saida
}

/// Pesos de um eixo: pra cada ponto novo, (primeiro ponto velho, pesos). Triângulo com o suporte
/// alargado quando reduz (média de área, como uma tela menor desenharia).
fn pesos(velho: usize, novo: usize) -> Vec<(usize, Vec<f32>)> {
    let escala = novo as f64 / velho as f64;
    let suporte = (1.0 / escala).max(1.0);
    (0..novo)
        .map(|i| {
            let centro = (i as f64 + 0.5) / escala - 0.5;
            let a = ((centro - suporte).ceil().max(0.0)) as usize;
            let b = ((centro + suporte).floor() as usize).min(velho - 1);
            let mut p: Vec<f32> =
                (a..=b).map(|j| (1.0 - ((j as f64 - centro).abs() / suporte)).max(0.0) as f32).collect();
            let soma: f32 = p.iter().sum();
            if soma > 0.0 {
                p.iter_mut().for_each(|v| *v /= soma);
            } else {
                p = vec![1.0];
            }
            (a, p)
        })
        .collect()
}

fn redimensionar(foto: &Foto, largura: usize, altura: usize) -> Foto {
    if largura == foto.largura && altura == foto.altura {
        return Foto { largura, altura, rgb: foto.rgb.clone() };
    }
    let (px, py) = (pesos(foto.largura, largura), pesos(foto.altura, altura));
    // Primeiro na horizontal (em f32), depois na vertical.
    let mut meio = vec![0f32; largura * foto.altura * 3];
    for y in 0..foto.altura {
        let linha = &foto.rgb[y * foto.largura * 3..(y + 1) * foto.largura * 3];
        for (x, (a, p)) in px.iter().enumerate() {
            let mut c = [0f32; 3];
            for (k, w) in p.iter().enumerate() {
                let i = (a + k) * 3;
                c[0] += w * linha[i] as f32;
                c[1] += w * linha[i + 1] as f32;
                c[2] += w * linha[i + 2] as f32;
            }
            meio[(y * largura + x) * 3..(y * largura + x) * 3 + 3].copy_from_slice(&c);
        }
    }
    let mut rgb = vec![0u8; largura * altura * 3];
    for (y, (a, p)) in py.iter().enumerate() {
        for x in 0..largura {
            for canal in 0..3 {
                let mut v = 0f32;
                for (k, w) in p.iter().enumerate() {
                    v += w * meio[((a + k) * largura + x) * 3 + canal];
                }
                rgb[(y * largura + x) * 3 + canal] = v.round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    Foto { largura, altura, rgb }
}

/// Onde o jogo prende o que a prova olha, quando a tela muda de largura.
#[derive(Clone, Copy, PartialEq)]
enum Preso {
    /// Na esquerda (o painel da esquerda: Baú, Mundo...).
    Esquerda,
    /// No meio da tela (a árvore).
    Meio,
    /// No meio do espaço à esquerda do inventário (as janelas de recompensa e de compra: num
    /// print 1920x1080 com o inventário aberto, as duas ficam centradas em 0..1258). O inventário
    /// fica preso na direita.
    Livre,
}

/// A foto como seria numa tela `largura` x `altura`. Devolve também a conta pra levar um ponto da
/// foto original pra nova: `x * escala + dx`, `y * escala` (pros pontos da parte que importa).
fn no_formato(foto: &Foto, largura: usize, altura: usize, preso: Preso) -> (Foto, f64, f64) {
    let escala = altura as f64 / foto.altura as f64;
    let natural = (foto.largura as f64 * escala).round() as usize;
    let nova = redimensionar(foto, natural, altura);
    if natural == largura {
        return (nova, escala, 0.0);
    }
    let inventario = (LARGURA_DO_PAINEL * altura as f64).round() as isize;
    let (livre_velho, livre_novo) = (natural as isize - inventario, largura as isize - inventario);
    let dx: isize = match preso {
        Preso::Esquerda => 0,
        Preso::Meio => (largura as isize - natural as isize) / 2,
        Preso::Livre => (livre_novo - livre_velho) / 2,
    };
    let mut rgb = Vec::with_capacity(largura * altura * 3);
    for y in 0..altura {
        for x in 0..largura as isize {
            let xo = if preso == Preso::Livre && x >= livre_novo {
                x - (largura as isize - natural as isize)
            } else if preso == Preso::Livre && x - dx >= livre_velho {
                -1
            } else {
                x - dx
            };
            if xo >= 0 && (xo as usize) < natural {
                let i = (y * natural + xo as usize) * 3;
                rgb.extend_from_slice(&nova.rgb[i..i + 3]);
            } else {
                rgb.extend_from_slice(&FUNDO_DA_ARVORE);
            }
        }
    }
    (Foto { largura, altura, rgb }, escala, dx as f64)
}

/// Pedaço de cima à esquerda da foto.
fn recorte(foto: &Foto, x: usize, y: usize, largura: usize, altura: usize) -> Foto {
    let mut rgb = Vec::with_capacity(largura * altura * 3);
    for linha in y..y + altura {
        let i = (linha * foto.largura + x) * 3;
        rgb.extend_from_slice(&foto.rgb[i..i + largura * 3]);
    }
    Foto { largura, altura, rgb }
}

fn icones(pasta: &Path) -> Vec<(String, Icone)> {
    let mut saida: Vec<(String, Icone)> = std::fs::read_dir(pasta.join("icones"))
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| {
            let nome = e.file_name().to_string_lossy().trim_end_matches(".rgba").to_string();
            (nome, Icone::novo(78, std::fs::read(e.path()).unwrap()).unwrap())
        })
        .collect();
    saida.sort_by(|a, b| a.0.cmp(&b.0));
    saida
}

/// O que o laço da visão faz numa olhada, pra um ícone: foto da parte esquerda, lado pela altura.
struct Olhada {
    foto: Foto,
    grossa: FotoGrossa,
    lado: usize,
}

impl Olhada {
    fn nova(tela: &Foto, lugar: Lugar) -> Olhada {
        let fracao = if lugar == Lugar::Loja { FRACAO_NA_LOJA } else { FRACAO_NA_RECOMPENSA };
        let lado = (tela.altura as f32 * fracao).round() as usize;
        let foto = recorte(tela, 0, 0, largura_olhada(tela.largura, tela.altura), tela.altura);
        let grossa = FotoGrossa::nova(&foto, fator_pro_lado(lado));
        Olhada { foto, grossa, lado }
    }
}

#[test]
fn bancada_gemas() {
    let Some(pasta) = pasta() else { return };
    let icones = icones(&pasta);
    let quadros = quadros(&pasta, &["recompensa", "loja"]);
    println!("\n== GEMAS: {} fotos, {} ícones, limiar {LIMIAR}", quadros.len(), icones.len());
    let linhas: Vec<String> = std::thread::scope(|e| {
        let fios: Vec<_> = quadros
            .iter()
            .map(|q| {
                let icones = &icones;
                e.spawn(move || {
                    let lugar = if q.tipo == "loja" { Lugar::Loja } else { Lugar::Recompensa };
                    let base = Olhada::nova(&q.foto, lugar);
                    let achados: Vec<(usize, usize, usize, f32)> = icones
                        .iter()
                        .enumerate()
                        .filter_map(|(k, (_, icone))| {
                            melhor_lugar(&base.foto, &base.grossa, icone, base.lado, lugar)
                                .filter(|a| a.nota >= LIMIAR)
                                .map(|a| (k, a.x, a.y, a.nota))
                        })
                        .collect();
                    let mut texto = format!(
                        "{} ({}x{}, lado {}): {} ícones achados: {}\n",
                        q.nome,
                        q.foto.largura,
                        q.foto.altura,
                        base.lado,
                        achados.len(),
                        achados.iter().map(|a| format!("{} {:.2}", icones[a.0].0, a.3)).collect::<Vec<_>>().join(", ")
                    );
                    if achados.is_empty() {
                        return texto;
                    }
                    // Controle: ícones que não estão na foto (um a cada 20, fora os achados).
                    let controle: Vec<usize> = (0..icones.len())
                        .step_by(20)
                        .filter(|k| !achados.iter().any(|a| a.0 == *k))
                        .collect();
                    for (nome, largura, altura) in FORMATOS {
                        let inicio = Instant::now();
                        let (tela, escala, dx) = no_formato(&q.foto, largura, altura, Preso::Livre);
                        let olhada = Olhada::nova(&tela, lugar);
                        let mut certos = 0;
                        let mut pior = 1.0f32;
                        let mut erros = Vec::new();
                        for &(k, x, y, _) in &achados {
                            let (ex, ey) = (x as f64 * escala + dx, y as f64 * escala);
                            let folga = (olhada.lado as f64 / 5.0).max(3.0);
                            match melhor_lugar(&olhada.foto, &olhada.grossa, &icones[k].1, olhada.lado, lugar) {
                                Some(a) if a.nota >= LIMIAR
                                    && (a.x as f64 - ex).abs() <= folga
                                    && (a.y as f64 - ey).abs() <= folga =>
                                {
                                    certos += 1;
                                    pior = pior.min(a.nota);
                                }
                                outro => erros.push(format!(
                                    "{} {}",
                                    icones[k].0,
                                    outro.map_or("nada".into(), |a| format!("{:.2} em ({},{}) esperado ({ex:.0},{ey:.0})", a.nota, a.x, a.y))
                                )),
                            }
                        }
                        let falsos: Vec<String> = controle
                            .iter()
                            .filter_map(|&k| {
                                melhor_lugar(&olhada.foto, &olhada.grossa, &icones[k].1, olhada.lado, lugar)
                                    .filter(|a| a.nota >= LIMIAR)
                                    .map(|a| format!("{} {:.2}", icones[k].0, a.nota))
                            })
                            .collect();
                        texto += &format!(
                            "   {:18} lado {:3}  {}/{} certos (pior {:.2})  falsos {}/{}  {:5} ms {}{}\n",
                            nome,
                            olhada.lado,
                            certos,
                            achados.len(),
                            pior,
                            falsos.len(),
                            controle.len(),
                            inicio.elapsed().as_millis(),
                            if erros.is_empty() { String::new() } else { format!(" ERROS: {}", erros.join("; ")) },
                            if falsos.is_empty() { String::new() } else { format!(" FALSOS: {}", falsos.join("; ")) },
                        );
                    }
                    texto
                })
            })
            .collect();
        fios.into_iter().map(|f| f.join().unwrap()).collect()
    });
    for linha in linhas {
        print!("{linha}");
    }
}

/// O que o laço dos painéis lê numa foto, do mesmo jeito que ele faz.
fn ler_paineis(tela: &Foto) -> (Leitura, [f64; 3], Option<f64>) {
    let altura = tela.altura;
    let (largura, alto) = tamanho_da_foto(altura);
    let mut leitura = None;
    let mut nota_painel = [0.0; 3];
    if largura <= tela.largura {
        nota_painel = notas(&recorte(tela, 0, 0, largura, alto), altura, None);
        leitura = Some(ler(nota_painel));
    }
    let mut nota_compra = None;
    if leitura != Some(Leitura::Aberto) {
        if let Some(faixa) = faixa_da_compra(tela.largura, altura) {
            let foto = recorte(tela, 0, faixa.topo, faixa.largura, faixa.alto);
            let nota = nota_da_compra(&foto, altura, faixa.topo, None);
            let mut da_compra = ler_compra(&nota);
            if da_compra == Leitura::Duvida && nota.janela.is_none() {
                da_compra = Leitura::Fechado;
            }
            nota_compra = Some(nota.inteiro);
            leitura = Some(leitura.map_or(da_compra, |l| juntar(l, da_compra)));
        }
    }
    (leitura.unwrap_or(Leitura::Duvida), nota_painel, nota_compra)
}

#[test]
fn bancada_paineis() {
    let Some(pasta) = pasta() else { return };
    let quadros = quadros(&pasta, &["recompensa", "loja", "arvore", "zona_nova", "mapa_tab"]);
    println!("\n== PAINÉIS: {} fotos", quadros.len());
    let linhas: Vec<String> = std::thread::scope(|e| {
        let fios: Vec<_> = quadros
            .iter()
            .map(|q| {
                e.spawn(move || {
                    let (referencia, _, _) = ler_paineis(&q.foto);
                    let mut diferentes = Vec::new();
                    let mut resumo = Vec::new();
                    for (nome, largura, altura) in FORMATOS {
                        let (tela, _, _) = no_formato(&q.foto, largura, altura, if q.tipo == "loja" { Preso::Livre } else { Preso::Esquerda });
                        let (leitura, painel, compra) = ler_paineis(&tela);
                        let maior = painel.iter().cloned().fold(0.0, f64::max);
                        resumo.push(format!("{maior:.2}/{}", compra.map_or("-".into(), |c| format!("{c:.2}"))));
                        if leitura != referencia {
                            diferentes.push(format!("{nome}: {leitura:?} (painel {painel:.2?}, compra {compra:.2?})"));
                        }
                    }
                    format!(
                        "{:20} original {:?}; notas por formato {}{}\n",
                        q.nome,
                        referencia,
                        resumo.join(" "),
                        if diferentes.is_empty() { String::new() } else { format!("\n   DIFERENTE: {}", diferentes.join("\n   DIFERENTE: ")) }
                    )
                })
            })
            .collect();
        fios.into_iter().map(|f| f.join().unwrap()).collect()
    });
    for linha in linhas {
        print!("{linha}");
    }
}

pub(crate) fn arvore_do_app() -> arvore_visao::Arvore {
    let caminho = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/dados/arvore/arvore.json");
    let o: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(caminho).unwrap()).unwrap();
    let nos = o["nos"].as_array().unwrap();
    let ids = nos.iter().map(|n| n[0].as_u64().unwrap() as u32).collect();
    let xs = nos.iter().map(|n| n[1].as_f64().unwrap() as f32).collect();
    let ys = nos.iter().map(|n| n[2].as_f64().unwrap() as f32).collect();
    let tipos = nos.iter().map(|n| n[3].as_u64().unwrap() as u8).collect();
    let ligacoes: Vec<u32> = o["ligacoes"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as u32).collect();
    arvore_visao::Arvore::nova(ids, xs, ys, tipos, &ligacoes).unwrap()
}

fn bgrx(foto: &Foto) -> Vec<u8> {
    foto.rgb.chunks_exact(3).flat_map(|p| [p[2], p[1], p[0], 0]).collect()
}

/// A foto pequena da porta: 1 ponto a cada 8, sem média (como o `StretchBlt` com `COLORONCOLOR`).
fn pequena(foto: &Foto) -> Foto {
    let (largura, altura) = (foto.largura / 8, foto.altura / 8);
    let mut rgb = Vec::with_capacity(largura * altura * 3);
    for y in 0..altura {
        for x in 0..largura {
            let i = (y * 8 * foto.largura + x * 8) * 3;
            rgb.extend_from_slice(&foto.rgb[i..i + 3]);
        }
    }
    Foto { largura, altura, rgb }
}

#[test]
fn bancada_arvore() {
    let Some(pasta) = pasta() else { return };
    let arvore = arvore_do_app();
    let quadros = quadros(&pasta, &["arvore", "zona_nova", "mapa_tab", "recompensa"]);
    println!("\n== ÁRVORE: {} fotos", quadros.len());
    // Uma foto por vez: a procura já usa vários fios.
    for q in &quadros {
        let registro = |foto: &Foto| {
            let pontos = bgrx(foto);
            let inicio = Instant::now();
            let r = arvore_visao::registrar(
                &arvore_visao::Foto { largura: foto.largura, altura: foto.altura, bgrx: &pontos },
                &arvore,
                None,
            );
            let p = pequena(foto);
            let pp = bgrx(&p);
            let parece = arvore_visao::parece_arvore(&arvore_visao::Foto { largura: p.largura, altura: p.altura, bgrx: &pp });
            (r, parece, inicio.elapsed().as_millis())
        };
        let (base, parece_base, _) = registro(&q.foto);
        println!(
            "{:20} original: parece {parece_base} {}",
            q.nome,
            base.map_or("nada".into(), |r| format!(
                "aceito {} n {} bons {}/{} desl {} em ({:.0},{:.0})",
                r.aceito, r.encaixe.n, r.bons, r.total, r.deslocados, r.encaixe.tx, r.encaixe.ty
            ))
        );
        for (nome, largura, altura) in FORMATOS {
            let (tela, escala, dx) = no_formato(&q.foto, largura, altura, Preso::Meio);
            let (r, parece, ms) = registro(&tela);
            let mut aviso = String::new();
            let aceito = r.is_some_and(|r| r.aceito);
            if aceito != base.is_some_and(|b| b.aceito) || parece != parece_base {
                aviso += " DIFERENTE";
            }
            if let (Some(r), Some(b)) = (r.filter(|r| r.aceito), base.filter(|b| b.aceito)) {
                let (ex, ey) = (b.encaixe.tx as f64 * escala + dx, b.encaixe.ty as f64 * escala);
                let erro = ((r.encaixe.tx as f64 - ex).powi(2) + (r.encaixe.ty as f64 - ey).powi(2)).sqrt();
                if r.encaixe.n != b.encaixe.n || erro > 0.01 * altura as f64 {
                    aviso += &format!(" ENCAIXE n {} vs {}, erro {erro:.0} pontos", r.encaixe.n, b.encaixe.n);
                }
            }
            println!(
                "   {:18} parece {parece:5} {} {ms:5} ms{aviso}",
                nome,
                r.map_or("nada".into(), |r| format!("aceito {:5} n {:2} bons {:3}/{:3} desl {:3}", r.aceito, r.encaixe.n, r.bons, r.total, r.deslocados)),
            );
        }
    }
}

/// Quanto custa uma olhada do laço da visão (foto reduzida e seis gemas), num fio só, com a largura
/// olhada de antes (0,95 altura) e com a de agora (o espaço livre à esquerda do inventário).
#[test]
fn bancada_tempo() {
    let Some(pasta) = pasta() else { return };
    let icones = icones(&pasta);
    let gemas: Vec<&Icone> = icones.iter().filter(|(nome, _)| nome.starts_with("SkillGem")).map(|(_, i)| i).take(6).collect();
    let quadros = quadros(&pasta, &["recompensa", "loja"]);
    println!("
== TEMPO de uma olhada com {} gemas (média de 3)", gemas.len());
    for (nome, largura, altura) in [FORMATOS[3], FORMATOS[4], FORMATOS[5], FORMATOS[10], FORMATOS[11]] {
        let mut tempos = [0f64; 2];
        let mut vezes = 0;
        // Só a loja: a foto inteira e o pedaço da janela de compra (com o recorte), quando vista.
        let (mut na_loja, mut na_janela, mut vezes_na_loja) = (0f64, 0f64, 0);
        let (mut na_recompensa, mut vezes_na_recompensa) = (0f64, 0);
        // Procurar a janela de recompensa (em todas as fotos: é o que custa a cada olhada).
        let mut procura_da_recompensa = 0f64;
        for q in quadros.iter().filter(|q| q.foto.altura == 1080) {
            let lugar = if q.tipo == "loja" { Lugar::Loja } else { Lugar::Recompensa };
            let (tela, _, _) = no_formato(&q.foto, largura, altura, Preso::Livre);
            let fracao = if lugar == Lugar::Loja { FRACAO_NA_LOJA } else { FRACAO_NA_RECOMPENSA };
            let lado = (altura as f32 * fracao).round() as usize;
            for (k, olhada) in [((altura as f32 * 0.95) as usize).min(largura), largura_olhada(largura, altura)].into_iter().enumerate() {
                let foto = recorte(&tela, 0, 0, olhada, altura);
                for _ in 0..3 {
                    let inicio = Instant::now();
                    let grossa = FotoGrossa::nova(&foto, fator_pro_lado(lado));
                    for icone in &gemas {
                        std::hint::black_box(melhor_lugar(&foto, &grossa, icone, lado, lugar));
                    }
                    let ms = inicio.elapsed().as_secs_f64() * 1000.0;
                    tempos[k] += ms;
                    if k == 1 && lugar == Lugar::Recompensa {
                        na_recompensa += ms;
                        vezes_na_recompensa += 1;
                    }
                }
            }
            vezes += 3;
            let foto = recorte(&tela, 0, 0, largura_olhada(largura, altura), altura);
            for _ in 0..3 {
                let inicio = Instant::now();
                std::hint::black_box(nota_da_recompensa(&foto));
                procura_da_recompensa += inicio.elapsed().as_secs_f64() * 1000.0;
            }
            if lugar != Lugar::Loja {
                continue;
            }
            let janela = faixa_da_compra(tela.largura, altura).and_then(|faixa| {
                let foto = recorte(&tela, 0, faixa.topo, faixa.largura, faixa.alto);
                nota_da_compra(&foto, altura, faixa.topo, None).janela
            });
            let foto = recorte(&tela, 0, 0, largura_olhada(largura, altura), altura);
            let agora = Instant::now();
            let janela = janela.map(|j| [j.esquerda, j.topo, j.direita, j.base].map(|v| v as i32));
            let Loja::Aberta(pedaco) = loja_de(Some((agora, janela)), false, agora, (0, 0), foto.largura, altura) else {
                continue;
            };
            let mut recortada = Foto { largura: 0, altura: 0, rgb: Vec::new() };
            for _ in 0..3 {
                let inicio = Instant::now();
                let grossa = FotoGrossa::nova(&foto, fator_pro_lado(lado));
                for icone in &gemas {
                    std::hint::black_box(melhor_lugar(&foto, &grossa, icone, lado, lugar));
                }
                na_loja += inicio.elapsed().as_secs_f64() * 1000.0;
                let inicio = Instant::now();
                recortar(&foto, pedaco, &mut recortada);
                let grossa = FotoGrossa::nova(&recortada, fator_pro_lado(lado));
                for icone in &gemas {
                    std::hint::black_box(melhor_lugar(&recortada, &grossa, icone, lado, lugar));
                }
                na_janela += inicio.elapsed().as_secs_f64() * 1000.0;
            }
            vezes_na_loja += 3;
        }
        println!(
            "   {:18} antes {:6.1} ms   agora {:6.1} ms (largura {} -> {})   recompensa {:6.1} ms (achar a janela {:5.1} ms)   loja: inteira {:6.1} ms, na janela {:6.1} ms ({} fotos)",
            nome,
            tempos[0] / vezes as f64,
            tempos[1] / vezes as f64,
            ((altura as f32 * 0.95) as usize).min(largura),
            largura_olhada(largura, altura),
            na_recompensa / vezes_na_recompensa.max(1) as f64,
            procura_da_recompensa / vezes.max(1) as f64,
            na_loja / vezes_na_loja.max(1) as f64,
            na_janela / vezes_na_loja.max(1) as f64,
            vezes_na_loja / 3,
        );
    }
}

/// Quanto custa, em média, uma olhada com seis gemas da recompensa por achar (duas fixas e quatro
/// que se revezam), com a compra fechada. Antes, toda olhada procurava quatro delas na foto
/// inteira. Agora, com a janela de recompensa reconhecida, procura só no pedaço dela; sem ela, na
/// foto inteira uma olhada a cada quatro (e procura a janela em toda olhada).
#[cfg(windows)]
#[test]
fn bancada_olhada_da_recompensa() {
    use crate::visao::{olhar, Alvo, Olhadas, Visto};
    let Some(pasta) = pasta() else { return };
    let icones = icones(&pasta);
    let alvos: Vec<Alvo> = icones
        .iter()
        .filter(|(nome, _)| nome.starts_with("SkillGem"))
        .take(6)
        .map(|(nome, icone)| Alvo { id: nome.clone(), na_loja: false, icone: icone.clone() })
        .collect();
    let quadros = quadros(&pasta, &["recompensa", "loja", "arvore", "zona_nova", "mapa_tab"]);
    const OLHADAS: usize = 8;
    println!("\n== OLHADA com {} gemas da recompensa por achar (média de {OLHADAS} olhadas por foto)", alvos.len());
    for (nome, largura, altura) in [FORMATOS[3], FORMATOS[4], FORMATOS[5], FORMATOS[10], FORMATOS[11]] {
        // [com a janela vista, sem]: (antes, agora, fotos)
        let mut somas = [(0f64, 0f64, 0usize); 2];
        for q in &quadros {
            let preso = if q.tipo == "recompensa" || q.tipo == "loja" { Preso::Livre } else { Preso::Esquerda };
            let (tela, _, _) = no_formato(&q.foto, largura, altura, preso);
            let foto = recorte(&tela, 0, 0, largura_olhada(largura, altura), altura);
            let k = if nota_da_recompensa(&foto).1.is_some() { 0 } else { 1 };

            let lado = alvos[0].lado_na_tela(altura);
            let inicio = Instant::now();
            let grossa = FotoGrossa::nova(&foto, fator_pro_lado(lado));
            for alvo in &alvos[..4] {
                std::hint::black_box(melhor_lugar(&foto, &grossa, &alvo.icone, lado, Lugar::Recompensa));
            }
            let antes = inicio.elapsed().as_secs_f64() * 1000.0;

            let mut olhadas = Olhadas::novas();
            let inicio = Instant::now();
            for _ in 0..OLHADAS {
                // Sempre por achar: as achadas também voltam a ser procuradas.
                let mut vistos = vec![Visto::default(); alvos.len()];
                olhar(&foto, &alvos, &mut vistos, &mut olhadas, Loja::Fechada);
            }
            let agora = inicio.elapsed().as_secs_f64() * 1000.0 / OLHADAS as f64;
            somas[k].0 += antes;
            somas[k].1 += agora;
            somas[k].2 += 1;
        }
        let media = |(antes, agora, fotos): (f64, f64, usize)| {
            let n = fotos.max(1) as f64;
            format!("antes {:6.1} ms, agora {:6.1} ms ({fotos} fotos)", antes / n, agora / n)
        };
        println!("   {:18} com a janela: {}   sem a janela: {}", nome, media(somas[0]), media(somas[1]));
    }
}

/// A busca da recompensa só dentro da janela de recompensa: em cada formato, a janela tem que ser
/// vista nas fotos da recompensa (e as gemas achadas no pedaço têm que ser as mesmas da foto
/// inteira), e nunca nas outras. Mostra também quanto custa procurar a janela.
#[test]
fn bancada_recompensa_na_janela() {
    let Some(pasta) = pasta() else { return };
    let icones = icones(&pasta);
    let quadros = quadros(&pasta, &["recompensa", "loja", "arvore", "zona_nova", "mapa_tab"]);
    println!("\n== RECOMPENSA NA JANELA: {} fotos", quadros.len());
    let linhas: Vec<String> = std::thread::scope(|e| {
        let fios: Vec<_> = quadros
            .iter()
            .map(|q| {
                let icones = &icones;
                e.spawn(move || {
                    let na_recompensa = q.tipo == "recompensa";
                    let mut texto = format!("{}\n", q.nome);
                    for (nome, largura, altura) in FORMATOS {
                        let preso = if q.tipo == "recompensa" || q.tipo == "loja" { Preso::Livre } else { Preso::Esquerda };
                        let (tela, _, _) = no_formato(&q.foto, largura, altura, preso);
                        let olhada = Olhada::nova(&tela, Lugar::Recompensa);
                        let inicio = Instant::now();
                        let (nota, janela) = nota_da_recompensa(&olhada.foto);
                        let ms_janela = inicio.elapsed().as_secs_f64() * 1000.0;
                        let Some(pedaco) = janela else {
                            texto += &format!(
                                "   {:18} nota {nota:.2}  não vista  {ms_janela:5.1} ms{}\n",
                                nome,
                                if na_recompensa { "  (recompensa não vista)" } else { "" }
                            );
                            continue;
                        };
                        if !na_recompensa {
                            texto += &format!("   {:18} nota {nota:.2}  {pedaco:?}  {ms_janela:5.1} ms  ERRO: vista fora da recompensa\n", nome);
                            continue;
                        }
                        let mut recorte_da_janela = Foto { largura: 0, altura: 0, rgb: Vec::new() };
                        let inicio = Instant::now();
                        recortar(&olhada.foto, pedaco, &mut recorte_da_janela);
                        let grossa = FotoGrossa::nova(&recorte_da_janela, fator_pro_lado(olhada.lado));
                        let mut ms_pedaco = inicio.elapsed().as_secs_f64() * 1000.0;
                        let mut ms_inteira = 0.0;
                        let (mut cheias, mut iguais, mut extras) = (0, 0, Vec::new());
                        let mut mais_embaixo = 0usize;
                        for (nome_icone, icone) in icones.iter().filter(|(n, _)| n.starts_with("SkillGem")) {
                            let inicio = Instant::now();
                            let inteira = melhor_lugar(&olhada.foto, &olhada.grossa, icone, olhada.lado, Lugar::Recompensa)
                                .filter(|a| a.nota >= LIMIAR);
                            ms_inteira += inicio.elapsed().as_secs_f64() * 1000.0;
                            let inicio = Instant::now();
                            let no_pedaco = melhor_lugar(&recorte_da_janela, &grossa, icone, olhada.lado, Lugar::Recompensa)
                                .filter(|a| a.nota >= LIMIAR)
                                .map(|a| (a.x + pedaco[0], a.y + pedaco[1]));
                            ms_pedaco += inicio.elapsed().as_secs_f64() * 1000.0;
                            if let Some(a) = inteira {
                                mais_embaixo = mais_embaixo.max(a.y + a.lado);
                            }
                            match (inteira, no_pedaco) {
                                (Some(a), Some((x, y))) => {
                                    cheias += 1;
                                    if a.x.abs_diff(x) <= 1 && a.y.abs_diff(y) <= 1 {
                                        iguais += 1;
                                    } else {
                                        extras.push(format!("{nome_icone} em outro lugar ({},{} {:.2}) x ({x},{y})", a.x, a.y, a.nota));
                                    }
                                }
                                (Some(a), None) => {
                                    cheias += 1;
                                    extras.push(format!("{nome_icone} PERDIDA ({},{} {:.2})", a.x, a.y, a.nota));
                                }
                                (None, Some(_)) => extras.push(format!("{nome_icone} só no pedaço")),
                                (None, None) => {}
                            }
                        }
                        let h = altura as f64;
                        texto += &format!(
                            "   {:18} nota {nota:.2}  topo {:.3}h  gemas até {:.3}h abaixo  {ms_janela:5.1} ms  pedaço {}x{}  {iguais}/{cheias} iguais  inteira {ms_inteira:6.0} ms  pedaço {ms_pedaco:6.0} ms{}\n",
                            nome,
                            (pedaco[1] as f64 + 0.01 * h) / h,
                            mais_embaixo.saturating_sub(pedaco[1]) as f64 / h,
                            pedaco[2] - pedaco[0],
                            pedaco[3] - pedaco[1],
                            if extras.is_empty() { String::new() } else { format!("  {}", extras.join("; ")) },
                        );
                    }
                    texto
                })
            })
            .collect();
        fios.into_iter().map(|f| f.join().unwrap()).collect()
    });
    for linha in linhas {
        print!("{linha}");
    }
}

/// A busca da loja só dentro da janela de compra: em cada formato, a janela tem que ser vista nas
/// fotos da loja (e as gemas achadas no pedaço têm que ser as mesmas da foto inteira), e nunca nas
/// da recompensa (senão as gemas da recompensa deixariam de ser procuradas).
#[test]
fn bancada_loja_na_janela() {
    let Some(pasta) = pasta() else { return };
    let icones = icones(&pasta);
    let quadros = quadros(&pasta, &["recompensa", "loja"]);
    println!("\n== LOJA NA JANELA: {} fotos", quadros.len());
    let linhas: Vec<String> = std::thread::scope(|e| {
        let fios: Vec<_> = quadros
            .iter()
            .map(|q| {
                let icones = &icones;
                e.spawn(move || {
                    let na_loja = q.tipo == "loja";
                    let mut texto = format!("{}\n", q.nome);
                    for (nome, largura, altura) in FORMATOS {
                        let (tela, _, _) = no_formato(&q.foto, largura, altura, Preso::Livre);
                        let janela = faixa_da_compra(tela.largura, altura).and_then(|faixa| {
                            let foto = recorte(&tela, 0, faixa.topo, faixa.largura, faixa.alto);
                            nota_da_compra(&foto, altura, faixa.topo, None).janela
                        });
                        let janela = janela.map(|j| [j.esquerda, j.topo, j.direita, j.base].map(|v| v as i32));
                        let agora = Instant::now();
                        let olhada = Olhada::nova(&tela, if na_loja { Lugar::Loja } else { Lugar::Recompensa });
                        let loja = loja_de(Some((agora, janela)), false, agora, (0, 0), olhada.foto.largura, altura);
                        if !na_loja {
                            let certo = loja == Loja::Fechada;
                            texto += &format!("   {:18} {:?}{}\n", nome, loja, if certo { "" } else { "  ERRO: compra vista na recompensa" });
                            continue;
                        }
                        let Loja::Aberta(pedaco) = loja else {
                            // Sem a janela vista, as gemas da loja não são procuradas: quantas a foto
                            // inteira acharia (só em 1920x1080, que é caro)?
                            let mut perdidas = Vec::new();
                            if nome == "1920x1080" {
                                for (nome_icone, icone) in icones.iter().filter(|(n, _)| n.starts_with("SkillGem")) {
                                    if melhor_lugar(&olhada.foto, &olhada.grossa, icone, olhada.lado, Lugar::Loja)
                                        .is_some_and(|a| a.nota >= LIMIAR)
                                    {
                                        perdidas.push(nome_icone.clone());
                                    }
                                }
                            }
                            texto += &format!("   {:18} {:?}  compra não vista; a foto inteira acha {:?}\n", nome, loja, perdidas);
                            continue;
                        };
                        // As gemas que a foto inteira acha, e o que o pedaço acha delas.
                        let mut recorte_da_janela = Foto { largura: 0, altura: 0, rgb: Vec::new() };
                        let inicio = Instant::now();
                        recortar(&olhada.foto, pedaco, &mut recorte_da_janela);
                        let grossa = FotoGrossa::nova(&recorte_da_janela, fator_pro_lado(olhada.lado));
                        let mut ms_pedaco = inicio.elapsed().as_secs_f64() * 1000.0;
                        let mut ms_inteira = 0.0;
                        let (mut cheias, mut iguais, mut extras) = (0, 0, Vec::new());
                        for (nome_icone, icone) in icones.iter().filter(|(n, _)| n.starts_with("SkillGem")) {
                            let inicio = Instant::now();
                            let inteira = melhor_lugar(&olhada.foto, &olhada.grossa, icone, olhada.lado, Lugar::Loja)
                                .filter(|a| a.nota >= LIMIAR);
                            ms_inteira += inicio.elapsed().as_secs_f64() * 1000.0;
                            let inicio = Instant::now();
                            let no_pedaco = melhor_lugar(&recorte_da_janela, &grossa, icone, olhada.lado, Lugar::Loja)
                                .filter(|a| a.nota >= LIMIAR)
                                .map(|a| (a.x + pedaco[0], a.y + pedaco[1]));
                            ms_pedaco += inicio.elapsed().as_secs_f64() * 1000.0;
                            match (inteira, no_pedaco) {
                                (Some(a), Some((x, y))) => {
                                    cheias += 1;
                                    if a.x.abs_diff(x) <= 1 && a.y.abs_diff(y) <= 1 {
                                        iguais += 1;
                                    } else {
                                        extras.push(format!("{nome_icone} em outro lugar"));
                                    }
                                }
                                (Some(_), None) => {
                                    cheias += 1;
                                    extras.push(format!("{nome_icone} PERDIDA"));
                                }
                                (None, Some(_)) => extras.push(format!("{nome_icone} só no pedaço")),
                                (None, None) => {}
                            }
                        }
                        texto += &format!(
                            "   {:18} pedaço {}x{}  {iguais}/{cheias} iguais  inteira {ms_inteira:6.0} ms  pedaço {ms_pedaco:6.0} ms{}\n",
                            nome,
                            pedaco[2] - pedaco[0],
                            pedaco[3] - pedaco[1],
                            if extras.is_empty() { String::new() } else { format!("  {}", extras.join("; ")) },
                        );
                    }
                    texto
                })
            })
            .collect();
        fios.into_iter().map(|f| f.join().unwrap()).collect()
    });
    for linha in linhas {
        print!("{linha}");
    }
}
