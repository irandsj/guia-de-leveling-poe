# Ajudante do teste de ponta a ponta (scripts/e2e.mjs). Conversa com o Windows sobre
# a janela DO NOSSO APP. Nada aqui toca no jogo nem no teclado de verdade.
#
#   -Acao estilos  -IdProcesso N          estilos da janela do overlay e pra onde vai o clique
#   -Acao tecla    -IdProcesso N -IdTecla X -Vk V   avisa ao app que a tecla global X foi apertada
#   -Acao conflito -Mods M -Vk V          a tecla já está registrada por alguém? (sem apertar nada)
#   -Acao jogo                            o Path of Exile está aberto?
#   -Acao foto     -IdProcesso N -Saida arquivo.png   foto só do retângulo do overlay
#   -Acao consumo  -IdProcesso N          memória e tempo de CPU do app e dos processos do WebView2 dele
#   -Acao fechar   -IdProcesso N          pede à janela do overlay que feche (o app sai sozinho)
#
# A resposta sai em JSON, numa linha.
param(
    [Parameter(Mandatory = $true)][ValidateSet("estilos", "tecla", "conflito", "jogo", "foto", "consumo", "fechar")][string]$Acao,
    [int]$IdProcesso = 0,
    [long]$IdTecla = 0,
    [int]$Mods = 0,
    [int]$Vk = 0,
    [string]$Saida = ""
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class JanelaDoTeste {
    public delegate bool EnumProc(IntPtr hwnd, IntPtr lparam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X, Y; }

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lparam);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd, StringBuilder texto, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hwnd, StringBuilder texto, int max);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int indice);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out RECT r);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool PostMessageW(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterHotKey(IntPtr hwnd, int id, uint mods, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hwnd, int id);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowW(string classe, string titulo);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    // Sem isto o Windows entrega as medidas "arredondadas" em telas com escala.
    public static void MedidasReais() { SetProcessDPIAware(); }

    public static string Classe(IntPtr hwnd) {
        var texto = new StringBuilder(256);
        GetClassNameW(hwnd, texto, texto.Capacity);
        return texto.ToString();
    }

    public static string Titulo(IntPtr hwnd) {
        var texto = new StringBuilder(256);
        GetWindowTextW(hwnd, texto, texto.Capacity);
        return texto.ToString();
    }

    public static List<IntPtr> DoProcesso(uint pid) {
        var lista = new List<IntPtr>();
        EnumWindows((hwnd, l) => {
            uint dono;
            GetWindowThreadProcessId(hwnd, out dono);
            if (dono == pid) lista.Add(hwnd);
            return true;
        }, IntPtr.Zero);
        return lista;
    }

    public static long Estilo(IntPtr hwnd, int indice) { return GetWindowLongPtr(hwnd, indice).ToInt64(); }
    public static bool Visivel(IntPtr hwnd) { return IsWindowVisible(hwnd); }
    public static RECT Retangulo(IntPtr hwnd) { RECT r; GetWindowRect(hwnd, out r); return r; }
    public static RECT AreaUtil(IntPtr hwnd) { RECT r; GetClientRect(hwnd, out r); return r; }
    public static IntPtr NoPonto(int x, int y) {
        var alvo = WindowFromPoint(new POINT { X = x, Y = y });
        return alvo == IntPtr.Zero ? alvo : GetAncestor(alvo, 2 /* GA_ROOT */);
    }
    public static IntPtr NaFrente() { return GetForegroundWindow(); }
    public static bool Avisar(IntPtr hwnd, long id, uint mods, uint vk) {
        ulong detalhe = ((ulong)vk << 16) | (ulong)mods;
        return PostMessageW(hwnd, 0x0312 /* WM_HOTKEY */, new IntPtr(id), new IntPtr((long)detalhe));
    }
    public static int Conflito(uint mods, uint vk) {
        if (RegisterHotKey(IntPtr.Zero, 0x4242, mods | 0x4000 /* MOD_NOREPEAT */, vk)) {
            UnregisterHotKey(IntPtr.Zero, 0x4242);
            return 0;
        }
        return Marshal.GetLastWin32Error();
    }
    public static bool PedirPraFechar(IntPtr hwnd) {
        return PostMessageW(hwnd, 0x0010 /* WM_CLOSE */, IntPtr.Zero, IntPtr.Zero);
    }

    // PROCESS_MEMORY_COUNTERS_EX2 do Windows.
    [StructLayout(LayoutKind.Sequential)]
    struct Memoria {
        public uint cb, PageFaultCount;
        public UIntPtr PeakWorkingSetSize, WorkingSetSize, QuotaPeakPagedPoolUsage, QuotaPagedPoolUsage,
            QuotaPeakNonPagedPoolUsage, QuotaNonPagedPoolUsage, PagefileUsage, PeakPagefileUsage,
            PrivateUsage, PrivateWorkingSetSize;
        public ulong SharedCommitUsage;
    }
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint acesso, bool herdar, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("psapi.dll")] static extern bool GetProcessMemoryInfo(IntPtr h, ref Memoria m, uint cb);

    // A memória que é só do processo, em bytes: é a coluna "Memória" do Gerenciador de
    // Tarefas. Devolve -1 se o Windows não informar (versões antigas).
    public static long MemoriaSoDele(uint pid) {
        IntPtr h = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
        if (h == IntPtr.Zero) return -1;
        try {
            var m = new Memoria();
            m.cb = (uint)Marshal.SizeOf(typeof(Memoria));
            if (!GetProcessMemoryInfo(h, ref m, m.cb)) return -1;
            return (long)m.PrivateWorkingSetSize.ToUInt64();
        } finally {
            CloseHandle(h);
        }
    }
    public static bool JogoAberto() { return FindWindowW("POEWindowClass", null) != IntPtr.Zero; }
}
"@

