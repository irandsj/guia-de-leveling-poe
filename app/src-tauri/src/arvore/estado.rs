//! Memória do guia da árvore: o que já se leu de cada nó, com votação no tempo.
//!
//! O que isto faz, e só isto: contas em cima das leituras que a visão entrega (alocado, livre,
//! não sei…). Não fala com o Windows, não tira foto, não lê nada do jogo e não grava em disco:
//! a memória vive enquanto o app vive e some quando a build muda.

use std::collections::HashMap;
use std::time::Duration;

use arvore_visao::{Arvore, Leitura, INICIO, MAESTRIA, NOTAVEL};

use super::GuiaRecebido;

/// Quantas leituras iguais seguidas, em fotos diferentes, até o nó trocar de estado sabido.
/// Uma leitura só pode ser reflexo, cursor por cima ou a animação de alocar.
pub const LEITURAS_PRA_SABER: u8 = 2;

/// O que se sabe de um nó.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Sabido {
    /// Nunca foi lido com certeza nesta build.
    Nunca,
    Livre,
    Alocado,
}

/// Os votos de um nó: o que se sabe, o que as últimas leituras disseram e quantas vezes seguidas.
#[derive(Clone, Copy, Debug)]
struct Voto {
    sabido: Sabido,
    /// Última leitura que contou (`true` = alocado).
    candidato: bool,
    seguidas: u8,
}

const SEM_VOTO: Voto = Voto { sabido: Sabido::Nunca, candidato: false, seguidas: 0 };

/// A memória por nó, na mesma ordem dos vetores da árvore.
#[derive(Debug)]
pub struct Memoria {
    build: String,
    votos: Vec<Voto>,
    /// Quantas fotos já foram anotadas nesta build (para de contar no teto do número).
    fotos: u8,
}

impl Memoria {
    pub fn nova() -> Memoria {
        Memoria { build: String::new(), votos: Vec::new(), fotos: 0 }
    }

    /// Acerta a memória pra esta build e esta árvore. Zera tudo se a build mudou ou se a árvore
    /// tem outro tamanho (as posições deixariam de valer).
    pub fn preparar(&mut self, build: &str, quantos_nos: usize) {
        if self.build != build || self.votos.len() != quantos_nos {
            self.build = build.to_string();
            self.votos.clear();
            self.votos.resize(quantos_nos, SEM_VOTO);
            self.fotos = 0;
        }
    }

    /// A árvore já foi lida nesta build? Só vale depois de `LEITURAS_PRA_SABER` fotos: antes
    /// disso nenhum nó pode ter trocado de estado, e a memória vazia diria "nada feito".
    pub fn vista(&self) -> bool {
        self.fotos >= LEITURAS_PRA_SABER
    }

    /// O que se sabe do nó na posição `posicao` da árvore.
    pub fn sabido(&self, posicao: usize) -> Sabido {
        self.votos.get(posicao).map_or(Sabido::Nunca, |voto| voto.sabido)
    }

    /// Algum nó tem uma leitura nova que ainda não virou sabido: a última foto disse outra coisa
    /// e falta a próxima pra confirmar (o ponto que acabou de ser pego, a árvore vista pela
    /// primeira vez). Vale olhar de novo logo, pra a mudança não esperar a volta inteira.
    pub fn em_duvida(&self) -> bool {
        self.votos.iter().any(|voto| {
            let lido = if voto.candidato { Sabido::Alocado } else { Sabido::Livre };
            voto.seguidas > 0 && voto.seguidas < LEITURAS_PRA_SABER && lido != voto.sabido
        })
    }

