//! Acha a árvore de passivas do jogo numa foto da tela e lê o estado de cada nó.
//!
//! O que isto faz, e só isto: contas em cima de uma foto que alguém já tirou. Não fala com o
//! Windows, não tira foto, não lê memória de ninguém e não manda nada pra lugar nenhum.
//!
//! A interface pública abaixo é o contrato com `src-tauri/src/arvore`. As contas seguem o
//! protótipo em Python (a norma) e são conferidas contra ele pela bancada de `tests/prova.rs`.
//! Nada aqui dá pânico: foto vazia, buffer curto ou encaixe absurdo viram "não achei".

mod aneis;
mod centros;
mod imagem;
mod leitura;
mod porta;
mod registro;

/// Abre um fio a mais dentro de `e`. `None` se o sistema recusar: aí quem chamou faz o trabalho
/// no próprio fio. (O `spawn` comum daria pânico nesse caso, e pânico aqui derruba o programa.)
pub(crate) fn abrir_fio<'e, T: Send + 'e>(
    e: &'e std::thread::Scope<'e, '_>,
    f: impl FnOnce() -> T + Send + 'e,
) -> Option<std::thread::ScopedJoinHandle<'e, T>> {
    #[cfg(test)]
    if fios_recusados::recusar() {
        return None;
    }
    std::thread::Builder::new().spawn_scoped(e, f).ok()
}

/// Só pros testes: faz de conta que o sistema recusa abrir fios (vale pro fio que pediu).
#[cfg(test)]
pub(crate) mod fios_recusados {
    use std::cell::Cell;

    thread_local! {
        static LIGADO: Cell<bool> = const { Cell::new(false) };
        static RECUSAS: Cell<usize> = const { Cell::new(0) };
    }

    pub(crate) fn recusar() -> bool {
        let ligado = LIGADO.with(|l| l.get());
        if ligado {
            RECUSAS.with(|r| r.set(r.get() + 1));
        }
        ligado
    }

    /// Roda `f` com os fios recusados. Devolve o resultado e quantos fios foram recusados.
    pub(crate) fn com_recusa<T>(f: impl FnOnce() -> T) -> (T, usize) {
        LIGADO.with(|l| l.set(true));
        RECUSAS.with(|r| r.set(0));
        let saida = f();
        LIGADO.with(|l| l.set(false));
        (saida, RECUSAS.with(|r| r.get()))
    }
}

/// Tipos de nó, com os mesmos números do arquivo de dados da árvore.
pub const NORMAL: u8 = 0;
pub const NOTAVEL: u8 = 1;
pub const CHAVE: u8 = 2;
pub const JOIA: u8 = 3;
pub const MAESTRIA: u8 = 4;
pub const INICIO: u8 = 5;
pub const JOIA_GRANDE: u8 = 6;

/// A árvore principal: posições em unidades da árvore, tipos e vizinhos (posições nos vetores).
#[derive(Clone, Debug)]
pub struct Arvore {
    pub ids: Vec<u32>,
    pub xs: Vec<f32>,
    pub ys: Vec<f32>,
    pub tipos: Vec<u8>,
    pub vizinhos: Vec<Vec<u32>>,
}

impl Arvore {
    /// Monta a árvore. `ligacoes` são pares de posições, achatados. `None` se os tamanhos não
    /// baterem, se houver coordenada que não é número ou ligação fora da faixa.
    pub fn nova(ids: Vec<u32>, xs: Vec<f32>, ys: Vec<f32>, tipos: Vec<u8>, ligacoes: &[u32]) -> Option<Arvore> {
        let n = ids.len();
        if xs.len() != n || ys.len() != n || tipos.len() != n || !ligacoes.len().is_multiple_of(2) {
            return None;
        }
        if xs.iter().chain(ys.iter()).any(|v| !v.is_finite()) {
            return None;
        }
        let mut vizinhos = vec![Vec::new(); n];
        for par in ligacoes.as_chunks::<2>().0 {
            let (a, b) = (par[0] as usize, par[1] as usize);
            if a >= n || b >= n || a == b {
                return None;
            }
            vizinhos[a].push(par[1]);
            vizinhos[b].push(par[0]);
        }
        Some(Arvore { ids, xs, ys, tipos, vizinhos })
    }
}