[JanelaDoTeste]::MedidasReais()

function Responder($objeto) {
    $objeto | ConvertTo-Json -Compress -Depth 5
}

function JanelaDoOverlay {
    [JanelaDoTeste]::DoProcesso([uint32]$IdProcesso) |
        Where-Object { [JanelaDoTeste]::Titulo($_) -eq "Guia de Leveling" -and [JanelaDoTeste]::Visivel($_) } |
        Select-Object -First 1
}

switch ($Acao) {
    "jogo" {
        Responder @{ aberto = [JanelaDoTeste]::JogoAberto() }
    }
    "conflito" {
        $erro = [JanelaDoTeste]::Conflito([uint32]$Mods, [uint32]$Vk)
        # 1409 = ERROR_HOTKEY_ALREADY_REGISTERED
        Responder @{ registrada = ($erro -eq 1409); erro = $erro }
    }
    "tecla" {
        $escondida = [JanelaDoTeste]::DoProcesso([uint32]$IdProcesso) |
            Where-Object { [JanelaDoTeste]::Classe($_) -eq "global_hotkey_app" } |
            Select-Object -First 1
        if ($null -eq $escondida) {
            Responder @{ ok = $false; erro = "janela das teclas nao encontrada" }
        } else {
            Responder @{ ok = [JanelaDoTeste]::Avisar($escondida, $IdTecla, [uint32]$Mods, [uint32]$Vk) }
        }
    }
    "estilos" {
        $janela = JanelaDoOverlay
        if ($null -eq $janela) {
            Responder @{ ok = $false; erro = "janela do overlay nao encontrada" }
            break
        }
        $ex = [JanelaDoTeste]::Estilo($janela, -20)
        $r = [JanelaDoTeste]::Retangulo($janela)
        $util = [JanelaDoTeste]::AreaUtil($janela)
        $cx = [int](($r.Left + $r.Right) / 2)
        $cy = [int](($r.Top + $r.Bottom) / 2)
        $noPonto = [JanelaDoTeste]::NoPonto($cx, $cy)
        Responder @{
            ok              = $true
            x               = $r.Left
            y               = $r.Top
            largura         = $r.Right - $r.Left
            altura          = $r.Bottom - $r.Top
            # Sem borda nem barra de título: a área útil ocupa a janela inteira.
            sem_borda       = (($util.Right -eq ($r.Right - $r.Left)) -and ($util.Bottom -eq ($r.Bottom - $r.Top)))
            por_cima        = (($ex -band 0x00000008) -ne 0)                # WS_EX_TOPMOST
            clique_passa    = (($ex -band 0x00000020) -ne 0)                # WS_EX_TRANSPARENT
            em_camadas      = (($ex -band 0x00080000) -ne 0)                # WS_EX_LAYERED
            nao_pega_foco   = (($ex -band 0x08000000) -ne 0)                # WS_EX_NOACTIVATE
            # Quem o Windows diz que recebe o clique no meio da janela.
            clique_cai_nela = ($noPonto -eq $janela)
            esta_na_frente  = ([JanelaDoTeste]::NaFrente() -eq $janela)
        }
    }
    "foto" {
        $janela = JanelaDoOverlay
        if ($null -eq $janela -or $Saida -eq "") {
            Responder @{ ok = $false; erro = "janela do overlay nao encontrada (ou faltou -Saida)" }
            break
        }
        Add-Type -AssemblyName System.Drawing
        $r = [JanelaDoTeste]::Retangulo($janela)
        $largura = $r.Right - $r.Left
        $altura = $r.Bottom - $r.Top
        $imagem = New-Object System.Drawing.Bitmap $largura, $altura
        $desenho = [System.Drawing.Graphics]::FromImage($imagem)
        $desenho.CopyFromScreen($r.Left, $r.Top, 0, 0, $imagem.Size)
        $desenho.Dispose()
        $imagem.Save($Saida, [System.Drawing.Imaging.ImageFormat]::Png)
        $imagem.Dispose()
        Responder @{ ok = $true; largura = $largura; altura = $altura }
    }
    "consumo" {
        # O app e tudo o que ele abriu: os processos do WebView2 são filhos e netos dele.
        $todos = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate, CommandLine)
        $raiz = $todos | Where-Object { $_.ProcessId -eq $IdProcesso } | Select-Object -First 1
        if ($null -eq $raiz) {
            Responder @{ ok = $false; erro = "processo nao encontrado" }
            break
        }
        $familia = New-Object System.Collections.Generic.List[object]
        $familia.Add($raiz)
        for ($i = 0; $i -lt $familia.Count; $i++) {
            $pai = $familia[$i]
            foreach ($filho in $todos) {
                # O Windows reaproveita números de processo: filho de verdade nasceu depois do pai.
                if ($filho.ParentProcessId -eq $pai.ProcessId -and $filho.ProcessId -ne $pai.ProcessId -and
                    $filho.CreationDate -ge $pai.CreationDate -and -not $familia.Contains($filho)) {
                    $familia.Add($filho)
                }
            }
        }
        $lista = @()
        $soDeleConhecida = $true
        foreach ($membro in $familia) {
            $processo = Get-Process -Id $membro.ProcessId -ErrorAction SilentlyContinue
            if ($null -eq $processo) { continue }
            $privado = [JanelaDoTeste]::MemoriaSoDele([uint32]$membro.ProcessId)
            if ($privado -lt 0) {
                # Windows antigo: fica a memória toda do processo, que conta a mais.
                $soDeleConhecida = $false
                $privado = $processo.WorkingSet64
            }
            # O papel de cada processo do WebView2 vem escrito na linha de comando dele.
            $papel = "app"
            if ($membro.ProcessId -ne $IdProcesso) {
                $papel = "navegador"
                $linha = [string]$membro.CommandLine
                if ($linha -match "--type=([\w-]+)") { $papel = $Matches[1] }
                if ($linha -match "--utility-sub-type=[\w.]*?(\w+)\s") { $papel = $Matches[1] }
            }
            $lista += @{
                id         = [int]$membro.ProcessId
                nome       = $processo.ProcessName
                papel      = $papel
                privado_mb = [math]::Round($privado / 1MB, 1)
                total_mb   = [math]::Round($processo.WorkingSet64 / 1MB, 1)
                cpu_s      = [math]::Round($processo.TotalProcessorTime.TotalSeconds, 3)
            }
        }
        Responder @{
            ok        = $true
            quando_ms = [long]([DateTime]::UtcNow - [DateTime]"1970-01-01").TotalMilliseconds
            nucleos   = [Environment]::ProcessorCount
            # false = o Windows não informou a memória só do processo (privado_mb = total_mb).
            privado_conhecido = $soDeleConhecida
            processos = $lista
        }
    }
    "fechar" {
        $janela = JanelaDoOverlay
        if ($null -eq $janela) {
            Responder @{ ok = $false; erro = "janela do overlay nao encontrada" }
        } else {
            Responder @{ ok = [JanelaDoTeste]::PedirPraFechar($janela) }
        }
    }
}
