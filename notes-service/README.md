# Notebook 服务(登录 + 保存)

```
浏览器 ── twwinde.github.io/notes/ (GitHub Pages, 公开静态页面,不含任何笔记内容)
   │  Bearer 会话令牌
   ▼
Cloudflare Worker (本目录 worker.js)
   │  ① GitHub OAuth 只用来确认"你是 TWWinde",拿到身份后立即吊销该 OAuth 令牌
   │  ② 用自己的细粒度令牌读写私有仓库,浏览器永远拿不到 GitHub 令牌
   ▼
私有仓库 TWWinde/notes (每篇笔记 = 一个 .md 文件,每次保存 = 一次 commit)
```

- 只有 `ALLOWED_LOGIN` 指定的 GitHub 账号能登录;其他人登录会看到 "This notebook is private."
- 会话令牌 30 天有效,保存在各设备浏览器里。想让**所有设备立即下线**:把 `wrangler.toml` 里的 `SESSION_VERSION` 加 1 再 `npm run deploy`。
- 编辑时先存本地草稿,停止输入 3 秒后自动提交到 GitHub(也可 Ctrl/Cmd+S)。两台设备改同一篇时会提示冲突,可选"载入对方版本、把我的另存为副本"或"用我的覆盖"。
- 笔记历史、恢复误删,都直接在 GitHub 私有仓库里看 commit 记录。

## 一次性部署(约 15 分钟)

### 1. 建私有笔记仓库

```bash
gh repo create TWWinde/notes --private --add-readme --description "Private notebook"
```

### 2. 建 GitHub OAuth App(只用于登录识别身份)

GitHub → Settings → Developer settings → OAuth Apps → New OAuth App

- Application name: `TWWinde Notebook`
- Homepage URL: `https://twwinde.github.io/notes/`
- Authorization callback URL: 先填 `https://example.com`,第 4 步拿到 Worker 地址后改成 `https://<worker 地址>/auth/callback`

创建后记下 **Client ID**,点 *Generate a new client secret* 记下 **Client secret**。

### 3. 建细粒度令牌(Worker 用来读写笔记)

GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token

- Repository access: **Only select repositories** → 只选 `TWWinde/notes`
- Permissions → Repository permissions → **Contents: Read and write**(其余保持 No access)
- Expiration: 自选(到期后重新生成并重复下面的 `GITHUB_TOKEN` 那一步)

### 4. 部署 Worker(需要一个免费 Cloudflare 账号)

```bash
cd notes-service
npx wrangler@3 login
npx wrangler@3 deploy
```

输出里会有地址,形如 `https://twwinde-notebook.<你的子域>.workers.dev`。然后写入四个密钥(每条命令会提示粘贴值):

```bash
npx wrangler@3 secret put GITHUB_CLIENT_ID
```

```bash
npx wrangler@3 secret put GITHUB_CLIENT_SECRET
```

```bash
npx wrangler@3 secret put GITHUB_TOKEN
```

```bash
openssl rand -base64 48 | npx wrangler@3 secret put SESSION_SECRET
```

回到第 2 步的 OAuth App,把 callback URL 改成 `https://twwinde-notebook.<你的子域>.workers.dev/auth/callback`。

### 5. 让主页指向 Worker

编辑 `_pages/notes.html` 顶部的 `notes_api`,填上第 4 步的 Worker 地址,提交并推送主页仓库。GitHub Pages 构建完成后打开 <https://twwinde.github.io/notes/> → *Sign in with GitHub*。

## 本地开发

不需要 Cloudflare、也不碰真实 GitHub:

```bash
cd notes-service && npm test
```

```bash
cd notes-service && npm run dev
```

`npm run dev` 会用内存里的假 GitHub 启动 Worker(8787 端口)和笔记页面(4000 端口),并打印一个已登录的地址。

## 配置项

| 名称 | 位置 | 说明 |
|---|---|---|
| `ALLOWED_LOGIN` | wrangler.toml | 唯一允许登录的 GitHub 用户名 |
| `NOTES_REPO` / `NOTES_BRANCH` | wrangler.toml | 笔记仓库与分支 |
| `FRONTEND_URL` | wrangler.toml | 登录后跳回的页面 |
| `ALLOWED_ORIGINS` | wrangler.toml | 额外允许调用 API 的来源(本地 Jekyll 等) |
| `SESSION_DAYS` / `SESSION_VERSION` | wrangler.toml | 会话有效期 / 全部下线开关 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | secret | OAuth App |
| `GITHUB_TOKEN` | secret | 只对 `TWWinde/notes` 有 Contents 读写权限的细粒度令牌 |
| `SESSION_SECRET` | secret | 会话签名密钥,≥32 字符 |
