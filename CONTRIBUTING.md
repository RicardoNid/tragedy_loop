# GitHub 开发流程

统一上游：[RicardoNid/tragedy_loop](https://github.com/RicardoNid/tragedy_loop)（私有）。
默认分支为 `main`，远程名为 `origin`。`ricardo` 与 `personal` 只用于追溯原始来源。

1. 先创建或领取 GitHub Issue，记录目标、范围、来源和可验证的验收条件。
2. `git fetch origin` 后，从最新 `origin/main` 创建 `codex/<issue>-<topic>` 分支；
   并行任务使用独立 worktree，避免混入其他任务未提交的修改。
3. 实现并执行与变更匹配的检查。代码变更运行 `npm run check`，涉及 GUI 的变更另运行
   `npm run engine:gui:test`。保留失败证据，分别报告自动检查、GUI 回归和人工验收。
4. 推送开发分支，用 `gh pr create` 创建 PR，正文写 `Closes #<issue>`，说明最终行为、
   验证结果和未完成项。尚未通过检查或审阅时使用 Draft。
5. 合并前独立核对项目规范和关联 Issue 的验收条件；审阅必须覆盖当前 head SHA。
   更新分支后重新执行受影响检查和审阅。CI 通过且任务授权允许合并后，使用
   `gh pr merge --merge --match-head-commit <reviewed-sha>`，保留整合历史。
6. 合并后确认 PR 状态、Issue 关闭状态及远端 main 的合并提交，再同步本地 main。

不得直接推送 main，不得强推共享分支，不得用关闭 PR 代替合并。
GitHub CLI 的默认仓库可通过 `gh repo set-default RicardoNid/tragedy_loop` 设置。
本仓库使用 GitHub Issue/PR；Forgejo 专用接口与 exact-SHA API 不适用于此仓库。

当前 GitHub 账户套餐不支持此私有仓库的分支保护（API 返回 403，要求 GitHub Pro 或公开仓库）。
以上合并约束当前依靠协作规范执行，不能宣称已有服务端强制保护；保持仓库私有。
以后具备支持条件时应启用 main 的 PR 必需和 CI 必需保护。
部署不属于 PR 合并的隐含操作，历史 NAS/服务器部署脚本仍未经本仓库验证。