/// Foto em BGRX (4 bytes por ponto, de cima pra baixo), como o Windows entrega.
#[derive(Clone, Copy, Debug)]
pub struct Foto<'a> {
    pub largura: usize,
    pub altura: usize,
    pub bgrx: &'a [u8],
}

/// Onde a árvore está na foto: `tela = s * arvore + (tx, ty)`, com `s = n * altura / 80000`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Encaixe {
    pub n: u32,
    pub s: f32,
    pub tx: f32,
    pub ty: f32,
}

/// O que deu pra ler de um nó.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Leitura {
    Livre,
    Alocado,
    NaoSei,
    Tapado,
    ForaDaTela,
}

/// Resultado de procurar a árvore na foto.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Registro {
    pub encaixe: Encaixe,
    pub nota: f32,
    /// Nós com a moldura achada no lugar previsto.
    pub bons: u32,
    /// Nós conferidos.
    pub total: u32,
    /// O mesmo que `bons`, com o encaixe deslocado de propósito (controle).
    pub deslocados: u32,
    /// Passou na regra de aceitação.
    pub aceito: bool,
}

/// Resultado de conferir um encaixe já conhecido.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Conferencia {
    pub bons: u32,
    pub total: u32,
}

/// Retângulo da foto que não mostra a árvore (ex.: o painel do guia), em pontos da foto.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tapume {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
}

/// Procura a árvore na foto. `so_este_zoom`: tenta só esse nível de zoom (8 a 40); `None` tenta todos.
/// Devolve a melhor hipótese (com `aceito` dizendo se passou) ou `None` se não achou nada parecido.
pub fn registrar(foto: &Foto, arvore: &Arvore, so_este_zoom: Option<u32>) -> Option<Registro> {
    registro::registrar(foto, arvore, so_este_zoom)
}

/// Confere se a árvore continua no encaixe dado (só as molduras; barato).
pub fn conferir(foto: &Foto, arvore: &Arvore, encaixe: &Encaixe, tapumes: &[Tapume]) -> Conferencia {
    let Some(tela) = imagem::Tela::de(foto) else { return Conferencia { bons: 0, total: 0 } };
    let (bons, total) =
        aneis::contar(&tela, arvore, encaixe.s as f64, encaixe.tx as f64, encaixe.ty as f64, tapumes, true);
    Conferencia { bons, total }
}

/// Lê o estado de cada nó, na mesma ordem de `arvore.ids`. `saida` é limpa e preenchida.
pub fn ler(foto: &Foto, arvore: &Arvore, encaixe: &Encaixe, tapumes: &[Tapume], saida: &mut Vec<Leitura>) {
    leitura::ler(foto, arvore, encaixe, tapumes, saida)
}

/// A foto pequena (1 ponto a cada 8) parece a tela da árvore? Necessário, não suficiente.
pub fn parece_arvore(pequena: &Foto) -> bool {
    porta::parece_arvore(pequena)
}

/// Fração (0 a 1) dos pontos que mudaram entre duas fotos pequenas. 1.0 se os tamanhos diferem.
pub fn fracao_que_mudou(a: &Foto, b: &Foto) -> f32 {
    porta::fracao_que_mudou(a, b)
}

/// O ponto (x, y) da foto cai numa parte fixa da interface da árvore (cabeçalho, cantos, rodapé)?
pub fn zona_fixa(x: f32, y: f32, largura: f32, altura: f32, folga: f32) -> bool {
    porta::zona_fixa(x as f64, y as f64, largura as f64, altura as f64, folga as f64)
}

/// Raio, em unidades da árvore, além do qual o desenho pode riscar sem atrapalhar a leitura do nó.
pub fn raio_de_fora(tipo: u8) -> f32 {
    match tipo {
        NOTAVEL | JOIA => 88.0,
        CHAVE => 122.0,
        // A maestria é lida até 96 (o efeito em volta da escolhida).
        MAESTRIA => 100.0,
        JOIA_GRANDE => 110.0,
        INICIO => 130.0,
        _ => 56.0,
    }
}
