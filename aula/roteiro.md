# 🎬 Aula — Tracking Stack (rastreamento na sua conta)

> Aula CURTA (alvo 10–14 min). Alex grava a tela instalando do zero numa conta limpa.
> A skill que faz o trabalho é a `deploy-stack` (12 passos). Aqui é o roteiro falado.

**Pré-produção:** ter conta Cloudflare (free serve), conta GitHub com `gh` logado
(`gh auth status`), Node instalado. Abrir abas: Cloudflare dashboard, GitHub.

---

## Cena 0 — Gancho (0:00–0:40)
"Todo mundo paga Stape ou monta GTM server-side e ainda perde conversão pro iOS e pros
adblocks. Hoje você vai ter o SEU rastreamento, na SUA conta Cloudflare, de graça — e quem
instala é a IA. Bora."

## Cena 1 — Gerar a cópia + baixar (0:40–2:00)
- `Use this template` → cria o repo do aluno.
- `git clone` + `cd`.
- "Esse rastreamento é seu. Não tem backend compartilhado, ninguém vê seus dados."

## Cena 2 — `instalar` (2:00–10:00) — o miolo
Abrir `claude`, digitar **`instalar`**. Narrar enquanto a `deploy-stack` conduz:
1. **Login Cloudflare** (`wrangler login`) — "autoriza no navegador."
2. **Nome do projeto** — "vira o seu domínio, o banco e o repo de uma vez."
3. **Banco D1 criado** — "é onde cada lead e cada venda fica guardado com a origem."
4. **Migrations aplicadas** — "monta as tabelas."
5. **Segredos gerados** (DASH_KEY + slugs de webhook) — "guarda no gerenciador de senhas."
6. **Repo no GitHub + push** — "daqui pra frente, todo deploy é um `git push`."
7. **Cloudflare Pages** (manual no painel) — conectar o repo, branch `main`.
8. **Bind do D1** (`DB`) + **variáveis de ambiente** (Pixel, token CAPI, DASH_KEY).
9. **Redeploy** — esperar ficar verde.
- Mostrar o checklist da skill sendo cumprido.

## Cena 3 — Prova de que funcionou (10:00–12:30)
- Abrir `https://SEU-PROJETO.pages.dev/dash/?key=DASH_KEY` — o dashboard abre.
- "Mas o teste de verdade é a próxima skill." Adicionar uma página: dizer **"adicionar uma landing"**
  (skill `add-page`), visitar a página, e rodar **"verificar tracking"** (`verify-tracking`):
  os 6 checkpoints (cookie → sessão no D1 → checkout → webhook → enrich → plataforma).

## Cena 4 — Fechamento
- "Rastreamento próprio, server-side, na sua conta, instalado pela IA."
- Próximo passo do método / CTA rotativo (Aula|IA|ConsultorIA).

---

### Erros que podem aparecer ao vivo
- `wrangler login` não volta → o aluno não clicou "Allow" no navegador.
- `/dash` dá 401 → DASH_KEY colada com espaço/quebra de linha.
- Página em branco → "Build output directory" tem que ser `/`.
- Tabela `sessions` vazia → bind do D1 não foi feito (variável tem que ser `DB`).
> Todos já estão documentados em `.claude/skills/deploy-stack/SKILL.md` (Troubleshooting).
