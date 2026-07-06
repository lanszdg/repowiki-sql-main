# Repowiki L3 业务 Skill 契约

## 定位

L3 业务 skill 负责把 L2 事实生成业务 Wiki。它承载业务规则、命名口径、分类口径、模板章节和写作风格。

固定主流程由 repowiki 控制：

```text
L1 codegraph
-> L2 profile 生成 .repowiki/knowledge
-> merge-knowledge
-> repowiki-l3-scheduler.cjs 初始化任务队列
-> L3 skill / LLM agent 生成服务清单、功能清单、功能文档
-> repowiki-progress.cjs 完整性校验
```

业务研发可以复制并定制 L3 skill，但不能改变主流程。

## 允许读取

```text
<仓根>/.repowiki/modules.json
<仓根>/.repowiki/knowledge/services.json
<仓根>/.repowiki/knowledge/functions.json
<仓根>/.repowiki/knowledge/downstream.json
<仓根>/.repowiki/l3-scheduler/tasks.json
<仓根>/.repowiki/l3-scheduler/state.json
config/skills/<L3_SKILL>/templates/*
config/skills/<L3_SKILL>/rules/*
<仓根>/.repowiki/templates/*
```

## 允许写入

```text
<仓根>/docs/功能文档/*
<仓根>/.repowiki/l3-scheduler/state.json
<仓根>/.repowiki/l3-scheduler/metadata/*.json
```

完成 task 时，必须把 `state.json` 对应任务更新为：

```json
{
  "status": "done",
  "completed_by": "l3-skill",
  "finished_at": "<ISO 时间>"
}
```

## 禁止

```text
重新扫描源码发现服务或功能
调用 codegraph 发现事实
修改 .repowiki/knowledge/*.json
跳过 merge 或完整性校验
每个模块各自生成一份全仓服务清单或功能清单
把 knowledge 中没有的事实写成确定结论
```

## 新建业务 L3 skill

复制：

```text
config/skills/wiki-l3-default
-> config/skills/wiki-l3-<业务名>
```

修改：

```text
manifest.json
SKILL.md
templates/服务清单.columns.conf
templates/功能清单.columns.conf
templates/功能文档.md
rules/*.md
```

## manifest.json

`manifest.json` 声明业务 skill 的行特定契约。通用 repowiki 引擎只读取这些字段，不在 scheduler/task/rows 中写死某一家银行的文件名、应用名来源或文档目录。

```json
{
  "schemaVersion": 1,
  "docsDir": "功能文档",
  "appName": {
    "source": "repo-dir",
    "configFile": "ai-agent/config/aidevApp.json",
    "field": "app"
  },
  "outputs": {
    "serviceList": "{app}-服务清单",
    "functionList": "{app}-功能清单",
    "functionDocGuide": "{app}-功能文档说明",
    "functionDocSuffix": "功能文档"
  }
}
```

字段约束：

- `docsDir`：清单和功能文档输出到 `<仓根>/docs/<docsDir>`。
- `appName.source`：`repo-dir` 表示使用仓库目录名；业务 skill 可声明 `aidevApp`，从 `configFile` 的 `field` 读取应用名，读取失败时回落到仓库目录名。
- `outputs.serviceList` / `outputs.functionList` / `outputs.functionDocGuide`：控制面生成 rows、MD、CSV、XLSX 和说明文档时使用的基础文件名，支持 `{app}` 占位。
- `outputs.functionDocSuffix`：单功能文档文件名后缀，例如 `{功能名称}_功能文档.md`。

业务 skill 变更 `manifest.json`、`validation.json`、`templates/*` 或 `rules/*` 后，scheduler 的 `contractHash` 必须变化，旧 L3 done 状态会被重置，避免旧规约产物被误复用。

调用：

```text
用 repowiki 为 D:\path\to\项目 生成完整中文 wiki，L3 使用 wiki-l3-<业务名>
```
