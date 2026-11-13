//! Interpretação de uma linha do Client.txt.
//!
//! Formato visto no PoE 3.29 (uma linha por evento, terminada em `\n`):
//!
//! ```text
//! 2026/10/20 12:04:20 8362531 1186a8a3 [DEBUG Client 45132] Generating level 40 area "1_4_town" with seed 1
//! 2026/10/20 12:04:21 8363265 cffb065b [INFO Client 45132] : You have entered Highgate.
//! 2026/08/26 01:44:09 50306906 cffb065b [INFO Client 31928] : Nome (Scion) is now level 89
//! 2026/08/26 20:01:27 35556703 cffb065b [INFO Client 32136] : Nome has been slain.
//! ```
//!
//! Regras que evitam engano:
//! - A linha "Generating level" é do próprio cliente, sai em inglês em qualquer idioma e
//!   traz o ID único da área. É ela que move a rota.
//! - Mensagens do sistema começam com `": "` logo depois do cabeçalho. Mensagens de chat
//!   começam com o canal ou o nome de quem falou (`#`, `@`, `$`, `%`, `&`, `Nome:`), então
//!   um jogador não consegue fabricar um evento escrevendo no chat.
//! - "is now level" só vale no formato `Nome (Classe) is now level N` (a linha
//!   "AFK mode is now ON" não passa).

use serde::Serialize;

/// Um acontecimento tirado do log.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "tipo", rename_all = "snake_case")]
pub enum Evento {
    /// O jogo gerou (ou reabriu) uma área. `area_id` é o ID interno, ex.: `1_1_2`.
    Zona {
        area_id: String,
        nivel_area: u32,
        seed: u64,
    },
    /// "You have entered NOME." (só no cliente em inglês; serve de informação extra).
    Entrou { nome: String },
    /// Alguém subiu de nível. Pode ser outro jogador da área: quem usa o evento
    /// precisa conferir o nome do personagem.
    Nivel {
        personagem: String,
        classe: String,
        nivel: u32,
    },
    /// Alguém morreu.
    Morte { personagem: String },
}

/// Lê uma linha do Client.txt. Devolve `None` pra tudo que não interessa.
pub fn interpretar_linha(linha: &str) -> Option<Evento> {
    let linha = linha.trim_end_matches(['\r', '\n']);
    let mensagem = mensagem_do_cliente(linha)?;

    if let Some(resto) = mensagem.strip_prefix("Generating level ") {
        return interpretar_zona(resto);
    }

    // Daqui pra baixo, só mensagens do sistema (": texto").
    let texto = mensagem.strip_prefix(": ")?;

    if let Some(nome) = texto
        .strip_prefix("You have entered ")
        .and_then(|t| t.strip_suffix('.'))
    {
        if !nome.is_empty() {
            return Some(Evento::Entrou {
                nome: nome.to_string(),
            });
        }
        return None;
    }

    if let Some((antes, nivel_txt)) = texto.rsplit_once(" is now level ") {
        let nivel = numero(nivel_txt)?;
        let antes = antes.strip_suffix(')')?;
        let (personagem, classe) = antes.rsplit_once(" (")?;
        if !nome_valido(personagem) || classe.is_empty() || nivel == 0 || nivel > 100 {
            return None;
        }
        return Some(Evento::Nivel {
            personagem: personagem.to_string(),
            classe: classe.to_string(),
            nivel: nivel as u32,
        });
    }

    if let Some(personagem) = texto.strip_suffix(" has been slain.") {
        if nome_valido(personagem) {
            return Some(Evento::Morte {
                personagem: personagem.to_string(),
            });
        }
    }

    None
}

