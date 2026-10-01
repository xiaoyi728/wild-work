package app

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
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

// TestEmbeddedWebAppIsARealPanel 断言 embed 目标里装的**真是面板**，不是空壳或旧产物。
//
// 为什么需要它：`//go:embed all:web-app` 只要求目录非空，而 `web-app/.gitkeep` 是被跟踪的
// ——于是「web-app 里只有 .gitkeep」也能编译通过，产出一个 `/` 返回空面板的 exe；
// 同样地，改了 `webui/src` 却忘了 `npm run build`，exe 里就是旧面板。这两种都
// **不报任何错**（AGENTS.md §6 不变量 0 点名的头号坑），而既有的产物级检查
// （TestEmbeddedWebAppHasNoNodeModules / TestBuiltCSSHasNoContainerCollision）在
// web-app 无内容时是 `t.Skip`，恰好在这两种情况下全部让路。
//
// 未跑过 npm build（web-app/assets 不存在，如刚 clone）时 skip，保持后端-only 流程可用；
// 一旦有产物，就要求它完整、是面板、且不比源码旧。
//
// ⚠️ 第 3 项是 **mtime** 判据，会有误报：`cp` 还原文件、`git checkout`/`git pull` 都会把源码
// mtime 顶到当前，即使内容一字未改也会红。这是有意接受的取舍——修法就是提示里那句
// `npm run build`（3 秒），而它换来的是抓住「改了源码忘了重建」这个不报错的头号坑。
// 撞到误报请重建产物，**不要把这项检查删掉**。
func TestEmbeddedWebAppIsARealPanel(t *testing.T) {
	webApp := filepath.Join("..", "..", "cmd", "wild-work", "web-app")
	assets := filepath.Join(webApp, "assets")
	if _, err := os.Stat(assets); err != nil {
		t.Skip("web-app/assets 不存在（未跑 npm build）；先跑 npm --prefix cmd/wild-work/webui run build")
	}

	// 1) index.html 必须存在并真的引用了 bundle
	idx, err := os.ReadFile(filepath.Join(webApp, "index.html"))
	if err != nil {
		t.Fatalf("web-app/index.html 读不到（embed 进去的就是空面板）：%v", err)
	}
	refs := assetRefs.FindAllStringSubmatch(string(idx), -1)
	if len(refs) == 0 {
		t.Fatalf("web-app/index.html 里没有引用任何 assets/*，embed 的是空壳。内容：%q", truncate(string(idx), 300))
	}

	// 2) 每个被引用的产物都要存在，且 JS 里要能认出面板（DOM id 是面板独有的指纹）
	var newest time.Time
	for _, r := range refs {
		p := filepath.Join(webApp, filepath.FromSlash(r[1]))
		fi, err := os.Stat(p)
		if err != nil {
			t.Errorf("index.html 引用的 %s 不存在：%v", r[1], err)
			continue
		}
		if fi.ModTime().After(newest) {
			newest = fi.ModTime()
		}
		if !strings.HasSuffix(p, ".js") {
			continue
		}
		b, err := os.ReadFile(p)
		if err != nil {
			t.Errorf("读 %s 失败：%v", r[1], err)
			continue
		}
		for _, marker := range []string{"btnToggleFees", "btnRefreshAll", "acct-card"} {
			if !bytes.Contains(b, []byte(marker)) {
				t.Errorf("%s 里找不到面板指纹 %q —— 这份 bundle 不是本面板的产物（空壳或别的项目）", r[1], marker)
			}
		}
	}

	// 3) 源码不得比产物新：那就是「改了 webui 却没 npm build」，exe 里是旧面板
	var stale []string
	srcRoot := filepath.Join("..", "..", "cmd", "wild-work", "webui")
	for _, sub := range []string{"src", "index.html", "vite.config.js", "tailwind.config.js", "postcss.config.js"} {
		p := filepath.Join(srcRoot, sub)
		fi, err := os.Stat(p)
		if err != nil {
			continue // 目录不存在就不比
		}
		if !fi.IsDir() {
			if fi.ModTime().After(newest) {
				stale = append(stale, sub)
			}
			continue
		}
		_ = filepath.WalkDir(p, func(fp string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			if di, e := d.Info(); e == nil && di.ModTime().After(newest) {
				stale = append(stale, strings.TrimPrefix(fp, srcRoot+string(os.PathSeparator)))
			}
			return nil
		})
	}
	if len(stale) > 0 {
		t.Errorf("webui 源码比 web-app 产物新，二进制里嵌的是旧面板（%d 个文件，产物时间 %s）：%v\n"+
			"→ 跑 npm --prefix cmd/wild-work/webui run build 后重新 go build",
			len(stale), newest.Format(time.RFC3339), truncate(strings.Join(stale, ", "), 400))
	}
}

var assetRefs = regexp.MustCompile(`(?:src|href)="(\.?/?(assets/[^"]+))"`)

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
