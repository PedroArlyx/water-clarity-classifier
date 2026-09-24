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

## Agente 3D

```mermaid
stateDiagram-v2
    [*] --> Ocioso
    Ocioso --> Movendo: iniciar
    Movendo --> Enchendo: chega à pia
    Enchendo --> Observando: copo cheio
    Observando --> Analisando: captura WebGL
    Analisando --> Entregando: API retorna limpo
    Analisando --> Alertando: API retorna sujo
    Entregando --> Ocioso
    Alertando --> Ocioso
```

O seletor de aparência nunca envia o rótulo esperado. Ele altera o material da água; a cena é renderizada para PNG e a API decide com o mesmo modelo usado no upload clássico. Também é possível enviar uma fotografia própria no fluxo do agente.

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
- Three.js está versionado localmente para funcionar com CSP estrita e sem CDN.
- O modelo serializado com Joblib deve ser tratado como executável confiável; o serviço nunca aceita modelos enviados pelo cliente.
- A aplicação não mantém sessão, conta ou banco de dados. Uploads são processados em memória e não são persistidos.
