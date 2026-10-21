# 上游更新报告（2026-10-21 09:13:35 CST）

- 上游仓库：https://github.com/rockswang/wild-work.git（master）
- 基线：`9d620936058d5a24b910408d1617e25248063640`
- 上游当前：`e3bc93fe62f5a5ed507960699267b00be146fef7`
- 本地 HEAD：`60d4e52`（工作区未提交改动 13 项）

## 上游新增提交

```
e3bc93f fix(qoder,qodercn,qodercom): 流式剥壳识别内嵌 403，RESOURCE_LIMIT 归软限流（R108）
785cbaa test(stats): 持久化 fixture 日期改相对取值，消除 30 日窗口时间炸弹
b832020 feat(qoder): 透传 thinking_config 档位到 parameters.reasoning_effort
a0099b8 revert(docs): 撤掉 AGENTS.md 的「版本号以远端为准」纪律条目
8115a47 chore: 版本号回退到远端 2.9.3，R107 并入 v2.9.3 节；钉死「版本号以远端为准」纪律
96ea3b8 fix(raccoon): 每日积分到期清零不再被记成「今日消耗」（R107）
```

## 变更规模（上游基线 → 上游当前）

```
 AGENTS.md                                      | 851 +++++++++++++------------
 RELEASES.md                                    |  76 ++-
 "docs/\345\206\263\350\256\256\351\241\271.md" |   1 +
 internal/ledger/credit_raccoon_expire_test.go  | 200 ++++++
 internal/qoder/client.go                       |  10 +
 internal/qoder/sse.go                          | 148 ++++-
 internal/qoder/stream_nested_error_test.go     | 108 ++++
 internal/qodercn/body.go                       |  24 +-
 internal/qodercn/client.go                     |  14 +-
 internal/qodercn/models.go                     |  81 ++-
 internal/qodercn/qodercn_test.go               | 137 +++-
 internal/qodercn/sse.go                        | 150 ++++-
 internal/qodercn/stream_nested_error_test.go   | 108 ++++
 internal/qodercom/body.go                      |  24 +-
 internal/qodercom/client.go                    |  12 +-
 internal/qodercom/models.go                    |  78 ++-
 internal/qodercom/qodercom_test.go             | 135 +++-
 internal/qodercom/sse.go                       | 148 ++++-
 internal/qodercom/stream_nested_error_test.go  | 108 ++++
 internal/raccoon/client.go                     | 173 ++++-
 internal/raccoon/credit_key_test.go            |  60 ++
 internal/raccoon/expiry_bucket_test.go         |  91 +++
 internal/raccoon/raccoon_test.go               | 295 +++++++++
 internal/stats/persist_test.go                 |  21 +-
 24 files changed, 2593 insertions(+), 460 deletions(-)
```

## 全部变更文件及本地状态

| # | 文件 | 变更 | 本地状态 |
|---|------|------|----------|
| 1 | `AGENTS.md` | M | 本地已偏离；工作区未提交 |
| 2 | `RELEASES.md` | M | 本地已偏离 |
| 3 | `"docs/\345\206\263\350\256\256\351\241\271.md"` |  | 上游已删除；本地无此文件 |
| 4 | `internal/ledger/credit_raccoon_expire_test.go` | A | 本地无此文件 |
| 5 | `internal/qoder/client.go` | M | 本地已偏离 |
| 6 | `internal/qoder/sse.go` | M | 本地已偏离 |
| 7 | `internal/qoder/stream_nested_error_test.go` | A | 本地无此文件 |
| 8 | `internal/qodercn/body.go` | M | 本地已偏离 |
| 9 | `internal/qodercn/client.go` | M | 本地已偏离 |
| 10 | `internal/qodercn/models.go` | M | 本地已偏离 |
| 11 | `internal/qodercn/qodercn_test.go` | M | 本地已偏离 |
| 12 | `internal/qodercn/sse.go` | M | 本地已偏离 |
| 13 | `internal/qodercn/stream_nested_error_test.go` | A | 本地无此文件 |
| 14 | `internal/qodercom/body.go` | M | 本地已偏离 |
| 15 | `internal/qodercom/client.go` | M | 本地已偏离 |
| 16 | `internal/qodercom/models.go` | M | 本地已偏离 |
| 17 | `internal/qodercom/qodercom_test.go` | M | 本地已偏离 |
| 18 | `internal/qodercom/sse.go` | M | 本地已偏离 |
| 19 | `internal/qodercom/stream_nested_error_test.go` | A | 本地无此文件 |
| 20 | `internal/raccoon/client.go` | M | 本地已偏离 |
| 21 | `internal/raccoon/credit_key_test.go` | A | 本地无此文件 |
| 22 | `internal/raccoon/expiry_bucket_test.go` | A | 本地无此文件 |
| 23 | `internal/raccoon/raccoon_test.go` | M | 本地已偏离 |
| 24 | `internal/stats/persist_test.go` | M | 本地已偏离 |

## 重点关注：本地已偏离或缺失的文件

- `AGENTS.md` — 本地已偏离；工作区未提交
- `RELEASES.md` — 本地已偏离
- `"docs/\345\206\263\350\256\256\351\241\271.md"` — 上游已删除；本地无此文件
- `internal/ledger/credit_raccoon_expire_test.go` — 本地无此文件
- `internal/qoder/client.go` — 本地已偏离
- `internal/qoder/sse.go` — 本地已偏离
- `internal/qoder/stream_nested_error_test.go` — 本地无此文件
- `internal/qodercn/body.go` — 本地已偏离
- `internal/qodercn/client.go` — 本地已偏离
- `internal/qodercn/models.go` — 本地已偏离
- `internal/qodercn/qodercn_test.go` — 本地已偏离
- `internal/qodercn/sse.go` — 本地已偏离
- `internal/qodercn/stream_nested_error_test.go` — 本地无此文件
- `internal/qodercom/body.go` — 本地已偏离
- `internal/qodercom/client.go` — 本地已偏离
- `internal/qodercom/models.go` — 本地已偏离
- `internal/qodercom/qodercom_test.go` — 本地已偏离
- `internal/qodercom/sse.go` — 本地已偏离
- `internal/qodercom/stream_nested_error_test.go` — 本地无此文件
- `internal/raccoon/client.go` — 本地已偏离
- `internal/raccoon/credit_key_test.go` — 本地无此文件
- `internal/raccoon/expiry_bucket_test.go` — 本地无此文件
- `internal/raccoon/raccoon_test.go` — 本地已偏离
- `internal/stats/persist_test.go` — 本地已偏离

## 查看具体改动（只读命令）

```bash
git -C /home/incam/Software/wild-work-master diff 9d620936058d5a24b910408d1617e25248063640 e3bc93fe62f5a5ed507960699267b00be146fef7
git -C /home/incam/Software/wild-work-master log --oneline --no-decorate 9d620936058d5a24b910408d1617e25248063640..e3bc93fe62f5a5ed507960699267b00be146fef7
```
