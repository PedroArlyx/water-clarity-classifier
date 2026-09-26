# Assets visuais e de terceiros

Inventário de tudo o que a interface e a cena 3D usam, com origem, autor, licença e uso. Nenhum asset é carregado de CDN: tudo é servido localmente, compatível com a CSP estrita (`default-src 'self'`).

## Bibliotecas e fontes

| Asset | Origem | Autor | Licença | Uso |
|---|---|---|---|---|
| `static/vendor/three.module.js`, `three.core.js` (r186) | pacote npm `three@0.186` | three.js authors | MIT (`static/vendor/THREE-LICENSE.txt`) | renderização WebGL |
| `static/vendor/addons/RoundedBoxGeometry.js` | `three/examples/jsm/geometries` (r186) | three.js authors | MIT | cantos arredondados de portas, gavetas e peças |
| `static/vendor/addons/BufferGeometryUtils.js` | `three/examples/jsm/utils` (r186) | three.js authors | MIT | mescla da geometria estática (menos draw calls) |
| `static/fonts/inter-var-latin.woff2` | pacote npm `@fontsource-variable/inter` 5.x | The Inter Project Authors (Rasmus Andersson) | SIL OFL 1.1 (`static/fonts/OFL-Inter.txt`) | tipografia da interface |
| `static/fonts/jetbrains-mono-var-latin.woff2` | pacote npm `@fontsource-variable/jetbrains-mono` 5.x | JetBrains | SIL OFL 1.1 (`static/fonts/OFL-JetBrainsMono.txt`) | números, métricas e dados |

Os addons do three.js foram copiados sem alteração de lógica; apenas o import `'three'` foi reescrito para `'../three.module.js'`, pois a CSP bloqueia `importmap` inline.

## Modelos 3D

Todos os modelos são **procedurais e autorais deste projeto** (código em `static/js/experience/`). Não há arquivos GLB/GLTF externos.

| Elemento | Técnica | Arquivo |
|---|---|---|
| Cozinha (marcenaria, tampo com recorte da cuba, janela, prateleiras, ilha, pendentes) | caixas arredondadas e geometria de revolução em escala métrica | `kitchen.js` |
| Estação de visão (base, painel de backlight, câmera) | geometria procedural | `kitchen.js` |
| Torneira gooseneck e alavanca | `TubeGeometry` sobre curva Catmull-Rom | `kitchen.js` |
| Copo (parede e fundo com espessura) | `LatheGeometry` com perfis externo e interno | `glass.js` |
| Água (volume com menisco, reconstruída conforme o nível) | `LatheGeometry` + `MeshPhysicalMaterial` com transmissão | `glass.js` |
| Fluxo da torneira, respingos e ondulações | shaders próprios + partículas | `stream.js` |
| Robô assistente (base, tronco, cabeça, visor, braços com IK) | geometria de revolução, cápsulas e esferas | `robot.js` |

### Por que procedural e não GLB

- **Licença e rastreabilidade:** não há dependência de assets de terceiros com termos variados.
- **Tamanho:** a cena inteira cabe em ~140 KB de JavaScript próprio (sem minificação), sem downloads de modelos ou texturas.
- **Controle físico:** o copo e a água precisam de parede interna, fundo espesso e nível variável; o braço precisa de juntas reais para IK. Isso é mais simples de garantir com geometria gerada.

### Pipeline recomendado para substituir por modelos de Blender

1. Modelar em Blender em metros (1 unidade = 1 m), com origem do copo no centro da base e do robô no chão.
2. Exportar **glTF 2.0 binário (.glb)**, com "Apply Modifiers", normais e UVs; materiais Principled BSDF.
3. Otimizar para web: `npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt --texture-compress webp` (texturas até 1024 px).
4. Colocar em `static/models/`, vendorizar `GLTFLoader.js` (+ `meshopt_decoder`) em `static/vendor/addons/` e registrar o asset nesta tabela (origem, autor, licença).
5. Manter os nomes dos nós usados pelo código (juntas do braço, `outlet` da torneira) ou adaptar `robot.js`/`kitchen.js`.

## Texturas

Todas geradas em tempo de execução por `static/js/experience/textures.js` (canvas + ruído determinístico): tábuas de carvalho (cor e rugosidade), lâmina de carvalho, quartzo, reboco, aço escovado (rugosidade), sombra de contato e vista externa desfocada. Não há arquivos de imagem.

## Iluminação (IBL)

O mapa de ambiente é gerado a partir de uma cena procedural com painéis emissivos (janela, softboxes de teto, rebatimento quente) e pré-filtrado com `PMREMGenerator` (`environment.js`). Não há HDRI externo.

## Áudio

Sintetizado com WebAudio (`audio.js`): ruído filtrado para a água, oscilador filtrado para o servo e tons curtos para captura/resultado. Não há arquivos de áudio. Desligado por padrão; controle 🔊/🔇 na barra da cena.

## Imagens do dataset

Catalogadas com URL, autor e licença em `data/metadata/images.csv` (ver `docs/DADOS.md`). Não são usadas como assets visuais da interface.
