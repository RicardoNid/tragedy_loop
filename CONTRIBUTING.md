# GitHub 开发流程

统一上游：[RicardoNid/tragedy_loop](https://github.com/RicardoNid/tragedy_loop)（公开）。
默认分支为 `main`，远程名为 `origin`。`ricardo` 与 `personal` 只用于追溯原始来源。

1. 先创建或领取 GitHub Issue，记录目标、范围、来源和可验证的验收条件。
2. `git fetch origin` 后，从最新 `origin/main` 创建 `codex/<issue>-<topic>` 分支；
   并行任务使用独立 worktree，避免混入其他任务未提交的修改。
3. 当前仅为工程骨架：执行冻结安装和 `pnpm check`，它只验证配置，不是应用测试。
   后续引入代码时再建立相应类型、单元、构建和 GUI 检查，分别报告实际覆盖范围。
   本工程任务不得修改或提交 `facts/`；它由“规则真源”任务独立维护。
4. 推送开发分支，用 `gh pr create` 创建 PR，正文写 `Closes #<issue>`，说明最终行为、
   验证结果和未完成项。尚未通过检查或审阅时使用 Draft。
5. 合并前独立核对项目规范和关联 Issue 的验收条件；审阅必须覆盖当前 head SHA。
   更新分支后重新执行受影响检查和审阅。CI 通过且任务授权允许合并后，使用
   `gh pr merge --merge --match-head-commit <reviewed-sha>`，保留整合历史。
6. 合并后确认 PR 状态、Issue 关闭状态及远端 main 的合并提交，再同步本地 main。

不得直接推送 main，不得强推共享分支，不得用关闭 PR 代替合并。
GitHub CLI 的默认仓库可通过 `gh repo set-default RicardoNid/tragedy_loop` 设置。
本仓库使用 GitHub Issue/PR；Forgejo 专用接口与 exact-SHA API 不适用于此仓库。

仓库已公开，main 已启用服务端分支保护，管理员同样受约束：
必须通过 PR 合并，GitHub Actions 的 `check` 检查必须通过，分支必须与最新 main 同步，
所有审阅讨论必须解决；禁止强推和删除 main。
目前不强制其他账号批准（required approvals 为 0），但仍须完成上述规范和验收条件审阅。
部署不属于 PR 合并的隐含操作，历史 NAS/服务器部署脚本仍未经本仓库验证。
