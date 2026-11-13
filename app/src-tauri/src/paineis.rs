//! Painel da esquerda do jogo (Mundo, Baú, vendedor…) aberto por baixo do balão: o balão vira
//! bolinha enquanto ele está aberto e volta quando ele fecha, e o botão de busca da loja aparece.
//! A interface cuida da forma; daqui só sai o evento "painel-do-jogo".
//!
//! Como se sabe que o painel está aberto: uma foto pequena do canto de cima, à esquerda, da tela
//! do jogo (o cabeçalho do painel, que tem a mesma arte no Mundo e no Baú) é comparada com o
//! desenho desse cabeçalho guardado aqui (`MODELO`). Nada é lido da memória do jogo e nada é
//! enviado a ele.
//!
//! A janela de compra do vendedor ("Purchase") não fica no canto: fica no meio do espaço à
//! esquerda do inventário. O cabeçalho dela (`MODELO_DA_COMPRA`) é procurado numa faixa da tela,
//! da esquerda até o inventário.

use std::sync::OnceLock;

use serde::Serialize;

use crate::casar::Foto;

/// Lado de uma célula do modelo, em alturas da tela do jogo.
const CELULA: f64 = 0.01;
/// O modelo tem 10 x 62 células: o cabeçalho inteiro do painel (0,10 x 0,62 alturas de tela).
const LINHAS: usize = 10;
const COLUNAS: usize = 62;
/// Largura do painel da esquerda, em alturas de tela (690 pontos com 1125 de altura).
pub(crate) const LARGURA_DO_PAINEL: f64 = 0.6133;
/// O cabeçalho é medido em três pedaços, cada um por si: a dica de um item pode tapar parte dele.
const PEDACOS: [(usize, usize); 3] = [(0, 21), (21, 42), (42, COLUNAS)];
/// Um pedaço parecido assim com o modelo já mostra o painel aberto. Nos prints de prova, o painel
/// aberto deu 0,99 em todo pedaço; em quase mil recortes do jogo sem painel, nada passou de 0,54.
const ABRE: f64 = 0.85;
/// Todos os pedaços abaixo disto contam como painel fechado. Entre um e outro, fica como estava.
const FECHA: f64 = 0.6;
/// Leituras seguidas de painel fechado até dar ele como fechado (uma dica pode tapar quase tudo
/// por um instante).
const LEITURAS_PRA_FECHAR: u32 = 2;
/// Com menos células que isto um pedaço não é medido (o balão pode tapar parte do cabeçalho).
const MINIMO_DE_CELULAS: usize = 12;
/// Sobreposição mínima, em pontos de cada lado, pra contar que o balão está por cima do painel.
const SOBRA_MINIMA: i64 = 8;

/// O cabeçalho da janela de compra tem 6 x 64 células: a barra de cima, com a placa do título
/// ("Purchase"), e a linha do "Select Items To Buy".
const LINHAS_DA_COMPRA: usize = 6;
const COLUNAS_DA_COMPRA: usize = 64;
/// Onde começa o modelo da compra, de cima pra baixo, em alturas de tela (189 pontos com 1125).
const TOPO_DA_COMPRA: f64 = 0.168;
/// A janela de compra muda de lugar com a largura da tela: o modelo é procurado da esquerda até o
/// inventário, de tanto em tanto (em alturas de tela), e um pouco pra cima e pra baixo.
const PASSO_DA_COMPRA: f64 = 0.0025;
const FOLGA_DA_COMPRA: f64 = 0.006;
/// Pedaços do cabeçalho da compra (6, pra sobrar um inteiro quando uma dica de item tapa metade
/// dele). Um pedaço bem parecido não abre a janela (em prints sem ela, um pedaço chegou a 0,67),
/// mas segura aberta uma janela que já foi vista.
const PEDACOS_DA_COMPRA: [(usize, usize); 6] = [(0, 11), (11, 21), (21, 32), (32, 43), (43, 54), (54, COLUNAS_DA_COMPRA)];
const SEGURA_A_COMPRA: f64 = 0.9;
/// A janela de compra inteira em volta do modelo, em alturas de tela a partir do canto dele:
/// esquerda, topo, direita e base (a base é a da caixa "Highlight Items").
const JANELA_DA_COMPRA: [f64; 4] = [-0.004, -0.011, 0.64, 0.663];

/// O campo de busca ("Type keywords here...") do Baú, em alturas de tela a partir do canto da área
/// de jogo: a esquerda dele e a base da barra "Highlight Items" (435 e 950 pontos com 1125).
const BUSCA_DO_BAU: [f64; 2] = [0.3867, 0.8444];
/// A esquerda do campo de busca da janela de compra, em alturas de tela a partir da esquerda da
/// janela (650 pontos com ela em 290). A base da barra da busca é a base da janela.
const BUSCA_DA_COMPRA: f64 = 0.32;
/// Vão entre a barra da busca e os botões, em alturas de tela.
const VAO_DA_BUSCA: f64 = 0.004;

/// Cor média de cada célula do cabeçalho da janela de compra, em RRGGBB, medida num print do
/// vendedor (Nessa). `------` são as abas (-1- -2- -3-), que mudam de um vendedor pro outro.
/// Nos prints de prova, ela deu 0,99 de 720 a 2160 de altura; sem ela, nada passou de 0,56.
const MODELO_DA_COMPRA: [&str; LINHAS_DA_COMPRA] = [
    "151b1b 191d1d 1a1e1f 151a1a 1b2021 1b2424 192021 171e1e 151c1d 191e20 1b2022 1a2122 192021 181f20 161c1d 171d1e 181e1f 191f20 171d1e 262622 1c1712 27211e 2a211d 1a1819 1a191a 1b1a1d 1e1d1f 34322f 36332f 1f1e1e 21201e 1e1f1d 1c1d1b 1d1c1c 1e1e1e 262524 242425 1d1d20 1a1b1d 19191a 1a1819 2b211d 26211e 1f1713 272622 161a1b 14191a 171d1e 191f1f 191f20 181f20 181e1f 151b1b 181f1f 1a1f20 1b2122 171d1e 181d1d 272b2a 212424 232625 3e3225 37291d 121413",
    "0f1414 161b1b 131817 212626 141818 171e1d 151c1c 121919 121919 111718 121818 121919 111919 202321 37352c 352e26 342e26 131818 131615 30251b 312721 322c27 26211e 1a1a1d 191a1d 1a1c20 1b1c20 4e4b42 5e5b4d 4a463b 7d7860 555444 5a5848 5b5849 6d6852 7b7662 35342f 1a1d20 1a1c20 191a1d 1a1a1d 27201e 332c27 302721 31251b 141714 131717 372e27 332c24 38342a 212420 121818 121819 121818 101717 13191b 121919 0e1212 141918 181c1d 312b23 5e3d29 45210d 1e1913",
    "0e1313 141817 171b1b 0f1212 111616 181f1f 192122 141a1b 121819 131a1b 141a1c 151b1c 151c1e 34362f 392b22 2d1f17 31251e 201c19 413227 251812 271c16 3a2c21 30251d 1d1c21 1a1b1f 191b1e 191b1d 202122 1c1c1f 2f2f2e 272725 2b2d28 1f2220 252524 252425 2d2d2c 252526 1a1b1e 191b1f 1a1b1e 1d1d20 32251e 392c22 271b14 261812 413227 1d1a15 2e231b 2e1f16 3b2d24 30312c 141a1a 121819 13191a 151b1d 141a1b 141b1c 141818 121716 1c2020 1d1b16 46210e 4b260f 151511",
    "0e0c0a 0b0907 0e0b08 100c08 100d0a 110d0a 100d09 100d0a 100f09 110e09 100e09 100e09 0f0d09 0f0d09 352a1f 1f1710 110e0a 2e251a 201710 1c150f 1a140f 201912 1d1611 221b16 201b16 201b16 1f1914 231e17 211b15 221d15 221c16 1f1a13 1f1a14 211b15 211b15 201b15 221c17 1d1712 1f1a15 1e1a15 1f1a14 1b150f 1e1812 19120e 18120d 1e1610 2c241a 0f0d0a 1f1610 352920 100d09 100e0a 100f0a 110f0a 110e0a 110f0a 110f0b 0f0d0a 0f0e09 0e0d08 0e0c08 100c08 0d0b08 0f0d0a",
    "181109 120d09 100c07 110c06 110c06 100b05 100b05 100c05 100b05 100c06 0f0b05 0f0a05 0d0905 0c0904 0d0905 0c0905 0d0905 0d0805 0c0805 0b0804 0a0704 0a0703 090703 ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ 090603 090603 090603 0a0704 0b0805 0b0804 0c0904 0c0904 0c0905 0e0a06 0f0a06 110b06 120c06 110b05 120c07 110b06 110b06 120d07 110c08 0f0a06 130c09 1b130b",
    "19120a 130c09 1e1309 1b1209 25180c 1d1309 1e140a 1b1309 20150a 20160b 23180c 18110a 22170a 1b130a 110b08 281b0d 1b120c 18110b 0d0a07 0c0a06 0c0906 0b0906 0b0805 ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ 090705 090705 0a0806 0b0907 0c0906 0c0906 0c0a07 0c0907 0d0907 0d0a07 0f0b07 110c08 100b07 0f0a06 0f0b06 0f0b05 0f0b06 0f0905 0e0906 0b0704 120d0a 1c140b",
];

