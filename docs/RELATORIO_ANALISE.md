# Relatório técnico da evolução

> **Histórico.** Este relatório descreve o experimento anterior (comparação de sete algoritmos, SVM vencedor, 794 atributos). Esse modelo foi removido; a aplicação usa somente `model/modelo_agua.pkl` (Naive Bayes). Métricas atuais em `model/metadata.json` e no README.

## Resumo executivo

O projeto original cumpria o fluxo básico, porém concentrava aplicação, processamento e inferência, validava upload principalmente pela extensão, usava um artefato sem contexto, possuía apenas 52 linhas e selecionava por F1 ponderado. A versão atual preserva o classificador tradicional baseado em RGB e o transforma em um fluxo rastreável de dados, experimento, modelo e aplicação.

O resultado reproduzido em 24/09/2026 avaliou 61 amostras e sete algoritmos. O SVM obteve o maior F1 macro médio, 0,7642, seguido por Logistic Regression, 0,7380. O modelo publicado foi então ajustado novamente em todas as 61 amostras. Essas métricas medem apenas a validação cruzada; não são métricas do ajuste final.

## Diagnóstico inicial e tratamento

| Achado | Risco | Tratamento |
|---|---|---|
| dataset pequeno e 71% da classe majoritária | estimativa instável e viés | ampliação auditável para 61 linhas e F1 macro como critério |
| 50 linhas sem imagens/origem | impede auditoria e CV agrupada | backup preservado e limitação explícita em metadados |
| histogramas dependentes da resolução | inconsistência entre imagens | normalização por canal em treino e inferência |
| artefato `model.pkl` sem schema/metadados | incompatibilidade silenciosa | bundle versionado, schema JSON, hash e versões |
| lógica monolítica | teste e manutenção difíceis | factory Flask, blueprints e serviço de ML |
| extensão como principal validação | arquivos falsos/corrompidos e DoS | validação de extensão, MIME, assinatura, dimensões e pixels |
| debug ligado no código original | exposição em produção | opt-in por variável e Gunicorn no deploy |
| ausência de testes/CI | regressões | suíte Pytest, Ruff e GitHub Actions |
| frontend acadêmico simples | pouca clareza na demonstração | upload acessível, dashboard e agente Three.js |

## Dados

Foram pesquisadas fontes reutilizáveis e incorporadas apenas imagens cuja licença e autoria puderam ser catalogadas. O processo aprovou nove imagens do Wikimedia Commons, além de catalogar os dois exemplos locais. Quatro candidatas foram rejeitadas visualmente por domínio inadequado, ambiguidade ou redundância. Não houve duplicata exata nem par com distância dHash até 8 entre as imagens aprovadas.

O ganho de 50 para 61 amostras é real, mas não é “significativo” em escala científica. A prioridade foi não preencher a base com imagens incertas ou incompatíveis. A classe minoritária passou de 13 para 23 exemplos no backup-base, mas o conjunto ainda é insuficiente para afirmar generalização.

## Representação RGB

O baseline exigido permanece explícito: 256 bins normalizados para cada um dos canais R, G e B, totalizando 768. A versão `rgb-histogram-stats-v2` adiciona, derivados desses mesmos histogramas:

- média, desvio padrão, percentis 10/25/50/75/90 por canal;
- luminosidade ponderada;
- diferenças médias R–G, R–B e G–B;
- amplitude entre médias dos canais.

São 794 atributos no total. Como os valores adicionais são derivados dos histogramas, as 50 linhas legadas continuam utilizáveis sem inventar os pixels originais.

## Avaliação real

Método: `StratifiedKFold` com cinco folds, embaralhamento e semente 42. A métrica principal definida antes da comparação é F1 macro, apropriada para dar peso igual às duas classes. Os modelos sensíveis à escala usam `StandardScaler` dentro do pipeline; modelos de árvore não.

| Modelo | Accuracy | Balanced accuracy | F1 macro | F1 ponderado |
|---|---:|---:|---:|---:|
| SVM | 0,7705 | 0,7846 | 0,7642 | 0,7720 |
| Logistic Regression | 0,7538 | 0,7396 | 0,7380 | 0,7548 |
| KNN | 0,7705 | 0,7282 | 0,7299 | 0,7574 |
| Random Forest | 0,6872 | 0,6589 | 0,6635 | 0,6859 |
| Decision Tree | 0,6564 | 0,6321 | 0,6321 | 0,6558 |
| Gaussian Naive Bayes | 0,6744 | 0,6264 | 0,6076 | 0,6429 |
| Gradient Boosting | 0,6423 | 0,6079 | 0,6040 | 0,6307 |

As predições out-of-fold do vencedor produziram matriz `[[19,4],[10,28]]`. Para `limpo`, precisão 0,6552, recall 0,8261 e F1 0,7308; para `sujo`, precisão 0,8750, recall 0,7368 e F1 0,8000. O desvio de 0,1608 no F1 macro confirma alta incerteza.

## KDD implementado

1. **Seleção:** base legada e catálogo de imagens licenciadas.
2. **Pré-processamento:** validação de schema, nulos, duplicatas, rótulos e hashes.
3. **Transformação:** normalização e engenharia de atributos RGB v2.
4. **Mineração:** comparação dos sete algoritmos.
5. **Interpretação:** métricas macro/ponderadas, desvios, relatório e matriz.
6. **Treinamento final:** clone do vencedor ajustado em 100% do conjunto.
7. **Uso:** bundle carregado pela API e consumido pelos dois frontends.

## Agente e demonstração 3D

O agente possui responsabilidades distintas do classificador:

- **percepção inicial:** recebe o pedido e o modo visual;
- **ação:** move-se à pia, posiciona e enche o copo;
- **percepção do ambiente:** captura o canvas WebGL como PNG;
- **processamento:** envia a captura ao endpoint real;
- **decisão:** interpreta a classe devolvida pelo SVM;
- **ação resultante:** entrega quando a aparência é `limpo` ou alerta quando é `sujo`.

Os botões de cenário mudam apenas material, transparência e cor. O backend não recebe o rótulo selecionado. O modo de upload próprio passa a fotografia do usuário pela mesma API.

No teste em Firefox/Playwright, a cena limpa retornou `limpo` e o upload de `sujo19.jpg` retornou `sujo`, acionando a interrupção da entrega. A cena marrom renderizada, embora enviada corretamente e visualmente diferente, ainda retornou `limpo`. O sistema conserva esse erro real em vez de adulterar a resposta; ele reforça a necessidade de ampliar o dataset com renderizações e variações próximas do domínio da demonstração.

## Conclusão

O fluxo acadêmico solicitado está implementado de ponta a ponta e auditável. O principal risco restante não é arquitetural, mas científico: quantidade, qualidade e procedência parcial dos dados. O próximo avanço responsável é uma coleta planejada por sessões, com arquivos brutos, `group_id`, divisão agrupada e um conjunto de teste externo nunca usado na seleção.
