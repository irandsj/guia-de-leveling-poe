//! Vigia da mochila: percebe quando uma gema da build está no inventário (comprada no vendedor,
//! pega na recompensa da quest ou trazida de antes), pra interface marcar a gema sozinha.
//!
//! O laço da visão fotografa a grade do inventário enquanto ele está aberto na cidade (o laço dos
//! painéis reconhece o cabeçalho dele). Cada casa da grade vira "vazia", "gema tal" ou "outra coisa",
//! e só vale o que aparece em duas olhadas seguidas. Uma gema da lista conta quando o inventário
//! passa a ter mais cópias dela do que já teve nesta visita à cidade. Assim, mudar a gema de casa,
//! pegar no cursor e devolver, ou uma dica do jogo passando por cima da grade não marcam nada de novo.
//! Gema posta direto no equipamento não passa pela grade e fica pra marcar na mão.
//!
//! Só contas: não fala com o Windows nem com o jogo, então dá pra testar com fotos guardadas.

use std::collections::HashMap;

use crate::casar::{Foto, Icone, Lugar, MoldeFixo};

/// A grade do inventário tem 12 colunas e 5 linhas e fica presa na direita da tela.
pub const COLUNAS: usize = 12;
pub const LINHAS: usize = 5;
/// Em alturas de tela: a borda esquerda da grade fica a `ESQUERDA` da borda direita da tela, o
/// topo a `TOPO` do topo, e cada casa tem `CASA` de lado. Medido em prints de 1920x1080 e 3840x2160.
const ESQUERDA: f32 = 0.6005;
const TOPO: f32 = 0.5435;
const CASA: f32 = 0.0487;
/// O ícone da gema ocupa a casa: o mesmo lado do ícone na loja.
const ICONE: f32 = crate::visao::FRACAO_NA_LOJA;
/// Folga em volta da grade na foto, em pontos (o ícone pode estar um pouco fora do lugar).
const FOLGA: usize = 4;
/// Até quantos pontos o canto do ícone pode estar longe do canto da casa.
const RAIO: usize = 3;
/// A conta de "vazia" usa o miolo da casa, sem esta fração do lado em cada borda (as linhas da grade).
const MARGEM: f32 = 0.12;
/// Casa vazia é escura e lisa. Medido no miolo das vazias: média de 6 a 7, desvio de 1 a 3.
const VAZIA_MEDIA: f32 = 14.0;
const VAZIA_DESVIO: f32 = 6.0;
/// Quanto a cor do miolo pode mudar sem conferir de novo o que tem na casa.
const MUDOU: f32 = 4.0;

/// Onde fica a grade numa tela do jogo, e de que tamanho são as casas.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Grade {
    /// O pedaço da área de jogo a fotografar (com a folga): canto e tamanho, em pontos.
    pub x: usize,
    pub y: usize,
    pub largura: usize,
    pub altura: usize,
    /// Canto da primeira casa dentro da foto da grade.
    canto: (f32, f32),
    /// Lado de uma casa, com fração.
    casa: f32,
    /// Lado do ícone de gema.
    lado: usize,
}

impl Grade {
    /// A grade numa área de jogo deste tamanho. Nada se ela não cabe (tela estreita demais).
    pub fn da_tela(largura: usize, altura: usize) -> Option<Grade> {
        let h = altura as f32;
        let casa = CASA * h;
        let (esquerda, topo) = (largura as f32 - ESQUERDA * h, TOPO * h);
        let (x, y) = (esquerda.floor() as isize - FOLGA as isize, topo.floor() as isize - FOLGA as isize);
        let largura_da_grade = (COLUNAS as f32 * casa).ceil() as usize + 2 * FOLGA;
        let altura_da_grade = (LINHAS as f32 * casa).ceil() as usize + 2 * FOLGA;
        if x < 0 || y < 0 || x as usize + largura_da_grade > largura || y as usize + altura_da_grade > altura {
            return None;
        }
        Some(Grade {
            x: x as usize,
            y: y as usize,
            largura: largura_da_grade,
            altura: altura_da_grade,
            canto: (esquerda - x as f32, topo - y as f32),
            casa,
            lado: (ICONE * h).round() as usize,
        })
    }

