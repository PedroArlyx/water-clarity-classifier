# Atendimento aos requisitos da atividade

| Requisito | Evidência no projeto | Resultado atual |
|---|---|---|
| Submeter o dataset a vários classificadores | — | não atendido: o projeto usa somente o `modelo_agua` (Naive Bayes) |
| Usar medidas adequadas | `train_model.py:_scoring` e `resultados_avaliacao.csv` | accuracy, balanced accuracy, precision/recall macro, F1 macro e ponderado com desvios |
| Identificar o melhor | — | não atendido: não há comparação entre algoritmos; F1 macro do `modelo_agua` 0,6991 |
| Treinar o modelo com todos os dados | `train_final_model`, chamado somente após a avaliação | `model/modelo_agua.pkl`, 65 amostras |
| Representar KDD | pipeline, dashboard e `docs/ARQUITETURA.md` | sete etapas documentadas |
| Receber foto na web Python | `templates/index.html`, `water_clarity/web.py` e Flask | upload clássico com e sem JavaScript |
| Extrair RGB | `water_clarity/ml/features.py` | 768 bins de histograma |
| Manter treino e inferência compatíveis | colunas no bundle e função compartilhada | versão `rgb-histogram-v1`, 768 atributos |
| Classificar limpo/sujo | `ModelService.predict_upload` | classe, confiança, RGB, modelo e aviso |
| Não afirmar potabilidade | constante `VISUAL_ONLY_WARNING` e todas as telas | aviso em respostas e interface |
| Agente | `static/js/demo3d.js` | percepção, ação, decisão e resposta representadas |
| Cozinha 3D | Three.js local e `templates/demonstration.html` | bancada, pia, torneira, copo, água, luz e robô |
| Integração verdadeira | `closeUpAndCapture` → `/api/v1/predictions` | PNG do canvas passa pelo modelo; nenhum rótulo é enviado |
| Cenários controlados | radios clean/dirty/random/upload | aparência muda; decisão continua sendo do modelo |
| Dashboard | `/experimento` | dados, modelos, métricas, gráficos, matriz, KDD e auditoria |
| Rastreabilidade | `model/metadata.json` | hash, data, seed, runtime, schema e resultados |
| Segurança | validação de imagem e headers em `water_clarity/` | limites, MIME, conteúdo, pixels, CSP e erros seguros |
| Testes | `tests/` e workflow de CI | unitários, treinamento, API, uploads e páginas |
| Automação | módulos em `scripts/` | etapas isoladas e `python -m scripts.pipeline` |

## Roteiro curto para apresentação

1. Abra `/experimento` e explique dados, KDD, F1 macro e a diferença entre avaliação e modelo final.
2. Em `/`, envie `data/raw/proprias/limpo/limpo2.jpg` e `data/raw/proprias/sujo/sujo19.jpg`, mostrando que o mesmo endpoint retorna resultados diferentes.
3. Em `/demonstracao`, execute os modos visuais e destaque no painel de rede o POST real para `/api/v1/predictions`.
4. Abra `/api/v1/model/metadata` para mostrar data, hash, schema e métricas do artefato servido.

## Ressalva para a banca

O projeto demonstra corretamente o processo de classificação visual. A base pequena não sustenta alegações de potabilidade, precisão operacional ou generalização para qualquer copo/ambiente. Essa restrição está exposta deliberadamente, pois omiti-la reduziria a qualidade científica do trabalho.
