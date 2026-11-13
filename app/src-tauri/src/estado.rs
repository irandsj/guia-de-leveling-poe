//! Estado do app, compartilhado entre a janela, as teclas e a thread que vigia o jogo.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, AtomicU8, Ordering};
use std::sync::Mutex;

use leitor_log::Resumo;
use serde::Serialize;

use crate::atalhos::Tabela;
use crate::config::{Config, Geometria};

/// Onde o jogador deixou o balão. As formas mudam o tamanho da janela (e o programa pode puxar
/// ela pra dentro da tela), mas ela sempre volta pra cá.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Lugar {
    /// Canto de cima à esquerda e tamanho da janela quando o jogador largou ela ali.
    pub escolhido: Option<Geometria>,
    /// Onde o programa pôs a janela por último. Achar ela em outro canto = o jogador arrastou.
    pub posta: Option<(i32, i32)>,
}

pub struct Estado {
    /// Pasta onde ficam config.json, plano.json, progresso.json e preferencias.json.
    pub pasta_dados: PathBuf,
    pub config: Mutex<Config>,
    pub tabela: Mutex<Tabela>,
    /// Modo de edição: a janela aceita clique e teclado.
    pub edicao: AtomicBool,
    /// Alt apertado agora: a janela aceita clique sem entrar na edição.
    pub alt_segurado: AtomicBool,
    /// Forma do balão fora da edição (`Forma` como número). Na edição é sempre o detalhado.
    pub forma: AtomicU8,
    /// Altura do conteúdo do balão resumido ou expandido, em pixels lógicos (a interface mede).
    pub altura_medida: AtomicU32,
    /// Altura da janela da bolinha, em pixels lógicos (0 = só a bolinha). Com o baú aberto, os
    /// botões de busca ficam embaixo dela e a janela cresce pra baixo.
    pub altura_da_bolinha: AtomicU32,
    /// A janela está agora no tamanho do balão detalhado (o que vai pro config.json)?
    pub tamanho_detalhado_na_tela: AtomicBool,
    /// Onde o jogador deixou o balão (ver `janela::aplicar_forma`).
    pub lugar: Mutex<Lugar>,
    /// O usuário pediu pra esconder (tecla ou bandeja).
    pub escondido: AtomicBool,
    pub jogo_aberto: AtomicBool,
    pub jogo_em_foco: AtomicBool,
    pub overlay_em_foco: AtomicBool,
    /// As teclas de passo/layout estão registradas agora?
    pub teclas_de_jogo_ligadas: AtomicBool,
    /// As setas do teclado (trocar a etapa da árvore) estão registradas agora?
    pub setas_ligadas: AtomicBool,
    /// Última janela do jogo vista.
    pub janela_do_jogo: AtomicIsize,
    /// Janela que estava na frente quando a edição começou (pra devolver o teclado).
    pub janela_antes_da_edicao: AtomicIsize,
    /// A edição foi aberta no centro da tela (boas-vindas, sem build): ao sair, a janela volta pro
    /// lugar escolhido pelo jogador.
    pub no_centro: AtomicBool,
    pub log: Mutex<StatusLog>,
    /// Pedido pra procurar o Client.txt de novo (a configuração mudou).
    pub relocalizar: AtomicBool,
    /// Teclas que o Windows recusou (já usadas por outro programa).
    pub avisos_de_teclas: Mutex<AvisosDeTeclas>,
    /// Avisos que saem das opções do jogo: tela cheia exclusiva, jogo em outro idioma.
    pub avisos_do_jogo: Mutex<Vec<String>>,
}

/// As quatro formas do balão: tudo com fotos e soquetes (expandido), tudo, só o essencial, ou
/// só uma bolinha pra abrir de novo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Forma {
    Detalhado = 0,
    Resumido = 1,
    Bolinha = 2,
    Expandido = 3,
}

impl Forma {
    pub fn do_nome(nome: &str) -> Option<Forma> {
        match nome {
            "detalhado" => Some(Forma::Detalhado),
            "resumido" => Some(Forma::Resumido),
            "bolinha" => Some(Forma::Bolinha),
            "expandido" => Some(Forma::Expandido),
            _ => None,
        }
    }