    /// Nota mínima pra uma casa desta grade ser a gema.
    pub fn limiar(&self) -> f32 {
        limiar_da_casa(self.casa)
    }

    /// Canto da casa (coluna, linha) na foto da grade.
    pub fn casa(&self, coluna: usize, linha: usize) -> (usize, usize) {
        (
            (self.canto.0 + coluna as f32 * self.casa).round() as usize,
            (self.canto.1 + linha as f32 * self.casa).round() as usize,
        )
    }

    /// Lado do ícone de gema, em pontos.
    pub fn lado(&self) -> usize {
        self.lado
    }
}

/// Uma gema da build, pronta pra conferir nas casas.
pub struct Procurada {
    pub id: String,
    molde: MoldeFixo,
}

/// As gemas procuradas (id e ícone), com o ícone no `lado` da grade. Gema repetida (a mesma como
/// recompensa e como compra) vale uma vez só.
pub fn procuradas<'a>(alvos: impl IntoIterator<Item = (&'a str, &'a Icone)>, lado: usize) -> Vec<Procurada> {
    let mut saida: Vec<Procurada> = Vec::new();
    for (id, icone) in alvos {
        if saida.iter().any(|p| p.id == id) {
            continue;
        }
        if let Some(molde) = MoldeFixo::novo(icone, lado, Lugar::Loja) {
            saida.push(Procurada { id: id.to_string(), molde });
        }
    }
    saida
}

/// Nota mínima pra casa ser a gema, pelo lado da casa: de `LIMIAR_PEQUENA` (casa de `CASA_PEQUENA`
/// pontos ou menos) a `LIMIAR_GRANDE` (de `CASA_GRANDE` pra cima). Ícone pequeno tem menos detalhe,
/// e um item qualquer chega mais perto dele. Mais baixa que a das janelas: na mochila a gema sai mais
/// escura, e com fundo vermelho quando falta nível. Nas fotos de prova (`bancada_mochila`, contra
/// todas as gemas da pasta), as gemas e os outros itens ficaram: casa de 35 pontos (720), a partir de
/// 0,779 e até 0,730; de 44 (900), 0,746 e 0,709; de 51 (1680x1050), 0,722 e 0,690; de 105 (4K),
/// 0,728 e 0,648.
const LIMIAR_PEQUENA: f32 = 0.75;
const CASA_PEQUENA: f32 = 36.0;
const LIMIAR_GRANDE: f32 = 0.70;
const CASA_GRANDE: f32 = 52.0;

fn limiar_da_casa(casa: f32) -> f32 {
    let fracao = ((casa - CASA_PEQUENA) / (CASA_GRANDE - CASA_PEQUENA)).clamp(0.0, 1.0);
    LIMIAR_PEQUENA - fracao * (LIMIAR_PEQUENA - LIMIAR_GRANDE)
}

/// As gemas da build prontas pra conferir nas casas, no lado do ícone de uma grade. Ficam guardadas:
/// a lista de agora muda a cada gema marcada, e o desenho de cada uma só é feito uma vez.
pub struct Gemas {
    lado: usize,
    todas: Vec<Procurada>,
}

impl Gemas {
    pub fn novas(lado: usize) -> Gemas {
        Gemas { lado, todas: Vec::new() }
    }

    pub fn lado(&self) -> usize {
        self.lado
    }

    /// Junta estas gemas às guardadas (as que já estão ficam como estão).
    pub fn juntar<'a>(&mut self, gemas: impl IntoIterator<Item = (&'a str, &'a Icone)>) {
        let novas: Vec<(&str, &Icone)> =
            gemas.into_iter().filter(|(id, _)| self.todas.iter().all(|g| g.id != *id)).collect();
        self.todas.extend(procuradas(novas, self.lado));
    }

    pub fn todas(&self) -> &[Procurada] {
        &self.todas
    }
}

/// O que tem numa casa.
#[derive(Clone, Debug, PartialEq)]
pub enum Conteudo {
    Vazia,
    /// Uma das gemas da lista (o id dela).
    Gema(String),
    /// Item, gema que não está na lista, dica do jogo por cima, cursor...
    Outra,
}

/// Cor do miolo de uma casa: média de cada cor, média geral e desvio de todos os valores.
#[derive(Clone, Copy, Debug)]
struct Miolo {
    cores: [f32; 3],
    media: f32,
    desvio: f32,
}

