//! Desenho do guia da árvore: decide o que riscar por cima da árvore do jogo e risca num buffer.
//!
//! O que isto faz, e só isto: contas. Monta a lista de formas (anéis, linhas, caixas, seta) e
//! de textos a partir do que o guia sabe, e pinta as formas num buffer de memória que alguém
//! entregou. Não fala com o Windows, não tira foto, não lê nada do jogo e não manda nada pra
//! lugar nenhum. Quem põe o buffer na tela é `janela`, numa janela nossa.

use super::GuiaRecebido;

/// Cor com opacidade (sem pré-multiplicar; a conta é feita na hora de pintar).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

/// Verde-claro do nº 1: o mesmo das molduras das gemas (`visao::COR`), que não existe na
/// interface do jogo. Só o nº 1 leva o verde cheio: o olho vai nele primeiro.
const VERDE: Cor = Cor { r: 0x60, g: 0xFF, b: 0x50, a: 255 };
/// O mesmo verde nos outros numerados (65% de opacidade): dá pra ver a sequência sem brigar com o nº 1.
const VERDE_DOS_PROXIMOS: Cor = Cor { r: 0x60, g: 0xFF, b: 0x50, a: 165 };
/// O mesmo verde, bem apagado, pro resto do trecho que ainda falta (22% de opacidade).
const VERDE_APAGADO: Cor = Cor { r: 0x60, g: 0xFF, b: 0x50, a: 56 };
/// Verde das linhas entre os nós (40% de opacidade): um rastro, não um caminho pintado.
const VERDE_DA_LINHA: Cor = Cor { r: 0x60, g: 0xFF, b: 0x50, a: 100 };
/// Vermelho dos nós a devolver.
const VERMELHO: Cor = Cor { r: 0xFF, g: 0x46, b: 0x3C, a: 255 };
/// Fundo das caixas de texto: quase preto, 85% de opacidade.
const FUNDO: Cor = Cor { r: 16, g: 16, b: 16, a: 217 };
/// Texto das caixas.
const BRANCO: Cor = Cor { r: 255, g: 255, b: 255, a: 255 };
/// Número dos numerados depois do nº 1 (80% de opacidade), numa caixa mais leve (60%).
const BRANCO_DOS_PROXIMOS: Cor = Cor { r: 255, g: 255, b: 255, a: 205 };
const FUNDO_DOS_PROXIMOS: Cor = Cor { r: 16, g: 16, b: 16, a: 155 };
/// A letra do número depois do nº 1, como fração da do nº 1.
const MENOR_DOS_PROXIMOS: f32 = 0.85;

/// Onde fica a caixa de situação: logo abaixo do cabeçalho da tela da árvore, como fração da
/// altura (o cabeçalho do jogo acaba em ~0,18 da altura; desenho do sistema, seção 5.3).
const ALTURA_DA_SITUACAO: f32 = 0.185;
/// Em quantas colunas quebra o texto do efeito da maestria.
const COLUNAS_DO_ROTULO: usize = 40;
/// No máximo quantas linhas tem a caixa do efeito da maestria.
const LINHAS_DO_ROTULO: usize = 8;
/// Distância da seta até a borda da tela, como fração da altura.
const MARGEM_DA_SETA: f32 = 0.08;
/// Em quantos passos a seta recua pro centro até sair de cima de uma parte fixa da interface.
const RECUOS_DA_SETA: u32 = 24;
/// Altura da faixa que a caixa de situação ocupa, como fração da altura da tela: a letra dela
/// (0,019) mais as duas margens de 0,35 da letra dão ~0,033; o resto é folga.
const FAIXA_DA_SITUACAO: f32 = 0.05;
/// Meia largura mínima dessa faixa, como fração da altura: a mesma do cabeçalho do jogo, que fica
/// logo acima (parte fixa do topo, 0,34 pra cada lado do centro).
const MEIA_FAIXA_DA_SITUACAO: f32 = 0.34;
/// Largura média de uma letra do Segoe UI em negrito, como fração da altura da letra (estimativa:
/// quem mede de verdade é `janela`; aqui só se reserva o lugar da caixa de situação).
const LARGURA_DA_LETRA: f32 = 0.6;
/// Menor letra de número ao lado do anel, em pontos (menos que isso não se lê).
const MENOR_LETRA_DE_NUMERO: f32 = 10.0;
/// Altura da letra do número como fração do raio do anel: no zoom baixo os nós ficam encostados,
/// e uma caixa de tamanho fixo taparia os vizinhos.
const LETRA_POR_RAIO: f32 = 1.2;

/// Uma forma pra riscar, em pontos do buffer (x pra direita, y pra baixo).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Forma {
    /// Circunferência de raio `raio` (no meio do traço) e traço de `espessura` pontos.
    Anel { x: f32, y: f32, raio: f32, espessura: f32, cor: Cor },
    Linha { x0: f32, y0: f32, x1: f32, y1: f32, espessura: f32, cor: Cor },
    /// Retângulo cheio.
    Caixa { x0: f32, y0: f32, x1: f32, y1: f32, cor: Cor },
    /// Triângulo cheio com a ponta em (x, y), apontando pra (dx, dy), com `tamanho` de comprimento.
    Seta { x: f32, y: f32, dx: f32, dy: f32, tamanho: f32, cor: Cor },
}

/// Um texto numa caixinha de fundo escuro. O ponto (x, y) é onde fica a fração
/// (`ancora_x`, `ancora_y`) da caixa: (0, 0) = canto de cima à esquerda, (0.5, 0) = meio do topo.
/// Quem mede o texto e põe a caixa no lugar é `janela` (só ela sabe o tamanho das letras).
#[derive(Clone, Debug, PartialEq)]
pub struct Texto {
    pub x: f32,
    pub y: f32,
    pub ancora_x: f32,
    pub ancora_y: f32,
    pub texto: String,
    /// Altura da letra, em pontos.
    pub altura: f32,
    pub cor: Cor,
    pub fundo: Cor,
}

/// Tudo o que vai pra tela numa passada.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Cena {
    pub formas: Vec<Forma>,
    /// Números e efeitos de maestria (somem debaixo de tapume e de parte fixa da interface).
    pub textos: Vec<Texto>,
    /// A caixa de situação (a única coisa que pode ficar em cima de parte fixa).
    pub situacao: Option<Texto>,
}

/// Um buffer BGRA pré-multiplicado, de cima pra baixo, 4 bytes por ponto.
pub struct Tela<'a> {
    largura: usize,
    altura: usize,
    pontos: &'a mut [u8],
}

/// Pontos inteiros que a faixa `de..=ate` toca dentro de `0..limite`. `None` se não sobra nenhum
/// ou se a conta não deu número.
fn faixa(de: f32, ate: f32, limite: usize) -> Option<(usize, usize)> {
    if !de.is_finite() || !ate.is_finite() || ate < 0.0 || de > ate || de >= limite as f32 {
        return None;
    }
    // De número quebrado pra inteiro o Rust satura: nada aqui estoura.
    let comeco = de.floor().max(0.0) as usize;
    let fim = (ate.ceil().max(0.0) as usize).saturating_add(1).min(limite);
    (comeco < fim).then_some((comeco, fim))
}