/// Cor média de cada célula do cabeçalho com o painel aberto, em RRGGBB. `------` é uma célula
/// que muda de um painel pro outro (título, abas) e fica fora da conta. Medido em prints do Mundo
/// (dois) e do Baú (um), com o mesmo peso pros dois.
const MODELO: [&str; LINHAS] = [
    "161210 100e0c 0f0d0b 0f0d0b 100d0c 0f0e0c 110f0e 11100e 131411 121210 131411 141412 151614 151615 151615 151615 161716 141614 141412 131311 1d1b18 1d1b18 141412 141513 151513 12110f 181410 15100d 221910 221910 140f0c 1b140e 332515 241c13 13100e 151411 151614 161715 141614 161716 141514 161615 161715 161716 151716 171817 161817 141614 141514 151614 141513 131412 11110f 11110f 14120f 14110d 15120e 11100d 14110e 14110d 14110e 171411",
    "121110 080e0e 060b0b 060b0b 070d0d 090f0f 0a1010 0c1413 0f1918 0e1716 0e1716 101a19 111b1b 131e1f 172424 182424 182525 222a28 423a2a 604d32 664f33 785c3a 6a4f30 443624 151e1e 0e1111 32291d 443120 523b20 745a38 4b3622 5a4329 8a6a3a 49351e 3d2b1a 362a1c 131c1c 152020 2f2f26 433926 473a2a 3b3529 32312a 1e2522 162323 1b2929 1a2828 172423 111c1c 121c1c 111a1a 0c1514 0b1312 0b1211 131613 ------ 19120b 0f1312 17130f ------ ------ 141210",
    "111010 090d0d 090c0d 080b0b 090c0c 0a0d0e 0c1110 0e1514 0f1615 101817 101717 101716 111717 172020 172121 1f2725 49402e 785a36 8f7043 775c36 22180f 150f08 604728 6a4c28 352c20 2b2319 5f4224 5d4429 6a4b2e 5a462f ------ 615340 4a3523 775937 826740 7c5d36 1f1c16 32281a 564025 574228 503c25 6d512e 846339 62482b 4d3f2d 292a23 151d1d 141e1d 151d1d 0c1312 0e1413 0c1111 0b0f0f 0a0e0e 121110 ------ ------ 0f100f ------ ------ ------ ------",
    "120f0e 090908 0a0a09 090908 0a0a09 0d0d0c 0f0f0e 111210 121211 111210 161614 131211 1d1d1b 342e26 52412e 886840 a68753 a0824f 402f1c 171009 150f0a 1a130c 19130d 674a2d 715736 78572e 865f31 7a5c36 3e271c ------ ------ ------ 765439 3b261d 7d5f3a 9c7846 51371e 422f1c 4d3821 100c07 120d09 140f09 2b1f12 947747 a28252 8b6b42 5b452c 483a29 2d2923 151310 0f0e0d 0e0c0b 0e0c0a 0a0908 130e0b ------ ------ 0d0c0b ------ ------ ------ ------",
    "110d0c 151a19 181e1d 1b2222 272f2e 2c3433 3b4342 383f3f 393128 564027 574026 6b5436 8e7147 957546 a48754 7f6a42 17110b 1d150c 2c1f11 212322 323535 494131 4c3921 5c4323 6c4c23 71532e 584021 573e24 23150d 3a2117 553b25 684a30 341e14 25170f 4d3720 6e4f28 61461f 58401e 2a1e0c 2c200f 1c1c18 1a1f1f 221d17 22180e 3f321f 5b4b31 9a8254 9c7e4d 9a7b4a 8d6e47 5d462c 584227 322617 181a18 1b1f1f 232727 1d2222 171b1b 1f2322 212626 080908 ------",
    "0f0c0b 131817 171b1a 1c1f1f 181b1a 1a1d1d 1c2121 1c2222 181d1d 151614 1c1b16 2d2920 363124 1c1b16 141616 141716 141512 5a4227 362618 222726 514837 5e4925 806536 aa884c c4a262 c8a767 cdac6c bea064 b79c65 c5a96e d2b579 d0b177 c2a266 b19256 a7874d 9c7d45 9a7b45 8c6f3b 7b602f 6d5528 544221 282e2b 202929 4d3822 3e2c1b 0f0d0a 10100c 17150f 181812 1e1b14 10100d 0f1210 111717 0f1212 222423 181b1c 232726 544636 58351d 261d13 040504 171412",
    "0e0c0b 0f1312 131616 1a1e1e 171b1b 191e1e 181e1e 1c2424 202929 212b2a 222b2b 222b2b 242d2d 293334 283232 263030 1c2324 131412 342a1d 303632 695531 5c4a29 826837 a48448 c3a05f caa767 cdab6b ------ 927c54 aa9162 957d54 9c8256 8c7347 897143 ------ 9a7b41 987940 886b36 806432 745a2b 756237 403827 2d3738 2f261a 14110e 0b100f 0b0f0f 0b1010 131b1b 1d2626 1e2828 192021 182020 131919 121616 1d2020 191c1a 4e2410 412613 2f1d0e 040504 17140f",
    "0e0b0a 0f1110 101312 151817 0b0d0d 0d1011 131717 181c1c 191e1e 1b1f20 1f2525 232a2a 252c2c 252b2b 252b2b 232727 1d1f1f 191a1a 1d201f 282f2e 5d4e34 58482a 67552d 745e31 977c46 a48953 aa905a ad945f a78e5b a78e55 9d834a 957b45 947c48 8d7746 917845 8b713e 8d7441 7d6433 71592b 614c23 74643a 292721 1c1e1d 0f1110 101212 131515 111414 121616 1b2020 1a1f1f 1b2121 101414 0e1111 0a0d0d 141616 131616 101313 1e1209 2e1609 13110c 040404 15120f",
    "111111 0a1012 090e11 090e10 080e0f 080e10 080e10 090e11 0a0f11 0c1013 0d1215 0e1416 0f1619 0e1518 0f1619 11181b 10191c 10181c 131c1f 151e21 171f21 1d2625 282c26 433625 34291c 202824 1e2826 22211a 322215 382315 2a2319 2c2419 352212 31281e 222520 1f2a2a 1d211e 322c22 3e3526 303226 2b3129 161e21 141d1f 111a1d 10191c 0f181b 0f1719 0e1518 0d1417 0b1215 0a1013 090f12 080d10 070c0f 070d10 070d0f 070d0f 080e10 080e10 0a0f11 0a0f11 ------",
    "131314 0c1316 12181b ------ 0d1213 151615 141615 141616 151615 141615 151716 151717 161919 171b1a 181d1c 1b1f1d 1d211f 1f2322 212523 222725 232827 252a29 1f2b2c 222d2e 272f2e 26302f 2a322f 2b3231 2d3432 2f3534 2e3533 2f3635 303533 2d3433 2c3332 283230 252f2d 242d2c 232b2c 212a29 202727 192325 1d282a ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ 141514 090f12 ------ ------ ------ ------",
];

type Cor = [f64; 3];
type Tabela = [[Option<Cor>; COLUNAS]; LINHAS];
type TabelaDaCompra = [[Option<Cor>; COLUNAS_DA_COMPRA]; LINHAS_DA_COMPRA];

/// Lê um modelo do texto (RRGGBB por célula, `------` fora da conta).
fn ler_tabela<const L: usize, const C: usize>(texto: [&str; L]) -> [[Option<Cor>; C]; L] {
    let mut tabela = [[None; C]; L];
    for (linha, texto) in tabela.iter_mut().zip(texto) {
        for (celula, pedaco) in linha.iter_mut().zip(texto.split(' ')) {
            *celula = u32::from_str_radix(pedaco, 16)
                .ok()
                .map(|v| [(v >> 16 & 0xff) as f64, (v >> 8 & 0xff) as f64, (v & 0xff) as f64]);
        }
    }
    tabela
}

/// O modelo do painel da esquerda, lido uma vez só.
fn modelo() -> &'static Tabela {
    static LIDO: OnceLock<Tabela> = OnceLock::new();
    LIDO.get_or_init(|| ler_tabela(MODELO))
}

/// O modelo da janela de compra, lido uma vez só.
fn modelo_da_compra() -> &'static TabelaDaCompra {
    static LIDO: OnceLock<TabelaDaCompra> = OnceLock::new();
    LIDO.get_or_init(|| ler_tabela(MODELO_DA_COMPRA))
}

/// Onde começa a célula `k` (linha ou coluna), em pontos, numa tela com esta altura.
fn borda(k: usize, altura: usize) -> usize {
    ((k as f64 * CELULA) * altura as f64) as usize
}

/// Largura e altura, em pontos, da foto que cobre o cabeçalho numa tela com esta altura.
pub fn tamanho_da_foto(altura: usize) -> (usize, usize) {
    (borda(COLUNAS, altura), borda(LINHAS, altura))
}

/// Um retângulo em pontos, contado a partir do canto da área de jogo.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Retangulo {
    pub esquerda: i64,
    pub topo: i64,
    pub direita: i64,
    pub base: i64,
}

impl Retangulo {
    /// Quanto os dois se sobrepõem: (largura, altura), zero quando não se tocam.
    fn sobra(&self, outro: &Retangulo) -> (i64, i64) {
        (
            (self.direita.min(outro.direita) - self.esquerda.max(outro.esquerda)).max(0),
            (self.base.min(outro.base) - self.topo.max(outro.topo)).max(0),
        )
    }
}

/// Cor média de um pedaço da foto.
fn media(foto: &Foto, xa: usize, xb: usize, ya: usize, yb: usize) -> Cor {
    let mut soma = [0u64; 3];
    for y in ya..yb {
        let linha = &foto.rgb[(y * foto.largura + xa) * 3..(y * foto.largura + xb) * 3];
        for ponto in linha.chunks_exact(3) {
            soma[0] += ponto[0] as u64;
            soma[1] += ponto[1] as u64;
            soma[2] += ponto[2] as u64;
        }
    }
    let quantos = ((xb - xa) * (yb - ya)).max(1) as f64;
    [soma[0] as f64 / quantos, soma[1] as f64 / quantos, soma[2] as f64 / quantos]
}