impl Miolo {
    /// O quadrado de lado `lado` com o canto em (x0, y0).
    fn de(foto: &Foto, x0: usize, y0: usize, lado: usize) -> Miolo {
        let (mut soma, mut quadrados) = ([0f64; 3], 0f64);
        for y in y0..(y0 + lado).min(foto.altura) {
            let linha = &foto.rgb[(y * foto.largura + x0) * 3..(y * foto.largura + (x0 + lado).min(foto.largura)) * 3];
            for ponto in linha.chunks_exact(3) {
                for c in 0..3 {
                    let v = ponto[c] as f64;
                    soma[c] += v;
                    quadrados += v * v;
                }
            }
        }
        let n = (lado * lado).max(1) as f64;
        let media = (soma[0] + soma[1] + soma[2]) / (3.0 * n);
        let variancia = (quadrados / (3.0 * n) - media * media).max(0.0);
        Miolo {
            cores: soma.map(|s| (s / n) as f32),
            media: media as f32,
            desvio: variancia.sqrt() as f32,
        }
    }

    fn vazia(&self) -> bool {
        self.media < VAZIA_MEDIA && self.desvio < VAZIA_DESVIO
    }

    fn perto(&self, outro: &Miolo) -> bool {
        (0..3).all(|c| (self.cores[c] - outro.cores[c]).abs() <= MUDOU) && (self.desvio - outro.desvio).abs() <= MUDOU
    }
}

#[derive(Clone, Default)]
struct Celula {
    /// O que se viu na última olhada, e o miolo de quando a casa foi conferida (sem miolo: conferir
    /// de novo na próxima olhada).
    vista: Option<(Conteudo, Option<Miolo>)>,
    /// O que se viu em duas olhadas seguidas.
    confirmada: Option<Conteudo>,
}

/// O que a vigia guarda de uma olhada pra outra.
pub struct Vigia {
    celulas: Vec<Celula>,
    /// Quantas cópias de cada gema da lista o inventário já teve (confirmadas) nesta visita.
    maximo: HashMap<String, usize>,
}

impl Default for Vigia {
    fn default() -> Vigia {
        Vigia::nova()
    }
}

impl Vigia {
    pub fn nova() -> Vigia {
        Vigia { celulas: vec![Celula::default(); COLUNAS * LINHAS], maximo: HashMap::new() }
    }

    /// As casas mudaram de lugar (outra altura de tela): o que se viu nelas não vale mais. O máximo de
    /// cada gema continua.
    pub fn esquecer_casas(&mut self) {
        self.celulas = vec![Celula::default(); COLUNAS * LINHAS];
    }

    /// Saiu da cidade: na próxima visita, cada gema que estiver no inventário conta de novo (a
    /// interface sabe quantas já marcou). O que se viu nas casas fica: só a casa que mudou é conferida
    /// de novo.
    pub fn nova_visita(&mut self) {
        self.maximo.clear();
    }

    /// A lista mudou: as casas ocupadas são conferidas de novo na próxima olhada.
    pub fn trocar_procuradas(&mut self) {
        for celula in &mut self.celulas {
            if let Some((conteudo, miolo)) = &mut celula.vista {
                if *conteudo != Conteudo::Vazia {
                    *miolo = None;
                }
            }
        }
    }

