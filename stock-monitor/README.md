# 股票监控台 · 威联通 NAS 部署指南

## 快速部署（Container Station）

### 方法一：Docker Compose（推荐）

1. **上传文件到 NAS**
   - 将整个 `stock-monitor` 文件夹上传到 NAS，例如放到 `/share/Container/stock-monitor/`

2. **打开 Container Station**
   - 点击「创建」→「创建应用程序」
   - 选择 Docker Compose 方式
   - 上传或粘贴 `docker-compose.yml` 内容

3. **启动后访问**
   - 浏览器打开 `http://NAS的IP:3000`

---

### 方法二：命令行部署（SSH）

```bash
# 1. SSH 登录 NAS
ssh admin@你的NAS_IP

# 2. 进入项目目录
cd /share/Container/stock-monitor

# 3. 构建并启动
docker-compose up -d --build

# 4. 查看日志
docker-compose logs -f
```

---

### 方法三：使用预构建镜像（无需构建）

如果 NAS 没有安装 Node.js，可以在有 Docker 的电脑上构建：

```bash
# 在电脑上构建镜像
docker build -t stock-monitor .

# 导出镜像
docker save stock-monitor > stock-monitor.tar

# 上传到 NAS 并导入
docker load < stock-monitor.tar

# 启动
docker run -d \
  --name stock-monitor \
  --restart unless-stopped \
  -p 3000:3000 \
  -v /share/Container/stock-monitor/data:/data \
  -e TZ=Asia/Shanghai \
  stock-monitor
```

---

## 功能说明

| 功能 | 说明 |
|------|------|
| 📊 监控面板 | 实时显示所有股票价格、涨跌幅、成交量 |
| 📈 K线图 | 点击股票卡片查看历史走势（1日/5日/1月/3月/1年/5年）|
| 🔔 价格提醒 | 设定目标价，触价时页面弹出提醒 |
| 🔍 股票搜索 | 支持美股/港股/A股/ETF 搜索 |
| ⚙️ 设置 | 配置刷新频率、货币单位 |
| 💾 数据持久化 | 配置保存在 `/data/config.json` |

## 支持的股票格式

| 市场 | 格式示例 |
|------|---------|
| 美股 | `AAPL`, `TSLA`, `NVDA` |
| 港股 | `00700.HK`, `09988.HK` |
| 上交所 | `600519.SS`（贵州茅台）|
| 深交所 | `000858.SZ`（五粮液）|
| ETF | `510300.SS`, `QQQ` |
| 指数 | `^GSPC`, `^HSI`, `^N225` |

## 端口与数据

- **端口**：3000（可在 docker-compose.yml 修改）
- **数据目录**：`./data/config.json`（映射到容器内 `/data`）
- **时区**：默认 Asia/Shanghai

## 常见问题

**Q: 页面打不开？**
A: 检查防火墙是否放开 3000 端口。威联通：控制台 → 安全 → 防火墙。

**Q: 股票价格不更新？**
A: 数据来自 Yahoo Finance，需要 NAS 能访问国际网络。

**Q: 如何修改刷新频率？**
A: 在「设置」页面修改，默认 60 秒。

**Q: 数据会丢失吗？**
A: 配置文件映射到宿主机 `./data/` 目录，容器重启不丢失。