/// Correlação normalizada entre duas listas de números (1 = mesmo desenho, 0 = nada a ver).
fn correlacao(a: &[f64], b: &[f64]) -> f64 {
    let n = a.len() as f64;
    let (media_a, media_b) = (a.iter().sum::<f64>() / n, b.iter().sum::<f64>() / n);
    let (mut cruzado, mut quadrado_a, mut quadrado_b) = (0.0, 0.0, 0.0);
    for (x, y) in a.iter().zip(b) {
        let (x, y) = (x - media_a, y - media_b);
        cruzado += x * y;
        quadrado_a += x * x;
        quadrado_b += y * y;
    }
    cruzado / ((quadrado_a * quadrado_b).sqrt() + 1e-6)
}

/// O quanto cada pedaço do cabeçalho parece com o modelo. `foto` começa no canto da área de jogo,
/// que tem esta `altura`. As células sob `tapada` (o balão, quando ele aparece nas fotos) ficam
/// fora da conta.
pub fn notas(foto: &Foto, altura: usize, tapada: Option<Retangulo>) -> [f64; 3] {
    let (largura, alto) = tamanho_da_foto(altura);
    if largura == 0 || foto.largura < largura || foto.altura < alto || foto.rgb.len() < foto.largura * foto.altura * 3 {
        return [0.0; 3];
    }
    let modelo = modelo();
    let mut saida = [0.0; 3];
    for (nota, &(de, ate)) in saida.iter_mut().zip(&PEDACOS) {
        let (mut nossos, mut deles) = (Vec::new(), Vec::new());
        for (j, linha) in modelo.iter().enumerate() {
            let (ya, yb) = (borda(j, altura), borda(j + 1, altura));
            for (i, celula) in linha.iter().enumerate().take(ate).skip(de) {
                let Some(cor) = celula else { continue };
                let (xa, xb) = (borda(i, altura), borda(i + 1, altura));
                let aqui = Retangulo { esquerda: xa as i64, topo: ya as i64, direita: xb as i64, base: yb as i64 };
                if tapada.is_some_and(|t| {
                    let (l, a) = t.sobra(&aqui);
                    l > 0 && a > 0
                }) {
                    continue;
                }
                nossos.extend(media(foto, xa, xb, ya, yb));
                deles.extend(cor);
            }
        }
        *nota = if nossos.len() < MINIMO_DE_CELULAS * 3 { 0.0 } else { correlacao(&nossos, &deles) };
    }
    saida
}

/// O que uma foto diz do painel.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Leitura {
    Aberto,
    Fechado,
    /// Parecido demais pra dizer fechado e de menos pra dizer aberto (uma dica tapando o
    /// cabeçalho, por exemplo): fica como estava.
    Duvida,
}

pub fn ler(notas: [f64; 3]) -> Leitura {
    if notas.iter().any(|&n| n >= ABRE) {
        Leitura::Aberto
    } else if notas.iter().all(|&n| n < FECHA) {
        Leitura::Fechado
    } else {
        Leitura::Duvida
    }
}

/// O painel de uma leitura pra outra: abre na hora, fecha só com leituras seguidas.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vigia {
    pub aberto: bool,
    fechadas: u32,
}

impl Vigia {
    pub fn anotar(&mut self, leitura: Leitura) {
        match leitura {
            Leitura::Aberto => {
                self.aberto = true;
                self.fechadas = 0;
            }
            Leitura::Fechado => {
                self.fechadas = self.fechadas.saturating_add(1);
                if self.fechadas >= LEITURAS_PRA_FECHAR {
                    self.aberto = false;
                }
            }
            Leitura::Duvida => self.fechadas = 0,
        }
    }
}

/// O balão (em pontos, a partir do canto da área de jogo) está por cima desta janela do jogo?
pub fn cobre(balao: Retangulo, janela: Retangulo) -> bool {
    let (largura, alto) = balao.sobra(&janela);
    largura >= SOBRA_MINIMA && alto >= SOBRA_MINIMA
}

/// O balão está por cima do painel da esquerda?
pub fn cobre_o_painel(balao: Retangulo, altura: usize) -> bool {
    let painel = Retangulo {
        esquerda: 0,
        topo: 0,
        direita: (LARGURA_DO_PAINEL * altura as f64) as i64,
        base: altura as i64,
    };
    cobre(balao, painel)
}

// ---------- A janela de compra do vendedor ----------

/// A faixa da tela onde se procura o cabeçalho da janela de compra, a partir do canto da área de
/// jogo: começa em `topo` e vai da esquerda até o inventário.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FaixaDaCompra {
    pub topo: usize,
    pub largura: usize,
    pub alto: usize,
}

pub fn faixa_da_compra(largura_da_area: usize, altura: usize) -> Option<FaixaDaCompra> {
    let h = altura as f64;
    let modelo = COLUNAS_DA_COMPRA as f64 * CELULA * h;
    let livre = largura_da_area as f64 - LARGURA_DO_PAINEL * h;
    let largura = livre.max(modelo + 2.0).ceil() as usize;
    if altura < 100 || largura > largura_da_area {
        return None;
    }
    Some(FaixaDaCompra {
        topo: ((TOPO_DA_COMPRA - FOLGA_DA_COMPRA) * h) as usize,
        largura,
        alto: ((LINHAS_DA_COMPRA as f64 * CELULA + 2.0 * FOLGA_DA_COMPRA) * h).ceil() as usize + 2,
    })
}

/// Somas acumuladas da foto: a cor média de qualquer retângulo sai com quatro contas.
struct Somas {
    largura: usize,
    soma: Vec<[u32; 3]>,
}

impl Somas {
    fn de(foto: &Foto) -> Somas {
        Somas::de_linhas(foto, 0, foto.altura)
    }

    /// Só das linhas `de..ate` da foto (a linha `de` vira a primeira).
    fn de_linhas(foto: &Foto, de: usize, ate: usize) -> Somas {
        let largura = foto.largura + 1;
        let altura = ate.min(foto.altura).saturating_sub(de);
        let mut soma = vec![[0u32; 3]; largura * (altura + 1)];
        for y in 0..altura {
            let mut linha = [0u32; 3];
            for x in 0..foto.largura {
                let p = ((y + de) * foto.largura + x) * 3;
                let acima = soma[y * largura + x + 1];
                for c in 0..3 {
                    linha[c] += foto.rgb[p + c] as u32;
                }
                soma[(y + 1) * largura + x + 1] = [acima[0] + linha[0], acima[1] + linha[1], acima[2] + linha[2]];
            }
        }
        Somas { largura, soma }
    }

    fn media(&self, xa: usize, xb: usize, ya: usize, yb: usize) -> Cor {
        let s = |x: usize, y: usize| self.soma[y * self.largura + x];
        let (ab, eb, ac, ec) = (s(xb, yb), s(xa, yb), s(xb, ya), s(xa, ya));
        let quantos = ((xb - xa) * (yb - ya)).max(1) as f64;
        std::array::from_fn(|k| ((ab[k] - eb[k]) - (ac[k] - ec[k])) as f64 / quantos)
    }
}

/// O que a foto da faixa diz da janela de compra.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct NotaDaCompra {
    /// O cabeçalho inteiro, no lugar mais parecido.
    pub inteiro: f64,
    /// O pedaço mais parecido, em qualquer lugar.
    pub pedaco: f64,
    /// Onde fica a janela (a partir do canto da área de jogo), quando o cabeçalho inteiro bateu.
    pub janela: Option<Retangulo>,
}

/// Procura o cabeçalho da janela de compra na `foto` da faixa, que começa na altura
/// `topo_da_foto` da área de jogo (com esta `altura`). As células sob `tapada` ficam de fora.
pub fn nota_da_compra(foto: &Foto, altura: usize, topo_da_foto: usize, tapada: Option<Retangulo>) -> NotaDaCompra {
    let h = altura as f64;
    let lado = CELULA * h;
    let (largo, alto) = (COLUNAS_DA_COMPRA as f64 * lado, LINHAS_DA_COMPRA as f64 * lado);
    let mut saida = NotaDaCompra::default();
    if altura == 0
        || foto.rgb.len() < foto.largura * foto.altura * 3
        || (foto.largura as f64) < largo + 1.0
        || (foto.altura as f64) < alto + 1.0
    {
        return saida;
    }
    let somas = Somas::de(foto);
    let modelo = modelo_da_compra();
    let passo = (PASSO_DA_COMPRA * h).max(1.0);
    let meio = TOPO_DA_COMPRA * h - topo_da_foto as f64;
    let voltas = (FOLGA_DA_COMPRA / PASSO_DA_COMPRA).round() as i32;
    let (mut nossos, mut deles) = (Vec::new(), Vec::new());
    let mut pedacos: [(Vec<f64>, Vec<f64>); PEDACOS_DA_COMPRA.len()] = Default::default();
    let mut lugar = None;
    let mut x = 0.0;
    while x + largo < foto.largura as f64 {
        for volta in -voltas..=voltas {
            let y = meio + volta as f64 * passo;
            if y < 0.0 || y + alto >= foto.altura as f64 {
                continue;
            }
            nossos.clear();
            deles.clear();
            pedacos.iter_mut().for_each(|(a, b)| {
                a.clear();
                b.clear();
            });
            for (j, linha) in modelo.iter().enumerate() {
                let (ya, yb) = ((y + j as f64 * lado) as usize, (y + (j + 1) as f64 * lado) as usize);
                for (i, celula) in linha.iter().enumerate() {
                    let Some(cor) = celula else { continue };
                    let (xa, xb) = ((x + i as f64 * lado) as usize, (x + (i + 1) as f64 * lado) as usize);
                    let aqui = Retangulo {
                        esquerda: xa as i64,
                        topo: (ya + topo_da_foto) as i64,
                        direita: xb as i64,
                        base: (yb + topo_da_foto) as i64,
                    };
                    if tapada.is_some_and(|t| {
                        let (l, a) = t.sobra(&aqui);
                        l > 0 && a > 0
                    }) {
                        continue;
                    }
                    let media = somas.media(xa, xb, ya, yb);
                    let pedaco = PEDACOS_DA_COMPRA.iter().position(|&(de, ate)| (de..ate).contains(&i)).unwrap_or(0);
                    nossos.extend(media);
                    deles.extend(cor);
                    pedacos[pedaco].0.extend(media);
                    pedacos[pedaco].1.extend(cor);
                }
            }
            if nossos.len() >= MINIMO_DE_CELULAS * 3 {
                let inteiro = correlacao(&nossos, &deles);
                if inteiro > saida.inteiro {
                    saida.inteiro = inteiro;
                    lugar = Some((x, y + topo_da_foto as f64));
                }
            }
            for (a, b) in &pedacos {
                if a.len() >= MINIMO_DE_CELULAS * 3 {
                    saida.pedaco = saida.pedaco.max(correlacao(a, b));
                }
            }
        }
        x += passo;
    }
    if saida.inteiro >= ABRE {
        saida.janela = lugar.map(|(x, y)| {
            let [e, t, d, b] = JANELA_DA_COMPRA.map(|v| v * h);
            Retangulo {
                esquerda: (x + e) as i64,
                topo: (y + t) as i64,
                direita: (x + d) as i64,
                base: (y + b) as i64,
            }
        });
    }
    saida
}

