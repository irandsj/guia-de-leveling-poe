//! Bancada de prova: os quadros reais do estudo contra as respostas do protótipo em Python.
//!
//! Só roda com `GUIA_PROVA_ARVORE` apontando pra pasta da bancada (`indice.json`, `rgb/`,
//! `esperado/`; as árvores ficam em `../compacto`). Os quadros não vão pro repositório.
//! Rodar: `GUIA_PROVA_ARVORE=... cargo test --release -- --nocapture prova`.

mod comum;

use arvore_visao::{conferir, ler, registrar, Arvore, Encaixe, Foto, Leitura, Registro};
use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

fn json(caminho: &Path) -> serde_json::Value {
    let bytes = std::fs::read(caminho).unwrap_or_else(|e| panic!("{}: {e}", caminho.display()));
    serde_json::from_slice(&bytes).expect("json")
}

/// Código do protótipo pra cada leitura (`None` = o nó não aparece na resposta dele).
fn codigo(l: Leitura) -> Option<u64> {
    match l {
        Leitura::Livre => Some(0),
        Leitura::Alocado => Some(1),
        Leitura::NaoSei => Some(2),
        Leitura::Tapado => Some(3),
        Leitura::ForaDaTela => None,
    }
}

/// Compara a leitura com a do protótipo: (nós comparados, iguais).
fn comparar(arvore: &Arvore, lido: &[Leitura], esperado: &serde_json::Value) -> (usize, usize) {
    let (mut total, mut iguais) = (0, 0);
    for (i, l) in lido.iter().enumerate() {
        // O protótipo não lê início de classe nem encaixe grande.
        if arvore.tipos[i] > 4 {
            continue;
        }
        let dele = esperado.get(arvore.ids[i].to_string()).and_then(|v| v.as_u64());
        let meu = codigo(*l);
        if dele.is_none() && meu.is_none() {
            continue;
        }
        total += 1;
        iguais += (dele == meu) as usize;
    }
    (total, iguais)
}

fn mediana(v: &mut [f64]) -> f64 {
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(f64::total_cmp);
    v[v.len() / 2]
}

fn resumo(r: &Option<Registro>) -> String {
    match r {
        Some(r) => format!(
            "n {} t ({:.2}, {:.2}) nota {:.1} anéis {}/{} desl {}",
            r.encaixe.n, r.encaixe.tx, r.encaixe.ty, r.nota, r.bons, r.total, r.deslocados
        ),
        None => "nada".to_string(),
    }
}

#[derive(Default)]
struct Tempos {
    cheio: Vec<f64>,
    com_zoom: Vec<f64>,
    conferir_ler: Vec<f64>,
}

