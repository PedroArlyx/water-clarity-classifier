# Arquitetura

## Visão geral

```mermaid
flowchart LR
    U[Usuário] --> UI[Upload clássico ou cozinha 3D]
    UI --> API[Flask /api/v1/predictions]
    API --> V[Validação segura da imagem]
    V --> F[Cor do centro da foto: 19 atributos]
    F --> M[modelo_agua.pkl carregado uma vez]
    M --> R[Classe, confiança e aviso]
    META[metadata.json] --> DASH[Dashboard experimental]
    CSV[resultados_avaliacao.csv] --> DASH
```

A factory `water_clarity.create_app` registra dois blueprints: `web`, responsável por páginas e artefatos fixos, e `api`, responsável pelo contrato JSON. O serviço de ML carrega o artefato confiável de forma preguiçosa e segura entre threads.

## Pipeline KDD

```mermaid
flowchart TD
    B[Imagens catalogadas em data/metadata/images.csv] --> C{Revisão aprovada?}
    C -- sim --> D[Conferência de hash]
    C -- não --> X[Excluída ou pendente]
    D --> F[Recorte de 50% do centro]
    F --> G[19 estatísticas de saturação, brilho e cromaticidade]
    G --> J[Mineração e interpretação]
```

## Treinamento e seleção

```mermaid
flowchart TD
    X[Imagens aprovadas] --> CV[StratifiedGroupKFold 5x por sessão/fonte, seed 42]
    CV --> P[StandardScaler → LogisticRegression balanceada]
    X --> LOSO[Cada sessão de fotos próprias fora uma vez]
    P --> OOF[Predições out-of-fold e matriz]
    P --> FINAL[Modelo treinado em 100%]
    FINAL --> ART[modelo_agua.pkl]
```

`train_model.py` treina apenas o `modelo_agua`. A avaliação nunca mede o modelo final já ajustado em todas as linhas.

## Fluxo de inferência

```mermaid
sequenceDiagram
    participant C as Cliente
    participant A as API Flask
    participant V as Validador Pillow
    participant F as Features RGB
    participant M as Modelo
    C->>A: multipart image
    A->>V: bytes, nome, MIME
    V-->>A: RGB sanitizado
    A->>F: imagem RGB
    F-->>A: 19 atributos do centro (+ histograma só para a interface)
    A->>M: predict + predict_proba
    M-->>A: classe e confiança
    A-->>C: JSON + aviso visual
```

## Agente 3D (Water Vision)

```mermaid
stateDiagram-v2
    [*] --> Ocioso
    Ocioso --> Solicitação: "Pegue um copo de água"
    Solicitação --> IndoAoCopo
    IndoAoCopo --> PegandoCopo
    PegandoCopo --> IndoÀPia
    IndoÀPia --> AbrindoTorneira
    AbrindoTorneira --> Enchendo
    Enchendo --> FechandoTorneira: nível ≥ 84%
    FechandoTorneira --> EstaçãoDeVisão
    EstaçãoDeVisão --> Captura: copo pousado no backlight
    Captura --> Classificação: PNG 512×512 → POST /api/v1/predictions
    Classificação --> Entregando: API retorna limpo
    Classificação --> Alerta: API retorna sujo
    Entregando --> Ocioso: nova solicitação
    Alerta --> Ocioso: nova solicitação
```

Módulos em `static/js/experience/` (ES modules nativos, carregados só após "Iniciar experiência"):

| Módulo | Responsabilidade |
|---|---|
| `main.js` | interface (intro, carregamento por etapas reais, HUD, assistente, análise, resultado, diálogo) e chamada à API |
| `world.js` | renderer, qualidade adaptativa (baixa/média/alta/auto por dispositivo e FPS), loop e captura |
| `director.js` | máquina de estados da tarefa; sincroniza robô, câmera, torneira e interface |
| `robot.js` | robô, IK analítico de dois segmentos, olhar, piscar, gestos e status |
| `kitchen.js` / `environment.js` / `textures.js` | cozinha em metros, IBL procedural e texturas geradas |
| `glass.js` / `stream.js` | copo, água com transmissão física, fluxo com gravidade, respingos e bolhas |
| `camera.js` | planos cinematográficos amortecidos e modo livre (órbita por mouse, toque e teclado) |
| `anim.js` / `audio.js` | tweens no relógio da cena (aceleráveis) e áudio sintetizado opcional |

**Separação entre aparência e decisão.** O seletor "Água da torneira" altera apenas o material renderizado. A câmera fixa da estação de visão (fundo com backlight, como em inspeção de líquidos) renderiza sempre 512×512 com pixel ratio 1 — independentemente da qualidade gráfica — e o PNG segue para o mesmo endpoint do upload. Nenhum rótulo é enviado. O modo "Minha foto" envia a fotografia do usuário no lugar da captura.

**Limitação observada do modelo atual.** O modelo olha a cor do centro da foto; ele ainda confunde água suja clara ou leitosa com limpa e depende de o copo estar no centro do enquadramento. A demonstração mostra o resultado real; para o cenário de alerta use o modo "Minha foto" com uma imagem claramente suja (ex.: `data/raw/proprias/sujo/sujo19.jpg`).

## Organização

```mermaid
flowchart TB
    APP[app.py / Gunicorn] --> FACTORY[water_clarity/__init__.py]
    FACTORY --> WEB[web.py]
    FACTORY --> API[api.py]
    API --> SERVICE[ml/service.py]
    SERVICE --> FEATURES[ml/features.py]
    TRAIN[train_model.py] --> FEATURES
    TRAIN --> MODEL[model/*]
    SCRIPTS[scripts/*] --> DATA[data/*]
    DATA --> TRAIN
```

## Decisões e compromissos

- O domínio continua sendo RGB tradicional; não foi introduzida CNN nem serviço externo.
- O schema de atributos e o hash do dataset ficam junto do modelo para detectar divergências.
- Three.js, addons, fontes e texturas são locais ou procedurais para funcionar com CSP estrita e sem CDN (ver `docs/ASSETS.md`).
- O modelo serializado com Joblib deve ser tratado como executável confiável; o serviço nunca aceita modelos enviados pelo cliente.
- A aplicação não mantém sessão, conta ou banco de dados. Uploads são processados em memória e não são persistidos.