/// O que a nota diz da janela de compra: abre só com o cabeçalho inteiro; um pedaço bem
/// parecido (o resto tapado por uma dica) deixa como estava.
pub fn ler_compra(nota: &NotaDaCompra) -> Leitura {
    if nota.inteiro >= ABRE {
        Leitura::Aberto
    } else if nota.inteiro < FECHA && nota.pedaco < SEGURA_A_COMPRA {
        Leitura::Fechado
    } else {
        Leitura::Duvida
    }
}

/// O painel da esquerda e a janela de compra juntos: um aberto basta; fechado, só os dois.
pub fn juntar(a: Leitura, b: Leitura) -> Leitura {
    match (a, b) {
        (Leitura::Aberto, _) | (_, Leitura::Aberto) => Leitura::Aberto,
        (Leitura::Fechado, Leitura::Fechado) => Leitura::Fechado,
        _ => Leitura::Duvida,
    }
}

/// Onde fica o canto de cima, à esquerda, dos botões de busca, a partir do canto da área de jogo
/// (com esta `altura`): logo abaixo da barra da busca da janela de compra, se ela foi vista, ou da
/// do Baú, alinhado com o campo de digitar.
pub fn lugar_da_busca(altura: usize, compra: Option<Retangulo>) -> (i64, i64) {
    let h = altura as f64;
    let vao = (VAO_DA_BUSCA * h).ceil() as i64;
    match compra {
        Some(janela) => (janela.esquerda + (BUSCA_DA_COMPRA * h) as i64, janela.base + vao),
        None => ((BUSCA_DO_BAU[0] * h) as i64, (BUSCA_DO_BAU[1] * h) as i64 + vao),
    }
}

// ---------- A janela de recompensa da quest ----------
//
// A visão só procura as gemas da recompensa a cada olhada quando esta janela está na tela (sem ela
// vista, procura de tempos em tempos). A janela fica no meio do espaço livre à esquerda do
// inventário, mas sobe ou desce de um print pro outro: o cabeçalho é procurado numa faixa de alturas.

/// O cabeçalho da janela de recompensa tem 10 x 61 células: a barra de cima, com a placa do
/// título ("Reward"), e a faixa do "Select One Reward".
const LINHAS_DA_RECOMPENSA: usize = 10;
const COLUNAS_DA_RECOMPENSA: usize = 61;
/// Entre que alturas de tela fica o topo do cabeçalho (nos prints, de 0,29 a 0,33).
const TOPO_DA_RECOMPENSA: [f64; 2] = [0.20, 0.45];
/// O cabeçalho é procurado primeiro de célula em célula, numa grade com as médias das células já
/// tiradas (posta em `FASES_DA_RECOMPENSA` deslocamentos em cada direção, pra nenhum lugar ficar
/// longe de um olhado), e depois de pouco em pouco (em alturas de tela), em volta do mais parecido.
const FASES_DA_RECOMPENSA: usize = 2;
const PASSO_FINO_DA_RECOMPENSA: f64 = 0.0025;
const VOLTA_FINA_DA_RECOMPENSA: f64 = 0.01;
/// Nota a partir da qual a janela conta como aberta. Nos prints com ela, 0,98 ou mais (0,78 com a
/// câmera de quem fazia o vídeo tapando um canto); sem ela, nada passou de 0,50.
const ABRE_A_RECOMPENSA: f64 = 0.7;
/// Onde procurar as gemas, a partir do canto do cabeçalho, em alturas de tela: esquerda, topo,
/// direita e base (a base dá pra várias linhas de recompensas).
const JANELA_DA_RECOMPENSA: [f64; 4] = [-0.01, -0.01, 0.62, 0.50];

/// Cor média de cada célula do cabeçalho da janela de recompensa, em RRGGBB, medida num print da
/// GGG. `------` é texto (o título na placa e a frase da faixa), que muda com o idioma.
const MODELO_DA_RECOMPENSA: [&str; LINHAS_DA_RECOMPENSA] = [
    "151614 1d2322 181f1e 232b2b 2d3635 2c3737 253031 2c393b 2a3637 2b3435 2a3536 273333 2c3939 273534 2a3536 293334 2c3637 253031 2c3939 293535 293434 293333 50422b 6d4f2e 7f5e3a 755f3f 755c3f 614b35 322821 533b2f 7f583d 6f4d39 372b23 3e2e25 7b6245 7e6644 7e5e3b 815d38 746141 2c3533 283333 2c3637 253131 2c393a 293637 293335 2a3435 2c3637 263132 2b3837 2a3737 273332 2a3434 2b3535 273131 2a3231 282f2f 212726 222421 262a28 1d2120",
    "151514 141617 212424 1a1e1e 181d1d 171c1c 181e1e 161c1c 161b1b 171d1d 161c1c 151b1b 151b1b 131919 151a1a 171c1d 171c1d 141a1b 161c1d 141a1a 14191a 161c1c 30261d 806446 b18757 ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ 956e4b 645037 151b19 161c1c 171c1d 141a1b 161c1c 141a1a 14191a 151b1c 171d1d 141b1b 161b1c 151a1b 14191a 151a1a 151a1a 121616 1d201f 202223 302d25 6b4f38 472915 0f0f0d",
    "131312 0f1212 1e2122 151919 1c201f 141919 192122 151c1c 13191a 131a1b 141b1c 141b1c 141a1b 141a1b 13191a 13191a 141a1c 151c1d 131a1b 141a1b 13191a 121819 2e2c24 6d5734 b48243 ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ 91683e 655337 131717 13191a 141a1b 151c1e 141a1b 141b1c 13191a 131819 141a1b 151c1e 141b1b 141b1c 131a1b 121819 141c1d 0e1314 191c1c 171a1a 2f251b 4b2110 49280f 151410",
    "131110 0d0f0e 181b1b 0c0e0e 0c0e0e 121516 131717 101515 101314 0e1113 0e1414 0f1414 0f1414 0e1112 0f1313 0e1212 0f1313 0f1414 0f1414 0e1212 0e1313 0e1212 493d2d 776441 a67e44 ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ 856339 554529 1c1b17 0f1213 0e1313 0f1414 101414 0e1212 0f1313 0f1313 0e1212 0f1414 101414 0f1313 0e1212 0e1213 0d1211 101313 111514 131617 0d0d0d 241208 1d130c 0a0a0b",
    "14110e 14100e 14100e 14100e 15110f 15110f 14110e 14100e 14110f 15120f 15120f 17120e 15110f 14110e 14110e 15110e 15120f 14110e 14110e 14110f 15110f 15110f 28221a 4e3c26 402f1c 18110c 100c09 1c110b 2e1a0e 31180d 1b1009 22140b 321c0f 2e1d12 170f09 120d08 19100b 3f3025 3d3021 1e1813 14110f 15120e 15120e 16120e 15120e 14110d 14110d 14110d 14110e 14110e 14110e 14110e 15110f 14110d 14100d 13100c 13100e 14110f 14110d 16120f 181210",
    "1d110e 1d120e 1c110c 20130e 24150e 27160f 29160f 291710 2c1810 2b170f 2d1810 2a170f 2a170f 2a160f 2b170f 2c1810 2f1910 2e1810 2e170f 2f170f 30170e 32180f 33180d 32170c 30150d 2f150c 31160d 32160d 30140b 32150c 35170d 34170d 2e130b 2e140b 2e150c 2e150c 30170e 30170e 2f160e 2e160e 2a140d 28140d 26140d 27150e 28160e 29160f 29160f 24150e 26150f 22140e 24150f 23140e 23140e 25140f 22130e 21130d 1e100c 21130e 20120e 1f120e 2a130d",
    "21130f 26140f 0c090b 0e0a0d 0f0a0e 100a0e 100a0e 140b0d 190d0b 1b0b0c 1b0b0c 1b0c0c 1c0d0b 1c0e0c 1e0e0d 1e0e0d 1e0d0c 1f0e0c 1f0d0c 200d0a ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ 1d0c09 1b0c0a 1b0c0a 1a0b0b 190b0a 180b0c 180b0b 160c0b 140b0c 130b0d 10090b 100a0c 100a0d 0e0a0d 0e0a0d 0d0a0d 0d0a0d 0c090c 23120d 391a12",
    "261611 2f1610 130c0d 1f1311 3b2419 5d432b 42291b 1b0d0f 1b0d0f 1c0e0f 1c0e0f 1f0f0e 21100e 22100e 24100e 24100d 25100d 27110d 2c100b 30110a ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ 2c0f09 280e09 230f0b 210e0c 200e0b 200f0d 1e0f0c 1c0f0d 180d0d 160c0e 150c0d 150c0e 140c0f 2e1b13 664931 452c1b 201513 120b0d 2b1511 411d15",
    "321b15 421d15 160d0e 1b0f11 1d1212 1e1111 1c0f10 1c0f11 1c0e11 1c0e11 1c0e11 1f1010 24120f 26120f 27110e 28110d 2a120c 2c120c 2f120c 34120b ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ ------ 301109 2c110a 28100c 25100c 23100c 22100e 200f0e 1c0f0e 180d0d 160c0e 160c0e 160c0f 170d10 1a0e10 221411 1f1412 170d0f 140c0e 281310 3e1d15",
    "391f19 4a2219 2a1512 2b1511 281310 251210 251310 271311 2c1613 2b1412 2c1612 2c1511 2c1410 2e1511 2f1611 311611 341712 371710 38170f 3a1710 3e1811 3f1910 41190f 42190e 461a0f 481a0f 4a1a0e 4a190e 4a1a0e 4c1b0d 4a1b0d 4b1b0e 49190e 491a0f 48190e 461a0f 43180e 431a0f 40180f 3b170f 39160f 37160f 331510 311410 2f1510 2e1611 2c1510 2a1510 281311 251210 241210 241210 241210 231210 231210 231210 231210 22110e 1f100d 2c1510 3c1d14",
];

