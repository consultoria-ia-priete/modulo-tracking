# ✅ Checklist de conclusão — Tracking Stack

O módulo só está **pronto** quando todos os itens passam.

## Pré-requisitos
- [ ] Conta Cloudflare ativa (free serve)
- [ ] Conta GitHub + `gh auth status` autenticado
- [ ] Node/npm instalado (`npx wrangler@latest --version` responde)

## Instalação (skill `deploy-stack`)
- [ ] Login Cloudflare feito
- [ ] Banco D1 criado + migrations aplicadas (0001–0015, 0005 ausente de propósito)
- [ ] DASH_KEY + slugs de webhook gerados e salvos em gerenciador de senhas
- [ ] Repo no GitHub criado e `main` enviado
- [ ] Projeto Cloudflare Pages criado, conectado ao repo, branch `main`, output `/`
- [ ] Bind do D1 como `DB` + variáveis (META_PIXEL_ID, META_ACCESS_TOKEN, DASH_KEY)
- [ ] Redeploy verde — `https://SEU-PROJETO.pages.dev` no ar

## Validação (teste de fogo)
- [ ] `/dash/?key=DASH_KEY` abre o dashboard
- [ ] 1 página adicionada (`add-page`), visitada
- [ ] `verify-tracking`: 6 checkpoints PASS (cookie → sessão → checkout → webhook → enrich → plataforma)

## Segurança
- [ ] `.gitignore` cobre `wrangler.toml`, `.dev.vars`, `.env*`, `*.bak`
- [ ] `scripts/scan-secrets.sh .` retornou **0 hits**

## Aula
- [ ] Aula gravada: da cópia do template até os 6 checkpoints verdes
