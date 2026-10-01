package main

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// 本测试锁定一个**真实发生过**的 bug（AGENTS.md R24，2026-09-26 修正）：
//
//	初版给 glm 渠道置了 Runtime.SingleAccount=true，理由是「refresh_token 轮换后不可人工恢复」。
//	但 SingleAccount 会让 handler 短路**所有账号级惩罚**，于是账号 A 失效/限流时永远不切账号 B，
//	多账号形同虚设（实测确认）。
//
// 原先这里的守卫是 internal/server 的 TestGLMNotSingleAccount，它断言的全是常量与 Go 零值
// （provider.GLM.String()=="glm"、Runtime{} 的 SingleAccount 零值为 false），
// **从未读过 main.go 的装配**——即"若将来有人又给它加上，测试立刻失败"这句注释是不成立的：
// 真加上它也照样绿。本测试改为静态扫 main.go，双向锁死：
//
//	① 带 SingleAccount: true 的渠道集合必须恰为 {oczen}（不变量 22：单账号渠道不得受任何账号级惩罚）；
//	② 因此 glm 不得出现在其中（R24）。
//
// 为什么用静态检查：Runtime 是 main.go 里的装配字面量，运行期无法从 internal/server 侧
// 断言"装配时没写这个字段"；而这件事在源码层面就能判定（同 scheduler_start_test.go 的思路）。
func TestSingleAccountOnlyForOczen(t *testing.T) {
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatalf("读 main.go 失败: %v", err)
	}
	code := string(src)

	// 匹配 runtimes 装配里的每个渠道条目：`provider.Xxx: { ... }`（条目内无嵌套花括号）。
	entryRe := regexp.MustCompile(`provider\.(\w+):\s*\{[^}]*\}`)
	matches := entryRe.FindAllStringSubmatch(code, -1)
	if len(matches) == 0 {
		t.Fatal("未在 main.go 中扫到任何 `provider.X: {...}` 装配条目（正则失效？）——不能报绿")
	}
	singleRe := regexp.MustCompile(`SingleAccount:\s*true`)

	var single []string
	seen := map[string]bool{}
	for _, m := range matches {
		kind := m[1]
		seen[kind] = true
		if singleRe.MatchString(m[0]) {
			single = append(single, kind)
		}
	}
	sort.Strings(single)
	t.Logf("扫到 %d 条装配条目（渠道 %d 个）；其中 SingleAccount=true: %v", len(matches), len(seen), single)

	if len(single) == 0 {
		t.Error("没有任何渠道置 SingleAccount=true —— oczen 匿名渠道必须有（不变量 22：" +
			"唯一账号且不可重登，任何账号级惩罚都等于整条渠道下线）")
	}
	for _, k := range single {
		if k != "Oczen" {
			t.Errorf("渠道 %s 不得置 SingleAccount=true：该语义会跳过全部账号级惩罚，"+
				"导致账号 A 失效/限流时永不切 B（glm 已因此踩过一次，见 AGENTS.md R24）", k)
		}
	}
	if !seen["Oczen"] || !seen["GLM"] {
		t.Errorf("装配条目里缺渠道（Oczen=%t GLM=%t）——正则或装配写法已变，本闸门失效",
			seen["Oczen"], seen["GLM"])
	}
}

// TestNoStaleSingleAccountClaimForGLM 盯住文档面：R24 修正后，源码注释里不得再把 glm
// 说成单账号渠道。起因是本次审计发现 internal/glm/constants.go 的包注释仍写着
// 「故 Runtime 置 SingleAccount」，与 R24、main.go 装配处、以及 glm_rotation_test.go
// 全部矛盾——照着注释改代码就会把已修的 bug 改回去。
//
// ⚠️ 判据的「这行是不是在说 glm」必须按**文件路径**判定，不能只看行内有没有 "glm" 字样：
// 最初那版要求行内含 glm/清言，结果 constants.go 那句包注释（行内只有"单账号渠道"）
// 被跳过，负向验证装回原句也照样绿——一道装饰性测试。internal/glm/ 下整个包都是 glm。
func TestNoStaleSingleAccountClaimForGLM(t *testing.T) {
	glmDir := filepath.Join("..", "..", "internal", "glm")
	ents, err := os.ReadDir(glmDir)
	if err != nil {
		t.Fatalf("读 %s 失败: %v", glmDir, err)
	}
	var files []string
	for _, e := range ents {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".go") {
			files = append(files, filepath.Join(glmDir, e.Name()))
		}
	}
	if len(files) == 0 {
		t.Fatalf("%s 下一个 .go 都没扫到——路径错了就别报绿", glmDir)
	}
	// main.go 里多渠道并列，只有明确提到 glm/清言 的行才算"在说 glm"。
	files = append(files, "main.go")

	affirmative := []string{"置 SingleAccount", "SingleAccount=true", "SingleAccount: true"}
	negations := []string{"不设", "不得", "不置", "**不**", "不是单账号", "非单账号"}
	scanned := 0
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("读 %s 失败: %v", f, err)
		}
		inGlmPkg := strings.Contains(f, "internal/glm") || strings.Contains(f, "internal\\glm")
		for i, line := range strings.Split(string(raw), "\n") {
			if !strings.Contains(line, "SingleAccount") {
				continue
			}
			scanned++
			aboutGLM := inGlmPkg || strings.Contains(strings.ToLower(line), "glm") || strings.Contains(line, "清言")
			if !aboutGLM {
				continue
			}
			negated := false
			for _, n := range negations {
				if strings.Contains(line, n) {
					negated = true
					break
				}
			}
			if negated {
				continue
			}
			for _, a := range affirmative {
				if strings.Contains(line, a) {
					t.Errorf("%s:%d 仍把 glm 说成单账号渠道（与 AGENTS.md R24 矛盾，照它改代码会把已修的 bug 改回去）:\n  %s",
						f, i+1, strings.TrimSpace(line))
					break
				}
			}
		}
	}
	if scanned == 0 {
		t.Errorf("扫了 %d 个文件却没遇到任何提到 SingleAccount 的行——判据已失效，别报绿", len(files))
	}
	t.Logf("扫了 %d 个文件，其中 %d 行提到 SingleAccount", len(files), scanned)
}