/// As células do modelo da recompensa que contam (linha, coluna, cor menos a média de todas) e o
/// tamanho disso tudo: a correlação de cada lugar sai numa passada só.
struct ModeloCentrado {
    celulas: Vec<(usize, usize, Cor)>,
    norma: f64,
}

fn modelo_da_recompensa() -> &'static ModeloCentrado {
    static LIDO: OnceLock<ModeloCentrado> = OnceLock::new();
    LIDO.get_or_init(|| {
        let tabela: [[Option<Cor>; COLUNAS_DA_RECOMPENSA]; LINHAS_DA_RECOMPENSA] = ler_tabela(MODELO_DA_RECOMPENSA);
        let mut celulas = Vec::new();
        for (j, linha) in tabela.iter().enumerate() {
            for (i, celula) in linha.iter().enumerate() {
                if let Some(cor) = celula {
                    celulas.push((j, i, *cor));
                }
            }
        }
        let media = celulas.iter().flat_map(|c| c.2).sum::<f64>() / (celulas.len() * 3).max(1) as f64;
        for celula in &mut celulas {
            celula.2 = celula.2.map(|v| v - media);
        }
        let norma = celulas.iter().flat_map(|c| c.2).map(|v| v * v).sum::<f64>().sqrt();
        ModeloCentrado { celulas, norma }
    })
}

/// O quanto um lugar parece com o cabeçalho (correlação, como `correlacao`), com `media(linha,
/// coluna)` dando a cor média de cada célula do lugar.
fn nota_da_recompensa_em(modelo: &ModeloCentrado, media: impl Fn(usize, usize) -> Cor) -> f64 {
    let (mut soma, mut quadrados, mut cruzado) = (0.0, 0.0, 0.0);
    for &(j, i, cor) in &modelo.celulas {
        let media = media(j, i);
        for k in 0..3 {
            soma += media[k];
            quadrados += media[k] * media[k];
            cruzado += media[k] * cor[k];
        }
    }
    let n = (modelo.celulas.len() * 3) as f64;
    let espalhado = (quadrados - soma * soma / n).max(0.0).sqrt();
    cruzado / (espalhado * modelo.norma + 1e-6)
}

/// Procura o cabeçalho da janela de recompensa na foto da visão (que começa no canto da área de
/// jogo e tem a altura dela). Devolve a nota do lugar mais parecido e, se a janela estiver aberta,
/// onde procurar as gemas, em pontos da foto (esquerda, topo, direita, base).
pub fn nota_da_recompensa(foto: &Foto) -> (f64, Option<[usize; 4]>) {
    let h = foto.altura as f64;
    let lado = CELULA * h;
    let (largo, alto) = (COLUNAS_DA_RECOMPENSA as f64 * lado, LINHAS_DA_RECOMPENSA as f64 * lado);
    if foto.altura < 100 || foto.rgb.len() < foto.largura * foto.altura * 3 || (foto.largura as f64) < largo + 2.0 {
        return (0.0, None);
    }
    // Só as linhas em que o cabeçalho pode estar, com folga pra procura fina.
    let folga = VOLTA_FINA_DA_RECOMPENSA * h;
    let de = (TOPO_DA_RECOMPENSA[0] * h - folga).max(0.0) as usize;
    let ate = ((TOPO_DA_RECOMPENSA[1] * h + folga + alto).ceil() as usize + 1).min(foto.altura);
    let somas = Somas::de_linhas(foto, de, ate);
    let alto_das_somas = (ate - de) as f64;
    let modelo = modelo_da_recompensa();
    let mut melhor = (f64::MIN, 0.0, 0.0);

    // Procura grossa, na grade (em pontos das somas, que começam na linha `de` da foto).
    let mut grade: Vec<Cor> = Vec::new();
    for fase_y in 0..FASES_DA_RECOMPENSA {
        for fase_x in 0..FASES_DA_RECOMPENSA {
            let x0 = fase_x as f64 * lado / FASES_DA_RECOMPENSA as f64;
            let y0 = TOPO_DA_RECOMPENSA[0] * h - de as f64 + fase_y as f64 * lado / FASES_DA_RECOMPENSA as f64;
            let colunas = ((foto.largura as f64 - x0) / lado - 1e-9).floor().max(0.0) as usize;
            let linhas = ((alto_das_somas - y0) / lado - 1e-9).floor().max(0.0) as usize;
            if colunas < COLUNAS_DA_RECOMPENSA || linhas < LINHAS_DA_RECOMPENSA {
                continue;
            }
            grade.clear();
            for gy in 0..linhas {
                let (ya, yb) = ((y0 + gy as f64 * lado) as usize, (y0 + (gy + 1) as f64 * lado) as usize);
                for gx in 0..colunas {
                    let (xa, xb) = ((x0 + gx as f64 * lado) as usize, (x0 + (gx + 1) as f64 * lado) as usize);
                    grade.push(somas.media(xa, xb, ya, yb));
                }
            }
            let mut gy = 0;
            while gy + LINHAS_DA_RECOMPENSA <= linhas && y0 + gy as f64 * lado <= TOPO_DA_RECOMPENSA[1] * h - de as f64 {
                for gx in 0..=colunas - COLUNAS_DA_RECOMPENSA {
                    let n = nota_da_recompensa_em(modelo, |j, i| grade[(gy + j) * colunas + gx + i]);
                    if n > melhor.0 {
                        melhor = (n, x0 + gx as f64 * lado, y0 + gy as f64 * lado + de as f64);
                    }
                }
                gy += 1;
            }
        }
    }

    // Procura fina em volta do melhor lugar da grade (em pontos da foto).
    let (mut xs, mut ys) = ([0usize; COLUNAS_DA_RECOMPENSA + 1], [0usize; LINHAS_DA_RECOMPENSA + 1]);
    let mut nota = |x: f64, y: f64| {
        let y = y - de as f64;
        if x < 0.0 || y < 0.0 || x + largo >= foto.largura as f64 || y + alto >= alto_das_somas {
            return f64::MIN;
        }
        for (i, borda) in xs.iter_mut().enumerate() {
            *borda = (x + i as f64 * lado) as usize;
        }
        for (j, borda) in ys.iter_mut().enumerate() {
            *borda = (y + j as f64 * lado) as usize;
        }
        nota_da_recompensa_em(modelo, |j, i| somas.media(xs[i], xs[i + 1], ys[j], ys[j + 1]))
    };
    let (_, gx, gy) = melhor;
    let fino = (PASSO_FINO_DA_RECOMPENSA * h).max(1.0);
    let voltas = (VOLTA_FINA_DA_RECOMPENSA / PASSO_FINO_DA_RECOMPENSA).round() as i32;
    for vy in -voltas..=voltas {
        for vx in -voltas..=voltas {
            let (x, y) = (gx + vx as f64 * fino, gy + vy as f64 * fino);
            let n = nota(x, y);
            if n > melhor.0 {
                melhor = (n, x, y);
            }
        }
    }
    let (n, x, y) = melhor;
    if n < ABRE_A_RECOMPENSA {
        return (n.max(0.0), None);
    }
    let [e, t, d, b] = JANELA_DA_RECOMPENSA.map(|v| v * h);
    let janela = [
        (x + e).max(0.0) as usize,
        (y + t).max(0.0) as usize,
        ((x + d) as usize).min(foto.largura),
        ((y + b) as usize).min(foto.altura),
    ];
    (n, Some(janela))
}

/// O que vai pra interface no evento "painel-do-jogo".
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct PainelDoJogo {
    /// Um painel da esquerda (Mundo, Baú…) ou a janela de compra do vendedor está aberto.
    pub aberto: bool,
    /// E o balão está por cima dele.
    pub cobre: bool,
}

/// Liga a thread que olha o cabeçalho do painel.
pub fn iniciar(app: tauri::AppHandle) {
    #[cfg(windows)]
    {
        let resultado = std::thread::Builder::new().name("paineis".into()).spawn(move || sistema::laco(app));
        if let Err(erro) = resultado {
            eprintln!("não consegui criar a thread dos painéis: {erro}");
        }
    }
    #[cfg(not(windows))]
    let _ = app;
}

#[cfg(windows)]
mod sistema {
    use std::sync::atomic::Ordering;
    use std::thread::sleep;
    use std::time::Duration;

    use tauri::{AppHandle, Emitter, Manager};
    use windows_sys::Win32::Foundation::{HWND, RECT};
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;

    use super::{
        cobre, cobre_o_painel, faixa_da_compra, juntar, ler, ler_compra, lugar_da_busca, nota_da_compra, notas,
        tamanho_da_foto, Leitura, PainelDoJogo, Retangulo, Vigia,
    };
    use crate::casar::Foto;
    use crate::estado::Estado;
    use crate::{janela, janela_da_busca, jogo, visao};

