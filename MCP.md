# DFlow 本机 MCP（单 Agent）

此 MCP 只负责**待反推区、有词区、元数据库**，不提供榜单抓取或远程服务。图片从 DFlow 已有的本地缓存读取；MCP 不会识图、翻译或自行运行 Krea2 skill，实际反推扩写由连接它的视觉 Agent 按 skill 完成。

## 启动和连接

1. 在 项目目录（例如 `D:\Download\dflow`） 运行 `npm install`（首次）及 `npm start`，保持画廊运行。
2. 在顶部「登录」→ 最后一项「MCP 设置」复制本机连接配置，再粘贴到你使用的 Agent 的 MCP 配置中。配置示例（字段位置依不同客户端而异）：

```json
{
  "mcpServers": {
    "dflow-local": {
      "command": "node",
      "args": ["D:\\Download\\dflow\\mcp-server.js"],
      "env": { "DFLOW_PORT": "4173" }
    }
  }
}
```

也可以在项目目录运行 `npm run mcp`；这条命令要由 MCP 客户端启动和连接，不是在普通终端里直接交互。若画廊端口变动，相应修改 `DFLOW_PORT`。服务通过 stdio 连接，只访问 `127.0.0.1` 上的既有 DFlow HTTP API，不额外开放 MCP 网络端口。不同 Agent 需要各自配置；同一时间只让一个 Agent 领取队列。

## 工具

- `list_pending`：读取待反推区队列与缓存、错误、预设和附加要求。
- `read_pending_image({id})`：把某张**已有本地缓存**的高清图交给视觉 Agent；上限 30 MB，不从 D 站或 P 站重新抓取。
- `get_reverse_workflow({id})`：返回此图的通用流程、反推预设和扩写预设完整正文；MCP 同时提供 `dflow_reverse` prompt。
- `claim_direct_reverse({requestId?,batchId?})`：领取平板或其他局域网浏览器通过「AI直推」提交的单图任务，返回完整的先反推后扩写流程；只领取分配给当前 MCP 会话的任务。完成后必须 `complete_pending`，失败必须 `fail_pending`。
- `claim_next_pending()`：领取下一张可用图片，同时附带两阶段完整流程和预设正文，状态改成 `processing`。领取之前建议先列队列，领取后按返回 ID 读图并处理；没有可处理项时 `item` 为 null。
- `complete_pending({id,prompt,resolvedPreset})`：写回完整结果，服务端校验字数与预设，成功后移至有词区。选“随机”时要填写实际采用的预设。
- `fail_pending({id,reason})`：失败时记录具体原因，图片仍留待反推区，方便之后重试。

- `create_worded_card({prompt,summary?,imagePath?})`：直接写有词区；有图时传 Agent 本机图片的**绝对路径**（PNG/JPEG/WebP），无图时必须填写概述。上传失败会尝试删除半成品卡片。
- `import_metadata_png({imagePath})`：传本机**原始 PNG**绝对路径，调用 DFlow 现有 ComfyUI/PNG 元数据解析，结果写元数据库；没有元数据则返回错误。

## 平板/局域网「AI直推」

平板打开 `http://电脑局域网IP:4173` 后，进入「待反推」并点击卡片上的「AI直推」，DFlow 会把任务写入服务端队列，已连接的 MCP Agent 领取后执行既有的「先反推、后扩写」流程。结果不会把完整提示词刷到聊天窗口，只显示开始、成功或失败原因；提示词会写回卡片。

登录/设置 → MCP 设置可固定目标 MCP Agent 和 DSH 聊天；未固定时优先复用在线 DSH MCP 和最近活跃且可写入的聊天。工具连接与聊天唤起是两个独立能力：只有标准 MCP、没有 DSH Bridge 的客户端不能由网页启动 AI 回合。服务器重启后自动重新登记，心跳顺序发送；主动断开不会被后台心跳立即复活，需客户端重新连接。

## 浏览器「开始自动反推」

1. 确认主机已运行 DSH Bridge，DSH 中已连接 DFlow MCP，队列所有启用卡片已有本地缓存。
2. 在浏览器待反推栏填写可选附加要求，点击「开始自动反推」。DFlow 在已有 DSH 聊天发送一次批次任务，不新建聊天、不弹出选择窗口。
3. Agent 必须循环 `claim_direct_reverse({batchId})`，按返回顺序读取图片、执行 workflow、`complete_pending` 或 `fail_pending`，直到 `request` 为 null。`workflow.batchInstruction` 是本次批次要求；不要改用普通队列领取，也不要处理该批次以外的卡片。
4. 浏览器显示总数、排队、处理中、成功与失败进度；缺图/缓存未就绪时不跳过队首，启动会明确拒绝。重复点击复用活动批次。

唤起链路通过 mock DSH bridge 与实际 stdio MCP 回归验证；真实 Agent 的识图质量、第三方客户端行为需在对应客户端验证。

建议 Agent 的工作顺序：`list_pending` → `claim_next_pending` → `read_pending_image` → 先执行反推预设的忠实观察，再执行扩写预设完整生成 → `complete_pending`；出错时 `fail_pending`，不要编造提示词或忽略失败。若 `processing` 中断，需要在 DFlow 界面重新加入/重试队列后再领取。不要对正在使用的个人数据运行集成测试。

## 测试

`npm test` 会在临时目录及独立端口启动 DFlow，实测 MCP 列队列、读取图片内容、领取/写回、创建有词卡片、导入含元数据的 PNG；测试结束清理临时目录，不触碰你的收藏。

## 预设与连接管理

MCP 设置位于现有登录弹窗中**翻译引擎配置后面**，采用左上连接配置、右上 Agent 连接、左下反推预设、右下扩写预设的四块布局（窄屏改为纵向排列）。这里可查看在线的 stdio Agent（客户端报告的名称与版本）、断开当前连接；只在运行服务的本机开放连接管理，服务重启后现有客户端自动重新登记；用户主动断开后需在客户端重新连接。不是账号列表，也不能管理其他机器的 Agent。

这里还可新增、导入 TXT/MD、修改、删除和选择默认的**反推预设**与**扩写预设**。待反推区每张卡片分别选择两种预设；随机仅适用于扩写阶段。完整文本保存在被 Git 忽略的独立目录 `data/mcp-presets/`：`reverse/` 是反推预设，`expansion/` 是扩写预设，`config.json` 记录名称、文件及默认选择。仓库默认提供 `presets/` 中明确发布的通用扩写、插画、电影、海报、巨构提示词，以及远端历史版本已有的五种 NAI 测试扩写预设，通用反推的核心工作流程另写在 MCP 代码中。本地其他预设不会提交到 Git。
