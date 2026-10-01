package app

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// webuiRoot 定位前端工程目录（测试的 cwd 是包目录 internal/app）。
func webuiRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", "..", "cmd", "wild-work", "webui"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "package.json")); err != nil {
		t.Skipf("找不到前端工程 %s：%v", root, err)
	}
	return root
}

// TestWebuiStaticGatesActuallyRun 把 webui/tools 下的两道前端闸门接进 `go test ./...`。
//
// 为什么要有这条：`npm run check` 是**手工**入口，没人保证它被跑过；而本项目实际每天跑的
// 是 §8 的 `go build && go vet && go test ./...`。闸门写了没接进常跑流程 = 等于没有闸门
// （R34 记过同型事故：调度器创建了、注册了，但漏了 go Run()，于是自动签到从未执行，
// 且不报错、手工触发仍可用，极难发现）。
//
// 更具体的动机：`check-props.mjs` 原先把扫描根写成相对 cwd 的 `'src'`，从仓库根跑就
// 一个 .jsx 都扫不到，却照样打「✓ 0 个组件…全部对得上」并 exit 0——**假绿**。
// 脚本自身已修（路径锚到脚本位置 + 扫到 0 个就报错），这条测试再从 Go 侧兜一次：
// 以固定 cwd 调用，任何一道闸门 exit≠0 都让 `go test` 变红。
//
// 环境缺 node 或未装依赖时 skip（不阻塞没有前端工具链的构建机）。
func TestWebuiStaticGatesActuallyRun(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("没有 node，跳过前端闸门")
	}
	root := webuiRoot(t)
	if _, err := os.Stat(filepath.Join(root, "node_modules", "vite")); err != nil {
		t.Skipf("webui 依赖未安装（node_modules/vite 不存在），跳过；先跑 npm --prefix %s install", root)
	}

	for _, script := range []string{
		filepath.Join("tools", "check-props.mjs"),
		filepath.Join("tools", "render-check.mjs"),
	} {
		script := script
		t.Run(filepath.Base(script), func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
			defer cancel()
			cmd := exec.CommandContext(ctx, "node", script)
			cmd.Dir = root
			var out strings.Builder
			cmd.Stdout = &out
			cmd.Stderr = &out
			if err := cmd.Run(); err != nil {
				t.Errorf("前端闸门 %s 未通过：%v\n输出：\n%s", script, err, out.String())
			}
		})
	}
}