/// Tira o cabeçalho `data hora ticks hash [NIVEL Client PID] ` e devolve o resto.
fn mensagem_do_cliente(linha: &str) -> Option<&str> {
    let b = linha.as_bytes();
    // "AAAA/MM/DD HH:MM:SS " tem 20 caracteres.
    if b.len() < 24
        || !b[0].is_ascii_digit()
        || b[4] != b'/'
        || b[7] != b'/'
        || b[10] != b' '
        || b[13] != b':'
        || b[16] != b':'
        || b[19] != b' '
    {
        return None;
    }
    let abre = linha.find('[')?;
    // Entre a hora e o colchete só pode haver os dois campos numéricos (ticks e hash).
    // O `get` também cobre o colchete antes da hora e texto fora do ASCII no cabeçalho.
    if !linha
        .get(20..abre)?
        .bytes()
        .all(|c| c.is_ascii_hexdigit() || c == b' ')
    {
        return None;
    }
    let fecha = abre + linha[abre..].find(']')?;
    let cabecalho = &linha[abre + 1..fecha];
    let mut partes = cabecalho.split(' ');
    let _nivel_do_log = partes.next()?;
    if partes.next()? != "Client" {
        return None;
    }
    linha.get(fecha + 1..)?.strip_prefix(' ')
}

fn interpretar_zona(resto: &str) -> Option<Evento> {
    let (nivel_txt, resto) = resto.split_once(" area \"")?;
    let nivel_area = numero(nivel_txt)? as u32;
    let (area_id, resto) = resto.split_once('"')?;
    if area_id.is_empty()
        || !area_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_')
    {
        return None;
    }
    let seed = resto
        .strip_prefix(" with seed ")
        .and_then(numero)
        .unwrap_or(0);
    Some(Evento::Zona {
        area_id: area_id.to_string(),
        nivel_area,
        seed,
    })
}

/// Número inteiro sem sinal, sem nada antes nem depois.
fn numero(texto: &str) -> Option<u64> {
    let texto = texto.trim_end();
    if texto.is_empty() || texto.len() > 19 || !texto.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    texto.parse().ok()
}

/// Nome de personagem: sem espaço e sem os sinais que aparecem no chat.
fn nome_valido(nome: &str) -> bool {
    !nome.is_empty()
        && nome.chars().count() <= 32
        && !nome
            .chars()
            .any(|c| c.is_whitespace() || matches!(c, ':' | '#' | '@' | '$' | '%' | '&' | '<' | '>'))
}

#[cfg(test)]
mod testes {
    use super::*;

    const CAB: &str = "2026/11/10 20:00:31 1026000 1186a8a3 [DEBUG Client 4321] ";
    const INFO: &str = "2026/11/10 20:00:31 1026000 cffb065b [INFO Client 4321] ";

    #[test]
    fn zona() {
        let l = format!("{CAB}Generating level 40 area \"1_4_town\" with seed 1");
        assert_eq!(
            interpretar_linha(&l),
            Some(Evento::Zona {
                area_id: "1_4_town".into(),
                nivel_area: 40,
                seed: 1
            })
        );
    }

    #[test]
    fn zona_com_fim_de_linha_do_windows() {
        let l = format!("{CAB}Generating level 2 area \"1_1_2\" with seed 3371089214\r\n");
        assert_eq!(
            interpretar_linha(&l),
            Some(Evento::Zona {
                area_id: "1_1_2".into(),
                nivel_area: 2,
                seed: 3371089214
            })
        );
    }

    #[test]
    fn hideout_e_labirinto_sao_zonas_como_as_outras() {
        let l = format!("{CAB}Generating level 60 area \"HideoutBackstreet\" with seed 1");
        assert!(matches!(
            interpretar_linha(&l),
            Some(Evento::Zona { area_id, .. }) if area_id == "HideoutBackstreet"
        ));
        let l = format!("{CAB}Generating level 33 area \"1_Labyrinth_boss_3\" with seed 77");
        assert!(matches!(
            interpretar_linha(&l),
            Some(Evento::Zona { area_id, nivel_area: 33, .. }) if area_id == "1_Labyrinth_boss_3"
        ));
    }

    #[test]
    fn entrou() {
        let l = format!("{INFO}: You have entered Lioneye's Watch.");
        assert_eq!(
            interpretar_linha(&l),
            Some(Evento::Entrou {
                nome: "Lioneye's Watch".into()
            })
        );
    }