#[test]
fn prova() {
    let Ok(pasta) = std::env::var("GUIA_PROVA_ARVORE") else {
        println!("prova: sem GUIA_PROVA_ARVORE, pulei");
        return;
    };
    let pasta = Path::new(&pasta);
    let indice = json(&pasta.join("indice.json"));
    let indice = indice.as_array().expect("lista");
    let mut arvores: HashMap<String, Arvore> = HashMap::new();
    let mut tempos: HashMap<(usize, usize), Tempos> = HashMap::new();

    let (mut decisao_igual, mut aceitos_dele, mut aceitos_meus, mut aceitos_dos_dois) = (0, 0, 0, 0);
    let (mut n_igual, mut maior_dt) = (0, 0.0f64);
    let (mut zoom_igual, mut zoom_total) = (0, 0);
    let (mut nos, mut nos_iguais, mut pior_quadro) = (0usize, 0usize, 1.0f64);
    let (mut nos_puro, mut nos_iguais_puro) = (0usize, 0usize);
    let mut divergentes: Vec<String> = Vec::new();

    for item in indice {
        let nome = item["arquivo"].as_str().expect("arquivo");
        let versao = item["versao"].as_str().expect("versao");
        let (w, h) = (item["largura"].as_u64().unwrap() as usize, item["altura"].as_u64().unwrap() as usize);
        let arvore = arvores.entry(versao.to_string()).or_insert_with(|| {
            let c = pasta.join("..").join("compacto").join(format!("arvore-{versao}.json"));
            comum::arvore_de(&std::fs::read_to_string(&c).unwrap_or_else(|e| panic!("{}: {e}", c.display())))
        });
        let rgb = std::fs::read(pasta.join("rgb").join(format!("{nome}.rgb"))).expect("rgb");
        assert_eq!(rgb.len(), w * h * 3, "{nome}");
        let mut bgrx = vec![0u8; w * h * 4];
        for (d, o) in bgrx.as_chunks_mut::<4>().0.iter_mut().zip(rgb.as_chunks::<3>().0) {
            d.copy_from_slice(&[o[2], o[1], o[0], 255]);
        }
        let foto = Foto { largura: w, altura: h, bgrx: &bgrx };
        let t = tempos.entry((w, h)).or_default();

        let agora = Instant::now();
        let r = registrar(&foto, arvore, None);
        t.cheio.push(agora.elapsed().as_secs_f64() * 1000.0);

        let dele = item["aceito"].as_bool().expect("aceito");
        let meu = r.is_some_and(|r| r.aceito);
        aceitos_dele += dele as usize;
        aceitos_meus += meu as usize;
        let do_python = format!(
            "n {} t ({}, {}) nota {} anéis {}/{} desl {}",
            item["n"], item["tx"], item["ty"], item["nota"], item["aneis_bons"], item["aneis_tot"], item["aneis_desloc"]
        );
        if dele == meu {
            decisao_igual += 1;
        } else {
            divergentes.push(format!("{nome}: DECISÃO python {dele} [{do_python}] | rust {meu} [{}]", resumo(&r)));
        }
        if !dele {
            continue;
        }
        let esperado = json(&pasta.join("esperado").join(format!("{nome}.json")));
        let n_dele = item["n"].as_u64().unwrap() as u32;
        let (tx_dele, ty_dele) = (item["tx"].as_f64().unwrap(), item["ty"].as_f64().unwrap());
        let encaixe_dele = Encaixe { n: n_dele, s: item["s"].as_f64().unwrap() as f32, tx: tx_dele as f32, ty: ty_dele as f32 };

        // A leitura no encaixe do protótipo (mede só o porte do `ler`).
        let mut lido = Vec::new();
        ler(&foto, arvore, &encaixe_dele, &[], &mut lido);
        let (total, iguais) = comparar(arvore, &lido, &esperado["estados"]);
        nos_puro += total;
        nos_iguais_puro += iguais;
        if iguais != total {
            divergentes.push(format!("{nome}: LER no encaixe do python: {iguais} de {total}"));
        }

        let Some(r) = r.filter(|r| r.aceito) else { continue };
        aceitos_dos_dois += 1;
        let dt = (r.encaixe.tx as f64 - tx_dele).abs().max((r.encaixe.ty as f64 - ty_dele).abs());
        if r.encaixe.n == n_dele {
            n_igual += 1;
            maior_dt = maior_dt.max(dt);
        }
        if r.encaixe.n != n_dele || dt > 0.5 {
            divergentes.push(format!("{nome}: ENCAIXE python [{do_python}] | rust [{}]", resumo(&Some(r))));
        }

        // Com o zoom dado tem de sair o mesmo encaixe.
        let agora = Instant::now();
        let z = registrar(&foto, arvore, Some(n_dele));
        t.com_zoom.push(agora.elapsed().as_secs_f64() * 1000.0);
        zoom_total += 1;
        if z.is_some_and(|z| z.aceito && z.encaixe == r.encaixe) {
            zoom_igual += 1;
        } else {
            divergentes.push(format!("{nome}: ZOOM DADO [{}] | cheio [{}]", resumo(&z), resumo(&Some(r))));
        }

        // Conferir + ler no encaixe achado aqui.
        let agora = Instant::now();
        let c = conferir(&foto, arvore, &r.encaixe, &[]);
        ler(&foto, arvore, &r.encaixe, &[], &mut lido);
        t.conferir_ler.push(agora.elapsed().as_secs_f64() * 1000.0);
        assert!(c.bons <= r.bons && c.total <= r.total, "{nome}: conferir {c:?} x registro {r:?}");
        let (total, iguais) = comparar(arvore, &lido, &esperado["estados"]);
        nos += total;
        nos_iguais += iguais;
        let fracao = if total > 0 { iguais as f64 / total as f64 } else { 1.0 };
        pior_quadro = pior_quadro.min(fracao);
        if fracao < 0.97 {
            divergentes.push(format!("{nome}: ESTADOS {iguais} de {total} ({:.1}%)", 100.0 * fracao));
        }
    }

    println!("\n== bancada: {} quadros ==", indice.len());
    println!("decisão igual: {decisao_igual} de {} (python aceitou {aceitos_dele}, rust {aceitos_meus})", indice.len());
    println!("aceitos pelos dois: {aceitos_dos_dois}; mesmo n em {n_igual}; maior diferença de encaixe {maior_dt:.3} ponto");
    println!("zoom dado = procura cheia: {zoom_igual} de {zoom_total}");
    println!(
        "estados iguais (encaixe do rust): {nos_iguais} de {nos} ({:.3}%); pior quadro {:.2}%",
        100.0 * nos_iguais as f64 / nos.max(1) as f64,
        100.0 * pior_quadro
    );
    println!(
        "estados iguais (encaixe do python): {nos_iguais_puro} de {nos_puro} ({:.3}%)",
        100.0 * nos_iguais_puro as f64 / nos_puro.max(1) as f64
    );
    let mut chaves: Vec<_> = tempos.keys().copied().collect();
    chaves.sort();
    for k in chaves {
        let t = tempos.get_mut(&k).unwrap();
        let maximo = t.cheio.iter().copied().fold(0.0, f64::max);
        let maximo_cl = t.conferir_ler.iter().copied().fold(0.0, f64::max);
        println!(
            "{}x{}: registrar cheio {:.0} ms (máx {:.0}, {} quadros) | com zoom {:.0} ms | conferir + ler {:.2} ms (máx {:.2})",
            k.0,
            k.1,
            mediana(&mut t.cheio),
            maximo,
            t.cheio.len(),
            mediana(&mut t.com_zoom),
            mediana(&mut t.conferir_ler),
            maximo_cl,
        );
    }
    println!("divergentes: {}", divergentes.len());
    for d in &divergentes {
        println!("  {d}");
    }

    assert!(indice.len() - decisao_igual <= 2, "decisões diferentes demais");
    assert_eq!(n_igual, aceitos_dos_dois, "zoom diferente em quadro aceito");
    assert!(maior_dt <= 0.5, "encaixe longe do protótipo: {maior_dt}");
    assert!(nos_iguais as f64 >= 0.99 * nos as f64, "estados iguais abaixo de 99%");
    assert!(pior_quadro >= 0.97, "um quadro abaixo de 97%");
}
