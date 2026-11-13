"""Prepara a bancada de telas: fotos reais do jogo, em pontos crus, pros testes de resolução.

As fotos vêm da pasta de referências tiradas de vídeos (fora do repositório). Nada daqui vai pro
aplicativo nem pro repositório: a pasta de saída fica fora dele.

Uso:
    python -I scripts/bancada-telas.py <pasta das referências> <pasta de saída>

Depois:
    GUIA_BANCADA_TELAS=<pasta de saída> cargo test --manifest-path src-tauri/Cargo.toml \
        --config "profile.dev.package.guia-leveling.opt-level=3" bancada -- --nocapture
    GUIA_BANCADA_TELAS=<pasta de saída> cargo test --manifest-path src-tauri/Cargo.toml \
        -p arvore-visao --test telas -- --nocapture

Saída:
    lista.txt              uma linha por foto: "<arquivo> <largura> <altura> <tipo>"
    quadros/<n>.rgb        a foto, 3 bytes por ponto (vermelho, verde, azul)
    icones/<nome>.rgba     cada ícone de public/gemas em 78x78, 4 bytes por ponto
"""

import json
import os
import random
import sys

from PIL import Image

# Quantas fotos de cada tipo e altura (as de qualidade 3 primeiro).
QUANTAS = {
    ("recompensa", 1080): 6,
    ("recompensa", 2160): 6,
    ("loja", 1080): 6,
    ("loja", 2160): 6,
    ("arvore", 1080): 6,
    ("arvore", 2160): 6,
    ("zona_nova", 1080): 3,
    ("mapa_tab", 1080): 3,
}


def main() -> None:
    referencias, saida = sys.argv[1], sys.argv[2]
    app = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.makedirs(os.path.join(saida, "quadros"), exist_ok=True)
    os.makedirs(os.path.join(saida, "icones"), exist_ok=True)

    with open(os.path.join(referencias, "indice.json"), encoding="utf-8") as f:
        indice = json.load(f)
    eventos = indice["eventos"] if isinstance(indice, dict) else indice

    sorteio = random.Random(330)
    linhas = []
    for (tipo, altura), quantas in QUANTAS.items():
        candidatos = [e for e in eventos if e["tipo"] == tipo and e["altura"] == altura]
        candidatos.sort(key=lambda e: (-e.get("qualidade", 0), e["arquivo"]))
        melhores = [e for e in candidatos if e.get("qualidade", 0) >= 3] or candidatos
        escolhidos = sorteio.sample(melhores, min(quantas, len(melhores)))
        for e in escolhidos:
            foto = Image.open(os.path.join(referencias, e["arquivo"])).convert("RGB")
            nome = f"{len(linhas):02d}-{tipo}-{altura}"
            with open(os.path.join(saida, "quadros", nome + ".rgb"), "wb") as f:
                f.write(foto.tobytes())
            linhas.append(f"{nome} {foto.width} {foto.height} {tipo} {e['arquivo']}")

    with open(os.path.join(saida, "lista.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(linhas) + "\n")

    pasta = os.path.join(app, "public", "gemas")
    icones = 0
    for arquivo in sorted(os.listdir(pasta)):
        if not arquivo.endswith(".webp"):
            continue
        icone = Image.open(os.path.join(pasta, arquivo)).convert("RGBA")
        if icone.size != (78, 78):
            icone = icone.resize((78, 78), Image.LANCZOS)
        with open(os.path.join(saida, "icones", arquivo[:-5] + ".rgba"), "wb") as f:
            f.write(icone.tobytes())
        icones += 1

    print(f"{len(linhas)} fotos e {icones} ícones em {saida}")


if __name__ == "__main__":
    main()