    /// Junta as leituras de UMA foto (na ordem de `arvore.ids`). `inicio` é a posição do início
    /// da classe. Devolve se algum nó trocou de estado sabido.
    ///
    /// `Alocado` só conta se o nó encosta no início ou num vizinho lido agora, ou já sabido, como
    /// alocado (a maestria: num notável). Brilho solto no meio da árvore não é ponto gasto.
    pub fn anotar(&mut self, arvore: &Arvore, inicio: Option<usize>, leituras: &[Leitura]) -> bool {
        self.fotos = self.fotos.saturating_add(1);
        let mut mudou = false;
        for (posicao, leitura) in leituras.iter().enumerate().take(self.votos.len()) {
            let alocado = match leitura {
                Leitura::Livre => false,
                Leitura::Alocado => {
                    if !self.encosta_em_alocado(arvore, inicio, leituras, posicao) {
                        continue;
                    }
                    true
                }
                Leitura::NaoSei | Leitura::Tapado | Leitura::ForaDaTela => continue,
            };
            let Some(voto) = self.votos.get_mut(posicao) else { continue };
            if voto.seguidas > 0 && voto.candidato == alocado {
                voto.seguidas = voto.seguidas.saturating_add(1);
            } else {
                voto.candidato = alocado;
                voto.seguidas = 1;
            }
            let novo = if alocado { Sabido::Alocado } else { Sabido::Livre };
            if voto.seguidas >= LEITURAS_PRA_SABER && voto.sabido != novo {
                voto.sabido = novo;
                mudou = true;
            }
        }
        mudou
    }

    /// O nó tem por onde estar alocado: é vizinho do início ou de alguém alocado?
    fn encosta_em_alocado(&self, arvore: &Arvore, inicio: Option<usize>, leituras: &[Leitura], posicao: usize) -> bool {
        let Some(vizinhos) = arvore.vizinhos.get(posicao) else { return false };
        let maestria = arvore.tipos.get(posicao) == Some(&MAESTRIA);
        vizinhos.iter().any(|&vizinho| {
            let vizinho = vizinho as usize;
            let tipo = arvore.tipos.get(vizinho).copied().unwrap_or(INICIO);
            if maestria {
                if tipo != NOTAVEL {
                    return false;
                }
            } else {
                if Some(vizinho) == inicio {
                    return true;
                }
                // Ninguém chega a um nó passando por uma maestria nem por outro início.
                if tipo == MAESTRIA || tipo == INICIO {
                    return false;
                }
            }
            leituras.get(vizinho) == Some(&Leitura::Alocado) || self.sabido(vizinho) == Sabido::Alocado
        })
    }
}

/// O guia casado com a árvore: cada passo com a posição do nó nos vetores da árvore.
#[derive(Clone, Debug, PartialEq)]
pub struct Roteiro {
    /// Posição na árvore de cada passo (`None`: o id não existe nesta versão da árvore).
    pub passos: Vec<Option<u32>>,
    pub soltos: Vec<bool>,
    /// De qual passo se chega em cada um (-1 = início da classe). O pai vem sempre antes do filho.
    pub pais: Vec<i32>,
    /// Os passos `0..ate_alvo` fecham a etapa alvo.
    pub ate_alvo: usize,
    pub numerados: usize,
    /// Posição na árvore do início da classe.
    pub inicio: Option<u32>,
    /// Nós que a build não quer mais: (id, posição na árvore).
    pub devolver: Vec<(u32, u32)>,
}

impl Roteiro {
    pub fn novo(arvore: &Arvore, guia: &GuiaRecebido) -> Roteiro {
        let posicoes: HashMap<u32, u32> =
            arvore.ids.iter().enumerate().map(|(posicao, &id)| (id, posicao as u32)).collect();
        let ordem = &guia.ordem;
        Roteiro {
            passos: ordem.iter().map(|passo| posicoes.get(&passo.no).copied()).collect(),
            soltos: ordem.iter().map(|passo| passo.solto).collect(),
            pais: ordem.iter().map(|passo| passo.pai).collect(),
            ate_alvo: (guia.ate_alvo as usize).min(ordem.len()),
            numerados: guia.numerados as usize,
            inicio: posicoes.get(&guia.inicio).copied(),
            devolver: guia.devolver.iter().filter_map(|id| Some((*id, *posicoes.get(id)?))).collect(),
        }
    }
}

