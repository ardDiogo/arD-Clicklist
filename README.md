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
| 2 — Produtos e estoque | Categorias, marcas, produtos, ambientes, movimentações | ✅ Implementada |
| 3 — Lista inteligente | Geração automática, manual, tempo real, estimativas | ✅ Implementada |
| 4 — Comprovantes | QR Code NFC-e → XML → foto/IA, revisão, confirmação transacional | ✅ Implementada |
| 5 — Inventário por fotos | Captura, reconhecimento multimodal, revisão, ajuste | ⏳ Próxima |
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

### O que a Fase 2 entrega

- **Catálogo**: 9 categorias padrão (globais), marcas criadas automaticamente pelo nome
  (sem duplicar por maiúsculas), produtos com marca, apresentação, embalagem, unidade e
  código de barras (único por família).
- **Ambientes**: 8 ambientes padrão criados para cada família (inclusive as já existentes);
  a família pode adicionar, renomear e remover em *Ajustes*.
- **Estoque** (em embalagens): ideal, atual, **comprar = máx(0, ideal − atual)**, status
  (em dia / repor / sem estoque), agrupado por ambiente ou categoria, busca sem acento,
  filtros, ações rápidas −1/+1 com *Desfazer*, contagem, "acabou", transferência entre
  ambientes, histórico e remoção (soft delete, histórico preservado). Tempo real entre membros.
- **Integridade**: `current_qty` só muda por `stock_movements`, gravada em função transacional
  que trava a linha (`SELECT … FOR UPDATE`); sem estoque negativo; movimentações imutáveis
  (bloqueadas até para o dono das tabelas); idempotência por chave; referências validadas
  para a mesma família; leitores (viewer) só leem.
- **Painel**: números reais (produtos, para repor, em falta) e lista do que precisa repor.

### O que a Fase 3 entrega

- **Lista automática**: uma lista aberta por família, criada e preenchida sozinha a partir do
  estoque (comprar = ideal − atual). Gerar de novo **não duplica** e **não sobrescreve** itens
  manuais, quantidades ajustadas, itens marcados ou removidos pelo usuário. Itens automáticos
  que deixam de faltar saem da lista.
- **Aviso inteligente**: "N produtos estão faltando e não estão na lista — Incluir".
- **Inclusão manual**: busca no estoque ou item avulso; se já estiver na lista, soma a quantidade.
  Origem registrada (`stock` / `manual`).
- **Modo mercado**: agrupada por categoria, marcar com um toque, "No carrinho" separado,
  −/+ de quantidade, preço unitário e observação por item, total estimado (claramente
  identificado como estimativa, com contagem de itens sem preço). Tempo real entre membros.
- **Finalizar compra**: opcionalmente lança os itens marcados no estoque como compra, após
  confirmação explícita ("Confirmo que recebi…"); idempotente (finalizar duas vezes não duplica).
  Uma nova lista é aberta automaticamente.
- **Histórico**: listas anteriores com itens comprados/não comprados e total estimado.

### O que a Fase 4 entrega

- **Três formas de importar**: QR Code da NFC-e (câmera, foto do QR ou link colado), arquivo
  XML (NF-e/NFC-e) e foto do cupom lida por IA (Gemini, via Edge Function).
- **Leitura ≠ estoque**: toda importação vira um **rascunho**. Nada muda no estoque até a
  confirmação explícita ("Confirmo que recebi…").
- **Revisão**: associação automática (EAN aprendido → código de barras do produto →
  descrição aprendida por estabelecimento), sugestões por semelhança para cupons abreviados,
  criar produto na hora, ignorar itens que não são de estoque (sacola), desmarcar o que não
  chegou, ajustar a quantidade que entra (itens por peso entram como 1 embalagem), aviso se a
  soma dos itens não bate com o total e aviso de possível duplicidade com lista finalizada.
- **Confirmação transacional e idempotente**: entradas de estoque, custo por embalagem,
  aprendizado de apelidos e marcação automática da lista aberta — tudo ou nada; confirmar de
  novo não duplica. O mesmo comprovante (chave de acesso ou hash do arquivo) não vira duas compras.