    /// Uma olhada na foto da grade, com o inventário aberto. `gemas` são as da build, e `lista` os ids
    /// das que ainda faltam. Devolve as da lista que passaram a ter mais cópias na grade, com quantas
    /// cópias têm agora (cada aumento uma vez só).
    pub fn olhar(&mut self, foto: &Foto, grade: &Grade, gemas: &[Procurada], lista: &[&str]) -> Vec<(String, usize)> {
        let lado_da_casa = grade.casa.round() as usize;
        let margem = (grade.casa * MARGEM) as usize;
        let miolo = lado_da_casa.saturating_sub(2 * margem).max(1);
        let limiar = grade.limiar();
        for linha in 0..LINHAS {
            for coluna in 0..COLUNAS {
                let (x, y) = grade.casa(coluna, linha);
                let celula = &mut self.celulas[linha * COLUNAS + coluna];
                if x + lado_da_casa > foto.largura || y + lado_da_casa > foto.altura {
                    *celula = Celula::default();
                    continue;
                }
                let agora = Miolo::de(foto, x + margem, y + margem, miolo);
                let (conteudo, conferido) = if agora.vazia() {
                    (Conteudo::Vazia, Some(agora))
                } else {
                    match &celula.vista {
                        Some((antes, Some(de_quando))) if *antes != Conteudo::Vazia && de_quando.perto(&agora) => {
                            (antes.clone(), Some(*de_quando))
                        }
                        _ => (conferir(foto, (x, y), gemas, lista, limiar), Some(agora)),
                    }
                };
                if celula.vista.as_ref().is_some_and(|(antes, _)| *antes == conteudo) {
                    celula.confirmada = Some(conteudo.clone());
                }
                celula.vista = Some((conteudo, conferido));
            }
        }

        let mut contagem: HashMap<&str, usize> = HashMap::new();
        for celula in &self.celulas {
            if let Some(Conteudo::Gema(id)) = &celula.confirmada {
                *contagem.entry(id.as_str()).or_default() += 1;
            }
        }
        let mut chegaram = Vec::new();
        for (id, quantas) in contagem {
            let maximo = self.maximo.entry(id.to_string()).or_default();
            if quantas > *maximo {
                chegaram.push((id.to_string(), quantas));
                *maximo = quantas;
            }
        }
        chegaram.sort();
        chegaram
    }
}

/// Qual gema da `lista` está na casa com este canto: a de nota maior, se passar do limiar e se nenhuma
/// outra gema da build tiver nota ainda maior ali (aí é a outra que está na casa, de desenho parecido).
fn conferir(foto: &Foto, canto: (usize, usize), gemas: &[Procurada], lista: &[&str], limiar: f32) -> Conteudo {
    let mut melhor: Option<(f32, &str)> = None;
    let mut maior_de_fora = f32::MIN;
    for gema in gemas {
        // Toda gema passa pelas duas passadas: cortar pela primeira (de 2 em 2 pontos) perdia gemas
        // certas nas fotos de prova, porque a segunda subia a nota até 0,36.
        let nota = gema.molde.nota_em_volta(foto, canto, RAIO);
        if !lista.contains(&gema.id.as_str()) {
            maior_de_fora = maior_de_fora.max(nota);
        } else if nota >= limiar && melhor.map_or(true, |(n, _)| nota > n) {
            melhor = Some((nota, &gema.id));
        }
    }
    match melhor {
        Some((nota, id)) if maior_de_fora < nota => Conteudo::Gema(id.to_string()),
        _ => Conteudo::Outra,
    }
}

/// A nota de cada gema procurada em cada casa ocupada, pra prova com prints.
#[cfg(test)]
pub(crate) fn notas_das_casas(foto: &Foto, grade: &Grade, procuradas: &[Procurada]) -> Vec<((usize, usize), Vec<(f32, String)>)> {
    let lado_da_casa = grade.casa.round() as usize;
    let margem = (grade.casa * MARGEM) as usize;
    let miolo = lado_da_casa.saturating_sub(2 * margem).max(1);
    let mut saida = Vec::new();
    for linha in 0..LINHAS {
        for coluna in 0..COLUNAS {
            let (x, y) = grade.casa(coluna, linha);
            if Miolo::de(foto, x + margem, y + margem, miolo).vazia() {
                continue;
            }
            let mut notas: Vec<(f32, String)> =
                procuradas.iter().map(|p| (p.molde.nota_em_volta(foto, (x, y), RAIO), p.id.clone())).collect();
            notas.sort_by(|a, b| b.0.total_cmp(&a.0));
            saida.push(((coluna, linha), notas));
        }
    }
    saida
}

#[cfg(test)]
mod testes {
    use super::*;

    fn sorteador(mut semente: u64) -> impl FnMut() -> u8 {
        move || {
            semente = semente.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (semente >> 33) as u8
        }
    }

