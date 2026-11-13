//! A dica do jogo por cima da árvore: a janelinha que o jogo abre com o mouse em cima de um nó e a
//! lista de efeitos que abre ao clicar numa maestria. O corpo dela é quase preto, e o fundo da
//! árvore não é: é por aí que a foto mostra que ela está aberta.
//!
//! Só contas em cima da foto que o laço já tirou. Nem mouse, nem teclado, nada do jogo.

use arvore_visao::Foto;

/// Lado do bloco, como fração da altura da foto (1080: 20 pontos).
const BLOCO: f32 = 1.0 / 54.0;
/// Menor lado de bloco, em pontos.
const MENOR_BLOCO: usize = 8;
/// Amostras por lado do bloco (de tantos em tantos pontos).
const AMOSTRAS_POR_LADO: usize = 10;
/// Ponto quase preto: nenhum canal passa disto. Medido em prints do jogo: o corpo da dica tem
/// mediana 2; o fundo da árvore fica entre 16 e 18.
const PRETO: u8 = 10;
/// Bloco do corpo da dica: pelo menos esta fração das amostras é quase preta. Medido: ~0,75 no
/// corpo (as letras ficam com o resto), menos de 0,05 no fundo da árvore.
const FRACAO_PRETA: f32 = 0.55;
/// Quantos blocos quase pretos dentro do retângulo bastam pra dizer que a dica está ali. A dica
/// menor (um nó comum, uma linha) já tem dezenas de blocos.
const BLOCOS_DA_DICA: usize = 6;

/// Há uma dica do jogo aberta dentro do retângulo (x0, y0)–(x1, y1), em pontos da foto?
/// Os blocos com o meio em `proibido` (partes fixas da interface, o painel do guia) não contam.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn dica_no_retangulo(
    foto: &Foto,
    (x0, y0, x1, y1): (f32, f32, f32, f32),
    proibido: &dyn Fn(f32, f32) -> bool,
) -> bool {
    let (w, h) = (foto.largura, foto.altura);
    let cabe = w.checked_mul(h).and_then(|n| n.checked_mul(4)).is_some_and(|n| n > 0 && foto.bgrx.len() >= n);
    if !cabe || ![x0, y0, x1, y1].iter().all(|v| v.is_finite()) {
        return false;
    }
    let lado = ((h as f32 * BLOCO).round() as usize).max(MENOR_BLOCO);
    let passo = (lado / AMOSTRAS_POR_LADO).max(1);
    // Blocos da grade fixa que ficam inteiros na foto e tocam o retângulo.
    let faixa = |de: f32, ate: f32, inteiros: usize| {
        let inicio = (de.max(0.0) / lado as f32) as usize;
        let fim = ((ate.max(0.0) / lado as f32).ceil() as usize).min(inteiros);
        inicio.min(fim)..fim
    };
    let mut achados = 0;
    for by in faixa(y0, y1, h / lado) {
        for bx in faixa(x0, x1, w / lado) {
            let (px, py) = (bx * lado, by * lado);
            let meio = lado as f32 / 2.0;
            if proibido(px as f32 + meio, py as f32 + meio) {
                continue;
            }
            let (mut pretos, mut total) = (0usize, 0usize);
            for y in (py..py + lado).step_by(passo) {
                let Some(linha) = foto.bgrx.get(y * w * 4..(y + 1) * w * 4) else { continue };
                for x in (px..px + lado).step_by(passo) {
                    let Some(ponto) = linha.get(x * 4..x * 4 + 3) else { continue };
                    total += 1;
                    if ponto.iter().all(|c| *c <= PRETO) {
                        pretos += 1;
                    }
                }
            }
            if total > 0 && pretos as f32 >= FRACAO_PRETA * total as f32 {
                achados += 1;
                if achados >= BLOCOS_DA_DICA {
                    return true;
                }
            }
        }
    }
    false
}

#[cfg(test)]
mod testes {
    use super::*;

    const L: usize = 1920;
    const A: usize = 1080;

