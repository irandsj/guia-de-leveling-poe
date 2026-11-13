//! Teclas globais.
//!
//! Regra da GGG: cada tecla faz UMA ação, e aqui todas as ações são no nosso overlay
//! (mostrar, esconder, mudar de passo). Nenhuma tecla é enviada ao jogo.
//!
//! A tecla de interação fica sempre registrada. As outras só ficam registradas
//! enquanto o jogo (ou o overlay) está em primeiro plano, pra não roubar F2/F3/F4
//! de outros programas.
//!
//! As setas do teclado (← ↓ voltam e → ↑ avançam a etapa da árvore) são mais apertadas ainda:
//! só ficam registradas com o jogo na frente E a árvore de passivas aberta nele (o fio da
//! árvore é quem vê isso na tela), e fora do modo de edição. Árvore fechada, as setas são do jogo.

use std::collections::HashMap;
use std::str::FromStr;
use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

use crate::config::Atalhos;
use crate::estado::Estado;
use crate::janela;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Acao {
    Interacao,
    Esconder,
    Voltar,
    Avancar,
    Layout,
    Resync,
    Forma,
    ArvoreAnterior,
    ArvoreProxima,
}

/// As setas do teclado e o que cada uma faz na árvore (não dá pra trocar nas opções).
const SETAS: [(&str, Acao); 4] = [
    ("ArrowLeft", Acao::ArvoreAnterior),
    ("ArrowDown", Acao::ArvoreAnterior),
    ("ArrowRight", Acao::ArvoreProxima),
    ("ArrowUp", Acao::ArvoreProxima),
];

impl Acao {
    /// Nome mandado pra interface no evento `atalho`.
    pub fn nome(self) -> &'static str {
        match self {
            Acao::Interacao => "interacao",
            Acao::Esconder => "esconder",
            Acao::Voltar => "voltar",
            Acao::Avancar => "avancar",
            Acao::Layout => "layout",
            Acao::Resync => "resync",
            Acao::Forma => "forma",
            Acao::ArvoreAnterior => "arvore_anterior",
            Acao::ArvoreProxima => "arvore_proxima",
        }
    }

    fn rotulo(self) -> &'static str {
        match self {
            Acao::Interacao => "Ligar/desligar interação",
            Acao::Esconder => "Esconder/mostrar",
            Acao::Voltar => "Voltar um passo",
            Acao::Avancar => "Avançar um passo",
            Acao::Layout => "Layout da zona",
            Acao::Resync => "Procurar o passo pela zona",
            Acao::Forma => "Trocar o tamanho do balão",
            Acao::ArvoreAnterior => "Etapa anterior da árvore",
            Acao::ArvoreProxima => "Próxima etapa da árvore",
        }
    }
}

#[derive(Default)]
pub struct Tabela {
    /// Valem sempre.
    pub fixas: Vec<(Shortcut, Acao)>,
    /// Só com o jogo ou o overlay em primeiro plano.
    pub de_jogo: Vec<(Shortcut, Acao)>,
    /// As setas: só com o jogo na frente e a árvore aberta.
    pub setas: Vec<(Shortcut, Acao)>,
}

impl Tabela {
    fn acao(&self, id: u32) -> Option<Acao> {
        self.fixas
            .iter()
            .chain(self.de_jogo.iter())
            .chain(self.setas.iter())
            .find(|(atalho, _)| atalho.id() == id)
            .map(|(_, acao)| *acao)
    }
}

/// Confere o texto das teclas e monta a tabela. Erro em português, pra mostrar na tela.
pub fn montar(atalhos: &Atalhos) -> Result<Tabela, String> {
    let pares = [
        (&atalhos.interacao, Acao::Interacao),
        (&atalhos.esconder, Acao::Esconder),
        (&atalhos.voltar, Acao::Voltar),
        (&atalhos.avancar, Acao::Avancar),
        (&atalhos.layout, Acao::Layout),
        (&atalhos.resync, Acao::Resync),
        (&atalhos.forma, Acao::Forma),
    ];
    let mut tabela = Tabela::default();
    let mut vistas: HashMap<u32, Acao> = HashMap::new();
    for (texto, acao) in pares {
        let texto = texto.trim();
        if texto.is_empty() {
            continue;
        }
        let atalho = Shortcut::from_str(texto)
            .map_err(|_| format!("Tecla inválida em \"{}\": {texto}", acao.rotulo()))?;
        if let Some(outra) = vistas.insert(atalho.id(), acao) {
            return Err(format!(
                "A tecla {texto} está em \"{}\" e em \"{}\".",
                outra.rotulo(),
                acao.rotulo()
            ));
        }
        if acao == Acao::Interacao {
            tabela.fixas.push((atalho, acao));
        } else {
            tabela.de_jogo.push((atalho, acao));
        }
    }
    // Seta que o jogador já pôs em outra ação fica com a ação dele.
    for (texto, acao) in SETAS {
        let Ok(atalho) = Shortcut::from_str(texto) else {
            continue;
        };
        if !vistas.contains_key(&atalho.id()) {
            tabela.setas.push((atalho, acao));
        }
    }
    Ok(tabela)
}