    /// De quanto em quanto tempo o cabeçalho é fotografado (a foto do painel é pequena, ~0,06 da
    /// tela; a da faixa da compra, ~0,05, só sai sem o painel da esquerda aberto).
    const ENTRE_OLHADAS: Duration = Duration::from_millis(300);

    /// Onde está uma janela nossa na tela.
    fn retangulo(janela: jogo::Janela) -> Option<Retangulo> {
        if janela == 0 {
            return None;
        }
        // SAFETY: só lê o retângulo de uma janela pra uma variável local.
        unsafe {
            let mut r: RECT = std::mem::zeroed();
            if GetWindowRect(janela as HWND, &mut r) == 0 {
                return None;
            }
            Some(Retangulo {
                esquerda: r.left as i64,
                topo: r.top as i64,
                direita: r.right as i64,
                base: r.bottom as i64,
            })
        }
    }

    pub fn laco(app: AppHandle) {
        let estado = app.state::<Estado>();
        let hwnd = |janela: Option<tauri::WebviewWindow>| -> jogo::Janela {
            janela.and_then(|janela| janela.hwnd().ok()).map(|hwnd| hwnd.0 as isize).unwrap_or(0)
        };
        let nossa = hwnd(janela::principal(&app));
        let da_busca = hwnd(janela_da_busca::janela(&app));
        let mut foto = Foto { largura: 0, altura: 0, rgb: Vec::new() };
        let mut bruto: Vec<u8> = Vec::new();
        let mut vigia = Vigia::default();
        let mut por_cima = false;
        // Onde a janela de compra foi vista (fica `None` com o painel da esquerda).
        let mut compra: Option<Retangulo> = None;
        let mut avisado = PainelDoJogo::default();
        // Onde vão os botões de busca (pontos da tela), com o Baú ou a compra aberta.
        let mut perto_da_busca: Option<(i32, i32)> = None;

        loop {
            sleep(ENTRE_OLHADAS);
            let (ligado, fora_das_fotos) = {
                let config = estado.config.lock().unwrap();
                (config.bolinha_com_painel, config.guia_fora_das_fotos)
            };
            let edicao = estado.edicao.load(Ordering::SeqCst);
            // Os botões de busca só ficam com o jogo (ou o guia) na frente.
            let mut em_cima = false;
            // O painel é olhado mesmo com a bolinha desligada: os botões de busca aparecem com o
            // Baú ou o vendedor aberto. A opção só decide se o balão vira bolinha.
            if !estado.jogo_aberto.load(Ordering::SeqCst) {
                vigia = Vigia::default();
                por_cima = false;
                compra = None;
                perto_da_busca = None;
            } else if !edicao {
                // Com outra janela na frente o painel não muda: fica o que se viu por último.
                let na_frente = jogo::janela_na_frente();
                let no_jogo = na_frente != 0 && jogo::classe_da_janela(na_frente) == jogo::CLASSE_DO_JOGO;
                em_cima = no_jogo || (na_frente != 0 && (na_frente == nossa || na_frente == da_busca));
                if let Some(area) = no_jogo.then(|| visao::medir(na_frente)).flatten() {
                    let balao = retangulo(nossa).map(|r| Retangulo {
                        esquerda: r.esquerda - area.canto.0 as i64,
                        topo: r.topo - area.canto.1 as i64,
                        direita: r.direita - area.canto.0 as i64,
                        base: r.base - area.canto.1 as i64,
                    });
                    let tapada = if fora_das_fotos { None } else { balao };
                    // A foto é pequena (~0,06 da tela): olha sempre, mesmo com o balão longe.
                    let (largura, altura) = tamanho_da_foto(area.altura);
                    let mut leitura = None;
                    if largura <= area.largura
                        && visao::copiar(area.canto, largura, altura, &mut foto, &mut bruto)
                    {
                        leitura = Some(ler(notas(&foto, area.altura, tapada)));
                    }
                    // A janela de compra do vendedor fica mais pro meio: é procurada quando o painel
                    // da esquerda não está aberto (os dois não abrem juntos).
                    if leitura == Some(Leitura::Aberto) {
                        compra = None;
                    } else if let Some(faixa) = faixa_da_compra(area.largura, area.altura) {
                        let canto = (area.canto.0, area.canto.1 + faixa.topo as i32);
                        if visao::copiar(canto, faixa.largura, faixa.alto, &mut foto, &mut bruto) {
                            let nota = nota_da_compra(&foto, area.altura, faixa.topo, tapada);
                            let mut da_compra = ler_compra(&nota);
                            if nota.janela.is_some() {
                                compra = nota.janela;
                            }
                            // A dúvida só segura uma janela de compra que já foi vista: sem ela, a
                            // tela comum que lembra um pouco o cabeçalho não prende o painel aberto.
                            if da_compra == Leitura::Duvida && compra.is_none() {
                                da_compra = Leitura::Fechado;
                            }
                            leitura = Some(leitura.map_or(da_compra, |l| juntar(l, da_compra)));
                        }
                    }
                    if let Some(leitura) = leitura {
                        vigia.anotar(leitura);
                    }
                    if !vigia.aberto {
                        compra = None;
                    }
                    // A visão procura as gemas da loja só com a compra aberta, e só dentro dela.
                    visao::anotar_compra(compra.map(|j| {
                        let (x, y) = (area.canto.0 as i64, area.canto.1 as i64);
                        [j.esquerda + x, j.topo + y, j.direita + x, j.base + y].map(|v| v as i32)
                    }));
                    por_cima = balao.is_some_and(|b| match compra {
                        Some(janela) => cobre(b, janela),
                        None => cobre_o_painel(b, area.altura),
                    });
                    perto_da_busca = vigia.aberto.then(|| {
                        let (x, y) = lugar_da_busca(area.altura, compra);
                        (area.canto.0 + x as i32, area.canto.1 + y as i32)
                    });
                }
            }

            let quer = perto_da_busca
                .filter(|_| em_cima && !edicao && estado.visivel() && janela_da_busca::tem_buscas());
            // Confere onde a janelinha está de verdade, não onde foi mandada da última vez: ela pode
            // nascer no canto da tela (`janela_da_busca::criar`) e o Windows pode mexer nela quando a
            // tela muda. Fora do lugar, volta pro lugar (longe, se não é pra aparecer).
            let esta = retangulo(da_busca).map(|r| (r.esquerda, r.topo));
            if !janela_da_busca::no_lugar(esta, quer) {
                janela_da_busca::mover(&app, quer);
            }

            let agora = PainelDoJogo { aberto: vigia.aberto, cobre: ligado && vigia.aberto && por_cima };
            if agora != avisado {
                let _ = app.emit("painel-do-jogo", agora);
                avisado = agora;
            }
        }
    }
}

#[cfg(test)]
pub(crate) mod testes {
    use super::*;

    /// Foto da área de jogo com o cabeçalho pintado célula por célula com as cores do modelo
    /// (as células fora do modelo ficam com uma cor qualquer).
    fn foto_do_modelo(altura: usize) -> Foto {
        let (largura, alto) = tamanho_da_foto(altura);
        let mut foto = Foto { largura, altura: alto, rgb: vec![0; largura * alto * 3] };
        for (j, linha) in modelo().iter().enumerate() {
            for (i, celula) in linha.iter().enumerate() {
                let cor = celula.unwrap_or([((i * 37 + j * 11) % 200) as f64, 90.0, 40.0]);
                pintar(&mut foto, borda(i, altura), borda(i + 1, altura), borda(j, altura), borda(j + 1, altura), cor);
            }
        }
        foto
    }

    fn pintar(foto: &mut Foto, xa: usize, xb: usize, ya: usize, yb: usize, cor: Cor) {
        for y in ya..yb.min(foto.altura) {
            for x in xa..xb.min(foto.largura) {
                let p = (y * foto.largura + x) * 3;
                foto.rgb[p] = cor[0] as u8;
                foto.rgb[p + 1] = cor[1] as u8;
                foto.rgb[p + 2] = cor[2] as u8;
            }
        }
    }

    /// Números quase ao acaso, sempre os mesmos.
    fn ruido(foto: &mut Foto, semente: u32, ate: u32) {
        let mut x = semente;
        for v in foto.rgb.iter_mut() {
            x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            *v = ((x >> 16) % ate) as u8;
        }
    }

    #[test]
    fn modelo_tem_todas_as_celulas() {
        for texto in MODELO {
            assert_eq!(texto.split(' ').count(), COLUNAS);
        }
        let usadas = modelo().iter().flatten().filter(|c| c.is_some()).count();
        assert_eq!(usadas, 579);
        assert_eq!(modelo()[0][0], Some([0x16 as f64, 0x12 as f64, 0x10 as f64]));
        assert_eq!(modelo()[1][55], None);
    }

    #[test]
    fn tamanho_da_foto_acompanha_a_altura() {
        assert_eq!(tamanho_da_foto(1080), (669, 108));
        assert_eq!(tamanho_da_foto(1440), (892, 144));
    }

    #[test]
    fn cabecalho_igual_ao_modelo_e_painel_aberto() {
        for altura in [720, 1080, 1125, 1440, 2160] {
            let notas = notas(&foto_do_modelo(altura), altura, None);
            assert!(notas.iter().all(|&n| n > 0.99), "{altura}: {notas:?}");
            assert_eq!(ler(notas), Leitura::Aberto);
        }
    }

    #[test]
    fn tela_escura_qualquer_e_painel_fechado() {
        let (largura, alto) = tamanho_da_foto(1080);
        let mut foto = Foto { largura, altura: alto, rgb: vec![0; largura * alto * 3] };
        for semente in [1, 7, 99] {
            ruido(&mut foto, semente, 60);
            let notas = notas(&foto, 1080, None);
            assert_eq!(ler(notas), Leitura::Fechado, "{notas:?}");
        }
        // Tudo de uma cor só (tela de carregamento) também.
        foto.rgb.iter_mut().for_each(|v| *v = 0);
        assert_eq!(ler(notas(&foto, 1080, None)), Leitura::Fechado);
    }

