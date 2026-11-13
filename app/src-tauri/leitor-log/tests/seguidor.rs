//! Testes do leitor com um Client.txt de exemplo e com arquivos temporários que
//! imitam o jogo gravando (acrescenta, corta linha no meio, recria o arquivo).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use leitor_log::seguidor::CAUDA_PADRAO;
use leitor_log::{interpretar_linha, Evento, NivelVisto, Seguidor, ZonaVista};

const EXEMPLO: &str = include_str!("../testdata/Client-exemplo.txt");

const CAB: &str = "2026/11/10 21:00:00 2000000 1186a8a3 [DEBUG Client 4321] ";
const INFO: &str = "2026/11/10 21:00:00 2000000 cffb065b [INFO Client 4321] ";

/// Pasta temporária própria de cada teste, apagada no fim.
struct Pasta(PathBuf);

impl Pasta {
    fn nova() -> Pasta {
        static CONTADOR: AtomicU32 = AtomicU32::new(0);
        let n = CONTADOR.fetch_add(1, Ordering::SeqCst);
        let pasta = std::env::temp_dir().join(format!(
            "leitor-log-teste-{}-{}",
            std::process::id(),
            n
        ));
        fs::create_dir_all(&pasta).unwrap();
        Pasta(pasta)
    }

    fn arquivo(&self, conteudo: &[u8]) -> PathBuf {
        let caminho = self.0.join("Client.txt");
        fs::write(&caminho, conteudo).unwrap();
        caminho
    }
}

