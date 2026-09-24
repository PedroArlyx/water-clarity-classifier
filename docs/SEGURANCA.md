# Revisão de segurança

Escopo: backend Python/Flask e frontend JavaScript. A revisão considera uma aplicação pública e sem autenticação. Estado: não foram identificados achados críticos ou altos após as correções.

## S-01 — validação insuficiente de upload — alto — corrigido

**Evidência anterior:** a versão inicial dependia de nome/extensão e entregava bytes diretamente ao Pillow.

**Correção:** `water_clarity/ml/features.py` limita a leitura, cruza extensão, MIME declarado e formato detectado, chama `verify`, limita lado e total de pixels, transforma avisos de decompression bomb em erro e só então decodifica RGB. A requisição também possui limite global e de partes em `water_clarity/__init__.py`.

## S-02 — modo debug em execução — alto — corrigido

**Evidência anterior:** a entrada original executava Flask com debug ativo.

**Correção:** `app.py` e `scripts/run.py` exigem `FLASK_DEBUG=1`; produção usa Gunicorn no `render.yaml`. Exceções não previstas são registradas no servidor, mas o cliente recebe mensagem genérica.

## S-03 — proteção do navegador e Host header — médio — corrigido

`water_clarity/__init__.py` aplica CSP sem scripts inline, bloqueia framing e MIME sniffing, restringe referrer e permissões. Em produção, `TRUSTED_HOSTS` ativa a validação de host; o Blueprint do Render aceita apenas `.onrender.com` e endereços locais por padrão.

## S-04 — desserialização Joblib — médio — risco residual aceito

**Evidência:** `water_clarity/ml/service.py` carrega `model/classifier.joblib` com Joblib. Artefatos Pickle/Joblib podem executar código durante a carga.

**Mitigação:** o caminho é fixo, não deriva da requisição e nenhum endpoint aceita modelo. O artefato deve vir somente deste pipeline/repositório e o acesso de escrita em produção deve ser restrito. Não carregue modelos baixados de fontes não confiáveis. Uma evolução possível é assinar o artefato e validar sua soma antes da carga.

## S-05 — negação de serviço computacional — baixo — risco residual

Os limites atuais reduzem imagens maliciosas, porém cada inferência ainda consome CPU e memória. Para exposição pública, use TLS e rate limiting no proxy/plataforma, monitore latência/erros e reduza `MAX_UPLOAD_BYTES` se o caso real permitir.

## Observações

- Uploads são processados em memória e não são persistidos, reduzindo traversal e acúmulo de arquivos.
- Rotas de artefatos usam caminhos constantes, não nomes fornecidos pelo cliente.
- Não há sessão autenticada, mudança de estado ou cookie necessário; CSRF não é relevante ao endpoint de inferência atual.
- Dependências estão fixadas. Atualizações devem passar por testes e revisão de avisos de segurança.