    /// Ícone redondo de manchas grandes, 78 por 78.
    fn icone(semente: u64) -> Icone {
        let mut sorteio = sorteador(semente);
        let blocos: Vec<[u8; 3]> = (0..13 * 13).map(|_| [sorteio(), sorteio(), sorteio()]).collect();
        let mut rgba = vec![0u8; 78 * 78 * 4];
        for y in 0..78 {
            for x in 0..78 {
                let (dx, dy) = (x as f32 - 38.5, y as f32 - 38.5);
                if (dx * dx + dy * dy).sqrt() <= 34.0 {
                    let cor = blocos[(y / 6) * 13 + x / 6];
                    rgba[(y * 78 + x) * 4..][..4].copy_from_slice(&[cor[0], cor[1], cor[2], 255]);
                }
            }
        }
        Icone::novo(78, rgba).unwrap()
    }

    /// Foto da grade vazia: escura, com um chuvisco fraco.
    fn grade_vazia(grade: &Grade) -> Foto {
        let mut sorteio = sorteador(99);
        let rgb = (0..grade.largura * grade.altura * 3).map(|_| 4 + sorteio() % 5).collect();
        Foto { largura: grade.largura, altura: grade.altura, rgb }
    }

    fn por_gema(foto: &mut Foto, grade: &Grade, icone: &Icone, (coluna, linha): (usize, usize), desvio: usize) {
        let (x, y) = grade.casa(coluna, linha);
        let colado = icone.redimensionado(grade.lado);
        for iy in 0..grade.lado {
            for ix in 0..grade.lado {
                let p = &colado.rgba[(iy * grade.lado + ix) * 4..][..4];
                if p[3] > 128 {
                    let i = ((y + desvio + iy) * foto.largura + x + desvio + ix) * 3;
                    foto.rgb[i..i + 3].copy_from_slice(&p[..3]);
                }
            }
        }
    }

    /// Um item qualquer: quadradinhos de cores sorteadas cobrindo a casa.
    fn por_item(foto: &mut Foto, grade: &Grade, (coluna, linha): (usize, usize)) {
        let mut sorteio = sorteador(7 + coluna as u64 * 31 + linha as u64);
        let (x, y) = grade.casa(coluna, linha);
        let lado = grade.casa.round() as usize;
        let blocos: Vec<[u8; 3]> = (0..100).map(|_| [sorteio(), sorteio(), sorteio()]).collect();
        for iy in 0..lado {
            for ix in 0..lado {
                let i = ((y + iy) * foto.largura + x + ix) * 3;
                foto.rgb[i..i + 3].copy_from_slice(&blocos[(iy / 6 % 10) * 10 + ix / 6 % 10]);
            }
        }
    }

    fn esvaziar(foto: &mut Foto, grade: &Grade, (coluna, linha): (usize, usize)) {
        let vazia = grade_vazia(grade);
        let (x, y) = grade.casa(coluna, linha);
        let lado = grade.casa.round() as usize + 3;
        for iy in y..(y + lado).min(foto.altura) {
            let (a, b) = ((iy * foto.largura + x) * 3, (iy * foto.largura + (x + lado).min(foto.largura)) * 3);
            foto.rgb[a..b].copy_from_slice(&vazia.rgb[a..b]);
        }
    }

    /// O ícone da `semente` com um bloco em cada oito sorteado de novo: desenho parecido, outra gema.
    fn parecido(semente: u64) -> Icone {
        let original = icone(semente);
        let mut sorteio = sorteador(semente + 1000);
        let mut rgba = original.rgba.clone();
        for by in 0..13 {
            for bx in 0..13 {
                if (by * 13 + bx) % 8 != 0 {
                    continue;
                }
                let cor = [sorteio(), sorteio(), sorteio()];
                for y in by * 6..by * 6 + 6 {
                    for x in bx * 6..bx * 6 + 6 {
                        let p = &mut rgba[(y * 78 + x) * 4..][..4];
                        if p[3] == 255 {
                            p[..3].copy_from_slice(&cor);
                        }
                    }
                }
            }
        }
        Icone::novo(78, rgba).unwrap()
    }

    const FROSTBLINK: &str = "Metadata/Items/Gems/SkillGemFrostblink";
    const ONSLAUGHT: &str = "Metadata/Items/Gems/SupportGemOnslaught";