    #[test]
    fn foto_pequena_demais_nao_diz_nada() {
        let foto = Foto { largura: 100, altura: 50, rgb: vec![0; 100 * 50 * 3] };
        assert_eq!(notas(&foto, 1080, None), [0.0; 3]);
    }

    #[test]
    fn dica_tapando_parte_do_cabecalho_nao_fecha() {
        let altura = 1080;
        let mut foto = foto_do_modelo(altura);
        // Uma dica de item escura sobre os dois primeiros pedaços.
        pintar(&mut foto, 0, borda(42, altura), 0, usize::MAX, [20.0, 18.0, 30.0]);
        let notas = notas(&foto, altura, None);
        assert!(notas[2] > 0.99, "{notas:?}");
        assert_eq!(ler(notas), Leitura::Aberto);
    }

    #[test]
    fn balao_nas_fotos_fica_fora_da_conta() {
        let altura = 1080;
        let mut foto = foto_do_modelo(altura);
        // O balão, branco, por cima do começo do cabeçalho.
        let balao = Retangulo { esquerda: -5, topo: 0, direita: 400, base: 700 };
        pintar(&mut foto, 0, 400, 0, usize::MAX, [240.0, 240.0, 240.0]);
        let sem_tirar = notas(&foto, altura, None);
        assert!(sem_tirar[0] < FECHA, "{sem_tirar:?}");
        let tirando = notas(&foto, altura, Some(balao));
        // O primeiro pedaço inteiro fica embaixo do balão: não é medido.
        assert_eq!(tirando[0], 0.0);
        assert!(tirando[2] > 0.99, "{tirando:?}");
        assert_eq!(ler(tirando), Leitura::Aberto);
    }

    #[test]
    fn abre_na_hora_e_fecha_com_duas_leituras() {
        let mut vigia = Vigia::default();
        vigia.anotar(Leitura::Fechado);
        assert!(!vigia.aberto);
        vigia.anotar(Leitura::Duvida);
        assert!(!vigia.aberto, "dúvida não abre");
        vigia.anotar(Leitura::Aberto);
        assert!(vigia.aberto);
        vigia.anotar(Leitura::Fechado);
        assert!(vigia.aberto, "uma leitura só não fecha");
        vigia.anotar(Leitura::Duvida);
        vigia.anotar(Leitura::Fechado);
        assert!(vigia.aberto, "a dúvida no meio zera a conta");
        vigia.anotar(Leitura::Fechado);
        assert!(!vigia.aberto);
    }

    #[test]
    fn balao_na_esquerda_cobre_o_painel() {
        let altura = 1080; // painel até x = 662
        let balao = |x: i64, y: i64| Retangulo { esquerda: x, topo: y, direita: x + 380, base: y + 500 };
        assert!(cobre_o_painel(balao(10, 200), altura));
        assert!(cobre_o_painel(balao(600, 200), altura));
        assert!(!cobre_o_painel(balao(660, 200), altura), "só encostando não conta");
        assert!(!cobre_o_painel(balao(1500, 200), altura), "do lado direito");
        assert!(!cobre_o_painel(balao(-400, 200), altura), "fora da janela do jogo");
        assert!(!cobre_o_painel(balao(10, 1200), altura), "abaixo da tela");
    }

    #[test]
    fn modelo_da_compra_tem_todas_as_celulas() {
        for texto in MODELO_DA_COMPRA {
            assert_eq!(texto.split(' ').count(), COLUNAS_DA_COMPRA);
        }
        let usadas = modelo_da_compra().iter().flatten().filter(|c| c.is_some()).count();
        assert_eq!(usadas, 346);
        // As abas (-1- -2- -3-) ficam de fora.
        assert_eq!(modelo_da_compra()[4][30], None);
    }

    #[test]
    fn faixa_da_compra_vai_ate_o_inventario() {
        assert_eq!(faixa_da_compra(1920, 1080), Some(FaixaDaCompra { topo: 174, largura: 1258, alto: 80 }));
        // Tela estreita demais pro cabeçalho inteiro: nem procura.
        assert_eq!(faixa_da_compra(650, 1080), None);
        assert_eq!(faixa_da_compra(1920, 50), None);
    }

    /// A faixa da compra com ruído escuro e, se pedido, o cabeçalho pintado a partir de `x0`.
    fn faixa_com_compra(largura_da_area: usize, altura: usize, x0: Option<f64>) -> (Foto, FaixaDaCompra) {
        let faixa = faixa_da_compra(largura_da_area, altura).unwrap();
        let mut foto = Foto { largura: faixa.largura, altura: faixa.alto, rgb: vec![0; faixa.largura * faixa.alto * 3] };
        ruido(&mut foto, 5, 50);
        if let Some(x0) = x0 {
            let lado = CELULA * altura as f64;
            let y0 = TOPO_DA_COMPRA * altura as f64 - faixa.topo as f64;
            for (j, linha) in modelo_da_compra().iter().enumerate() {
                for (i, celula) in linha.iter().enumerate() {
                    let cor = celula.unwrap_or([((i * 29 + j * 13) % 180) as f64, 60.0, 30.0]);
                    let x = |k: usize| (x0 + k as f64 * lado) as usize;
                    let y = |k: usize| (y0 + k as f64 * lado) as usize;
                    pintar(&mut foto, x(i), x(i + 1), y(j), y(j + 1), cor);
                }
            }
        }
        (foto, faixa)
    }

    #[test]
    fn cabecalho_da_compra_e_achado_e_diz_onde_fica_a_janela() {
        for (largura, altura, passos) in [(1280, 720, 40), (1920, 1080, 151), (2000, 1125, 130), (3840, 2160, 75)] {
            let x0 = passos as f64 * PASSO_DA_COMPRA * altura as f64;
            let (foto, faixa) = faixa_com_compra(largura, altura, Some(x0));
            let nota = nota_da_compra(&foto, altura, faixa.topo, None);
            assert!(nota.inteiro > 0.99, "{altura}: {nota:?}");
            assert_eq!(ler_compra(&nota), Leitura::Aberto);
            let janela = nota.janela.expect("janela");
            let h = altura as f64;
            let perto = |a: i64, b: f64| (a as f64 - b).abs() <= PASSO_DA_COMPRA * h + 1.0;
            assert!(perto(janela.esquerda, x0 - 0.004 * h), "{altura}: {janela:?}");
            assert!(perto(janela.direita, x0 + 0.64 * h), "{altura}: {janela:?}");
            assert!(perto(janela.topo, (TOPO_DA_COMPRA - 0.011) * h), "{altura}: {janela:?}");
            assert!(perto(janela.base, (TOPO_DA_COMPRA + 0.663) * h), "{altura}: {janela:?}");
        }
    }

    #[test]
    fn sem_o_cabecalho_a_compra_fica_fechada() {
        let (foto, faixa) = faixa_com_compra(1920, 1080, None);
        let nota = nota_da_compra(&foto, 1080, faixa.topo, None);
        assert_eq!(ler_compra(&nota), Leitura::Fechado, "{nota:?}");
        assert_eq!(nota.janela, None);
        // Foto menor que o cabeçalho: nota zero.
        let pequena = Foto { largura: 300, altura: 90, rgb: vec![0; 300 * 90 * 3] };
        assert_eq!(nota_da_compra(&pequena, 1080, faixa.topo, None), NotaDaCompra::default());
    }

    #[test]
    fn balao_por_cima_da_compra_fica_fora_da_conta() {
        let altura = 1080;
        let x0 = 151.0 * PASSO_DA_COMPRA * altura as f64;
        let (mut foto, faixa) = faixa_com_compra(1920, altura, Some(x0));
        // O balão, branco, por cima do terço da direita do cabeçalho.
        let comeco = (x0 + 43.0 * CELULA * altura as f64) as usize;
        pintar(&mut foto, comeco, usize::MAX, 0, usize::MAX, [240.0, 240.0, 240.0]);
        let balao = Retangulo { esquerda: comeco as i64, topo: 0, direita: 1920, base: 900 };
        assert_ne!(ler_compra(&nota_da_compra(&foto, altura, faixa.topo, None)), Leitura::Aberto);
        let nota = nota_da_compra(&foto, altura, faixa.topo, Some(balao));
        assert!(nota.inteiro > 0.99, "{nota:?}");
    }

    #[test]
    fn juntar_painel_e_compra() {
        use Leitura::*;
        for (a, b, juntos) in [
            (Aberto, Fechado, Aberto),
            (Fechado, Aberto, Aberto),
            (Aberto, Duvida, Aberto),
            (Fechado, Fechado, Fechado),
            (Fechado, Duvida, Duvida),
            (Duvida, Fechado, Duvida),
            (Duvida, Duvida, Duvida),
        ] {
            assert_eq!(juntar(a, b), juntos, "{a:?} + {b:?}");
        }
    }

    #[test]
    fn balao_em_cima_da_janela_de_compra() {
        let compra = Retangulo { esquerda: 294, topo: 177, direita: 1012, base: 935 };
        let balao = |x: i64| Retangulo { esquerda: x, topo: 300, direita: x + 380, base: 800 };
        assert!(cobre(balao(800), compra));
        assert!(!cobre(balao(1010), compra), "só encostando não conta");
        assert!(!cobre(balao(1300), compra), "do lado do inventário");
        // O balão no canto da esquerda, fora da janela de compra (que não fica no canto).
        assert!(!cobre(Retangulo { esquerda: 0, topo: 300, direita: 290, base: 800 }, compra));
    }

    #[test]
    fn modelo_da_recompensa_tem_todas_as_celulas() {
        for texto in MODELO_DA_RECOMPENSA {
            assert_eq!(texto.split(' ').count(), COLUNAS_DA_RECOMPENSA);
        }
        // O texto da placa e o da faixa ficam de fora.
        assert_eq!(modelo_da_recompensa().celulas.len(), 10 * 61 - 3 * 12 - 3 * 21);
        assert!(!modelo_da_recompensa().celulas.iter().any(|&(j, i, _)| j == 2 && i == 30));
    }

