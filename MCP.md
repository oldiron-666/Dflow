# DFlow 本机 MCP（单 Agent）

此 MCP 只负责**待反推区、有词区、元数据库**，不提供榜单抓取或远程服务。图片从 DFlow 已有的本地缓存读取；MCP 不会识图、翻译或自行运行 Krea2 skill，实际反推扩写由连接它的视觉 Agent 按 skill 完成。

## 启动和连接

1. 在 `D:\commen\agentsland\dflow` 运行 `npm install`（首次）及 `npm start`，保持画廊运行。
2. 在顶部「登录」→ 最后一项「MCP 设置」复制本机连接配置，再粘贴到你使用的 Agent 的 MCP 配置中。配置示例（字段位置依不同客户端而异）：

```json
{
  "mcpServers": {
    "dflow-local": {
      "command": "node",
      "args": ["D:\\commen\\agentsland\\dflow\\mcp-server.js"],
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
- `claim_direct_reverse({requestId?})`：领取平板或其他局域网浏览器通过「AI直推」提交的单图任务，返回完整的先反推后扩写流程；只领取分配给当前 MCP 会话的任务。完成后必须 `complete_pending`，失败必须 `fail_pending`。
- `claim_next_pending()`：领取下一张可用图片，同时附带两阶段完整流程和预设正文，状态改成 `processing`。领取之前建议先列队列，领取后按返回 ID 读图并处理；没有可处理项时 `item` 为 null。
- `complete_pending({id,prompt,resolvedPreset})`：写回完整结果，服务端校验字数与预设，成功后移至有词区。选“随机”时要填写实际采用的预设。
- `fail_pending({id,reason})`：失败时记录具体原因，图片仍留待反推区，方便之后重试。

- `create_worded_card({prompt,summary?,imagePath?})`：直接写有词区；有图时传 Agent 本机图片的**绝对路径**（PNG/JPEG/WebP），无图时必须填写概述。上传失败会尝试删除半成品卡片。
- `import_metadata_png({imagePath})`：传本机**原始 PNG**绝对路径，调用 DFlow 现有 ComfyUI/PNG 元数据解析，结果写元数据库；没有元数据则返回错误。

## 平板/局域网「AI直推」

平板打开 `http://电脑局域网IP:4173` 后，进入「待反推」并点击卡片上的「AI直推」，DFlow 会把任务写入服务端队列，已连接的 MCP Agent 领取后执行既有的「先反推、后扩写」流程。结果不会把完整提示词刷到聊天窗口，只显示开始、成功或失败原因；提示词会写回卡片。

登录/设置 → MCP 设置 → 已连接的 Agent 中可点击「设为直推目标」，把直推固定到某个 MCP 会话；若不设置，则发送给当前在线且最近心跳的 Agent。这个固定目标是 MCP 会话/Agent 级别，标准 MCP 无法强制控制 DSH 内部的某个具体聊天窗口；如果 DSH 为每个窗口启动独立 MCP 会话，就可以通过选择对应会话间接固定到该窗口。Agent 离线后任务会显示离线，重新连接后可继续领取。

建议 Agent 的工作顺序：`list_pending` → `claim_next_pending` → `read_pending_image` → 先执行反推预设的忠实观察，再执行扩写预设完整生成 → `complete_pending`；出错时 `fail_pending`，不要编造提示词或忽略失败。若 `processing` 中断，需要在 DFlow 界面重新加入/重试队列后再领取。不要对正在使用的个人数据运行集成测试。

## 测试

`node --test test/mcp.test.js` 会在临时目录及独立端口启动 DFlow，实测 MCP 列队列、读取图片内容、领取/写回、创建有词卡片、导入含元数据的 PNG；测试结束清理临时目录，不触碰你的收藏。

## 预设与连接管理

MCP 设置位于现有登录弹窗中**翻译引擎配置后面**，采用左上连接配置、右上 Agent 连接、左下反推预设、右下扩写预设的四块布局（窄屏改为纵向排列）。这里可查看在线的 stdio Agent（客户端报告的名称与版本）、断开当前连接；只在运行服务的本机开放连接管理，重新配置/自动重连的客户端可以再次连接。不是账号列表，也不能管理其他机器的 Agent。

这里还可新增、导入 TXT/MD、修改、删除和选择默认的**反推预设**与**扩写预设**。待反推区每张卡片分别选择两种预设；随机仅适用于扩写阶段。完整文本保存在被 Git 忽略的独立目录 `data/mcp-presets/`：`reverse/` 是反推预设，`expansion/` 是扩写预设，`config.json` 记录名称、文件及默认选择。当前电脑的预设已全部从 `D:\Download\Documents\krea2-prompt-suite.zip` 的 `references/presets/` 导入：通用反推 V2，加上其中六种扩写预设；旧的合并文件已经移除。仓库默认只上传一种扩写预设 `presets/通用扩写.txt`，通用反推的核心工作流程另写在 MCP 代码中。本地其他预设不会提交到 Git。