/// Registra as teclas da lista. Devolve um aviso pra cada uma que o Windows recusou.
fn registrar(app: &AppHandle, lista: &[(Shortcut, Acao)]) -> Vec<String> {
    let teclas = app.global_shortcut();
    let mut avisos = Vec::new();
    for (atalho, acao) in lista {
        if teclas.is_registered(*atalho) {
            continue;
        }
        if teclas.register(*atalho).is_err() {
            avisos.push(format!(
                "A tecla de \"{}\" já está em uso por outro programa.",
                acao.rotulo()
            ));
            continue;
        }
        // Só na versão de desenvolvimento: o teste de ponta a ponta lê estes números
        // pra avisar a tecla ao app sem mexer no teclado de verdade.
        #[cfg(debug_assertions)]
        eprintln!("[teclas] {} id={}", acao.nome(), atalho.id());
    }
    avisos
}

fn remover(app: &AppHandle, lista: &[(Shortcut, Acao)]) {
    let teclas = app.global_shortcut();
    for (atalho, _) in lista {
        if teclas.is_registered(*atalho) {
            let _ = teclas.unregister(*atalho);
        }
    }
}

// Nas funções abaixo a lista é copiada antes de falar com o plugin: registrar e remover
// esperam a thread principal, e ela pode estar justamente esperando a tabela em `tratar`.

/// Registra as teclas fixas (na abertura e quando a configuração muda).
pub fn ligar_fixas(app: &AppHandle) {
    let estado = app.state::<Estado>();
    let lista = estado.tabela.lock().unwrap().fixas.clone();
    let avisos = registrar(app, &lista);
    estado.avisos_de_teclas.lock().unwrap().fixas = avisos;
}

/// Liga ou desliga as teclas de jogo conforme quem está em primeiro plano.
pub fn ajustar_de_jogo(app: &AppHandle, ligar: bool) {
    let estado = app.state::<Estado>();
    if estado.teclas_de_jogo_ligadas.swap(ligar, Ordering::SeqCst) == ligar {
        return;
    }
    let lista = estado.tabela.lock().unwrap().de_jogo.clone();
    if ligar {
        let avisos = registrar(app, &lista);
        estado.avisos_de_teclas.lock().unwrap().de_jogo = avisos;
    } else {
        remover(app, &lista);
    }
}

/// Liga ou desliga as setas da árvore. Se o Windows recusar alguma seta, fica sem ela e sem aviso:
/// as setas do balão continuam lá.
pub fn ajustar_setas(app: &AppHandle, ligar: bool) {
    let estado = app.state::<Estado>();
    if estado.setas_ligadas.swap(ligar, Ordering::SeqCst) == ligar {
        return;
    }
    let lista = estado.tabela.lock().unwrap().setas.clone();
    if ligar {
        let _ = registrar(app, &lista);
    } else {
        remover(app, &lista);
    }
}

/// Troca todas as teclas (a configuração mudou).
pub fn trocar(app: &AppHandle, nova: Tabela) {
    let estado = app.state::<Estado>();
    let (fixas, de_jogo, setas) = {
        let tabela = estado.tabela.lock().unwrap();
        (tabela.fixas.clone(), tabela.de_jogo.clone(), tabela.setas.clone())
    };
    remover(app, &fixas);
    remover(app, &de_jogo);
    remover(app, &setas);
    *estado.tabela.lock().unwrap() = nova;
    *estado.avisos_de_teclas.lock().unwrap() = Default::default();

    let ligadas = estado.teclas_de_jogo_ligadas.swap(false, Ordering::SeqCst);
    let setas_ligadas = estado.setas_ligadas.swap(false, Ordering::SeqCst);
    ligar_fixas(app);
    if ligadas {
        ajustar_de_jogo(app, true);
    }
    if setas_ligadas {
        ajustar_setas(app, true);
    }
}

