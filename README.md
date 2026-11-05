# Casa em Dia *(nome provisório)*

PWA para gestão de estoque doméstico e lista de compras inteligente.
Princípio central: **o aplicativo trabalha para a família, não a família para o aplicativo.**

**Stack:** React 19 + Vite + TypeScript, Tailwind CSS v4, Lucide, vite-plugin-pwa ·
Supabase (Postgres, Auth, Realtime, Storage, Edge Functions) · Vercel.

---

## Status das fases

| Fase | Escopo | Status |
| --- | --- | --- |
| 1 — Fundação | Projeto, PWA, Auth, família, convites, papéis, RLS | ✅ Implementada |
| 2 — Produtos e estoque | Categorias, marcas, produtos, ambientes, movimentações | ⏳ Próxima |
| 3 — Lista inteligente | Geração automática, manual, tempo real, estimativas | — |
| 4 — Comprovantes | QR Code NFC-e → XML → foto/IA, revisão, confirmação transacional | — |
| 5 — Inventário por fotos | Captura, reconhecimento multimodal, revisão, ajuste | — |
| 6 — Financeiro | Histórico de preços, gastos, indicadores | — |

### O que a Fase 1 entrega (funcional, não só tela)

- **Autenticação**: cadastro (com nome), login, recuperação e redefinição de senha.
- **Família**: criação no primeiro acesso; troca entre famílias se o usuário tiver mais de uma.
- **Convites por link**: válidos por 7 dias, de uso único, opcionalmente restritos a um e-mail,
  com papel definido (admin / editor / leitor). Admin pode cancelar convites pendentes.
- **Membros**: alteração de papel, remoção, saída da família; o banco garante que
  sempre reste ao menos um administrador. Lista de membros atualiza em **tempo real**.
- **Segurança**: RLS em todas as tabelas; escrita sensível somente via funções
  `SECURITY DEFINER` que validam `auth.uid()` e papel; `household_id` imutável;
  auditoria (`audit_log`) das ações de família/convites/membros; redirecionamento pós-login
  protegido contra open redirect.
- **PWA**: manifest, ícones, service worker (cacheia apenas o app shell, nunca dados),
  aviso de nova versão, instalável no Android/iOS.
- **UI**: pt-BR, mobile-first (tab bar no celular, sidebar no desktop), tema claro
  por padrão + escuro/sistema.

Telas de Estoque, Lista e Compras aparecem como "Chega na Fase X": nada nelas é simulado.

---

## Arquitetura

```
src/
  app/                 # Rotas, guards (auth/família), tela de setup
  components/
    ui/                # Button, Field, Card, Alert, EmptyState, Badge, Avatar, Spinner
    layout/            # AppShell (sidebar + tab bar), AuthLayout, Logo, UpdatePrompt
  features/
    auth/              # AuthProvider, páginas, redirect seguro
    household/         # API (RPCs), HouseholdProvider, onboarding, convite, papéis
    settings/          # Família, membros/convites, aparência, conta
    dashboard/
    placeholder/       # Telas "Chega na Fase X"
  hooks/               # useTheme
  integrations/supabase/  # client tipado + database.types.ts
  lib/                 # env, formatação BRL/datas, mensagens de erro pt-BR
supabase/
  migrations/          # SQL versionado (fonte da verdade do banco)
  tests/               # Testes SQL de RLS/regras + stub mínimo do Supabase
  functions/           # Edge Functions (a partir da Fase 4: IA, NFC-e)
scripts/test-db.sh     # Sobe Postgres temporário e roda os testes SQL
```

**Regra de ouro:** o front-end só esconde/mostra ações. Toda autorização está no banco
(RLS + funções). Operações críticas das próximas fases (confirmar compra, mover estoque)
serão funções PostgreSQL transacionais e idempotentes.

---

## Rodando localmente

```bash
npm install
```

```bash
cp .env.example .env.local   # preencha com URL e anon key do Supabase
```

```bash
npm run dev
```

Sem `.env.local`, o app abre uma tela explicando o que configurar.

### Testes

```bash
npm test          # Vitest: formatação, erros, redirect seguro, permissões
```

```bash
npm run test:db   # Postgres local: migrations + RLS, isolamento entre famílias, convites, papéis
```

`test:db` precisa dos binários do PostgreSQL (`initdb`, `pg_ctl`, `psql`) instalados.

---

## Configuração necessária (você precisa fazer)

### 1. Supabase
1. Crie um projeto em <https://supabase.com> (plano gratuito).
2. Aplique a migration: **SQL Editor** → cole `supabase/migrations/20261105000100_foundation.sql` → Run.
   (ou com a CLI: `npx supabase link --project-ref <ref>` e `npx supabase db push`).
3. **Authentication → URL Configuration**:
   - *Site URL*: a URL da Vercel (ex.: `https://seu-app.vercel.app`).
   - *Redirect URLs*: `http://localhost:5173/**` e `https://seu-app.vercel.app/**`.
4. **Database → Publications**: confirme que `supabase_realtime` existe (a migration
   adiciona `household_members` a ela automaticamente).
5. Copie *Project URL* e a chave *anon/publishable* para `.env.local`.

### 2. Vercel
1. Importe o repositório; o preset Vite é detectado (`vercel.json` já cuida do
   fallback de SPA e cabeçalhos de segurança).
2. Em *Environment Variables*, defina `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

### 3. IA (somente a partir da Fase 4)
Chave do Gemini como secret das Edge Functions (`npx supabase secrets set GEMINI_API_KEY=...`).
Nunca em variáveis `VITE_*`.
