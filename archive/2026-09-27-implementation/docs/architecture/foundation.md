# 统一工程基础

本决策由 ltr 在本次 grilling 的 Q20–Q22 明确确认，并补充“资料校对由我们自己完成”。

浏览器由 React/Vite 构建，HTTP 服务使用 Fastify。服务调用 `@tragedy/engine`；
界面只引用 `@tragedy/contracts`，不打包私密引擎状态。`content` 声明模组与示例数据，
`transport` 保留已测试的引擎适配。Python 辅助工具使用独立 uv 环境。

前端迁移现有基本交互和 test ID；引擎保留原行为，未在框架重构中顺便改变规则裁定。
当前内存单局、可切换所有席位仍是单机基线，不能用于保密多人对局。
已确定将来以局域网为主、预留公网接口、无账户链接加入；此阶段未实施这些产品功能。

资料展示沿用原页面与规则全景，不保留旧编辑 API 或协作者修改回收流程。
服务只挂载明确的只读目录，不将整个仓库作为 HTTP 根目录。
生产构建输出 `apps/web/dist` 与 `apps/server/dist`，通过同一 Node 进程提供页面和 API。

工具选择依据：
[React 状态组织](https://react.dev/learn/managing-state)、
[Vite](https://vite.dev/guide/)、
[Fastify 服务](https://fastify.dev/docs/latest/Reference/Server/)、
[pnpm workspace](https://pnpm.io/workspaces)。