    #[test]
    fn nivel_com_classe_base_e_com_ascendencia() {
        let l = format!("{INFO}: HeroiTeste (Marauder) is now level 2");
        assert_eq!(
            interpretar_linha(&l),
            Some(Evento::Nivel {
                personagem: "HeroiTeste".into(),
                classe: "Marauder".into(),
                nivel: 2
            })
        );
        let l = format!("{INFO}: OutroJogador (Pathfinder) is now level 96");
        assert_eq!(
            interpretar_linha(&l),
            Some(Evento::Nivel {
                personagem: "OutroJogador".into(),
                classe: "Pathfinder".into(),
                nivel: 96
            })
        );
    }

    #[test]
    fn nome_com_acento_e_sublinhado() {
        let l = format!("{INFO}: Açaí_Do_Norte (Witch) is now level 12");
        assert!(matches!(
            interpretar_linha(&l),
            Some(Evento::Nivel { personagem, nivel: 12, .. }) if personagem == "Açaí_Do_Norte"
        ));
    }

    #[test]
    fn morte() {
        let l = format!("{INFO}: HeroiTeste has been slain.");
        assert_eq!(
            interpretar_linha(&l),
            Some(Evento::Morte {
                personagem: "HeroiTeste".into()
            })
        );
    }

    #[test]
    fn afk_nao_e_nivel() {
        let l = format!("{INFO}: AFK mode is now ON. Autoreply \"This player is AFK.\"");
        assert_eq!(interpretar_linha(&l), None);
    }

    #[test]
    fn chat_nao_fabrica_evento() {
        for falsa in [
            "#FulanoDeTal: Generating level 99 area \"2_10_1\" with seed 5",
            "@From Beltrano: : HeroiTeste (Marauder) is now level 99",
            "$Vendedor: : HeroiTeste has been slain.",
            "Vizinho: : You have entered The Coast.",
            "<TAG> Vizinho: Generating level 5 area \"1_1_3\" with seed 9",
            "%Parceiro: HeroiTeste (Marauder) is now level 50",
            "&Guilda: HeroiTeste has been slain.",
        ] {
            let l = format!("{INFO}{falsa}");
            assert_eq!(interpretar_linha(&l), None, "passou: {falsa}");
        }
    }

    #[test]
    fn linhas_que_nao_interessam() {
        for l in [
            "",
            "texto solto",
            "2026/11/10 20:00:05 1000500 890d9d3b [INFO Client 4321] Connected to sao.login.pathofexile.com in 32ms.",
            "2026/11/10 20:00:30 1025000 ca3a6b7d [INFO Client 4321] Connecting to instance server at 203.0.113.10:6112",
            "2026/11/10 20:00:01 1000001 f0f0f0f0 [INFO Client 4321] ***** LOG FILE OPENING *****",
            // sem cabeçalho de data, mesmo com o texto certo
            "[DEBUG Client 1] Generating level 1 area \"1_1_1\" with seed 1",
            // área com caracteres estranhos
            "2026/11/10 20:00:31 1026000 1186a8a3 [DEBUG Client 4321] Generating level 1 area \"1_1 1\" with seed 1",
            // nível impossível
            "2026/11/10 20:00:31 1026000 cffb065b [INFO Client 4321] : Heroi (Marauder) is now level 101",
            "2026/11/10 20:00:31 1026000 cffb065b [INFO Client 4321] : Heroi (Marauder) is now level 5 mesmo",
            // cabeçalho com texto no lugar dos campos numéricos
            "2026/11/10 20:00:31 isto nao [DEBUG Client 4321] Generating level 1 area \"1_1_1\" with seed 1",
        ] {
            assert_eq!(interpretar_linha(l), None, "passou: {l}");
        }
    }

    #[test]
    fn linha_cortada_no_meio_nao_vira_evento() {
        let inteira = format!("{CAB}Generating level 2 area \"1_1_2\" with seed 3371089214");
        // Corta em vários pontos antes da aspa que fecha o ID.
        let ate_a_aspa = inteira.find("\" with").unwrap();
        for corte in 30..ate_a_aspa {
            assert_eq!(interpretar_linha(&inteira[..corte]), None, "corte {corte}");
        }
    }
}