    fn montar(altura: usize) -> (Grade, Icone, Icone, Vec<Procurada>) {
        let grade = Grade::da_tela(altura * 16 / 9, altura).unwrap();
        let (a, b) = (icone(1), icone(2));
        let procuradas = procuradas([(FROSTBLINK, &a), (ONSLAUGHT, &b), (FROSTBLINK, &a)], grade.lado);
        (grade, a, b, procuradas)
    }

    #[test]
    fn a_grade_fica_presa_na_direita_e_acompanha_a_altura() {
        let g = Grade::da_tela(1920, 1080).unwrap();
        // Borda esquerda em 1920 - 0,6005 x 1080 = 1271,46; topo em 0,5435 x 1080 = 586,98; casa de 52,6.
        assert_eq!((g.x, g.y, g.largura, g.altura), (1267, 582, 640, 271));
        assert_eq!(g.casa(0, 0), (4, 5));
        assert_eq!(g.casa(11, 4), (583, 215));
        assert_eq!(g.lado(), 53);
        let larga = Grade::da_tela(2560, 1080).unwrap();
        assert_eq!((larga.x, larga.y, larga.largura), (g.x + 640, g.y, g.largura));
        assert!(Grade::da_tela(500, 1080).is_none(), "tela estreita demais");
    }