/// O que o guia conclui da memória: o que está feito e o que vem agora.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Resumo {
    /// Um por passo do guia.
    pub feito: Vec<bool>,
    /// Passos feitos no trecho do alvo.
    pub feitos: u32,
    /// Tamanho do trecho do alvo.
    pub total: u32,
    /// Posições em `ordem` dos próximos (o primeiro é o número 1).
    pub proximos: Vec<u32>,
    /// Ids alocados que a build não quer mais.
    pub devolver: Vec<u32>,
}

/// Tira o resumo da memória.
///
/// Passo feito = sabido alocado; ou nunca sabido e algum passo que sai DELE (filho, neto… pela
/// cadeia de `pai`) é sabido alocado: ninguém chega no filho sem passar pelo pai. Um alocado em
/// outro ramo, ou mais adiante na lista sem ligação, não prova nada. Sabido livre nunca é feito.
/// Passo solto (sem caminho até o início) não serve de prova pra ninguém e nunca leva número.
/// Os próximos saem só do trecho do alvo: acabou o trecho, a etapa está completa.
pub fn resumir(memoria: &Memoria, roteiro: &Roteiro) -> Resumo {
    let quantos = roteiro.passos.len();
    let sabido_do_passo = |passo: usize| -> Sabido {
        match roteiro.passos.get(passo) {
            Some(Some(posicao)) => memoria.sabido(*posicao as usize),
            _ => Sabido::Nunca,
        }
    };
    let solto = |passo: usize| roteiro.soltos.get(passo).copied().unwrap_or(false);

    let mut feito = vec![false; quantos];
    // `prova[passo]`: algum passo que sai dele pela cadeia de `pai` é sabido alocado. De trás pra
    // frente, quando se chega num passo todos os filhos dele já passaram.
    let mut prova = vec![false; quantos];
    for passo in (0..quantos).rev() {
        let sabido = sabido_do_passo(passo);
        let alocado = sabido == Sabido::Alocado;
        let por_filho = prova.get(passo).copied().unwrap_or(false);
        if let Some(marca) = feito.get_mut(passo) {
            *marca = alocado || (sabido == Sabido::Nunca && por_filho && !solto(passo));
        }
        if (alocado || por_filho) && !solto(passo) {
            // Pai que não vem antes do filho não é pai (a ponte já corta isso; aqui é só cuidado).
            let pai = roteiro.pais.get(passo).and_then(|pai| usize::try_from(*pai).ok()).filter(|pai| *pai < passo);
            if let Some(marca) = pai.and_then(|pai| prova.get_mut(pai)) {
                *marca = true;
            }
        }
    }

    let ate_alvo = roteiro.ate_alvo.min(quantos);
    let feitos = feito.iter().take(ate_alvo).filter(|marca| **marca).count() as u32;
    let proximos: Vec<u32> = (0..ate_alvo)
        .filter(|&passo| {
            let tem_lugar = matches!(roteiro.passos.get(passo), Some(Some(_)));
            tem_lugar && !solto(passo) && feito.get(passo) == Some(&false)
        })
        .take(roteiro.numerados)
        .map(|passo| passo as u32)
        .collect();
    let devolver: Vec<u32> = roteiro
        .devolver
        .iter()
        .filter(|(_, posicao)| memoria.sabido(*posicao as usize) == Sabido::Alocado)
        .map(|(id, _)| *id)
        .collect();
    Resumo { feito, feitos, total: ate_alvo as u32, proximos, devolver }
}

/// Balde de fichas: limita quantas procuras caras (a árvore em todos os zooms) cabem num tempo.
#[derive(Clone, Copy, Debug)]
pub struct Balde {
    fichas: u32,
    capacidade: u32,
    /// De quanto em quanto tempo volta uma ficha.
    reposicao: Duration,
    /// Tempo já contado pra próxima ficha.
    juntado: Duration,
}

impl Balde {
    /// Começa cheio.
    pub fn novo(capacidade: u32, reposicao: Duration) -> Balde {
        Balde { fichas: capacidade, capacidade, reposicao, juntado: Duration::ZERO }
    }

