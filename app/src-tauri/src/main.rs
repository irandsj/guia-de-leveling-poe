// Sem janela de console na versão final.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    guia_leveling::executar();
}
