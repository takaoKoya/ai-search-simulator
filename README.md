# 採用マーケティング MVP（Next.js）

求人条件からAIが原稿・LINE質問を生成し、LINEで応募受付・スクリーニング・面接案内までを行う管理システム。

## セットアップ

```bash
cp .env.example .env.local   # 値を設定（DATABASE_URL, OPENAI_API_KEY, LINE_*, Supabase など）
npm install                  # postinstall で prisma generate
npm run db:deploy            # マイグレーション適用（開発中は db:migrate）
npm run dev
```

## 主な画面・エンドポイント

| パス | 内容 |
| --- | --- |
| `/admin/jobs/new` | 求人条件を入力してAI生成・保存 |
| `/admin/jobs` / `/admin/jobs/[id]` | 求人一覧・詳細（応募者管理、面接案内、アナリティクス） |
| `/admin/analytics` | 全求人のチャネル別アナリティクス（期間指定可） |
| `/api/webhook/line` | LINE Webhook（署名検証あり）。LINE Developers に登録するURL |
| `/r/{jobId}?utm_source=tiktok` | 計測リンク。PVを記録してLINEへ誘導 |

`/admin/*` と `/api/{jobs,applicants,templates,analytics}/*` はSupabaseログインが必要です。

## 開発

```bash
npm test         # vitest
npx tsc --noEmit # 型チェック
npm run build
```
