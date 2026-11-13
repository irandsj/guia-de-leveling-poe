"""Troca a arte de cada gema em public/gemas pela montada direto do CDN da GGG.

    python -I scripts/icones-da-ggg.py                      baixa e troca todas
    python -I scripts/icones-da-ggg.py --folhas <pasta>     guarda (e reaproveita) as folhas baixadas
    python -I scripts/icones-da-ggg.py --saida <pasta>      grava em outra pasta (pra testar antes)

Por que: o poedb (de onde o baixar-icones.mjs tira os ícones) monta algumas gemas com o desenho em
outro lugar em cima da pedra, ou com a pedra deslocada. Em ~120 de 400 gemas a forma muda bastante, e a
leitura de tela não reconhecia, por exemplo, a Kinetic Bolt na recompensa do Tarkleigh (nota 0,70 com
o ícone do poedb, 0,92 com este). Rode depois do baixar-icones.mjs, que só traz as gemas novas.

- Qual arte é de cada gema: base_items do RePoE (repoe-fork.github.io), campo visual_identity.dds_file.
- A imagem: web.poecdn.com/image/<dds sem o .dds>.png, uma folha com quadros de 78x78 lado a lado
  (o último é a pedra; o primeiro, o desenho que vai por cima). O ícone é a folha empilhada do último
  quadro pro primeiro, igual ao jogo. Folhas de outro tamanho (75x75) são ampliadas pra 78x78.
- Só mexe nas gemas (SkillGem*, SupportGem*). Gema que o RePoE ainda não conhece fica como está.
- Saída: WebP sem perda, mesmo nome de antes. A arte é da Grinding Gear Games.

Precisa do Pillow (pip install pillow).
"""
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request

from PIL import Image

AGENTE = "Mozilla/5.0 (guia-leveling; uso pessoal)"
LADO = 78
raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
gemas = os.path.join(raiz, "public", "gemas")


def opcao(nome):
    if nome in sys.argv:
        return sys.argv[sys.argv.index(nome) + 1]
    return None


def baixar(endereco):
    pedido = urllib.request.Request(endereco, headers={"User-Agent": AGENTE})
    with urllib.request.urlopen(pedido, timeout=30) as resposta:
        return resposta.read()


def montar(folha):
    """Empilha os quadros da folha, do último (a pedra) pro primeiro (o desenho)."""
    folha = folha.convert("RGBA")
    lado = folha.height
    quadros = max(1, folha.width // lado)
    icone = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    for i in reversed(range(quadros)):
        icone.alpha_composite(folha.crop((i * lado, 0, (i + 1) * lado, lado)))
    if lado != LADO:
        icone = icone.resize((LADO, LADO), Image.LANCZOS)
    return icone


saida = opcao("--saida") or gemas
folhas = opcao("--folhas")
os.makedirs(saida, exist_ok=True)
if folhas:
    os.makedirs(folhas, exist_ok=True)

itens = json.loads(baixar("https://repoe-fork.github.io/base_items.min.json"))
arte = {}
for chave, item in itens.items():
    dds = (item.get("visual_identity") or {}).get("dds_file")
    if chave.startswith("Metadata/Items/Gems/") and dds:
        arte[chave.rsplit("/", 1)[-1]] = dds

trocados, sem_arte, falhas = 0, [], []
for arquivo in sorted(os.listdir(gemas)):
    nome, extensao = os.path.splitext(arquivo)
    if extensao != ".webp" or not nome.startswith(("SkillGem", "SupportGem")):
        continue
    dds = arte.get(nome)
    if not dds:
        sem_arte.append(nome)
        continue
    try:
        guardada = os.path.join(folhas, nome + ".png") if folhas else None
        if guardada and os.path.exists(guardada):
            bytes_da_folha = open(guardada, "rb").read()
        else:
            caminho = urllib.parse.quote(dds[: -len(".dds")] + ".png")
            bytes_da_folha = baixar("https://web.poecdn.com/image/" + caminho)
            if bytes_da_folha[:4] != b"\x89PNG":
                raise ValueError("não veio PNG")
            if guardada:
                open(guardada, "wb").write(bytes_da_folha)
            time.sleep(0.15)
        montar(Image.open(io.BytesIO(bytes_da_folha))).save(os.path.join(saida, arquivo), "WEBP", lossless=True)
        trocados += 1
    except Exception as erro:  # noqa: BLE001 (uma gema com problema não para as outras)
        falhas.append(f"{nome}: {erro}")

print(f"{trocados} trocadas · {len(sem_arte)} sem arte no RePoE (ficaram como estavam) · {len(falhas)} falharam")
for nome in sem_arte:
    print(f"  sem arte: {nome}")
for falha in falhas:
    print(f"  {falha}")