    /// Fundo de árvore (cinza 18, com um nó claro de tantos em tantos pontos).
    fn arvore() -> Vec<u8> {
        let mut bgrx = vec![0u8; L * A * 4];
        for y in 0..A {
            for x in 0..L {
                let i = (y * L + x) * 4;
                let claro = x % 60 < 6 && y % 60 < 6;
                let v = if claro { 140 } else { 18 };
                bgrx[i..i + 3].copy_from_slice(&[v + 8, v, v]);
            }
        }
        bgrx
    }

    /// Pinta uma dica: corpo quase preto, com uma linha de letras azuis a cada 40 pontos.
    fn pintar_dica(bgrx: &mut [u8], (x0, y0, x1, y1): (usize, usize, usize, usize)) {
        for y in y0..y1 {
            for x in x0..x1 {
                let i = (y * L + x) * 4;
                let letra = (y - y0) % 40 >= 14 && (y - y0) % 40 < 30 && x % 3 == 0;
                bgrx[i..i + 3].copy_from_slice(if letra { &[255, 136, 136] } else { &[3, 2, 2] });
            }
        }
    }

    fn nada(_: f32, _: f32) -> bool {
        false
    }

    #[test]
    fn so_o_corpo_preto_da_dica_conta() {
        let mut bgrx = arvore();
        let foto = Foto { largura: L, altura: A, bgrx: &bgrx };
        // Fundo da árvore, em qualquer lugar: nada.
        assert!(!dica_no_retangulo(&foto, (0.0, 0.0, L as f32, A as f32), &nada));

        pintar_dica(&mut bgrx, (1170, 770, 1960.min(L), 1080));
        let foto = Foto { largura: L, altura: A, bgrx: &bgrx };
        // O retângulo pega o corpo: achou. Pega só um canto de 2 blocos: pouco. Longe: nada.
        assert!(dica_no_retangulo(&foto, (1100.0, 700.0, 1500.0, 850.0), &nada));
        assert!(!dica_no_retangulo(&foto, (1100.0, 700.0, 1210.0, 800.0), &nada));
        assert!(!dica_no_retangulo(&foto, (200.0, 200.0, 800.0, 600.0), &nada));
        // Debaixo de parte proibida não conta.
        assert!(!dica_no_retangulo(&foto, (1100.0, 700.0, 1500.0, 850.0), &|x, _| x > 1000.0));
    }

    #[test]
    fn retangulo_e_foto_tortos_nao_quebram() {
        let mut bgrx = arvore();
        pintar_dica(&mut bgrx, (0, 0, L, A));
        let foto = Foto { largura: L, altura: A, bgrx: &bgrx };
        assert!(dica_no_retangulo(&foto, (-500.0, -500.0, 5000.0, 5000.0), &nada));
        assert!(!dica_no_retangulo(&foto, (f32::NAN, 0.0, 100.0, 100.0), &nada));
        assert!(!dica_no_retangulo(&foto, (0.0, 0.0, f32::INFINITY, 100.0), &nada));
        // Retângulo ao contrário ou fora da foto: vazio.
        assert!(!dica_no_retangulo(&foto, (900.0, 900.0, 100.0, 100.0), &nada));
        assert!(!dica_no_retangulo(&foto, (3000.0, 3000.0, 4000.0, 4000.0), &nada));
        // Buffer curto, foto vazia ou de tamanho absurdo.
        let curta = Foto { largura: L, altura: A, bgrx: &bgrx[..1000] };
        assert!(!dica_no_retangulo(&curta, (0.0, 0.0, 500.0, 500.0), &nada));
        let vazia = Foto { largura: 0, altura: 0, bgrx: &[] };
        assert!(!dica_no_retangulo(&vazia, (0.0, 0.0, 500.0, 500.0), &nada));
        let absurda = Foto { largura: usize::MAX, altura: 2, bgrx: &bgrx };
        assert!(!dica_no_retangulo(&absurda, (0.0, 0.0, 500.0, 500.0), &nada));
        // Foto menor que um bloco: nenhum bloco inteiro.
        let pequena = Foto { largura: 4, altura: 4, bgrx: &bgrx[..64] };
        assert!(!dica_no_retangulo(&pequena, (0.0, 0.0, 4.0, 4.0), &nada));
    }
}