impl<'a> Tela<'a> {
    /// `None` se o buffer é menor que `largura * altura * 4` ou se alguma medida é zero.
    pub fn nova(largura: usize, altura: usize, pontos: &'a mut [u8]) -> Option<Tela<'a>> {
        let bytes = largura.checked_mul(altura)?.checked_mul(4)?;
        if bytes == 0 {
            return None;
        }
        let pontos = pontos.get_mut(..bytes)?;
        Some(Tela { largura, altura, pontos })
    }

    pub fn largura(&self) -> usize {
        self.largura
    }

    pub fn altura(&self) -> usize {
        self.altura
    }

    /// Deixa tudo transparente.
    pub fn limpar(&mut self) {
        self.pontos.fill(0);
    }

    /// Os 4 bytes (B, G, R, A) de um ponto; `None` fora do buffer.
    #[cfg(test)]
    fn ponto(&self, x: usize, y: usize) -> Option<[u8; 4]> {
        if x >= self.largura || y >= self.altura {
            return None;
        }
        let i = (y * self.largura + x) * 4;
        let p = self.pontos.get(i..i + 4)?;
        Some([p[0], p[1], p[2], p[3]])
    }

    /// Mistura a cor por cima de um ponto, com `cobertura` de 0 a 1. Fora do buffer não faz nada.
    fn pintar(&mut self, x: usize, y: usize, cor: Cor, cobertura: f32) {
        if x >= self.largura || y >= self.altura {
            return;
        }
        let forca = (cor.a as f32 / 255.0) * cobertura.clamp(0.0, 1.0);
        if forca.is_nan() || forca <= 0.0 {
            return;
        }
        let i = (y * self.largura + x) * 4;
        let Some(ponto) = self.pontos.get_mut(i..i + 4) else { return };
        let resto = 1.0 - forca;
        if let [b, g, r, a] = ponto {
            let alfa = (255.0 * forca + *a as f32 * resto).round().min(255.0);
            // Pré-multiplicado: nenhuma cor passa da opacidade (o arredondamento não pode furar isso).
            *b = (cor.b as f32 * forca + *b as f32 * resto).round().min(alfa) as u8;
            *g = (cor.g as f32 * forca + *g as f32 * resto).round().min(alfa) as u8;
            *r = (cor.r as f32 * forca + *r as f32 * resto).round().min(alfa) as u8;
            *a = alfa as u8;
        }
    }

    /// Risca as formas, na ordem (a de depois fica por cima).
    pub fn desenhar(&mut self, formas: &[Forma]) {
        for forma in formas {
            match *forma {
                Forma::Anel { x, y, raio, espessura, cor } => self.anel(x, y, raio, espessura, cor),
                Forma::Linha { x0, y0, x1, y1, espessura, cor } => self.linha(x0, y0, x1, y1, espessura, cor),
                Forma::Caixa { x0, y0, x1, y1, cor } => self.caixa(x0, y0, x1, y1, cor),
                Forma::Seta { x, y, dx, dy, tamanho, cor } => self.seta(x, y, dx, dy, tamanho, cor),
            }
        }
    }

    /// Antisserrilhado simples: a cobertura cai de 1 a 0 em um ponto de largura na beira do traço.
    fn anel(&mut self, x: f32, y: f32, raio: f32, espessura: f32, cor: Cor) {
        if raio.is_nan() || espessura.is_nan() || raio <= 0.0 || espessura <= 0.0 {
            return;
        }
        let meia = espessura / 2.0;
        let fora = raio + meia + 1.0;
        let Some((x0, x1)) = faixa(x - fora, x + fora, self.largura) else { return };
        let Some((y0, y1)) = faixa(y - fora, y + fora, self.altura) else { return };
        for py in y0..y1 {
            let dy = py as f32 + 0.5 - y;
            for px in x0..x1 {
                let dx = px as f32 + 0.5 - x;
                let cobertura = meia + 0.5 - ((dx * dx + dy * dy).sqrt() - raio).abs();
                if cobertura > 0.0 {
                    self.pintar(px, py, cor, cobertura);
                }
            }
        }
    }

    fn linha(&mut self, x0: f32, y0: f32, x1: f32, y1: f32, espessura: f32, cor: Cor) {
        if espessura.is_nan() || espessura <= 0.0 {
            return;
        }
        let meia = espessura / 2.0;
        let fora = meia + 1.0;
        let Some((ax, bx)) = faixa(x0.min(x1) - fora, x0.max(x1) + fora, self.largura) else { return };
        let Some((ay, by)) = faixa(y0.min(y1) - fora, y0.max(y1) + fora, self.altura) else { return };
        let (vx, vy) = (x1 - x0, y1 - y0);
        let comprimento2 = vx * vx + vy * vy;
        for py in ay..by {
            let qy = py as f32 + 0.5 - y0;
            for px in ax..bx {
                let qx = px as f32 + 0.5 - x0;
                // Ponto do segmento mais perto deste.
                let t = if comprimento2 > 0.0 { ((qx * vx + qy * vy) / comprimento2).clamp(0.0, 1.0) } else { 0.0 };
                let (ex, ey) = (qx - t * vx, qy - t * vy);
                let cobertura = meia + 0.5 - (ex * ex + ey * ey).sqrt();
                if cobertura > 0.0 {
                    self.pintar(px, py, cor, cobertura);
                }
            }
        }
    }

    fn caixa(&mut self, x0: f32, y0: f32, x1: f32, y1: f32, cor: Cor) {
        let Some((ax, bx)) = faixa(x0, x1, self.largura) else { return };
        let Some((ay, by)) = faixa(y0, y1, self.altura) else { return };
        for py in ay..by {
            // Quanto do ponto a caixa cobre, na vertical e na horizontal.
            let cy = (y1.min(py as f32 + 1.0) - y0.max(py as f32)).clamp(0.0, 1.0);
            if cy <= 0.0 {
                continue;
            }
            for px in ax..bx {
                let cx = (x1.min(px as f32 + 1.0) - x0.max(px as f32)).clamp(0.0, 1.0);
                if cx > 0.0 {
                    self.pintar(px, py, cor, cx * cy);
                }
            }
        }
    }

    fn seta(&mut self, x: f32, y: f32, dx: f32, dy: f32, tamanho: f32, cor: Cor) {
        let norma = (dx * dx + dy * dy).sqrt();
        if !norma.is_finite() || norma <= 0.0 || tamanho.is_nan() || tamanho <= 0.0 {
            return;
        }
        let (ux, uy) = (dx / norma, dy / norma);
        // A base fica `tamanho` atrás da ponta e tem 1,2 × `tamanho` de largura.
        let (bx, by) = (x - ux * tamanho, y - uy * tamanho);
        let meia = tamanho * 0.6;
        let cantos = [(x, y), (bx + uy * meia, by - ux * meia), (bx - uy * meia, by + ux * meia)];
        let fora = tamanho * 1.2 + 1.0;
        let Some((ax, cx)) = faixa(x - fora, x + fora, self.largura) else { return };
        let Some((ay, cy)) = faixa(y - fora, y + fora, self.altura) else { return };
        for py in ay..cy {
            for px in ax..cx {
                let (qx, qy) = (px as f32 + 0.5, py as f32 + 0.5);
                // Distância (com sinal) do ponto a cada lado; dentro do triângulo as três são positivas.
                let mut dentro = f32::INFINITY;
                for lado in 0..3 {
                    let (a, b) = (cantos[lado], cantos[(lado + 1) % 3]);
                    let (lx, ly) = (b.0 - a.0, b.1 - a.1);
                    let comprimento = (lx * lx + ly * ly).sqrt();
                    if comprimento <= 0.0 {
                        continue;
                    }
                    dentro = dentro.min(((qx - a.0) * ly - (qy - a.1) * lx) / comprimento);
                }
                let cobertura = dentro + 0.5;
                if dentro.is_finite() && cobertura > 0.0 {
                    self.pintar(px, py, cor, cobertura);
                }
            }
        }
    }

    /// Apaga (deixa transparente) todo ponto riscado que cai onde `proibido` diz que não pode.
    /// `proibido` recebe o meio do ponto.
    pub fn recortar(&mut self, proibido: &dyn Fn(f32, f32) -> bool) {
        let largura = self.largura;
        for (posicao, ponto) in self.pontos.as_chunks_mut::<4>().0.iter_mut().enumerate() {
            if ponto.iter().all(|byte| *byte == 0) {
                continue;
            }
            let (x, y) = (posicao % largura, posicao / largura);
            if proibido(x as f32 + 0.5, y as f32 + 0.5) {
                ponto.fill(0);
            }
        }
    }

    /// Pinta `cor` com a cobertura tirada da luz de um rascunho (branco sobre preto, 4 bytes por
    /// ponto, `largura_da_luz` pontos por linha): é assim que o texto do Windows vira desenho com
    /// transparência. O canto de cima à esquerda do pedaço (`largura` × `altura`) vai em (x, y).
    #[allow(clippy::too_many_arguments)]
    pub fn cobrir(&mut self, x: i64, y: i64, largura: usize, altura: usize, luz: &[u8], largura_da_luz: usize, cor: Cor) {
        if largura > largura_da_luz {
            return;
        }
        for linha in 0..altura {
            let Some(py) = y.checked_add(linha as i64).and_then(|v| usize::try_from(v).ok()) else { continue };
            if py >= self.altura {
                break;
            }
            for coluna in 0..largura {
                let Some(px) = x.checked_add(coluna as i64).and_then(|v| usize::try_from(v).ok()) else { continue };
                if px >= self.largura {
                    break;
                }
                // O verde é o canal que mais pesa na luz; com letra cinza os três são iguais.
                let Some(i) = linha.checked_mul(largura_da_luz).and_then(|v| v.checked_add(coluna)).and_then(|v| v.checked_mul(4)) else {
                    return;
                };
                let Some(&brilho) = luz.get(i.saturating_add(1)) else { return };
                if brilho > 0 {
                    self.pintar(px, py, cor, brilho as f32 / 255.0);
                }
            }
        }
    }
}

/// Quebra o texto em linhas de até `colunas` letras, sem partir palavra (palavra maior que a
/// linha fica sozinha). No máximo `LINHAS_DO_ROTULO` linhas; o que sobra vira "…".
pub fn quebrar(texto: &str, colunas: usize) -> String {
    let colunas = colunas.max(1);
    let mut linhas: Vec<String> = Vec::new();
    let mut atual = String::new();
    let mut letras = 0usize;
    for palavra in texto.split_whitespace() {
        let tamanho = palavra.chars().count();
        if letras > 0 && letras + 1 + tamanho > colunas {
            linhas.push(std::mem::take(&mut atual));
            letras = 0;
        }
        if letras > 0 {
            atual.push(' ');
            letras += 1;
        }
        atual.push_str(palavra);
        letras += tamanho;
    }
    if !atual.is_empty() {
        linhas.push(atual);
    }
    if linhas.len() > LINHAS_DO_ROTULO {
        linhas.truncate(LINHAS_DO_ROTULO);
        if let Some(ultima) = linhas.last_mut() {
            ultima.push('…');
        }
    }
    linhas.join("\n")
}

/// Onde um nó está na tela.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lugar {
    pub x: f32,
    pub y: f32,
    /// Raio de dentro do risco: fora da moldura do nó e de onde a leitura amostra. O traço do
    /// anel fica todo daqui pra fora.
    pub raio: f32,
    /// Debaixo do painel do guia ou de parte fixa da interface, ou nó que nenhuma foto leu ainda
    /// (algo por cima, ou não está onde os dados dizem): não se desenha.
    pub tapado: bool,
    pub maestria: bool,
}