    /// Conta o tempo que passou desde a última chamada.
    pub fn passar(&mut self, decorrido: Duration) {
        if self.fichas >= self.capacidade || self.reposicao.is_zero() {
            self.juntado = Duration::ZERO;
            return;
        }
        self.juntado = self.juntado.saturating_add(decorrido);
        while self.juntado >= self.reposicao && self.fichas < self.capacidade {
            self.juntado = self.juntado.saturating_sub(self.reposicao);
            self.fichas += 1;
        }
        if self.fichas >= self.capacidade {
            self.juntado = Duration::ZERO;
        }
    }

    pub fn tem(&self) -> bool {
        self.fichas > 0
    }

    /// Gasta uma ficha. `false` se não havia.
    pub fn gastar(&mut self) -> bool {
        if self.fichas == 0 {
            return false;
        }
        self.fichas -= 1;
        true
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::arvore::PassoRecebido;
    use arvore_visao::NORMAL;
    use Leitura::{Alocado, ForaDaTela, Livre, NaoSei, Tapado};

    /// Uma fila: início(0) - a(1) - b(2) - notável(3) - c(4), com a maestria(5) pendurada no notável
    /// e um nó solto(6) ligado só ao c.
    fn arvore() -> Arvore {
        Arvore::nova(
            vec![100, 101, 102, 103, 104, 105, 106],
            vec![0.0; 7],
            vec![0.0; 7],
            vec![INICIO, NORMAL, NORMAL, NOTAVEL, NORMAL, MAESTRIA, NORMAL],
            &[0, 1, 1, 2, 2, 3, 3, 4, 3, 5, 4, 6],
        )
        .unwrap()
    }

    fn guia(nos: &[u32], ate_alvo: u32) -> GuiaRecebido {
        GuiaRecebido {
            build: "b1".into(),
            inicio: 100,
            ordem: nos
                .iter()
                .enumerate()
                .map(|(i, &no)| PassoRecebido { no, pai: i as i32 - 1, nome: format!("n{no}"), rotulo: None, solto: false })
                .collect(),
            ate_alvo,
            manter: Vec::new(),
            devolver: Vec::new(),
            texto: String::new(),
            numerados: 2,
        }
    }

    fn memoria() -> Memoria {
        let mut memoria = Memoria::nova();
        memoria.preparar("b1", 7);
        memoria
    }

    #[test]
    fn so_troca_depois_de_duas_leituras_iguais_seguidas() {
        let arvore = arvore();
        let mut m = memoria();
        assert!(!m.vista());
        let foto = [NaoSei, Alocado, Livre, NaoSei, NaoSei, NaoSei, NaoSei];
        assert!(!m.anotar(&arvore, Some(0), &foto), "uma leitura só não basta");
        assert!(!m.vista(), "com uma foto só nenhum nó é sabido: ainda não vale como vista");
        assert_eq!(m.sabido(1), Sabido::Nunca);
        assert!(m.anotar(&arvore, Some(0), &foto));
        assert!(m.vista());
        assert_eq!(m.sabido(1), Sabido::Alocado);
        assert_eq!(m.sabido(2), Sabido::Livre);
        assert!(!m.anotar(&arvore, Some(0), &foto), "repetir o que já se sabe não é mudança");
    }

    #[test]
    fn fica_em_duvida_so_entre_a_leitura_nova_e_a_que_confirma() {
        let arvore = arvore();
        let mut m = memoria();
        assert!(!m.em_duvida(), "memória vazia não espera nada");
        let foto = [NaoSei, Alocado, Livre, NaoSei, NaoSei, NaoSei, NaoSei];
        m.anotar(&arvore, Some(0), &foto);
        assert!(m.em_duvida(), "a primeira foto lida espera a segunda");
        m.anotar(&arvore, Some(0), &foto);
        assert!(!m.em_duvida());
        m.anotar(&arvore, Some(0), &foto);
        assert!(!m.em_duvida(), "o que já se sabe, lido de novo, não é dúvida");
        // O nó 2 foi pego: uma foto diz alocado, e a dúvida dura até a seguinte confirmar.
        let pegou = [NaoSei, Alocado, Alocado, NaoSei, NaoSei, NaoSei, NaoSei];
        m.anotar(&arvore, Some(0), &pegou);
        assert!(m.em_duvida());
        // Foto sem leitura do nó no meio (cursor por cima) não desfaz a dúvida.
        m.anotar(&arvore, Some(0), &[NaoSei; 7]);
        assert!(m.em_duvida());
        m.anotar(&arvore, Some(0), &pegou);
        assert!(!m.em_duvida());
        assert_eq!(m.sabido(2), Sabido::Alocado);
        // Um reflexo que volta atrás na foto seguinte também encerra a dúvida.
        m.anotar(&arvore, Some(0), &foto);
        assert!(m.em_duvida());
        m.anotar(&arvore, Some(0), &pegou);
        assert!(!m.em_duvida());
        assert_eq!(m.sabido(2), Sabido::Alocado);
    }

    #[test]
    fn leitura_trocada_recomeca_a_contagem_e_duvida_nao_mexe() {
        let arvore = arvore();
        let mut m = memoria();
        let aloc = [NaoSei, Alocado, NaoSei, NaoSei, NaoSei, NaoSei, NaoSei];
        let livre = [NaoSei, Livre, NaoSei, NaoSei, NaoSei, NaoSei, NaoSei];
        m.anotar(&arvore, Some(0), &aloc);
        m.anotar(&arvore, Some(0), &livre);
        m.anotar(&arvore, Some(0), &aloc);
        assert_eq!(m.sabido(1), Sabido::Nunca, "alocado, livre, alocado: nunca duas seguidas");
        // Dúvida, tapume e fora da tela no meio não zeram a contagem.
        for duvida in [NaoSei, Tapado, ForaDaTela] {
            m.anotar(&arvore, Some(0), &[NaoSei, duvida, NaoSei, NaoSei, NaoSei, NaoSei, NaoSei]);
        }
        m.anotar(&arvore, Some(0), &aloc);
        assert_eq!(m.sabido(1), Sabido::Alocado);
        // Pra voltar a livre também são duas.
        m.anotar(&arvore, Some(0), &livre);
        assert_eq!(m.sabido(1), Sabido::Alocado);
        m.anotar(&arvore, Some(0), &livre);
        assert_eq!(m.sabido(1), Sabido::Livre);
    }

    #[test]
    fn alocado_solto_nao_conta() {
        let arvore = arvore();
        let mut m = memoria();
        // O nó 4 brilha sozinho, longe do início e sem vizinho alocado: ignorado.
        let solto = [NaoSei, Livre, Livre, Livre, Alocado, NaoSei, NaoSei];
        m.anotar(&arvore, Some(0), &solto);
        m.anotar(&arvore, Some(0), &solto);
        assert_eq!(m.sabido(4), Sabido::Nunca);
        // Com o vizinho lido alocado na mesma foto, conta (a cadeia inteira até o início).
        let ligado = [NaoSei, Alocado, Alocado, Alocado, Alocado, NaoSei, NaoSei];
        m.anotar(&arvore, Some(0), &ligado);
        m.anotar(&arvore, Some(0), &ligado);
        assert_eq!(m.sabido(4), Sabido::Alocado);
        // Depois, com os vizinhos fora da tela, o que já se sabe deles ainda sustenta o nó 6.
        let de_perto = [ForaDaTela, ForaDaTela, ForaDaTela, ForaDaTela, ForaDaTela, NaoSei, Alocado];
        m.anotar(&arvore, Some(0), &de_perto);
        m.anotar(&arvore, Some(0), &de_perto);
        assert_eq!(m.sabido(6), Sabido::Alocado);
    }

    #[test]
    fn vizinho_do_inicio_conta_sozinho_e_sem_inicio_nao() {
        let arvore = arvore();
        let so_o_primeiro = [NaoSei, Alocado, NaoSei, NaoSei, NaoSei, NaoSei, NaoSei];
        let mut sem_inicio = memoria();
        sem_inicio.anotar(&arvore, None, &so_o_primeiro);
        sem_inicio.anotar(&arvore, None, &so_o_primeiro);
        assert_eq!(sem_inicio.sabido(1), Sabido::Nunca);
        let mut com_inicio = memoria();
        com_inicio.anotar(&arvore, Some(0), &so_o_primeiro);
        com_inicio.anotar(&arvore, Some(0), &so_o_primeiro);
        assert_eq!(com_inicio.sabido(1), Sabido::Alocado);
    }

    #[test]
    fn maestria_so_conta_com_o_notavel_alocado() {
        let arvore = arvore();
        let mut m = memoria();
        let sem_notavel = [NaoSei, NaoSei, NaoSei, Livre, NaoSei, Alocado, NaoSei];
        m.anotar(&arvore, Some(0), &sem_notavel);
        m.anotar(&arvore, Some(0), &sem_notavel);
        assert_eq!(m.sabido(5), Sabido::Nunca);
        let com_notavel = [NaoSei, Alocado, Alocado, Alocado, NaoSei, Alocado, NaoSei];
        m.anotar(&arvore, Some(0), &com_notavel);
        m.anotar(&arvore, Some(0), &com_notavel);
        assert_eq!(m.sabido(5), Sabido::Alocado);
        // E a maestria não serve de caminho pra ninguém: o notável sozinho ao lado dela não conta.
        let mut outra = memoria();
        let so_maestria = [NaoSei, NaoSei, Livre, Alocado, Livre, Alocado, NaoSei];
        outra.anotar(&arvore, Some(0), &so_maestria);
        outra.anotar(&arvore, Some(0), &so_maestria);
        assert_eq!(outra.sabido(3), Sabido::Nunca);
    }

    #[test]
    fn leituras_de_tamanho_errado_nao_quebram() {
        let arvore = arvore();
        let mut m = memoria();
        m.anotar(&arvore, Some(0), &[Alocado; 40]);
        m.anotar(&arvore, Some(99), &[Alocado; 2]);
        m.anotar(&arvore, Some(0), &[]);
        let mut vazia = Memoria::nova();
        assert!(!vazia.anotar(&arvore, Some(0), &[Alocado; 7]));
        assert_eq!(vazia.sabido(3), Sabido::Nunca);
    }

    #[test]
    fn a_memoria_zera_quando_a_build_muda() {
        let arvore = arvore();
        let mut m = memoria();
        let foto = [NaoSei, Alocado, NaoSei, NaoSei, NaoSei, NaoSei, NaoSei];
        m.anotar(&arvore, Some(0), &foto);
        m.anotar(&arvore, Some(0), &foto);
        m.preparar("b1", 7);
        assert_eq!(m.sabido(1), Sabido::Alocado, "mesma build: fica");
        m.preparar("b2", 7);
        assert_eq!(m.sabido(1), Sabido::Nunca);
        assert!(!m.vista());
    }

    /// Põe na memória, de uma vez, o que se sabe de cada nó.
    fn saber(m: &mut Memoria, arvore: &Arvore, leituras: [Leitura; 7]) {
        m.anotar(arvore, Some(0), &leituras);
        m.anotar(arvore, Some(0), &leituras);
    }

    #[test]
    fn roteiro_casa_os_ids_com_a_arvore() {
        let arvore = arvore();
        let mut g = guia(&[101, 102, 999, 103], 9);
        g.devolver = vec![106, 12345];
        g.ordem[3].solto = true;
        let roteiro = Roteiro::novo(&arvore, &g);
        assert_eq!(roteiro.passos, vec![Some(1), Some(2), None, Some(3)]);
        assert_eq!(roteiro.soltos, vec![false, false, false, true]);
        assert_eq!(roteiro.pais, vec![-1, 0, 1, 2]);
        assert_eq!(roteiro.ate_alvo, 4, "ate_alvo não passa do tamanho da ordem");
        assert_eq!(roteiro.inicio, Some(0));
        assert_eq!(roteiro.devolver, vec![(106, 6)]);
    }

    #[test]
    fn feito_e_proximos_seguem_a_ordem() {
        let arvore = arvore();
        let roteiro = Roteiro::novo(&arvore, &guia(&[101, 102, 103, 105, 104, 106], 5));
        let mut m = memoria();
        // Nada lido ainda: nada feito, os dois primeiros são os próximos.
        let vazio = resumir(&m, &roteiro);
        assert_eq!((vazio.feitos, vazio.total), (0, 5));
        assert_eq!(vazio.proximos, vec![0, 1]);

        saber(&mut m, &arvore, [NaoSei, Alocado, Alocado, Livre, NaoSei, NaoSei, NaoSei]);
        let resumo = resumir(&m, &roteiro);
        assert_eq!(resumo.feito, vec![true, true, false, false, false, false]);
        assert_eq!(resumo.feitos, 2);
        assert_eq!(resumo.proximos, vec![2, 3]);
    }

    #[test]
    fn nunca_lido_antes_de_um_alocado_conta_como_feito_e_livre_nunca() {
        let arvore = arvore();
        let roteiro = Roteiro::novo(&arvore, &guia(&[101, 102, 103, 105, 104, 106], 5));
        // Só se vê o fim da fila: 103 e 104 alocados, 102 sabido livre (pulado), 101 fora da tela.
        let mut outra = memoria();
        saber(&mut outra, &arvore, [NaoSei, Alocado, Alocado, Alocado, Alocado, NaoSei, NaoSei]);
        outra.votos[1] = SEM_VOTO; // como se o 101 nunca tivesse aparecido na tela
        outra.votos[2].sabido = Sabido::Livre;
        let resumo = resumir(&outra, &roteiro);
        // 101: nunca lido, mas há alocado depois → feito. 102: sabido livre → não feito.
        // 105 (maestria): nunca lida, 104 alocado depois → feita. 106: fora do trecho do alvo.
        assert_eq!(resumo.feito, vec![true, false, true, true, true, false]);
        assert_eq!(resumo.feitos, 4);
        assert_eq!(resumo.proximos, vec![1]);
    }

    #[test]
    fn alocado_em_outro_ramo_ou_mais_adiante_nao_prova_quem_nunca_foi_lido() {
        let arvore = arvore();
        // 101 → 102 → 103; do 103 saem dois ramos: a maestria 105 e o 104 → 106 (este, de depois do alvo).
        let mut g = guia(&[101, 102, 103, 105, 104, 106], 5);
        g.ordem[4].pai = 2;
        g.ordem[5].pai = 4;
        let roteiro = Roteiro::novo(&arvore, &g);
        // Lido: só o 106, alocado. O resto nunca apareceu (debaixo do painel, fora da tela…).
        let mut m = memoria();
        saber(&mut m, &arvore, [NaoSei, Alocado, Alocado, Alocado, Alocado, NaoSei, Alocado]);
        for posicao in 1..=4 {
            m.votos[posicao] = SEM_VOTO;
        }
        let resumo = resumir(&m, &roteiro);
        // A cadeia 106 ← 104 ← 103 ← 102 ← 101 está provada. A maestria 105, que vem antes do 106 na
        // lista mas é de outro ramo, não: continua por fazer e é o próximo.
        assert_eq!(resumo.feito, vec![true, true, true, false, true, true]);
        assert_eq!((resumo.feitos, resumo.total), (4, 5));
        assert_eq!(resumo.proximos, vec![3]);

        // Um passo de depois do alvo sem ligação com o trecho (pai = início) não prova nada.
        let mut sem_ligacao = guia(&[101, 102, 106], 2);
        sem_ligacao.ordem[2].pai = -1;
        let resumo = resumir(&m, &Roteiro::novo(&arvore, &sem_ligacao));
        assert_eq!(resumo.feito, vec![false, false, true]);
        assert_eq!(resumo.feitos, 0, "a etapa não sai completa com ponto faltando");
        assert_eq!(resumo.proximos, vec![0, 1]);

        // Pai torto (ele mesmo, ou um passo de depois) não vira prova nem estoura.
        let mut torto = Roteiro::novo(&arvore, &sem_ligacao);
        torto.pais = vec![0, 2, 7];
        assert_eq!(resumir(&m, &torto).feito, vec![false, false, true]);
        torto.pais.clear();
        assert_eq!(resumir(&m, &torto).feito, vec![false, false, true]);
    }

    #[test]
    fn solto_nao_leva_numero_nem_prova_os_anteriores() {
        let arvore = arvore();
        let mut g = guia(&[101, 102, 103, 106], 4);
        g.ordem[3].solto = true;
        let roteiro = Roteiro::novo(&arvore, &g);
        let mut m = memoria();
        saber(&mut m, &arvore, [NaoSei, Alocado, Alocado, Alocado, Alocado, NaoSei, Alocado]);
        m.votos[1] = SEM_VOTO;
        m.votos[2] = SEM_VOTO;
        m.votos[3] = SEM_VOTO;
        let resumo = resumir(&m, &roteiro);
        assert_eq!(resumo.feito, vec![false, false, false, true], "o solto alocado não puxa os outros");
        assert_eq!(resumo.proximos, vec![0, 1]);

        let mut sem_nada = memoria();
        sem_nada.fotos = LEITURAS_PRA_SABER;
        let mut so_solto = guia(&[106], 1);
        so_solto.ordem[0].solto = true;
        let resumo = resumir(&sem_nada, &Roteiro::novo(&arvore, &so_solto));
        assert!(resumo.proximos.is_empty(), "solto nunca é numerado");
        assert_eq!((resumo.feitos, resumo.total), (0, 1));
    }

    #[test]
    fn proximos_param_no_fim_do_trecho_do_alvo_e_pulam_id_desconhecido() {
        let arvore = arvore();
        let mut g = guia(&[101, 999, 102, 103, 104], 3);
        g.numerados = 8;
        let roteiro = Roteiro::novo(&arvore, &g);
        let resumo = resumir(&memoria(), &roteiro);
        assert_eq!(resumo.proximos, vec![0, 2], "999 não existe na árvore; 103 e 104 são de depois do alvo");
        assert_eq!(resumo.total, 3);
    }

    #[test]
    fn devolver_so_lista_o_que_esta_alocado() {
        let arvore = arvore();
        let mut g = guia(&[101, 102], 2);
        g.devolver = vec![103, 104, 777];
        let roteiro = Roteiro::novo(&arvore, &g);
        let mut m = memoria();
        saber(&mut m, &arvore, [NaoSei, Alocado, Alocado, Alocado, Livre, NaoSei, NaoSei]);
        let resumo = resumir(&m, &roteiro);
        assert_eq!(resumo.devolver, vec![103]);
        assert_eq!(resumo.feitos, 2);
        assert!(resumo.proximos.is_empty());
    }

    #[test]
    fn balde_gasta_e_repoe_com_o_tempo() {
        let mut balde = Balde::novo(3, Duration::from_secs(6));
        assert!(balde.gastar() && balde.gastar() && balde.gastar());
        assert!(!balde.tem());
        assert!(!balde.gastar());
        balde.passar(Duration::from_secs(5));
        assert!(!balde.tem());
        balde.passar(Duration::from_secs(1));
        assert!(balde.tem());
        assert!(balde.gastar());
        // Muito tempo parado enche, mas não passa da capacidade.
        balde.passar(Duration::from_secs(3600));
        assert!(balde.gastar() && balde.gastar() && balde.gastar());
        assert!(!balde.gastar());
        // Cheio não junta tempo: a próxima ficha leva os 6 s inteiros.
        let mut cheio = Balde::novo(1, Duration::from_secs(6));
        cheio.passar(Duration::from_secs(5));
        assert!(cheio.gastar());
        cheio.passar(Duration::from_secs(2));
        assert!(!cheio.tem());
    }
}
