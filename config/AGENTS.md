<!-- CODEGRAPH_START -->
## CodeGraph（内置代码图谱 / 事实层 L1）

本环境内置 CodeGraph：由 tree-sitter 解析出的代码知识图谱，通过 `codegraph_*` MCP 工具访问。读取是亚毫秒级的，能回答 grep 给不出的结构性问题（谁调用谁、改动会波及哪里、某符号定义在哪、签名是什么）。`codegraph` 命令已内置在 PATH 上（来自 `config/bin/codegraph`，**自带 node22 运行时，不受系统 node 版本影响、无需联网、无需额外安装**）。

### 首次使用：若当前项目没有 `.codegraph/`，自动建图（不要反过来问用户）

CodeGraph 的 MCP 服务只打开**已存在**的图谱，不会自动建图。因此：

- 当任何 `codegraph_*` 工具返回 "not initialized"，或当前项目根目录下没有 `.codegraph/` 时，**先用内置 shell 自动执行一次建图**，再继续：

  ```bash
  codegraph init . --index
  ```

  - 这只会在该项目目录里生成一个 `.codegraph/` 索引（不写入其它位置）。
  - 每个项目只需建一次；之后文件改动会被自动增量同步。
  - 大仓库首次建图可能要几分钟，属正常；完成后再调用 `codegraph_*` 工具。
- 仅当建图命令本身报错（如目录不可写）时，才把错误告诉用户并停下。

### 何时优先用 codegraph（而不是 grep/读文件）

结构性问题用 codegraph；只有"找字面文本"（字符串内容、注释、**注解参数、XML 配置**）或已经打开了某个具体文件后，才用 grep/read。

| 问题 | 工具 |
|---|---|
| "X 定义在哪 / 找名为 X 的符号" | `codegraph_search` |
| "谁调用了函数 Y" | `codegraph_callers` |
| "Y 调用了什么" | `codegraph_callees` |
| "从 X 到 Y 的调用链是怎样的" | `codegraph_trace` |
| "改动 Z 会影响哪些地方" | `codegraph_impact` |
| "Y 的签名 / 源码 / 文档" | `codegraph_node` |
| "给我某个任务/区域的聚焦上下文" | `codegraph_context` |
| "一次看多个相关符号的源码" | `codegraph_explore` |
| "某路径下有哪些文件" | `codegraph_files` |
| "索引健康吗" | `codegraph_status` |

### 经验法则

- **直接作答，别派生额外探索。** 架构类问题用 2-3 次 codegraph 调用即可。codegraph 是预建好的索引，再用 grep+read 重做是重复劳动、更费 token。
- **信任 codegraph 的结果**（来自完整 AST 解析），不要再 grep 复核。
- **codegraph 的盲区用 grep 兜底**：注解参数（如 `@DubboService` 的 version/group）、`dubbo:service` 等 XML 配置字符串 codegraph **不索引**，这类发现仍用 grep；但拿到候选后，定位文件路径、确认实现↔接口、取方法体一律用 codegraph，不要凭包名猜路径去 Read。
- 索引有约 500ms 防抖延迟：刚改完文件别在同一轮里立刻重查。
<!-- CODEGRAPH_END -->
