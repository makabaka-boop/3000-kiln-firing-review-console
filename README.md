# 窑炉烧成记录检查台

面向陶瓷工作室的离线优先烧成质检工作台。管理配方和烧成批次，导入温度 CSV，在趋势图上对照目标温度与允许范围，并完成异常归类和复核备注。

## 功能

- 配方：名称、目标温度、允许温差、计划时长；被批次引用的配方不可删除。
- 批次：名称、窑炉编号、配方、开始时间、备注；支持创建、查看和删除。
- CSV：严格要求 `时间,温度` 表头，校验列数、时间、数值、重复时间点和时间顺序；错误带行号，校验失败不覆盖原记录。
- 检查：SVG 折线图展示实际温度、目标线和允许范围；自动识别温度越界与过长采样间隔。
- 复核：异常可标记为待复核、设备问题、工艺问题、已接受，并保存备注。
- 工作台：首页指标，批次名/窑炉/异常状态筛选，明确空态与操作反馈，窄屏适配。
- 数据：浏览器 `localStorage` 持久化，JSON 全量导入导出、示例数据、一键清空；非法备份不会覆盖当前数据。

## 本地开发

要求 Node.js 20+。

```bash
npm install
npm run dev
npm test
npm run build
```

CSV 示例：

```csv
时间,温度
2026-09-08 08:30,26
2026-09-08 09:00,120
```

时间应为浏览器可解析的日期时间，并按升序排列。

## Docker

```bash
docker compose up --build -d
curl http://localhost:8080/health
docker compose down
```

默认打开 <http://localhost:8080>。如果端口已被占用，可覆盖宿主端口：

```bash
WEB_PORT=18080 docker compose up --build -d
curl http://localhost:18080/health
WEB_PORT=18080 docker compose down
```

镜像采用 Node 构建、Nginx 提供静态站点，容器自带 `/health` 健康检查。
