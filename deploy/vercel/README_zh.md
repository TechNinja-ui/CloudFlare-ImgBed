# Vercel 部署说明：Cloudflare D1 + R2

这个项目原本使用 Cloudflare Pages Functions 的 `env.img_d1` 和 `env.img_r2` 绑定。Vercel 没有 Cloudflare 运行时绑定，所以本目录新增的 Vercel 入口会：

- 用 Cloudflare D1 HTTP API 访问远程 D1 数据库。
- 用 Cloudflare R2 的 S3 兼容 API 访问远程 R2 存储桶。
- 把 `/api/*`、`/upload/*`、`/file/*`、`/dav/*`、`/random/*` 转发到 Vercel Serverless Function。
- 把 `frontend-dist` 作为静态前端输出目录。

## 1. 初始化 D1

先创建 D1 数据库，然后执行项目里的初始化 SQL 和迁移：

```bash
npx wrangler d1 create img_d1
npx wrangler d1 execute img_d1 --remote --file=database/init.sql
npx wrangler d1 execute img_d1 --remote --file=database/migrations/v2.2.1_add_tags_column.sql
```

记下创建命令输出里的 `database_id`。

## 2. 准备 R2

在 Cloudflare 控制台创建一个 R2 bucket。然后创建 R2 API Token，权限至少需要允许对象读写；项目会用到普通上传、读取、删除和分片上传。

## 3. Vercel 环境变量

在 Vercel 项目的 Environment Variables 中配置：

```text
CLOUDFLARE_ACCOUNT_ID=你的 Cloudflare Account ID
CLOUDFLARE_D1_DATABASE_ID=你的 D1 database_id
CLOUDFLARE_D1_API_TOKEN=可访问 D1 的 Cloudflare API Token
CLOUDFLARE_R2_BUCKET=你的 R2 bucket 名称
CLOUDFLARE_R2_ACCESS_KEY_ID=R2 S3 Access Key ID
CLOUDFLARE_R2_SECRET_ACCESS_KEY=R2 S3 Secret Access Key
```

可选：

```text
CLOUDFLARE_R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
CLOUDFLARE_R2_REGION=auto
```

项目原有的运行配置也继续放到 Vercel 环境变量里，例如 `TG_BOT_TOKEN`、`TG_CHAT_ID` 等。

## 4. Vercel 项目设置

仓库根目录已经有 `vercel.json`：

- `outputDirectory` 指向 `frontend-dist`。
- 动态接口统一转到 `api/vercel.js`。
- SPA 路由回退到 `/index.html`。

Vercel 部署时不需要重新构建前端，因为当前仓库已经包含 `frontend-dist`。

## 5. 注意事项

- D1 HTTP API 和 R2 S3 API 都是远程请求，延迟会比部署在 Cloudflare Workers/Pages 上直接使用绑定更高。
- 大文件上传会受到 Vercel Serverless Function 运行时间和请求体限制影响。当前 `vercel.json` 把函数 `maxDuration` 设置为 60 秒，实际上限取决于你的 Vercel 套餐。
- 生产环境建议使用权限最小化的 Cloudflare API Token，不要使用全局 API Key。