/// Chamado pelo plugin a cada tecla global. Só reage ao apertar (não ao soltar).
pub fn tratar(app: &AppHandle, atalho: &Shortcut, evento: ShortcutEvent) {
    if evento.state() != ShortcutState::Pressed {
        return;
    }
    let estado = app.state::<Estado>();
    let Some(acao) = estado.tabela.lock().unwrap().acao(atalho.id()) else {
        return;
    };
    match acao {
        Acao::Interacao => janela::alternar_edicao(app),
        Acao::Esconder => janela::alternar_escondido(app),
        outra => {
            let _ = app.emit("atalho", outra.nome());
        }
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn padrao_monta_uma_fixa_e_seis_de_jogo() {
        let tabela = montar(&Atalhos::default()).unwrap();
        assert_eq!(tabela.fixas.len(), 1);
        assert_eq!(tabela.fixas[0].1, Acao::Interacao);
        assert_eq!(tabela.de_jogo.len(), 6);
    }

    #[test]
    fn tecla_vazia_fica_desligada() {
        let atalhos = Atalhos {
            layout: "  ".into(),
            resync: String::new(),
            ..Atalhos::default()
        };
        let tabela = montar(&atalhos).unwrap();
        assert_eq!(tabela.de_jogo.len(), 4);
    }

    #[test]
    fn tecla_invalida_da_erro_legivel() {
        let atalhos = Atalhos {
            avancar: "Ctrl+Banana".into(),
            ..Atalhos::default()
        };
        let erro = montar(&atalhos).err().unwrap();
        assert!(erro.contains("Avançar um passo"), "{erro}");
        assert!(erro.contains("Ctrl+Banana"), "{erro}");
    }

    #[test]
    fn tecla_repetida_da_erro() {
        let atalhos = Atalhos {
            voltar: "F4".into(),
            ..Atalhos::default()
        };
        let erro = montar(&atalhos).err().unwrap();
        assert!(erro.contains("F4"), "{erro}");
    }

    #[test]
    fn acha_a_acao_pela_tecla() {
        let tabela = montar(&Atalhos::default()).unwrap();
        let f4 = Shortcut::from_str("F4").unwrap();
        assert_eq!(tabela.acao(f4.id()), Some(Acao::Avancar));
        let ctrl_f2 = Shortcut::from_str("Ctrl+F2").unwrap();
        assert_eq!(tabela.acao(ctrl_f2.id()), Some(Acao::Interacao));
        let f12 = Shortcut::from_str("F12").unwrap();
        assert_eq!(tabela.acao(f12.id()), None);
        // Ctrl+F3 troca o tamanho e não se confunde com o F3 sozinho (voltar).
        let ctrl_f3 = Shortcut::from_str("Ctrl+F3").unwrap();
        assert_eq!(tabela.acao(ctrl_f3.id()), Some(Acao::Forma));
        let f3 = Shortcut::from_str("F3").unwrap();
        assert_eq!(tabela.acao(f3.id()), Some(Acao::Voltar));
    }

    #[test]
    fn setas_mexem_na_etapa_da_arvore() {
        let tabela = montar(&Atalhos::default()).unwrap();
        assert_eq!(tabela.setas.len(), 4);
        assert_eq!(tabela.de_jogo.len(), 6);
        let acao = |texto: &str| tabela.acao(Shortcut::from_str(texto).unwrap().id());
        assert_eq!(acao("ArrowLeft"), Some(Acao::ArvoreAnterior));
        assert_eq!(acao("ArrowDown"), Some(Acao::ArvoreAnterior));
        assert_eq!(acao("ArrowRight"), Some(Acao::ArvoreProxima));
        assert_eq!(acao("ArrowUp"), Some(Acao::ArvoreProxima));
        assert_eq!(Acao::ArvoreAnterior.nome(), "arvore_anterior");
        assert_eq!(Acao::ArvoreProxima.nome(), "arvore_proxima");
    }

    #[test]
    fn seta_que_o_jogador_usou_fica_com_a_acao_dele() {
        let atalhos = Atalhos {
            avancar: "ArrowRight".into(),
            ..Atalhos::default()
        };
        let tabela = montar(&atalhos).unwrap();
        assert_eq!(tabela.setas.len(), 3);
        let direita = Shortcut::from_str("ArrowRight").unwrap();
        assert_eq!(tabela.acao(direita.id()), Some(Acao::Avancar));
    }

    #[test]
    fn config_antigo_sem_a_tecla_de_forma_ganha_o_ctrl_f3() {
        let lido: Atalhos = serde_json::from_str(r#"{"interacao":"Ctrl+F2","voltar":"F3"}"#).unwrap();
        assert_eq!(lido.forma, "Ctrl+F3");
        assert_eq!(Acao::Forma.nome(), "forma");
    }
}