/// O que `montar_cena` precisa saber.
pub struct Entrada<'a> {
    /// Tamanho da área do jogo, em pontos.
    pub largura: f32,
    pub altura: f32,
    pub guia: &'a GuiaRecebido,
    /// Um por passo do guia (`None`: o nó não existe nesta versão da árvore).
    pub lugares: &'a [Option<Lugar>],
    /// O início da classe (de onde sai a linha de quem tem `pai` = -1).
    pub inicio: Option<Lugar>,
    /// Um por passo do guia.
    pub feito: &'a [bool],
    /// Posições em `guia.ordem` dos próximos; o primeiro é o número 1.
    pub proximos: &'a [u32],
    /// Quantos passos faltam no trecho do alvo.
    pub faltam: u32,
    /// Nós alocados que a build não quer mais.
    pub devolver: &'a [Lugar],
}

/// Monta o que se desenha (desenho do sistema, seção 5.3). `proibido` diz se um ponto da tela
/// cai em tapume ou em parte fixa da interface; aqui só serve pra tirar a seta de cima delas
/// (o resto é recortado depois, ponto a ponto, por `Tela::recortar`).
pub fn montar_cena(e: &Entrada, proibido: &dyn Fn(f32, f32) -> bool) -> Cena {
    let mut cena = Cena::default();
    if e.largura.is_nan() || e.altura.is_nan() || e.largura < 1.0 || e.altura < 1.0 {
        return cena;
    }
    // Espessuras e letras acompanham a altura da tela (1080: 1 / 1,5 / 2,25 / 3 pontos e letra de 17).
    // O fio é das linhas e do resto do trecho; o fino, dos numerados depois do nº 1; o normal, dos
    // nós a devolver (que pedem atenção); o grosso, do nº 1.
    let fio = (e.altura / 1080.0).max(1.0);
    let fino = (e.altura / 720.0).max(1.5);
    let normal = (e.altura / 480.0).max(2.0);
    let grosso = (e.altura / 360.0).max(3.0);
    let letra = (e.altura * 0.016).max(13.0);

    let cabe = |lugar: &Lugar| -> bool {
        lugar.x.is_finite() && lugar.y.is_finite() && lugar.x >= 0.0 && lugar.y >= 0.0 && lugar.x < e.largura && lugar.y < e.altura
    };
    let a_vista = |lugar: &Lugar| -> bool { !lugar.tapado && cabe(lugar) };
    let lugar_de = |passo: usize| -> Option<Lugar> { e.lugares.get(passo).copied().flatten() };
    let numero_de = |passo: usize| -> Option<usize> { e.proximos.iter().position(|p| *p as usize == passo) };
    let ate_alvo = (e.guia.ate_alvo as usize).min(e.guia.ordem.len());
    // O traço fica todo fora de `lugar.raio`: o meio dele vai meia espessura além (senão o anel
    // grosso, em tela alta, entraria no raio em que a leitura amostra o fundo do nó).
    let anel = |lugar: &Lugar, espessura: f32, cor: Cor| -> Forma {
        Forma::Anel { x: lugar.x, y: lugar.y, raio: lugar.raio + espessura / 2.0, espessura, cor }
    };

    // 7. Caixa de situação no topo, no centro (montada antes da seta, que precisa desviar dela).
    let titulo = if e.guia.texto.trim().is_empty() { "Árvore" } else { e.guia.texto.trim() };
    let proximo = e.proximos.first().and_then(|passo| e.guia.ordem.get(*passo as usize)).map(|dados| dados.nome.trim());
    let frase = match (e.faltam, proximo) {
        (0, _) => format!("{titulo} · completo"),
        (faltam, Some(nome)) if !nome.is_empty() => format!("{titulo} · faltam {faltam} · próximo: {nome}"),
        (faltam, _) => format!("{titulo} · faltam {faltam}"),
    };
    let letra_da_situacao = (e.altura * 0.019).max(14.0);
    // Onde a caixa de situação vai ficar (ela é pintada por último, com fundo: o que cair ali some).
    let meia_situacao = (frase.chars().count() as f32 * LARGURA_DA_LETRA * letra_da_situacao / 2.0 + letra_da_situacao)
        .max(e.altura * MEIA_FAIXA_DA_SITUACAO);
    let na_situacao = |x: f32, y: f32| -> bool {
        let topo = e.altura * ALTURA_DA_SITUACAO;
        y >= topo && y <= topo + e.altura * FAIXA_DA_SITUACAO && (x - e.largura / 2.0).abs() < meia_situacao
    };

    // 3. Resto do trecho do alvo ainda não feito: anel de fio, bem apagado.
    for passo in 0..ate_alvo {
        if e.feito.get(passo) != Some(&false) || numero_de(passo).is_some() {
            continue;
        }
        if let Some(lugar) = lugar_de(passo).filter(|l| a_vista(l)) {
            cena.formas.push(anel(&lugar, fio, VERDE_APAGADO));
        }
    }

    // 4. Alocados que a build não quer mais: anel vermelho.
    for lugar in e.devolver.iter().filter(|l| a_vista(l)) {
        cena.formas.push(anel(lugar, normal, VERMELHO));
    }

    // 2. Linha de fio entre o pai e o nó numerado, de borda de anel a borda de anel.
    for &passo in e.proximos {
        let passo = passo as usize;
        let (Some(lugar), Some(dados)) = (lugar_de(passo).filter(|l| a_vista(l)), e.guia.ordem.get(passo)) else {
            continue;
        };
        let pai = match usize::try_from(dados.pai) {
            Err(_) => e.inicio,
            Ok(pai) if numero_de(pai).is_some() || e.feito.get(pai) == Some(&true) => lugar_de(pai),
            Ok(_) => None,
        };
        let Some(pai) = pai.filter(|l| a_vista(l)) else { continue };
        let (dx, dy) = (lugar.x - pai.x, lugar.y - pai.y);
        let distancia = (dx * dx + dy * dy).sqrt();
        let sobra = distancia - pai.raio - lugar.raio;
        if !sobra.is_finite() || sobra <= 1.0 {
            continue;
        }
        let (ux, uy) = (dx / distancia, dy / distancia);
        cena.formas.push(Forma::Linha {
            x0: pai.x + ux * pai.raio,
            y0: pai.y + uy * pai.raio,
            x1: lugar.x - ux * lugar.raio,
            y1: lugar.y - uy * lugar.raio,
            espessura: fio,
            cor: VERDE_DA_LINHA,
        });
    }

    // 1. Próximos: anel verde-claro (o nº 1 mais grosso e cheio, os outros finos e mais apagados)
    // + caixinha com o número ao lado.
    // 5. Maestria entre os numerados: o efeito a escolher, numa caixa ao lado. Só o da primeira
    // (a de menor número): a caixa é grande e, com duas, uma taparia o grupo da outra.
    let mut efeito_posto = false;
    for (ordem, &passo) in e.proximos.iter().enumerate() {
        let passo = passo as usize;
        let Some(lugar) = lugar_de(passo).filter(|l| a_vista(l)) else { continue };
        let (espessura, cor) = if ordem == 0 { (grosso, VERDE) } else { (fino, VERDE_DOS_PROXIMOS) };
        cena.formas.push(anel(&lugar, espessura, cor));
        // A 45°, logo fora do anel: o número em cima à direita, o efeito embaixo à direita.
        let canto = (lugar.raio + espessura) * std::f32::consts::FRAC_1_SQRT_2 + 2.0;
        // A letra do número acompanha o anel (que acompanha o zoom), até o tamanho normal. Depois
        // do nº 1 o número é menor e mais apagado, como o anel.
        let letra_do_numero = (lugar.raio * LETRA_POR_RAIO).max(MENOR_LETRA_DE_NUMERO).min(letra);
        let (letra_do_numero, cor, fundo) = if ordem == 0 {
            (letra_do_numero, BRANCO, FUNDO)
        } else {
            ((letra_do_numero * MENOR_DOS_PROXIMOS).max(MENOR_LETRA_DE_NUMERO), BRANCO_DOS_PROXIMOS, FUNDO_DOS_PROXIMOS)
        };
        cena.textos.push(Texto {
            x: lugar.x + canto,
            y: lugar.y - canto,
            ancora_x: 0.0,
            ancora_y: 1.0,
            texto: (ordem + 1).to_string(),
            altura: letra_do_numero,
            cor,
            fundo,
        });
        let rotulo = e.guia.ordem.get(passo).and_then(|dados| dados.rotulo.as_deref()).map(str::trim).unwrap_or("");
        if lugar.maestria && !rotulo.is_empty() && !efeito_posto {
            efeito_posto = true;
            cena.textos.push(Texto {
                x: lugar.x + canto,
                y: lugar.y + canto,
                ancora_x: 0.0,
                ancora_y: 0.0,
                texto: quebrar(rotulo, COLUNAS_DO_ROTULO),
                altura: letra,
                cor: BRANCO,
                fundo: FUNDO,
            });
        }
    }

    // 6. Nº 1 fora da tela: seta na borda apontando pra ele, com o número.
    let primeiro = e.proximos.first().and_then(|passo| lugar_de(*passo as usize));
    if let Some(lugar) = primeiro.filter(|l| !l.tapado && !cabe(l) && l.x.is_finite() && l.y.is_finite()) {
        let (cx, cy) = (e.largura / 2.0, e.altura / 2.0);
        let (dx, dy) = (lugar.x - cx, lugar.y - cy);
        let margem = e.altura * MARGEM_DA_SETA;
        let (meia_x, meia_y) = ((cx - margem).max(1.0), (cy - margem).max(1.0));
        // Até onde dá pra ir do centro na direção do nó sem sair da margem.
        let alcance = (meia_x / dx.abs().max(1e-3)).min(meia_y / dy.abs().max(1e-3));
        let norma = (dx * dx + dy * dy).sqrt();
        if alcance.is_finite() && norma.is_finite() && norma > 0.0 {
            let tamanho = e.altura * 0.03;
            let (ux, uy) = (dx / norma, dy / norma);
            // Recua pro centro enquanto a seta ou o número dela caírem em cima de parte fixa ou
            // debaixo da caixa de situação (três pontos: a ponta, a base do triângulo e o número).
            let ponta = (0..RECUOS_DA_SETA)
                .map(|recuo| alcance * (1.0 - recuo as f32 / RECUOS_DA_SETA as f32))
                .map(|t| (cx + dx * t, cy + dy * t))
                .find(|(px, py)| {
                    let (mx, my) = (px - ux * tamanho, py - uy * tamanho);
                    let (bx, by) = (px - ux * tamanho * 2.0, py - uy * tamanho * 2.0);
                    let livre = |x: f32, y: f32| !proibido(x, y) && !na_situacao(x, y);
                    livre(*px, *py) && livre(mx, my) && livre(bx, by)
                });
            if let Some((px, py)) = ponta {
                cena.formas.push(Forma::Seta { x: px, y: py, dx, dy, tamanho, cor: VERDE });
                cena.textos.push(Texto {
                    x: px - ux * tamanho * 2.0,
                    y: py - uy * tamanho * 2.0,
                    ancora_x: 0.5,
                    ancora_y: 0.5,
                    texto: "1".into(),
                    altura: letra,
                    cor: BRANCO,
                    fundo: FUNDO,
                });
            }
        }
    }

    cena.situacao = Some(Texto {
        x: e.largura / 2.0,
        y: e.altura * ALTURA_DA_SITUACAO,
        ancora_x: 0.5,
        ancora_y: 0.0,
        texto: frase,
        altura: letra_da_situacao,
        cor: BRANCO,
        fundo: FUNDO,
    });
    cena
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::arvore::PassoRecebido;

    const L: usize = 64;
    const A: usize = 48;

    fn buffer() -> Vec<u8> {
        vec![0u8; L * A * 4]
    }

    fn riscados(tela: &Tela) -> usize {
        tela.pontos.as_chunks::<4>().0.iter().filter(|p| p[3] != 0).count()
    }

    /// Em todo ponto, nenhuma cor passa da opacidade (regra do pré-multiplicado).
    fn pre_multiplicado(tela: &Tela) -> bool {
        tela.pontos.as_chunks::<4>().0.iter().all(|p| p[0] <= p[3] && p[1] <= p[3] && p[2] <= p[3])
    }

    #[test]
    fn buffer_pequeno_demais_e_recusado() {
        let mut curto = vec![0u8; L * A * 4 - 1];
        assert!(Tela::nova(L, A, &mut curto).is_none());
        let mut certo = buffer();
        assert!(Tela::nova(0, A, &mut certo).is_none());
        assert!(Tela::nova(L, 0, &mut certo).is_none());
        assert!(Tela::nova(usize::MAX, 8, &mut certo).is_none());
        let tela = Tela::nova(L, A, &mut certo).unwrap();
        assert_eq!((tela.largura(), tela.altura()), (L, A));
    }

    #[test]
    fn anel_risca_a_circunferencia_e_deixa_o_miolo_livre() {
        let mut pontos = buffer();
        let mut tela = Tela::nova(L, A, &mut pontos).unwrap();
        tela.desenhar(&[Forma::Anel { x: 32.0, y: 24.0, raio: 10.0, espessura: 3.0, cor: VERDE }]);
        assert_eq!(tela.ponto(32, 24).unwrap()[3], 0, "o centro fica descoberto");
        assert_eq!(tela.ponto(32, 19).unwrap()[3], 0, "dentro do anel também");
        assert_eq!(tela.ponto(42, 24).unwrap(), [0x50, 0xFF, 0x60, 255], "em cima do traço: verde cheio (B, G, R, A)");
        assert_eq!(tela.ponto(32, 14).unwrap()[3], 255);
        assert_eq!(tela.ponto(32, 10).unwrap()[3], 0, "fora do anel");
        // A beira é antisserrilhada: há pontos meio cobertos.
        assert!(tela.pontos.as_chunks::<4>().0.iter().any(|p| p[3] > 0 && p[3] < 255));
        assert!(pre_multiplicado(&tela));
        // Área riscada perto de 2π · raio · espessura.
        let area = riscados(&tela) as f32;
        assert!((150.0..260.0).contains(&area), "{area}");
    }

    #[test]
    fn formas_fora_ou_cortadas_pela_borda_nao_estouram() {
        let mut pontos = buffer();
        let mut tela = Tela::nova(L, A, &mut pontos).unwrap();
        let cor = VERDE;
        let estranhos = [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, -1e30, 1e30, -5.0, 0.0, 63.9, 1e6];
        for &a in &estranhos {
            for &b in &estranhos {
                tela.desenhar(&[
                    Forma::Anel { x: a, y: b, raio: 9.0, espessura: 2.0, cor },
                    Forma::Anel { x: 10.0, y: 10.0, raio: a, espessura: b, cor },
                    Forma::Linha { x0: a, y0: b, x1: 20.0, y1: 20.0, espessura: 2.0, cor },
                    Forma::Linha { x0: 5.0, y0: 5.0, x1: a, y1: b, espessura: a, cor },
                    Forma::Caixa { x0: a, y0: b, x1: 30.0, y1: 30.0, cor },
                    Forma::Caixa { x0: 3.0, y0: 3.0, x1: a, y1: b, cor },
                    Forma::Seta { x: a, y: b, dx: 1.0, dy: 0.0, tamanho: 8.0, cor },
                    Forma::Seta { x: 20.0, y: 20.0, dx: a, dy: b, tamanho: a, cor },
                ]);
            }
        }
        assert!(pre_multiplicado(&tela));
        // Um anel no canto aparece só no pedaço que cabe.
        tela.limpar();
        assert_eq!(riscados(&tela), 0);
        tela.desenhar(&[Forma::Anel { x: 0.0, y: 0.0, raio: 12.0, espessura: 2.0, cor }]);
        let no_canto = riscados(&tela);
        assert!(no_canto > 10 && no_canto < 60, "{no_canto}");
        // Totalmente fora: nada.
        tela.limpar();
        tela.desenhar(&[
            Forma::Anel { x: -40.0, y: -40.0, raio: 12.0, espessura: 2.0, cor },
            Forma::Anel { x: 200.0, y: 24.0, raio: 12.0, espessura: 2.0, cor },
            Forma::Linha { x0: -30.0, y0: -10.0, x1: -5.0, y1: -90.0, espessura: 3.0, cor },
            Forma::Caixa { x0: 64.0, y0: 0.0, x1: 90.0, y1: 48.0, cor },
            Forma::Seta { x: 32.0, y: -30.0, dx: 0.0, dy: -1.0, tamanho: 6.0, cor },
        ]);
        assert_eq!(riscados(&tela), 0);
    }

    #[test]
    fn buffer_de_um_ponto_aguenta_tudo() {
        let mut pontos = vec![0u8; 4];
        let mut tela = Tela::nova(1, 1, &mut pontos).unwrap();
        tela.desenhar(&[
            Forma::Anel { x: 0.5, y: 0.5, raio: 30.0, espessura: 80.0, cor: VERDE },
            Forma::Linha { x0: -9.0, y0: -9.0, x1: 9.0, y1: 9.0, espessura: 4.0, cor: VERMELHO },
            Forma::Caixa { x0: -9.0, y0: -9.0, x1: 9.0, y1: 9.0, cor: FUNDO },
            Forma::Seta { x: 3.0, y: 0.5, dx: 1.0, dy: 0.0, tamanho: 9.0, cor: VERDE },
        ]);
        assert_eq!(tela.ponto(0, 0).unwrap()[3], 255);
        assert!(tela.ponto(1, 0).is_none());
    }

    #[test]
    fn linha_cobre_o_caminho_com_a_espessura_pedida() {
        let mut pontos = buffer();
        let mut tela = Tela::nova(L, A, &mut pontos).unwrap();
        tela.desenhar(&[Forma::Linha { x0: 10.0, y0: 10.0, x1: 50.0, y1: 40.0, espessura: 2.0, cor: VERDE }]);
        assert_eq!(tela.ponto(30, 25).unwrap()[3], 255, "o meio do caminho");
        assert_eq!(tela.ponto(30, 20).unwrap()[3], 0, "5 pontos pro lado já não");
        assert_eq!(tela.ponto(55, 44).unwrap()[3], 0, "não passa da ponta");
        // Comprimento 50 × espessura 2 (mais a beira): área perto de 100.
        let area = riscados(&tela);
        assert!((100..190).contains(&area), "{area}");
        // Linha de comprimento zero vira um pontinho, sem dividir por zero.
        tela.limpar();
        tela.desenhar(&[Forma::Linha { x0: 20.0, y0: 20.0, x1: 20.0, y1: 20.0, espessura: 3.0, cor: VERDE }]);
        assert!(riscados(&tela) > 0 && riscados(&tela) < 20);
    }

    #[test]
    fn caixa_cheia_e_recortada_na_borda() {
        let mut pontos = buffer();
        let mut tela = Tela::nova(L, A, &mut pontos).unwrap();
        tela.desenhar(&[Forma::Caixa { x0: 4.0, y0: 6.0, x1: 14.0, y1: 12.0, cor: Cor { r: 200, g: 100, b: 50, a: 255 } }]);
        assert_eq!(riscados(&tela), 10 * 6);
        assert_eq!(tela.ponto(4, 6).unwrap(), [50, 100, 200, 255]);
        assert_eq!(tela.ponto(14, 6).unwrap()[3], 0);
        // Passando da borda de baixo e da direita: só o pedaço de dentro.
        tela.limpar();
        tela.desenhar(&[Forma::Caixa { x0: 60.0, y0: 44.0, x1: 500.0, y1: 500.0, cor: FUNDO }]);
        assert_eq!(riscados(&tela), 4 * 4);
        // Meio ponto de cobertura na beira, e cor meio transparente por cima de outra.
        tela.limpar();
        tela.desenhar(&[Forma::Caixa { x0: 10.5, y0: 10.0, x1: 12.0, y1: 11.0, cor: BRANCO }]);
        assert_eq!(tela.ponto(10, 10).unwrap(), [128, 128, 128, 128]);
        assert_eq!(tela.ponto(11, 10).unwrap(), [255, 255, 255, 255]);
        tela.desenhar(&[Forma::Caixa { x0: 11.0, y0: 10.0, x1: 12.0, y1: 11.0, cor: Cor { r: 0, g: 0, b: 0, a: 128 } }]);
        let por_cima = tela.ponto(11, 10).unwrap();
        assert_eq!(por_cima[3], 255, "opaco por baixo continua opaco");
        assert!((126..=128).contains(&por_cima[0]), "{por_cima:?}");
        assert!(pre_multiplicado(&tela));
    }

    #[test]
    fn seta_aponta_pro_lado_certo() {
        let mut pontos = buffer();
        let mut tela = Tela::nova(L, A, &mut pontos).unwrap();
        // Ponta em (40, 24) apontando pra direita: o corpo fica à esquerda da ponta.
        tela.desenhar(&[Forma::Seta { x: 40.0, y: 24.0, dx: 5.0, dy: 0.0, tamanho: 10.0, cor: VERDE }]);
        assert_eq!(tela.ponto(35, 24).unwrap()[3], 255);
        assert_eq!(tela.ponto(31, 20).unwrap()[3], 255, "perto da base ela é larga");
        assert_eq!(tela.ponto(38, 20).unwrap()[3], 0, "perto da ponta ela é fina");
        assert_eq!(tela.ponto(43, 24).unwrap()[3], 0, "nada além da ponta");
        assert_eq!(tela.ponto(27, 24).unwrap()[3], 0, "nada atrás da base");
        // Área do triângulo: base 12 × altura 10 / 2 = 60.
        let area = riscados(&tela);
        assert!((50..90).contains(&area), "{area}");
    }

    #[test]
    fn recortar_apaga_so_o_que_e_proibido() {
        let mut pontos = buffer();
        let mut tela = Tela::nova(L, A, &mut pontos).unwrap();
        tela.desenhar(&[Forma::Caixa { x0: 0.0, y0: 0.0, x1: 64.0, y1: 48.0, cor: VERDE }]);
        tela.recortar(&|x, _| x < 16.0);
        assert_eq!(riscados(&tela), (L - 16) * A);
        assert_eq!(tela.ponto(15, 30).unwrap(), [0, 0, 0, 0]);
        assert_eq!(tela.ponto(16, 30).unwrap()[3], 255);
    }

    #[test]
    fn cobrir_usa_a_luz_do_rascunho_como_cobertura() {
        let mut pontos = buffer();
        let mut tela = Tela::nova(L, A, &mut pontos).unwrap();
        // Rascunho de 8 × 2: a primeira linha toda branca, a segunda pela metade.
        let mut luz = vec![0u8; 8 * 2 * 4];
        for coluna in 0..8 {
            luz[coluna * 4..coluna * 4 + 3].fill(255);
            luz[(8 + coluna) * 4..(8 + coluna) * 4 + 3].fill(128);
        }
        tela.cobrir(10, 5, 4, 2, &luz, 8, VERMELHO);
        assert_eq!(tela.ponto(10, 5).unwrap(), [0x3C, 0x46, 0xFF, 255]);
        assert_eq!(tela.ponto(13, 6).unwrap()[3], 128);
        assert_eq!(tela.ponto(14, 5).unwrap()[3], 0, "só as 4 colunas pedidas");
        assert_eq!(riscados(&tela), 8);
        // Fora da tela, pela esquerda/cima e pela direita/baixo: pinta só o que cabe.
        tela.limpar();
        tela.cobrir(-2, -1, 4, 2, &luz, 8, VERMELHO);
        assert_eq!(riscados(&tela), 2);
        tela.cobrir(62, 47, 4, 2, &luz, 8, VERMELHO);
        assert_eq!(riscados(&tela), 4);
        // Pedidos sem pé nem cabeça não estouram.
        tela.cobrir(i64::MAX, i64::MIN, 4, 2, &luz, 8, VERMELHO);
        tela.cobrir(0, 0, 9, 2, &luz, 8, VERMELHO);
        tela.cobrir(0, 0, 8, 50, &luz, 8, VERMELHO);
        tela.cobrir(0, 0, usize::MAX, usize::MAX, &luz, usize::MAX, VERMELHO);
        tela.cobrir(0, 0, 4, 2, &[], 8, VERMELHO);
        assert!(pre_multiplicado(&tela));
    }

    #[test]
    fn quebrar_respeita_as_colunas_e_o_limite_de_linhas() {
        assert_eq!(quebrar("  uma   frase curta ", 40), "uma frase curta");
        assert_eq!(quebrar("", 40), "");
        let longo = "10% increased Damage for each type of Mastery you have Allocated";
        let quebrado = quebrar(longo, 40);
        assert_eq!(quebrado.lines().count(), 2);
        assert!(quebrado.lines().all(|linha| linha.chars().count() <= 40));
        assert_eq!(quebrado.replace('\n', " "), longo);
        assert_eq!(quebrar("palavraenormequenaocabe ok", 5), "palavraenormequenaocabe\nok");
        let enorme = "ab ".repeat(200);
        let cortado = quebrar(&enorme, 5);
        assert_eq!(cortado.lines().count(), LINHAS_DO_ROTULO);
        assert!(cortado.ends_with('…'));
        assert_eq!(quebrar("a b", 0), "a\nb", "zero colunas vira uma");
    }

    fn passo(no: u32, pai: i32, nome: &str, rotulo: Option<&str>) -> PassoRecebido {
        PassoRecebido { no, pai, nome: nome.into(), rotulo: rotulo.map(str::to_string), solto: false }
    }

    fn guia_de_cinco() -> GuiaRecebido {
        GuiaRecebido {
            build: "b".into(),
            inicio: 1,
            ordem: vec![
                passo(10, -1, "Feito", None),
                passo(11, 0, "Heart of Oak", None),
                passo(12, 1, "Life Mastery", Some("+50 to maximum Life")),
                passo(13, 2, "Depois", None),
                passo(14, 3, "Longe", None),
            ],
            ate_alvo: 5,
            manter: Vec::new(),
            devolver: Vec::new(),
            texto: "Árvore até Act 3".into(),
            numerados: 2,
        }
    }

    fn lugar(x: f32, y: f32) -> Lugar {
        Lugar { x, y, raio: 20.0, tapado: false, maestria: false }
    }

    /// Raio de dentro do traço de cada anel da cena (o meio do traço menos meia espessura).
    fn raios_de_dentro(cena: &Cena) -> Vec<f32> {
        cena.formas
            .iter()
            .filter_map(|forma| match *forma {
                Forma::Anel { raio, espessura, .. } => Some(raio - espessura / 2.0),
                _ => None,
            })
            .collect()
    }

    fn aneis(cena: &Cena, cor: Cor) -> Vec<(f32, f32, f32)> {
        cena.formas
            .iter()
            .filter_map(|forma| match *forma {
                Forma::Anel { x, y, espessura, cor: c, .. } if c == cor => Some((x, y, espessura)),
                _ => None,
            })
            .collect()
    }

    fn nada_proibido(_: f32, _: f32) -> bool {
        false
    }

    #[test]
    fn cena_tem_aneis_numeros_linhas_e_situacao() {
        let guia = guia_de_cinco();
        let mut maestria = lugar(500.0, 400.0);
        maestria.maestria = true;
        let lugares = [Some(lugar(100.0, 400.0)), Some(lugar(300.0, 400.0)), Some(maestria), Some(lugar(700.0, 400.0)), None];
        let entrada = Entrada {
            largura: 1920.0,
            altura: 1080.0,
            guia: &guia,
            lugares: &lugares,
            inicio: Some(lugar(100.0, 200.0)),
            feito: &[true, false, false, false, false],
            proximos: &[1, 2],
            faltam: 4,
            devolver: &[lugar(900.0, 900.0), Lugar { tapado: true, ..lugar(950.0, 900.0) }],
        };
        let cena = montar_cena(&entrada, &nada_proibido);

        // Dois numerados: só o nº 1 de verde cheio e mais grosso; o nº 2 fino e mais apagado.
        let verdes = aneis(&cena, VERDE);
        let proximos = aneis(&cena, VERDE_DOS_PROXIMOS);
        assert_eq!((verdes.len(), proximos.len()), (1, 1));
        assert_eq!((verdes[0].0, proximos[0].0), (300.0, 500.0));
        assert!(verdes[0].2 > proximos[0].2);
        // O rastro (linhas e resto do trecho) é o traço mais fino e mais apagado de todos.
        let traco_da_linha = cena.formas.iter().find_map(|f| match *f {
            Forma::Linha { espessura, cor, .. } => Some((espessura, cor.a)),
            _ => None,
        });
        let (fio, opacidade) = traco_da_linha.expect("devia haver linha");
        assert!(fio < proximos[0].2 && opacidade < VERDE_DOS_PROXIMOS.a);
        assert!(aneis(&cena, VERDE_APAGADO).iter().all(|anel| anel.2 <= fio));
        assert!(VERDE_APAGADO.a < opacidade);
        // O resto do trecho (o passo 3; o 4 não tem lugar) em anel apagado; o feito não leva anel.
        assert_eq!(aneis(&cena, VERDE_APAGADO).len(), 1);
        assert_eq!(aneis(&cena, VERDE_APAGADO)[0].0, 700.0);
        // Só o devolver que não está tapado.
        assert_eq!(aneis(&cena, VERMELHO).len(), 1);
        // Linhas: do feito pro nº 1 e do nº 1 pro nº 2, de borda a borda.
        let linhas: Vec<(f32, f32)> = cena
            .formas
            .iter()
            .filter_map(|f| match *f {
                Forma::Linha { x0, x1, .. } => Some((x0, x1)),
                _ => None,
            })
            .collect();
        assert_eq!(linhas, vec![(120.0, 280.0), (320.0, 480.0)]);
        // Textos: "1", "2" e o efeito da maestria.
        let textos: Vec<&str> = cena.textos.iter().map(|t| t.texto.as_str()).collect();
        assert_eq!(textos, vec!["1", "2", "+50 to maximum Life"]);
        // O número do nº 2 é menor e mais apagado que o do nº 1, e numa caixa mais leve.
        let (um, dois) = (&cena.textos[0], &cena.textos[1]);
        assert!(dois.altura < um.altura && dois.cor.a < um.cor.a && dois.fundo.a < um.fundo.a);
        // O efeito da maestria continua bem legível.
        assert_eq!((cena.textos[2].cor, cena.textos[2].fundo), (BRANCO, FUNDO));
        // Os anéis numerados vêm depois dos outros (ficam por cima).
        let numerado = |f: &Forma| matches!(f, Forma::Anel { cor, .. } if *cor == VERDE || *cor == VERDE_DOS_PROXIMOS);
        assert_eq!(cena.formas.iter().position(numerado), Some(cena.formas.len() - 2));

        let situacao = cena.situacao.unwrap();
        assert_eq!(situacao.texto, "Árvore até Act 3 · faltam 4 · próximo: Heart of Oak");
        assert_eq!((situacao.x, situacao.ancora_x), (960.0, 0.5));
        assert!((situacao.y - 199.8).abs() < 0.1);
    }

    #[test]
    fn o_traco_de_todo_anel_fica_fora_do_raio_do_lugar() {
        // Tela de 2160 de altura: o anel do nº 1 tem 8 pontos de espessura. Nenhum traço (o grosso,
        // o normal, o apagado, o vermelho) pode entrar no raio em que a leitura amostra o nó.
        let guia = guia_de_cinco();
        let lugares =
            [Some(lugar(600.0, 900.0)), Some(lugar(800.0, 900.0)), Some(lugar(1000.0, 900.0)), Some(lugar(1200.0, 900.0)), None];
        let entrada = Entrada {
            largura: 3840.0,
            altura: 2160.0,
            guia: &guia,
            lugares: &lugares,
            inicio: None,
            feito: &[false; 5],
            proximos: &[0, 1],
            faltam: 5,
            devolver: &[lugar(1400.0, 900.0)],
        };
        let cena = montar_cena(&entrada, &nada_proibido);
        let raios = raios_de_dentro(&cena);
        assert_eq!(raios.len(), 5, "dois numerados, dois apagados e um vermelho");
        assert!(raios.iter().all(|raio| *raio >= 20.0), "{raios:?}");
    }

    #[test]
    fn letra_do_numero_acompanha_o_anel_e_so_uma_maestria_mostra_o_efeito() {
        let mut guia = guia_de_cinco();
        guia.ordem[3].rotulo = Some("outro efeito".into());
        // Zoom baixo: anéis de 9 pontos de raio, nós a 30 pontos uns dos outros.
        let pequeno = |x: f32, maestria: bool| Some(Lugar { raio: 9.0, maestria, ..lugar(x, 600.0) });
        let lugares = [pequeno(400.0, false), pequeno(430.0, false), pequeno(460.0, true), pequeno(490.0, true), None];
        let entrada = Entrada {
            largura: 2560.0,
            altura: 1440.0,
            guia: &guia,
            lugares: &lugares,
            inicio: None,
            feito: &[false; 5],
            proximos: &[0, 1, 2, 3],
            faltam: 5,
            devolver: &[],
        };
        let cena = montar_cena(&entrada, &nada_proibido);
        let numeros: Vec<&Texto> = cena.textos.iter().filter(|t| t.texto.parse::<u32>().is_ok()).collect();
        assert_eq!(numeros.len(), 4);
        // 9 × 1,2 = 10,8 pontos, e não os 23 da letra normal em 1440p. Os de depois do nº 1 são
        // 15% menores, mas nunca abaixo do piso.
        let alturas: Vec<f32> = numeros.iter().map(|t| t.altura).collect();
        assert!((alturas[0] - 10.8).abs() < 0.01, "{alturas:?}");
        assert!(alturas[1..].iter().all(|a| *a == MENOR_LETRA_DE_NUMERO), "{alturas:?}");
        // Duas maestrias numeradas: só o efeito da primeira.
        let efeitos: Vec<&str> = cena.textos.iter().filter(|t| t.texto.parse::<u32>().is_err()).map(|t| t.texto.as_str()).collect();
        assert_eq!(efeitos, vec!["+50 to maximum Life"]);

        // Anel minúsculo: a letra para no piso. Anel grande: para no tamanho normal (0,016 da altura).
        let minusculo = [Some(Lugar { raio: 2.0, ..lugar(400.0, 600.0) }), None, None, None, None];
        let cena = montar_cena(&Entrada { lugares: &minusculo, proximos: &[0], ..entrada }, &nada_proibido);
        assert_eq!(cena.textos[0].altura, MENOR_LETRA_DE_NUMERO);
        let grande = [Some(Lugar { raio: 80.0, ..lugar(400.0, 600.0) }), None, None, None, None];
        let cena = montar_cena(&Entrada { lugares: &grande, proximos: &[0], ..entrada }, &nada_proibido);
        assert!((cena.textos[0].altura - 1440.0 * 0.016).abs() < 0.01);
        // Raio que não é número não estoura (e a letra cai no piso).
        let torto = [Some(Lugar { raio: f32::NAN, ..lugar(400.0, 600.0) }), None, None, None, None];
        let cena = montar_cena(&Entrada { lugares: &torto, proximos: &[0], ..entrada }, &nada_proibido);
        assert_eq!(cena.textos[0].altura, MENOR_LETRA_DE_NUMERO);
    }

    #[test]
    fn seta_pra_cima_nao_fica_debaixo_da_caixa_de_situacao() {
        let guia = guia_de_cinco();
        for (largura, altura) in [(1920.0f32, 1080.0f32), (2560.0, 1440.0), (3840.0, 2160.0)] {
            // A parte fixa do topo (cabeçalho do jogo): acima de 0,175 da altura, 0,34 pra cada lado.
            let topo = move |x: f32, y: f32| y < altura * 0.175 && (x - largura / 2.0).abs() < altura * 0.34;
            // O nº 1 reto pra cima, e um pouco pros lados (até onde a seta ainda sai por cima).
            for desvio in [0.0f32, -0.6, 0.6, 1.5, 2.4] {
                let lugares = [Some(lugar(largura / 2.0 + desvio * altura, -3.0 * altura)), None, None, None, None];
                let entrada = Entrada {
                    largura,
                    altura,
                    guia: &guia,
                    lugares: &lugares,
                    inicio: None,
                    feito: &[false; 5],
                    proximos: &[0],
                    faltam: 5,
                    devolver: &[],
                };
                let cena = montar_cena(&entrada, &topo);
                let seta = cena.formas.iter().find_map(|f| match *f {
                    Forma::Seta { x, y, dx, dy, tamanho, .. } => Some((x, y, dx, dy, tamanho)),
                    _ => None,
                });
                let (x, y, dx, dy, tamanho) = seta.expect("devia haver seta");
                assert!(dy < 0.0, "aponta pra cima");
                let situacao = cena.situacao.as_ref().unwrap();
                // A caixa de situação: do `y` dela até a letra mais as duas margens (0,35 da letra cada).
                let fim_da_caixa = situacao.y + situacao.altura * 1.7;
                let norma = (dx * dx + dy * dy).sqrt();
                // O triângulo vai da ponta até `tamanho` atrás; o número fica a 2 × `tamanho`.
                for atras in [0.0, tamanho, 2.0 * tamanho] {
                    let (px, py) = (x - dx / norma * atras, y - dy / norma * atras);
                    let na_faixa = py >= situacao.y && py <= fim_da_caixa && (px - largura / 2.0).abs() < altura * 0.34;
                    assert!(!na_faixa, "{largura}×{altura}, desvio {desvio}: ({px}, {py}) cai na caixa de situação");
                    assert!(!topo(px, py));
                }
            }
        }
    }

    #[test]
    fn primeiro_passo_liga_no_inicio_da_classe() {
        let guia = guia_de_cinco();
        let lugares = [Some(lugar(100.0, 400.0)), None, None, None, None];
        let entrada = Entrada {
            largura: 1920.0,
            altura: 1080.0,
            guia: &guia,
            lugares: &lugares,
            inicio: Some(lugar(100.0, 200.0)),
            feito: &[false; 5],
            proximos: &[0],
            faltam: 5,
            devolver: &[],
        };
        let cena = montar_cena(&entrada, &nada_proibido);
        assert!(cena.formas.iter().any(|f| matches!(*f, Forma::Linha { y0, y1, .. } if y0 == 220.0 && y1 == 380.0)));
        // Sem o início na tela, sem linha.
        let sem_inicio = Entrada { inicio: None, ..entrada };
        assert!(!montar_cena(&sem_inicio, &nada_proibido).formas.iter().any(|f| matches!(f, Forma::Linha { .. })));
    }

    #[test]
    fn no_tapado_ou_fora_da_tela_nao_e_desenhado() {
        let guia = guia_de_cinco();
        let lugares = [
            Some(Lugar { tapado: true, ..lugar(100.0, 400.0) }),
            Some(lugar(-300.0, 400.0)),
            Some(lugar(f32::NAN, 400.0)),
            Some(lugar(700.0, 5000.0)),
            None,
        ];
        let entrada = Entrada {
            largura: 1920.0,
            altura: 1080.0,
            guia: &guia,
            lugares: &lugares,
            inicio: None,
            feito: &[false; 5],
            proximos: &[0, 2],
            faltam: 5,
            devolver: &[],
        };
        let cena = montar_cena(&entrada, &nada_proibido);
        assert!(cena.formas.is_empty(), "{:?}", cena.formas);
        assert!(cena.textos.is_empty(), "o nº 1 está tapado: nem seta");
        assert!(cena.situacao.is_some());
    }

    #[test]
    fn numero_um_fora_da_tela_ganha_seta_na_borda() {
        let guia = guia_de_cinco();
        // O nº 1 está muito à direita e um pouco acima.
        let lugares = [Some(lugar(5000.0, 300.0)), None, None, None, None];
        let entrada = Entrada {
            largura: 1920.0,
            altura: 1080.0,
            guia: &guia,
            lugares: &lugares,
            inicio: None,
            feito: &[false; 5],
            proximos: &[0],
            faltam: 5,
            devolver: &[],
        };
        let cena = montar_cena(&entrada, &nada_proibido);
        let seta = cena.formas.iter().find_map(|f| match *f {
            Forma::Seta { x, y, dx, dy, .. } => Some((x, y, dx, dy)),
            _ => None,
        });
        let (x, y, dx, dy) = seta.expect("devia haver seta");
        assert!((x - (1920.0 - 86.4)).abs() < 0.5, "na margem da direita: {x}");
        assert!(y > 0.0 && y < 540.0);
        assert!(dx > 0.0 && dy < 0.0);
        assert_eq!(cena.textos.len(), 1);
        assert_eq!(cena.textos[0].texto, "1");
        assert!(cena.textos[0].x < x, "o número fica atrás da seta");

        // Com a beira da direita proibida, a seta recua pro centro.
        let recuada = montar_cena(&entrada, &|px, _| px > 1500.0);
        let x_recuado = recuada.formas.iter().find_map(|f| match *f {
            Forma::Seta { x, .. } => Some(x),
            _ => None,
        });
        assert!(x_recuado.expect("ainda há seta") <= 1500.0);
        // Com tudo proibido, não há seta (nem número dela).
        let sem = montar_cena(&entrada, &|_, _| true);
        assert!(sem.formas.is_empty() && sem.textos.is_empty());
    }

    #[test]
    fn situacao_completa_e_sem_titulo() {
        let mut guia = guia_de_cinco();
        guia.texto = "  ".into();
        let entrada = Entrada {
            largura: 1280.0,
            altura: 720.0,
            guia: &guia,
            lugares: &[],
            inicio: None,
            feito: &[true; 5],
            proximos: &[],
            faltam: 0,
            devolver: &[],
        };
        assert_eq!(montar_cena(&entrada, &nada_proibido).situacao.unwrap().texto, "Árvore · completo");
        let so_soltos = Entrada { faltam: 2, ..entrada };
        assert_eq!(montar_cena(&so_soltos, &nada_proibido).situacao.unwrap().texto, "Árvore · faltam 2");
    }

    #[test]
    fn entrada_torta_nao_quebra() {
        let guia = guia_de_cinco();
        let lugares = [Some(lugar(10.0, 10.0))];
        let entrada = Entrada {
            largura: 800.0,
            altura: 600.0,
            guia: &guia,
            lugares: &lugares,
            inicio: None,
            feito: &[],
            proximos: &[0, 99, 4, u32::MAX],
            faltam: 9,
            devolver: &[],
        };
        let cena = montar_cena(&entrada, &nada_proibido);
        assert_eq!(aneis(&cena, VERDE).len(), 1);
        let sem_tela = Entrada { largura: f32::NAN, altura: 0.0, ..entrada };
        assert_eq!(montar_cena(&sem_tela, &nada_proibido), Cena::default());
    }

    #[test]
    fn a_cena_inteira_cabe_num_buffer_pequeno() {
        // O que `montar_cena` devolve pra uma tela grande, riscado num buffer menor: nada estoura.
        let guia = guia_de_cinco();
        let lugares = [Some(lugar(100.0, 400.0)), Some(lugar(1900.0, 1070.0)), Some(lugar(5.0, 5.0)), None, None];
        let entrada = Entrada {
            largura: 1920.0,
            altura: 1080.0,
            guia: &guia,
            lugares: &lugares,
            inicio: Some(lugar(100.0, 200.0)),
            feito: &[true, false, false, false, false],
            proximos: &[1, 2],
            faltam: 4,
            devolver: &[lugar(1919.0, 0.0)],
        };
        let cena = montar_cena(&entrada, &nada_proibido);
        let mut pontos = buffer();
        let mut tela = Tela::nova(L, A, &mut pontos).unwrap();
        tela.desenhar(&cena.formas);
        assert!(riscados(&tela) > 0);
        assert!(pre_multiplicado(&tela));
    }
}
