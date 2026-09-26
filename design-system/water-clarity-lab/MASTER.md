# Water Clarity Lab — Design System

Fonte única de verdade: tokens em `static/style.css` (bloco `:root`). Este documento explica **quando** usar cada token. Se uma página precisar de algo que não existe aqui, crie o token primeiro — não use valores soltos.

## Direção de arte

**Cozinha contemporânea inteligente.** Neutros quentes (papel, pedra, grafite, carvalho, vidro). A tecnologia aparece de forma discreta. Cor saturada só comunica **estado** (limpa/suja, ativo) ou **dado** (canais RGB, séries de gráfico). Sem neon, sem gradientes decorativos, sem azul em tudo.

## Temas

| Contexto | Tema | Onde |
|---|---|---|
| Leitura acadêmica, upload, dashboard | claro (`:root`) | `/`, `/experimento`, diálogo "Ver análise" |
| Experiência 3D | escuro (`.page-demo`) — mesmos papéis, outros valores | `/demonstracao` |

Os componentes usam **papéis** (`--surface`, `--text-2`, `--border`…), nunca hex direto, para funcionar nos dois temas.

## Tipografia

| Token | Valor | Uso |
|---|---|---|
| `--font-sans` | Inter (variável, local) | todo o texto |
| `--font-mono` | JetBrains Mono (variável, local) | números, métricas, RGB, nomes de estimadores |
| `--text-xs` … `--text-2xl` | 12 → 28 px | rótulos → títulos de seção |
| `--text-3xl` | 32 → 44 px fluido | título do resultado |
| `--text-display` | 40 → 68 px fluido | um título por página |

Regras: títulos com peso 600–620 e `letter-spacing` negativo; rótulos pequenos em caixa alta usam `.kicker`; números em colunas sempre `tabular-nums`.

## Cor

| Papel | Claro | Escuro | Uso |
|---|---|---|---|
| `--bg` | `#f6f5f2` | `#0e0f10` | fundo da página |
| `--surface` | `#ffffff` | `#17181a` | cartões |
| `--text` / `--text-2` / `--text-3` | `#1a1918` / `#5b5750` / `#7b766e` | `#f3f2ef` / `#bdbab4` / `#8f8b85` | primário / secundário / terciário |
| `--accent` | `#2a78d6` | `#6ea6ef` | foco, etapa ativa, vencedor no gráfico |
| `--clean` (+ `-soft`, `-line`) | `#1f7a57` | `#5fc896` | classificação **limpa** |
| `--dirty` (+ `-soft`, `-line`) | `#9a5b00` | `#f0b25a` | classificação **suja** — âmbar, nunca a tela inteira vermelha |
| `--ch-r` / `--ch-g` / `--ch-b` | `#ef7a55` / `#1a6b40` / `#3b74d6` | `#df6d4a` / `#1d7043` / `#4f86e8` | canais RGB em barras e histogramas |

Os canais RGB foram validados para daltonismo (ΔE CVD ≥ 8 entre pares adjacentes, claro e escuro) com o validador da skill de dataviz. O vermelho tem contraste < 3:1 no fundo claro; por isso **rótulos R/G/B e valores numéricos são sempre visíveis**.

**Estado nunca depende só de cor:** o selo `.verdict` e o `.result-card` combinam ícone (✓ / !), palavra ("Limpa"/"Suja") e cor.

## Espaço, raio, sombra, movimento

- Espaço: `--space-1..10` = 4, 8, 12, 16, 20, 24, 32, 40, 56, 80 px.
- Raio: `--radius-xs` 6 (células), `-sm` 10 (botões, campos), `-md` 14 (blocos internos), `-lg` 20 (cartões, painéis), `-pill`.
- Sombra: `--shadow-1` (cartões em repouso), `-2` (elevado), `-3` (diálogo).
- Movimento: `--dur-1` 120 ms (press), `-2` 200 ms (hover), `-3` 360 ms (entrada de painel), `-4` 700 ms (barras de dado). Curva padrão `--ease-out`. `prefers-reduced-motion` zera animações CSS; na cena 3D, a câmera corta em vez de deslizar e a "respiração" é desligada.

## Componentes

| Classe | Descrição |
|---|---|
| `.btn` + `--primary` / `--secondary` / `--light` / `--ghost-dark`, tamanhos `--sm` / `--lg`, `--block` | botões; alvo mínimo 36–52 px |
| `.icon-btn` | botão quadrado 40 px com ícone (som); usa `aria-pressed` |
| `.segmented` (+ `--dark`, `--wrap`) | grupo de rádio (`role="radiogroup"`, setas do teclado) |
| `.select` (+ `--dark`) | select nativo estilizado |
| `.card`, `.glass` | superfície clara / painel translúcido sobre o 3D (usar com moderação) |
| `.kicker` | rótulo pequeno em caixa alta |
| `.notice` | aviso informativo (ícone âmbar) |
| `.verdict--clean` / `--dirty` | selo de classificação com ícone |
| `.facts` | lista rótulo → valor (valor em mono) |
| `.rgb-meter` | barras R/G/B com valor e amostra da cor média |
| `.histogram` | histograma RGB em SVG (linhas 1,6 px + área 10%) |
| `.prob` | probabilidades por classe (classe prevista em destaque) |
| `.flow` | pipeline horizontal (imagem → … → resultado) |
| `.kpi` (+ `--hero`) | números-resumo; um único `--hero` por página |
| `.chart` | barras horizontais SVG: ≤ 18 px, ponta arredondada 4 px, grade 1 px recessiva, haste de desvio-padrão |
| `.cm` | matriz de confusão em rampa sequencial azul (5 níveis) |
| `.data-table` | tabela de métricas (alternativa acessível aos gráficos) |

## Experiência 3D — camadas de interface

| Camada | Posição (desktop) | Mobile |
|---|---|---|
| Barra (câmera, qualidade, som) | topo direito | largura total |
| HUD (estado, modelo, pipeline) | direita, abaixo da barra | linha compacta; pipeline oculto (o painel de análise mostra as etapas) |
| Assistente (pedido e aparência simulada) | base esquerda | base, largura total |
| Análise / Resultado | base direita | base, largura total, rolável |

Regra de ouro: **o copo e o robô ficam no terço central/superior** de cada plano de câmera; painéis ocupam as bordas inferiores.

## Dados exibidos

Todo número exibido como resultado vem da API ou dos artefatos (`metadata.json`, `resultados_avaliacao.csv`). Se um valor não existir, a interface mostra "—" ou "não disponível"; nunca um valor ilustrativo. Nome do algoritmo nunca é fixo no frontend.