impl Drop for Pasta {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Acrescenta bytes no fim, como o jogo faz.
fn acrescentar(caminho: &Path, bytes: &[u8]) {
    let mut arquivo = OpenOptions::new().append(true).open(caminho).unwrap();
    arquivo.write_all(bytes).unwrap();
    arquivo.flush().unwrap();
}

fn zona(area_id: &str, nivel_area: u32, seed: u64) -> Evento {
    Evento::Zona {
        area_id: area_id.into(),
        nivel_area,
        seed,
    }
}

fn entrou(nome: &str) -> Evento {
    Evento::Entrou { nome: nome.into() }
}

fn nivel(personagem: &str, classe: &str, nivel: u32) -> Evento {
    Evento::Nivel {
        personagem: personagem.into(),
        classe: classe.into(),
        nivel,
    }
}

fn morte(personagem: &str) -> Evento {
    Evento::Morte {
        personagem: personagem.into(),
    }
}

#[test]
fn exemplo_inteiro_gera_so_os_eventos_de_verdade() {
    let eventos: Vec<Evento> = EXEMPLO.lines().filter_map(interpretar_linha).collect();
    assert_eq!(
        eventos,
        vec![
            zona("1_1_1", 1, 2890112233),
            entrou("The Twilight Strand"),
            nivel("HeroiTeste", "Marauder", 2),
            zona("1_1_town", 1, 1),
            entrou("Lioneye's Watch"),
            // as três linhas de chat que imitam eventos não entram
            zona("1_1_2", 2, 3371089214),
            entrou("The Coast"),
            nivel("HeroiTeste", "Marauder", 3),
            nivel("OutroJogador", "Witch", 4),
            // "AFK mode is now ON/OFF" não é nível
            morte("HeroiTeste"),
            zona("1_1_town", 1, 1),
            entrou("Lioneye's Watch"),
            zona("1_1_2", 2, 3371089214),
            entrou("The Coast"),
            nivel("HeroiTeste", "Marauder", 4),
            zona("1_1_2a", 3, 912345678),
            entrou("The Tidal Island"),
            zona("1_1_3", 4, 44556677),
            entrou("The Mud Flats"),
            nivel("HeroiTeste", "Marauder", 5),
        ]
    );
}

#[test]
fn abrir_comeca_no_fim_e_resume_a_cauda() {
    let pasta = Pasta::nova();
    let caminho = pasta.arquivo(EXEMPLO.as_bytes());

    let (mut seguidor, resumo) = Seguidor::abrir(&caminho, CAUDA_PADRAO).unwrap();

    assert_eq!(
        resumo.zona,
        Some(ZonaVista {
            area_id: "1_1_3".into(),
            nivel_area: 4
        })
    );
    // Um registro por personagem, o mais recente por último.
    assert_eq!(
        resumo.niveis,
        vec![
            NivelVisto {
                personagem: "OutroJogador".into(),
                classe: "Witch".into(),
                nivel: 4
            },
            NivelVisto {
                personagem: "HeroiTeste".into(),
                classe: "Marauder".into(),
                nivel: 5
            },
        ]
    );
    assert_eq!(seguidor.posicao(), EXEMPLO.len() as u64);
    // Nada do que já estava no arquivo vira evento.
    assert_eq!(seguidor.ler_novos().unwrap(), vec![]);
    assert_eq!(seguidor.ler_novos().unwrap(), vec![]);
}

#[test]
fn le_so_o_que_foi_acrescentado() {
    let pasta = Pasta::nova();
    let caminho = pasta.arquivo(EXEMPLO.as_bytes());
    let (mut seguidor, _) = Seguidor::abrir(&caminho, CAUDA_PADRAO).unwrap();

    acrescentar(
        &caminho,
        format!(
            "{CAB}Generating level 5 area \"1_1_4_1\" with seed 123\n\
             {INFO}: You have entered The Submerged Passage.\n"
        )
        .as_bytes(),
    );
    assert_eq!(
        seguidor.ler_novos().unwrap(),
        vec![zona("1_1_4_1", 5, 123), entrou("The Submerged Passage")]
    );
    assert_eq!(seguidor.ler_novos().unwrap(), vec![]);

    acrescentar(
        &caminho,
        format!("{INFO}: HeroiTeste (Marauder) is now level 6\n").as_bytes(),
    );
    assert_eq!(
        seguidor.ler_novos().unwrap(),
        vec![nivel("HeroiTeste", "Marauder", 6)]
    );
}

#[test]
fn linha_gravada_em_pedacos_espera_o_fim() {
    let pasta = Pasta::nova();
    let caminho = pasta.arquivo(EXEMPLO.as_bytes());
    let (mut seguidor, _) = Seguidor::abrir(&caminho, CAUDA_PADRAO).unwrap();

    let linha = format!("{CAB}Generating level 13 area \"1_1_11_1\" with seed 987654\n");
    let (parte1, parte2) = linha.split_at(linha.len() - 12);
    let (parte1a, parte1b) = parte1.split_at(40);

    acrescentar(&caminho, parte1a.as_bytes());
    assert_eq!(seguidor.ler_novos().unwrap(), vec![]);
    acrescentar(&caminho, parte1b.as_bytes());
    assert_eq!(seguidor.ler_novos().unwrap(), vec![]);
    acrescentar(&caminho, parte2.as_bytes());
    assert_eq!(
        seguidor.ler_novos().unwrap(),
        vec![zona("1_1_11_1", 13, 987654)]
    );
}

#[test]
fn abrir_com_ultima_linha_incompleta_completa_depois() {
    let pasta = Pasta::nova();
    let inicio = format!("{EXEMPLO}{CAB}Generating level 8 area \"1_1_");
    let caminho = pasta.arquivo(inicio.as_bytes());

    let (mut seguidor, resumo) = Seguidor::abrir(&caminho, CAUDA_PADRAO).unwrap();
    // A linha incompleta ainda não conta no resumo.
    assert_eq!(resumo.zona.unwrap().area_id, "1_1_3");

    acrescentar(&caminho, b"6\" with seed 42\n");
    assert_eq!(seguidor.ler_novos().unwrap(), vec![zona("1_1_6", 8, 42)]);
}

#[test]
fn arquivo_recriado_volta_pro_comeco() {
    let pasta = Pasta::nova();
    let caminho = pasta.arquivo(EXEMPLO.as_bytes());
    let (mut seguidor, _) = Seguidor::abrir(&caminho, CAUDA_PADRAO).unwrap();

    // O jogo apagou o log e começou outro, menor.
    fs::write(
        &caminho,
        format!("{CAB}Generating level 45 area \"2_6_town\" with seed 1\n"),
    )
    .unwrap();

    assert_eq!(seguidor.ler_novos().unwrap(), vec![zona("2_6_town", 45, 1)]);
    assert_eq!(seguidor.ler_novos().unwrap(), vec![]);
}

#[test]
fn arquivo_apagado_da_erro_e_volta_a_funcionar() {
    let pasta = Pasta::nova();
    let caminho = pasta.arquivo(EXEMPLO.as_bytes());
    let (mut seguidor, _) = Seguidor::abrir(&caminho, CAUDA_PADRAO).unwrap();

    fs::remove_file(&caminho).unwrap();
    assert!(seguidor.ler_novos().is_err());

    fs::write(
        &caminho,
        format!("{CAB}Generating level 1 area \"1_1_1\" with seed 7\n"),
    )
    .unwrap();
    assert_eq!(seguidor.ler_novos().unwrap(), vec![zona("1_1_1", 1, 7)]);
}

#[test]
fn cauda_pequena_ignora_a_primeira_linha_cortada() {
    let pasta = Pasta::nova();
    let caminho = pasta.arquivo(EXEMPLO.as_bytes());

    // 150 bytes pegam só a última linha (nível 5) e um pedaço da penúltima.
    let (mut seguidor, resumo) = Seguidor::abrir(&caminho, 150).unwrap();
    assert_eq!(resumo.zona, None);
    assert_eq!(
        resumo.niveis,
        vec![NivelVisto {
            personagem: "HeroiTeste".into(),
            classe: "Marauder".into(),
            nivel: 5
        }]
    );
    assert_eq!(seguidor.ler_novos().unwrap(), vec![]);

    // Cauda de zero bytes: abre direto no fim, sem resumo.
    let (mut seguidor, resumo) = Seguidor::abrir(&caminho, 0).unwrap();
    assert_eq!(resumo.zona, None);
    assert!(resumo.niveis.is_empty());
    assert_eq!(seguidor.ler_novos().unwrap(), vec![]);
}

#[test]
fn arquivo_grande_le_so_a_cauda() {
    let pasta = Pasta::nova();
    // ~6 MB de linhas que não interessam, com uma zona antiga lá no começo.
    let mut conteudo = String::with_capacity(6 * 1024 * 1024 + 4096);
    conteudo.push_str(&format!(
        "{CAB}Generating level 67 area \"2_10_town\" with seed 1\n"
    ));
    let enchimento = format!("{INFO}Tile hash: 1234567890\n");
    while conteudo.len() < 6 * 1024 * 1024 {
        conteudo.push_str(&enchimento);
    }
    conteudo.push_str(&format!(
        "{CAB}Generating level 12 area \"1_1_9\" with seed 55\n{INFO}: HeroiTeste (Marauder) is now level 11\n"
    ));
    let caminho = pasta.arquivo(conteudo.as_bytes());

    let (mut seguidor, resumo) = Seguidor::abrir(&caminho, CAUDA_PADRAO).unwrap();
    // A zona antiga ficou fora da cauda; vale a do fim.
    assert_eq!(
        resumo.zona,
        Some(ZonaVista {
            area_id: "1_1_9".into(),
            nivel_area: 12
        })
    );
    assert_eq!(resumo.niveis.len(), 1);
    assert_eq!(seguidor.posicao(), conteudo.len() as u64);
    assert_eq!(seguidor.ler_novos().unwrap(), vec![]);
}

#[test]
fn fim_de_linha_do_windows_e_bytes_quebrados() {
    let pasta = Pasta::nova();
    let caminho = pasta.arquivo(b"");
    let (mut seguidor, resumo) = Seguidor::abrir(&caminho, CAUDA_PADRAO).unwrap();
    assert_eq!(resumo.zona, None);

    let mut bytes = Vec::new();
    bytes.extend_from_slice(format!("{CAB}Generating level 2 area \"1_1_2\" with seed 9\r\n").as_bytes());
    // Linha de chat com bytes que não são UTF-8 válido.
    bytes.extend_from_slice(INFO.as_bytes());
    bytes.extend_from_slice(b"#Alguem: \xff\xfe\xc3 texto quebrado\r\n");
    bytes.extend_from_slice("\r\n".as_bytes());
    bytes.extend_from_slice(format!("{INFO}: Açaí_Do_Norte (Witch) is now level 7\r\n").as_bytes());
    acrescentar(&caminho, &bytes);

    assert_eq!(
        seguidor.ler_novos().unwrap(),
        vec![zona("1_1_2", 2, 9), nivel("Açaí_Do_Norte", "Witch", 7)]
    );
}

#[test]
fn linha_gigante_sem_fim_e_descartada() {
    let pasta = Pasta::nova();
    let caminho = pasta.arquivo(b"");
    let (mut seguidor, _) = Seguidor::abrir(&caminho, CAUDA_PADRAO).unwrap();

    // 200 KB sem nenhum "\n": não pode ficar guardado crescendo pra sempre.
    acrescentar(&caminho, &vec![b'x'; 200 * 1024]);
    assert_eq!(seguidor.ler_novos().unwrap(), vec![]);

    // O fim dessa linha gigante chega e, depois dela, uma linha boa.
    acrescentar(
        &caminho,
        format!("resto do lixo\n{CAB}Generating level 3 area \"1_1_2a\" with seed 4\n").as_bytes(),
    );
    assert_eq!(seguidor.ler_novos().unwrap(), vec![zona("1_1_2a", 3, 4)]);
}

#[test]
fn muitos_eventos_de_uma_vez_saem_na_ordem() {
    let pasta = Pasta::nova();
    let caminho = pasta.arquivo(b"");
    let (mut seguidor, _) = Seguidor::abrir(&caminho, CAUDA_PADRAO).unwrap();

    let mut texto = String::new();
    for n in 2..=60u32 {
        texto.push_str(&format!("{INFO}: HeroiTeste (Marauder) is now level {n}\n"));
    }
    acrescentar(&caminho, texto.as_bytes());

    let eventos = seguidor.ler_novos().unwrap();
    assert_eq!(eventos.len(), 59);
    assert_eq!(eventos[0], nivel("HeroiTeste", "Marauder", 2));
    assert_eq!(eventos[58], nivel("HeroiTeste", "Marauder", 60));
}
