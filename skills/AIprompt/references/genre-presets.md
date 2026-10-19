# 提示词预设索引

本技能维护以下 5 个文件型扩写预设，均位于 `references/presets/` 目录下。

## 预设列表与触发顺序

用户未指定预设时，弹出的交互选择框选项必须严格按照以下顺序排列：

1. **`nai`**（`references/presets/nai.txt`）：NovelAI V5 (NAI5) 专属多字段一体化预设。将主提示词与多角色栏（`| Character N:`）整合在单一代码框中一键复制，彻底删除 UC 段，支持严谨的二次元 Danbooru 规范、OC 外貌锚点与空间关系句。
2. **`海报`**（`references/presets/海报.txt`）：平面构成、网格排版系统与印刷材质肌理预设。
3. **`插画`**（`references/presets/插画.txt`）：插画艺术风格、色彩情绪与视觉隐喻解耦预设（默认动漫/插画风格）。
4. **`电影`**（`references/presets/电影.txt`）：电影质感与六步分段自然语言长句预设（光学景深、单光源因果、真人微肌理与胶片调色）。
5. **`巨构提示词`**（`references/presets/巨构提示词.txt`）：超大尺度建筑、星舰与极端环境巨构预设。

## 辅助参考文件
- `references/presets/通用反推.txt`：图片反推时用于提炼确定视觉事实与不确定项的基底文件。
- `references/nai5/`：NAI5 体系的构思、分镜、场景、OC 角色设计、服装写法等完整方法库。