    pub fn do_numero(numero: u8) -> Forma {
        match numero {
            1 => Forma::Resumido,
            2 => Forma::Bolinha,
            3 => Forma::Expandido,
            _ => Forma::Detalhado,
        }
    }
}

#[derive(Debug, Default)]
pub struct AvisosDeTeclas {
    pub fixas: Vec<String>,
    pub de_jogo: Vec<String>,
}

impl Estado {
    pub fn novo(pasta_dados: PathBuf, config: Config, tabela: Tabela) -> Estado {
        Estado {
            pasta_dados,
            config: Mutex::new(config),
            tabela: Mutex::new(tabela),
            edicao: AtomicBool::new(false),
            alt_segurado: AtomicBool::new(false),
            forma: AtomicU8::new(Forma::Detalhado as u8),
            altura_medida: AtomicU32::new(0),
            altura_da_bolinha: AtomicU32::new(0),
            tamanho_detalhado_na_tela: AtomicBool::new(true),
            lugar: Mutex::new(Lugar::default()),
            escondido: AtomicBool::new(false),
            jogo_aberto: AtomicBool::new(false),
            jogo_em_foco: AtomicBool::new(false),
            overlay_em_foco: AtomicBool::new(false),
            teclas_de_jogo_ligadas: AtomicBool::new(false),
            setas_ligadas: AtomicBool::new(false),
            janela_do_jogo: AtomicIsize::new(0),
            janela_antes_da_edicao: AtomicIsize::new(0),
            no_centro: AtomicBool::new(false),
            log: Mutex::new(StatusLog::default()),
            relocalizar: AtomicBool::new(false),
            avisos_de_teclas: Mutex::new(AvisosDeTeclas::default()),
            avisos_do_jogo: Mutex::new(Vec::new()),
        }
    }

    /// O overlay deve aparecer agora?
    pub fn visivel(&self) -> bool {
        if self.edicao.load(Ordering::SeqCst) {
            return true;
        }
        if self.escondido.load(Ordering::SeqCst) {
            return false;
        }
        if !self.config.lock().unwrap().esconder_fora_do_jogo {
            return true;
        }
        // Com o jogo fechado, aparece (pra dar pra ver que o app abriu).
        // Com o jogo aberto, só aparece quando o jogo ou o overlay está na frente.
        !self.jogo_aberto.load(Ordering::SeqCst)
            || self.jogo_em_foco.load(Ordering::SeqCst)
            || self.overlay_em_foco.load(Ordering::SeqCst)
    }

    pub fn retrato(&self) -> EstadoJanela {
        // Os avisos das opções do jogo vão junto com os das teclas: a interface mostra todos iguais.
        let avisos_de_teclas = {
            let do_jogo = self.avisos_do_jogo.lock().unwrap().clone();
            let avisos = self.avisos_de_teclas.lock().unwrap();
            do_jogo.into_iter().chain(avisos.fixas.iter().chain(&avisos.de_jogo).cloned()).collect()
        };
        EstadoJanela {
            edicao: self.edicao.load(Ordering::SeqCst),
            alt_segurado: self.alt_segurado.load(Ordering::SeqCst),
            visivel: self.visivel(),
            escondido: self.escondido.load(Ordering::SeqCst),
            jogo_aberto: self.jogo_aberto.load(Ordering::SeqCst),
            jogo_em_foco: self.jogo_em_foco.load(Ordering::SeqCst),
            avisos_de_teclas,
        }
    }
}

/// O que a interface precisa saber sobre a janela. Vai no evento `estado`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EstadoJanela {
    pub edicao: bool,
    pub alt_segurado: bool,
    pub visivel: bool,
    pub escondido: bool,
    pub jogo_aberto: bool,
    pub jogo_em_foco: bool,
    pub avisos_de_teclas: Vec<String>,
}

/// Situação da leitura do Client.txt. Vai no evento `log-status`.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct StatusLog {
    /// "procurando", "lendo" ou "erro".
    pub situacao: String,
    pub caminho: Option<String>,
    /// De onde veio o caminho: "manual", "jogo aberto" ou "instalacao".
    pub origem: Option<String>,
    pub erro: Option<String>,
    /// O que havia no fim do arquivo quando ele foi aberto.
    pub resumo: Option<Resumo>,
}