    /// Foto da visão (`largura` x `altura`) com ruído escuro e, se pedido, o cabeçalho da
    /// recompensa pintado com o canto em (x0, y0).
    pub(crate) fn foto_com_recompensa(largura: usize, altura: usize, canto: Option<(f64, f64)>) -> Foto {
        let mut foto = Foto { largura, altura, rgb: vec![0; largura * altura * 3] };
        ruido(&mut foto, 11, 50);
        if let Some((x0, y0)) = canto {
            let lado = CELULA * altura as f64;
            let tabela: [[Option<Cor>; COLUNAS_DA_RECOMPENSA]; LINHAS_DA_RECOMPENSA] = ler_tabela(MODELO_DA_RECOMPENSA);
            for (j, linha) in tabela.iter().enumerate() {
                for (i, celula) in linha.iter().enumerate() {
                    let cor = celula.unwrap_or([((i * 31 + j * 7) % 170) as f64, 70.0, 20.0]);
                    let x = |k: usize| (x0 + k as f64 * lado) as usize;
                    let y = |k: usize| (y0 + k as f64 * lado) as usize;
                    pintar(&mut foto, x(i), x(i + 1), y(j), y(j + 1), cor);
                }
            }
        }
        foto
    }

    #[test]
    fn cabecalho_da_recompensa_e_achado_e_diz_onde_procurar() {
        // Fora da grade da procura grossa, em várias alturas e formatos.
        for (largura, altura, x0, y0) in [
            (1280, 720, 0.3011, 0.2913),
            (1279, 1080, 0.2747, 0.3307),
            (1068, 1125, 0.2738, 0.3307),
            (2214, 1440, 0.8123, 0.2241),
            (2560, 2160, 0.3333, 0.4422),
        ] {
            let h = altura as f64;
            let foto = foto_com_recompensa(largura, altura, Some((x0 * h, y0 * h)));
            let (nota, janela) = nota_da_recompensa(&foto);
            assert!(nota > 0.99, "{altura}: {nota}");
            let [e, t, d, b] = janela.expect("janela");
            let perto = |a: usize, v: f64| (a as f64 - v * h).abs() <= PASSO_FINO_DA_RECOMPENSA * h + 1.0;
            assert!(perto(e, x0 - 0.01) && perto(t, y0 - 0.01), "{altura}: {:?}", [e, t, d, b]);
            assert!(perto(d, x0 + 0.62) && perto(b, y0 + 0.5), "{altura}: {:?}", [e, t, d, b]);
        }
    }

    #[test]
    fn sem_o_cabecalho_a_recompensa_nao_e_vista() {
        for semente_da_foto in [1279usize, 2214] {
            let foto = foto_com_recompensa(semente_da_foto, 1080, None);
            let (nota, janela) = nota_da_recompensa(&foto);
            assert!(nota < ABRE_A_RECOMPENSA && janela.is_none(), "{nota}");
        }
        // Fora da faixa de alturas (a janela de compra começa bem mais em cima) também não.
        let foto = foto_com_recompensa(1279, 1080, Some((300.0, 0.12 * 1080.0)));
        assert_eq!(nota_da_recompensa(&foto).1, None);
        // Foto estreita demais pro cabeçalho: nem procura.
        let estreita = foto_com_recompensa(600, 1080, None);
        assert_eq!(nota_da_recompensa(&estreita), (0.0, None));
    }

    #[test]
    fn botoes_de_busca_logo_abaixo_do_campo() {
        // Nos prints (1125 de altura): o campo do Baú vai de x 435 a 678 e a barra acaba em 950;
        // o da compra, com a janela em 290..1015 x 176..934, vai de x 650 a 890.
        assert_eq!(lugar_da_busca(1125, None), (435, 954));
        let compra = Retangulo { esquerda: 290, topo: 176, direita: 1015, base: 934 };
        assert_eq!(lugar_da_busca(1125, Some(compra)), (650, 939));
        // Em 1080 tudo encolhe junto.
        assert_eq!(lugar_da_busca(1080, None), (417, 916));
    }

    /// Prova com prints de verdade (2000 x 1125): `GUIA_PROVA_PAINEL` aponta a pasta com
    /// `N.txt` ("largura altura") e `N.rgb` (RGB cru). 3 e 5 = Mundo, 6 = Baú, 4 e 7 = árvore de
    /// passivas, 8 = janela de compra do vendedor (Nessa).
    #[test]
    fn prints_de_verdade() {
        let Ok(pasta) = std::env::var("GUIA_PROVA_PAINEL") else {
            return;
        };
        let pasta = std::path::PathBuf::from(pasta);
        let carregar = |nome: &str| {
            let medidas = std::fs::read_to_string(pasta.join(format!("{nome}.txt"))).expect("medidas");
            let mut partes = medidas.split_whitespace().map(|p| p.parse::<usize>().unwrap());
            let (largura, altura) = (partes.next().unwrap(), partes.next().unwrap());
            let rgb = std::fs::read(pasta.join(format!("{nome}.rgb"))).expect("pontos");
            assert_eq!(rgb.len(), largura * altura * 3);
            Foto { largura, altura, rgb }
        };
        let recorte = |foto: &Foto, x0: usize, y0: usize| {
            let (largura, altura) = (foto.largura - x0, foto.altura - y0);
            let mut rgb = Vec::with_capacity(largura * altura * 3);
            for y in y0..foto.altura {
                rgb.extend_from_slice(&foto.rgb[(y * foto.largura + x0) * 3..(y + 1) * foto.largura * 3]);
            }
            Foto { largura, altura, rgb }
        };

        let mut piores = 0.0f64;
        for nome in ["3", "5", "6"] {
            let foto = carregar(nome);
            let n = notas(&foto, foto.altura, None);
            println!("{nome}: {n:?}");
            assert_eq!(ler(n), Leitura::Aberto, "{nome}: {n:?}");
            // O mesmo jogo, sem painel, mais pra direita e mais pra baixo.
            for x0 in [700, 900, 1100, 1300] {
                if nome == "6" && x0 > 600 {
                    continue; // o inventário fica à direita do baú
                }
                for y0 in [0, 300, 600, 900] {
                    let r = recorte(&foto, x0, y0);
                    let n = notas(&r, foto.altura, None);
                    piores = piores.max(n.iter().cloned().fold(f64::MIN, f64::max));
                    assert_eq!(ler(n), Leitura::Fechado, "{nome} x={x0} y={y0}: {n:?}");
                }
            }
        }
        let arvore = carregar("4");
        let n = notas(&arvore, arvore.altura, None);
        println!("4: {n:?}  pior recorte sem painel: {piores:.3}");
        assert_eq!(ler(n), Leitura::Fechado, "árvore: {n:?}");

        // Uma dica de item tapando o meio do cabeçalho do baú: não fecha.
        let mut tapado = carregar("6");
        let h = tapado.altura as f64;
        for y in 0..(0.1 * h) as usize {
            for x in (0.05 * h) as usize..(0.45 * h) as usize {
                let p = (y * tapado.largura + x) * 3;
                tapado.rgb[p..p + 3].copy_from_slice(&[20, 18, 30]);
            }
        }
        let n = notas(&tapado, tapado.altura, None);
        println!("6 tapado: {n:?}");
        assert_ne!(ler(n), Leitura::Fechado, "{n:?}");

        // A janela de compra: a faixa sai do print inteiro, como sai da tela.
        let da_faixa = |foto: &Foto| {
            let faixa = faixa_da_compra(foto.largura, foto.altura).expect("faixa");
            let mut rgb = Vec::with_capacity(faixa.largura * faixa.alto * 3);
            for y in faixa.topo..faixa.topo + faixa.alto {
                rgb.extend_from_slice(&foto.rgb[y * foto.largura * 3..(y * foto.largura + faixa.largura) * 3]);
            }
            nota_da_compra(&Foto { largura: faixa.largura, altura: faixa.alto, rgb }, foto.altura, faixa.topo, None)
        };
        let vendedor = carregar("8");
        let n = notas(&vendedor, vendedor.altura, None);
        assert_eq!(ler(n), Leitura::Fechado, "8 não tem painel na esquerda: {n:?}");
        let nota = da_faixa(&vendedor);
        println!("8 compra: {nota:?}");
        assert_eq!(ler_compra(&nota), Leitura::Aberto, "{nota:?}");
        let janela = nota.janela.expect("janela");
        assert!((280..=305).contains(&janela.esquerda) && (1000..=1025).contains(&janela.direita), "{janela:?}");
        assert!((165..=190).contains(&janela.topo) && (920..=950).contains(&janela.base), "{janela:?}");
        // Os botões de busca: alinhados com o campo (x 650), logo abaixo da barra (que acaba em 935).
        let (x, y) = lugar_da_busca(vendedor.altura, Some(janela));
        assert!((640..=662).contains(&x) && (935..=950).contains(&y), "{x} {y}");
        for nome in ["3", "4", "5", "6", "7"] {
            let nota = da_faixa(&carregar(nome));
            println!("{nome} compra: {nota:?}");
            assert_eq!(ler_compra(&nota), Leitura::Fechado, "{nome}: {nota:?}");
        }
        // Uma dica de item tapando quase metade do cabeçalho da compra: não fecha.
        let mut tapado = carregar("8");
        for y in 150..320 {
            for x in 480..820 {
                let p = (y * tapado.largura + x) * 3;
                tapado.rgb[p..p + 3].copy_from_slice(&[20, 18, 30]);
            }
        }
        let nota = da_faixa(&tapado);
        println!("8 tapado: {nota:?}");
        assert_ne!(ler_compra(&nota), Leitura::Fechado, "{nota:?}");
    }
}
