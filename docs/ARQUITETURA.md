# Arquitetura

## Visão geral

```mermaid
flowchart LR
    U[Usuário] --> UI[Upload clássico ou cozinha 3D]
    UI --> API[Flask /api/v1/predictions]
    API --> V[Validação segura da imagem]
    V --> F[Histograma RGB: 768 valores, formato do res.csv]
    F --> M[modelo_agua.pkl: formato da cor → 0 a 1 → Naive Bayes]
    M --> R[Classe, confiança e aviso]
    META[metadata.json] --> DASH[Dashboard experimental]
    CSV[resultados_avaliacao.csv] --> DASH
```

A factory `water_clarity.create_app` registra dois blueprints: `web`, responsável por páginas e artefatos fixos, e `api`, responsável pelo contrato JSON. O serviço de ML carrega o artefato confiável de forma preguiçosa e segura entre threads.

## Pipeline KDD

```mermaid
flowchart TD
    A[res.csv: 50 fotos, 768 atributos RGB] --> F[Limpeza: nulos e duplicatas]
    F --> T1[Cenário A: histograma bruto como proporção]
    F --> T2[Cenário B: formato da cor, 78 atributos sem brilho]
    T1 & T2 --> N[MinMaxScaler 0 a 1 dentro do pipeline]
    N --> J[Mineração e interpretação]
```

## Treinamento e seleção

```mermaid
flowchart TD
    X[res.csv] --> CV[RepeatedStratifiedKFold 5×10, seed 42]
    CV --> M16[8 algoritmos × 2 cenários = 16 modelos]
    M16 --> PROF[Teste nas 8 fotos do professor e 7 extras]
    PROF --> SEL[Maior F1-macro entre os que acertam ≥ 6/8 do professor]
    SEL --> OOF[Predições out-of-fold e matriz do vencedor]
    SEL --> FINAL[Vencedor treinado com as 50 fotos]
    FINAL --> ART[modelo_agua.pkl]
```

A avaliação nunca mede o modelo final já ajustado em todas as linhas, e as fotos de teste (`data/teste/`) nunca entram no treino.

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
    F-->>A: histograma de 768 valores (o pipeline aplica o formato da cor)
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

**Limitação observada do modelo atual.** O Naive Bayes com formato da cor separa água colorida de água transparente, mas confunde água suja pouco colorida (leitosa, quase branca, como `sujo2`) com limpa, e mostra probabilidades perto de 100%. O fundo ocupa a maior parte da foto. A demonstração mostra o resultado real; para o cenário de alerta use o modo "Minha foto" com `data/teste/professor/sujo/sujo19.jpg`.

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