    #[test]
    fn gema_repetida_e_procurada_uma_vez() {
        let (_, _, _, procuradas) = montar(1080);
        assert_eq!(procuradas.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), [FROSTBLINK, ONSLAUGHT]);
    }

    const AS_DUAS: [&str; 2] = [FROSTBLINK, ONSLAUGHT];

    #[test]
    fn cada_casa_vira_vazia_gema_ou_outra() {
        let (grade, a, b, gemas) = montar(1080);
        let mut foto = grade_vazia(&grade);
        por_gema(&mut foto, &grade, &a, (0, 0), 0);
        por_gema(&mut foto, &grade, &b, (5, 2), 2);
        por_gema(&mut foto, &grade, &icone(3), (7, 1), 0);
        por_item(&mut foto, &grade, (11, 4));
        let mut vigia = Vigia::nova();
        vigia.olhar(&foto, &grade, &gemas, &AS_DUAS);
        assert!(vigia.celulas.iter().all(|c| c.confirmada.is_none()), "uma olhada não confirma nada");
        vigia.olhar(&foto, &grade, &gemas, &AS_DUAS);
        let em = |coluna: usize, linha: usize| vigia.celulas[linha * COLUNAS + coluna].confirmada.clone().unwrap();
        assert_eq!(em(0, 0), Conteudo::Gema(FROSTBLINK.into()));
        assert_eq!(em(5, 2), Conteudo::Gema(ONSLAUGHT.into()), "ícone 2 pontos fora do canto");
        assert_eq!(em(7, 1), Conteudo::Outra, "gema que não é da build");
        assert_eq!(em(11, 4), Conteudo::Outra);
        assert_eq!(em(3, 3), Conteudo::Vazia);

        // A gema da build que já foi marcada (fora da lista) também vira "outra".
        let mut vigia = Vigia::nova();
        vigia.olhar(&foto, &grade, &gemas, &[ONSLAUGHT]);
        vigia.olhar(&foto, &grade, &gemas, &[ONSLAUGHT]);
        assert_eq!(vigia.celulas[0].confirmada, Some(Conteudo::Outra));
    }

    #[test]
    fn marca_a_gema_que_esta_no_inventario_depois_de_duas_olhadas() {
        for altura in [720, 1080, 1440, 2160] {
            let (grade, a, b, gemas) = montar(altura);
            let mut foto = grade_vazia(&grade);
            por_gema(&mut foto, &grade, &a, (0, 0), 0);
            por_item(&mut foto, &grade, (4, 4));
            let mut vigia = Vigia::nova();
            assert!(vigia.olhar(&foto, &grade, &gemas, &AS_DUAS).is_empty(), "uma olhada só não basta ({altura})");
            assert_eq!(vigia.olhar(&foto, &grade, &gemas, &AS_DUAS), [(FROSTBLINK.into(), 1)], "a que já estava conta ({altura})");
            assert!(vigia.olhar(&foto, &grade, &gemas, &AS_DUAS).is_empty(), "já foi");

            por_gema(&mut foto, &grade, &b, (3, 1), 0);
            assert!(vigia.olhar(&foto, &grade, &gemas, &AS_DUAS).is_empty(), "{altura}");
            assert_eq!(vigia.olhar(&foto, &grade, &gemas, &AS_DUAS), [(ONSLAUGHT.into(), 1)], "{altura}");

            // Uma segunda cópia também conta, com a quantidade nova.
            por_gema(&mut foto, &grade, &a, (9, 0), 0);
            vigia.olhar(&foto, &grade, &gemas, &AS_DUAS);
            assert_eq!(vigia.olhar(&foto, &grade, &gemas, &AS_DUAS), [(FROSTBLINK.into(), 2)], "{altura}");
        }
    }

    #[test]
    fn mudar_a_gema_de_casa_nao_marca_de_novo() {
        let (grade, a, _, gemas) = montar(1080);
        let mut foto = grade_vazia(&grade);
        por_gema(&mut foto, &grade, &a, (2, 2), 0);
        let mut vigia = Vigia::nova();
        vigia.olhar(&foto, &grade, &gemas, &AS_DUAS);
        assert_eq!(vigia.olhar(&foto, &grade, &gemas, &AS_DUAS).len(), 1);
        // Pega no cursor (some por umas olhadas) e larga noutra casa.
        esvaziar(&mut foto, &grade, (2, 2));
        for _ in 0..3 {
            assert!(vigia.olhar(&foto, &grade, &gemas, &AS_DUAS).is_empty());
        }
        por_gema(&mut foto, &grade, &a, (8, 3), 0);
        for _ in 0..3 {
            assert!(vigia.olhar(&foto, &grade, &gemas, &AS_DUAS).is_empty());
        }
    }

    #[test]
    fn gema_que_aparece_numa_olhada_so_nao_marca() {
        let (grade, a, _, gemas) = montar(1080);
        let vazia = grade_vazia(&grade);
        let mut com_a_gema = grade_vazia(&grade);
        por_gema(&mut com_a_gema, &grade, &a, (6, 2), 0);
        let mut vigia = Vigia::nova();
        vigia.olhar(&vazia, &grade, &gemas, &AS_DUAS);
        // A gema no cursor passando por cima de uma casa vazia.
        assert!(vigia.olhar(&com_a_gema, &grade, &gemas, &AS_DUAS).is_empty());
        assert!(vigia.olhar(&vazia, &grade, &gemas, &AS_DUAS).is_empty());
        assert!(vigia.olhar(&vazia, &grade, &gemas, &AS_DUAS).is_empty());
    }

    #[test]
    fn com_outra_altura_as_casas_sao_vistas_de_novo_sem_marcar_de_novo() {
        let (grade, a, _, gemas) = montar(1080);
        let mut foto = grade_vazia(&grade);
        por_gema(&mut foto, &grade, &a, (1, 1), 0);
        let mut vigia = Vigia::nova();
        vigia.olhar(&foto, &grade, &gemas, &AS_DUAS);
        assert_eq!(vigia.olhar(&foto, &grade, &gemas, &AS_DUAS), [(FROSTBLINK.into(), 1)]);

        let (outra, a, _, gemas) = montar(1440);
        let mut foto = grade_vazia(&outra);
        por_gema(&mut foto, &outra, &a, (1, 1), 0);
        vigia.esquecer_casas();
        for _ in 0..3 {
            assert!(vigia.olhar(&foto, &outra, &gemas, &AS_DUAS).is_empty());
        }
        assert_eq!(vigia.celulas[COLUNAS + 1].confirmada, Some(Conteudo::Gema(FROSTBLINK.into())));
    }

    #[test]
    fn gema_que_entra_na_lista_e_conferida_de_novo() {
        let (grade, _, b, gemas) = montar(1080);
        let mut foto = grade_vazia(&grade);
        let mut vigia = Vigia::nova();
        vigia.olhar(&foto, &grade, &gemas, &[FROSTBLINK]);
        por_gema(&mut foto, &grade, &b, (4, 0), 0);
        vigia.olhar(&foto, &grade, &gemas, &[FROSTBLINK]);
        assert!(vigia.olhar(&foto, &grade, &gemas, &[FROSTBLINK]).is_empty(), "não está na lista");
        vigia.trocar_procuradas();
        vigia.olhar(&foto, &grade, &gemas, &AS_DUAS);
        assert_eq!(vigia.olhar(&foto, &grade, &gemas, &AS_DUAS), [(ONSLAUGHT.into(), 1)]);
    }

    #[test]
    fn a_gema_da_build_nao_vira_a_parecida_que_falta() {
        const PARECIDA: &str = "Metadata/Items/Gems/SkillGemParecida";
        let (grade, a, _, _) = montar(1080);
        let a2 = parecido(1);
        let gemas = procuradas([(FROSTBLINK, &a), (PARECIDA, &a2)], grade.lado);
        let so_a2 = procuradas([(PARECIDA, &a2)], grade.lado);
        let mut foto = grade_vazia(&grade);
        por_gema(&mut foto, &grade, &a, (6, 1), 0);
        let canto = grade.casa(6, 1);
        // A parecida passa do limiar na casa da original: sem a original na conta, viraria ela.
        let limiar = grade.limiar();
        assert_eq!(
            conferir(&foto, canto, &so_a2, &[PARECIDA], limiar),
            Conteudo::Gema(PARECIDA.into()),
            "o teste precisa de uma parecida"
        );
        assert_eq!(conferir(&foto, canto, &gemas, &[PARECIDA], limiar), Conteudo::Outra);

        // A original já foi marcada (saiu da lista) e continua no inventário: a parecida não é marcada.
        let mut vigia = Vigia::nova();
        for _ in 0..3 {
            assert!(vigia.olhar(&foto, &grade, &gemas, &[PARECIDA]).is_empty(), "a original não vira a parecida");
        }
        // E a parecida de verdade é marcada.
        por_gema(&mut foto, &grade, &a2, (2, 3), 0);
        vigia.olhar(&foto, &grade, &gemas, &[PARECIDA]);
        assert_eq!(vigia.olhar(&foto, &grade, &gemas, &[PARECIDA]), [(PARECIDA.into(), 1)]);
    }

    #[test]
    fn as_gemas_da_build_sao_guardadas_uma_vez_cada() {
        let icones: Vec<Icone> = (0..4).map(icone).collect();
        let mut gemas = Gemas::novas(30);
        gemas.juntar([("g0", &icones[0]), ("g1", &icones[1])]);
        gemas.juntar([("g1", &icones[1]), ("g2", &icones[2]), ("g0", &icones[0]), ("g3", &icones[3])]);
        assert_eq!(gemas.todas().iter().map(|g| g.id.as_str()).collect::<Vec<_>>(), ["g0", "g1", "g2", "g3"]);
        assert_eq!(gemas.lado(), 30);
    }

    #[test]
    fn na_visita_nova_a_gema_que_ficou_conta_de_novo_sem_conferir_a_casa() {
        let (grade, a, _, gemas) = montar(1080);
        let mut foto = grade_vazia(&grade);
        por_gema(&mut foto, &grade, &a, (2, 1), 0);
        let mut vigia = Vigia::nova();
        vigia.olhar(&foto, &grade, &gemas, &AS_DUAS);
        assert_eq!(vigia.olhar(&foto, &grade, &gemas, &AS_DUAS), [(FROSTBLINK.into(), 1)]);
        assert!(vigia.olhar(&foto, &grade, &gemas, &AS_DUAS).is_empty());
        vigia.nova_visita();
        // Já na primeira olhada, e sem conferir a casa (que não mudou): sem gema nenhuma pra
        // comparar, ela continua sendo a Frostblink.
        assert_eq!(vigia.olhar(&foto, &grade, &[], &AS_DUAS), [(FROSTBLINK.into(), 1)]);
        assert!(vigia.olhar(&foto, &grade, &gemas, &AS_DUAS).is_empty());
    }

    #[test]
    fn o_limiar_sobe_com_a_casa_pequena() {
        assert_eq!(limiar_da_casa(30.0), 0.75);
        assert_eq!(limiar_da_casa(36.0), 0.75);
        assert!((limiar_da_casa(44.0) - 0.725).abs() < 1e-6);
        assert_eq!(limiar_da_casa(52.0), 0.70);
        assert_eq!(limiar_da_casa(105.0), 0.70);
        assert!(Grade::da_tela(1280, 720).unwrap().limiar() > Grade::da_tela(1920, 1080).unwrap().limiar());
    }
}
