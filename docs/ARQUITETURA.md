# Arquitetura

## Visão geral

```mermaid
flowchart LR
    U[Usuário] --> UI[Upload clássico ou cozinha 3D]
    UI --> API[Flask /api/v1/predictions]
    API --> V[Validação segura da imagem]
    V --> F[Extração RGB v2]
    F --> M[Pipeline SVM carregado uma vez]
    M --> R[Classe, confiança e aviso]
    META[metadata.json] --> DASH[Dashboard experimental]
    CSV[resultados_avaliacao.csv] --> DASH
```

A factory `water_clarity.create_app` registra dois blueprints: `web`, responsável por páginas e artefatos fixos, e `api`, responsável pelo contrato JSON. O serviço de ML carrega o artefato confiável de forma preguiçosa e segura entre threads.

## Pipeline KDD

```mermaid
flowchart TD
    A[50 linhas legadas em res.csv.bak] --> D[Preparação]
    B[Imagens catalogadas] --> C{Revisão aprovada?}
    C -- sim --> D
    C -- não --> X[Excluída ou pendente]
    D --> E[res.csv + hash]
    E --> F[Limpeza e validação]
    F --> G[768 histogramas normalizados]
    G --> H[26 estatísticas RGB/brilho]
    H --> I[794 atributos]
    I --> J[Mineração e interpretação]
```

## Treinamento e seleção

```mermaid
flowchart TD
    X[Dataset preparado] --> CV[StratifiedKFold 5x, seed 42]
    CV --> K[KNN]
    CV --> DT[Decision Tree]
    CV --> RF[Random Forest]
    CV --> NB[Naive Bayes]
    CV --> SVM[SVM]
    CV --> LR[Logistic Regression]
    CV --> GB[Gradient Boosting]
    K & DT & RF & NB & SVM & LR & GB --> SEL[Ordenação por F1 macro]
    SEL --> OOF[Predições out-of-fold e matriz]
    SEL --> FINAL[Clone do vencedor treinado em 100%]
    FINAL --> ART[classifier.joblib]
```

Escalonamento pertence ao `Pipeline` somente para modelos sensíveis à escala. Árvores recebem atributos sem `StandardScaler`. A avaliação nunca mede o modelo final já ajustado em todas as linhas.

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
    F-->>A: vetor v2 com 794 valores
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

**Limitação observada do modelo atual.** Para imagens distantes do conjunto de treino, o SVM RBF devolve praticamente a mesma saída (a similaridade de kernel com todos os vetores de suporte é ≈ 0, restando o intercepto: ~72% "limpo"). Isso ocorre com as capturas 3D (limpa e turva) e também com fotos reais fora do treino. A demonstração mostra esse resultado honestamente; para o cenário de alerta use o modo "Minha foto" com uma imagem que o modelo reconhece como suja (ex.: `sujo19.jpg`).

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
    SCRIPTS[scripts/*] --> DATA[data/* e res.csv]
    DATA --> TRAIN
```

## Decisões e compromissos

- O domínio continua sendo RGB tradicional; não foi introduzida CNN nem serviço externo.
- O schema de atributos e o hash do dataset ficam junto do modelo para detectar divergências.
- Three.js, addons, fontes e texturas são locais ou procedurais para funcionar com CSP estrita e sem CDN (ver `docs/ASSETS.md`).
- O modelo serializado com Joblib deve ser tratado como executável confiável; o serviço nunca aceita modelos enviados pelo cliente.
- A aplicação não mantém sessão, conta ou banco de dados. Uploads são processados em memória e não são persistidos.