- **Original preservado**: arquivo no Storage privado (pasta da família, RLS) + resultado extraído
  (`raw_extraction`).
- **Histórico de preços**: último, média, menor, maior e variação por produto (só compras
  confirmadas, nunca sobrescritas). A lista de compras passa a estimar com o último preço pago.

**Limitações conhecidas**: o leitor da página da SEFAZ cobre o layout padrão (tabela `tabResult`,
usado por SP, RS/SVRS e vários estados) e foi testado com um exemplo desse layout, não contra os
portais reais. Se o seu estado usar outro layout, o app avisa e sugere foto ou XML.

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
    inventory/         # Estoque: domínio (regras puras), API, hooks realtime, telas
    shopping-list/     # Lista de compras: domínio, API, hooks realtime, telas, histórico
    receipts/          # Comprovantes: parsers fiscais (QR/HTML/XML), importação, revisão, preços
    settings/          # Família, membros/convites, ambientes, aparência, conta
    dashboard/
    placeholder/       # Telas "Chega na Fase X"
  hooks/               # useTheme
  integrations/supabase/  # client tipado + database.types.ts
  lib/                 # env, formatação BRL/datas, mensagens de erro pt-BR
supabase/
  migrations/          # SQL versionado (fonte da verdade do banco)
  tests/               # Testes SQL de RLS/regras + stub mínimo do Supabase
  functions/           # Edge Functions: nfce-proxy (SEFAZ) e receipt-ai (Gemini)
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
npm test          # Vitest: regras de estoque, formatação, erros, redirect seguro, permissões
```

```bash
npm run test:db   # Postgres local: RLS, isolamento, convites, papéis, estoque, idempotência
```

`test:db` precisa dos binários do PostgreSQL (`initdb`, `pg_ctl`, `psql`) instalados.

---

## Configuração necessária (você precisa fazer)

### 1. Supabase
1. Crie um projeto em <https://supabase.com> (plano gratuito).
2. Aplique as migrations **em ordem**: **SQL Editor** → cole cada arquivo de `supabase/migrations/` → Run
   (`20261105000100_foundation.sql`, `20261106000100_catalog_stock.sql`, `20261107000100_shopping_lists.sql`,
   `20261108000100_purchases.sql`). A da Fase 4 também cria o bucket privado `receipts`.
   (ou com a CLI: `npx supabase link --project-ref <ref>` e `npx supabase db push`).
3. **Authentication → URL Configuration**:
   - *Site URL*: a URL da Vercel (ex.: `https://seu-app.vercel.app`).
   - *Redirect URLs*: `http://localhost:5173/**` e `https://seu-app.vercel.app/**`.
4. **Database → Publications**: confirme que `supabase_realtime` existe (as migrations
   adicionam as tabelas necessárias automaticamente).
5. Copie *Project URL* e a chave *anon/publishable* para `.env.local`.

### 2. Vercel
1. Importe o repositório; o preset Vite é detectado (`vercel.json` já cuida do
   fallback de SPA e cabeçalhos de segurança).
2. Em *Environment Variables*, defina `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`
   (o nome antigo `VITE_SUPABASE_ANON_KEY` também é aceito).

### 3. Edge Functions (Fase 4)
Pelo painel (sem instalar nada): **Edge Functions → Deploy a new function → Via Editor**.

| Função | Arquivo | Precisa de |
| --- | --- | --- |
| `nfce-proxy` | `supabase/functions/nfce-proxy/index.ts` | nada |
| `receipt-ai` | `supabase/functions/receipt-ai/index.ts` | secret `GEMINI_API_KEY` |

Use exatamente esses nomes e mantenha "Verify JWT" ligado. A chave do Gemini é gratuita em
<https://aistudio.google.com/apikey> e vai em **Edge Functions → Secrets** (nunca em `VITE_*`).
Opcional: `GEMINI_MODEL` (padrão `gemini-2.5-flash`). Sem a chave, QR Code e XML funcionam e a
opção de foto mostra uma mensagem explicando o que falta.
