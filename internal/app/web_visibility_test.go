package app

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// TestHiddenByCssBaseRulesAreExplicitlyShown 盯住一类会「静默不可见」的移植缺陷：
//
// CSS 基础规则里带 `display:none` 的类，在 vanilla 是靠运行期 `el.style.display="block"`
// 点亮的；改成 React 的「条件挂载」后，很容易按「渲染出来＝可见」的直觉把那句丢掉——
// 节点确实在 DOM 里、数据也渲染了，但被基础规则永久压住，**不报任何错**。
//
// 真实经过（2026-10-01，用户报「鼠标放积分上看不到积分明细」）：积分明细浮窗
// `.credit-tip` 的基础规则带 `display:none`（webui/src/styles/style.css:473，
// 与上游 vanilla 逐字相同），vanilla 在 `web/app.js:229` 点亮它；移植成 JSX 后
// 那句没跟过来。实测修复前 `display:none`、`offsetHeight/Width = 0`；
// 修复后 `display:block`、380×184 可见。
//
// 为什么静态 id 对账与 render-check 都抓不到它：前者只看 id 有没有被写出来，
// 后者是 SSR、没有 CSS 级联，`display` 这种「渲染出来了但被样式藏住」的形态
// 只存在于「类名 + 样式表」的交叉处。
func TestHiddenByCssBaseRulesAreExplicitlyShown(t *testing.T) {
	root := filepath.Join("..", "..", "cmd", "wild-work", "webui")
	cssPath := filepath.Join(root, "src", "styles", "style.css")
	raw, err := os.ReadFile(cssPath)
	if err != nil {
		t.Skipf("读不到 %s：%v", cssPath, err)
	}

	hidden := baseHiddenClasses(string(raw))
	if len(hidden) == 0 {
		t.Errorf("一个「基础规则带 display:none」的类都没扫到——解析已失效，别报绿")
		return
	}
	t.Logf("基础规则带 display:none 的类：%v", hidden)

	jsxDir := filepath.Join(root, "src")
	var checked int
	for _, cls := range hidden {
		// 该类的每一处 JSX 使用点都必须自己把它点亮（inline style 带 display）
		usage := regexp.MustCompile(`<[a-zA-Z][\w]*\s[^>]*className="[^"]*\b` + regexp.QuoteMeta(cls) + `\b[^"]*"[^>]*>`)
		found := false
		err := filepath.Walk(jsxDir, func(p string, d os.FileInfo, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(p, ".jsx") {
				return nil
			}
			src, e := os.ReadFile(p)
			if e != nil {
				return nil
			}
			for _, m := range usage.FindAllString(string(src), -1) {
				found = true
				checked++
				if !strings.Contains(m, "display:") {
					line := 1 + strings.Count(string(src)[:strings.Index(string(src), m)], "\n")
					t.Errorf("%s:%d 渲染了 .%s 却没点亮它 —— CSS 基础规则是 display:none，"+
						"结果是不报错的永久不可见。补 style={{ display: 'block' }}\n  %s",
						p, line, cls, strings.TrimSpace(m))
				}
			}
			return nil
		})
		if err != nil {
			t.Fatalf("遍历 %s 失败：%v", jsxDir, err)
		}
		if !found {
			t.Logf("（.%s 在 JSX 里没有被渲染，无需点亮）", cls)
		}
	}
	if checked == 0 {
		t.Errorf("扫到了 %d 个隐藏类，但 JSX 里一处都没用到——多半是匹配正则失效，别报绿", len(hidden))
	}
}

// baseHiddenClasses 返回「基础规则里声明了 display:none」的类名。
//
// 做法是先按花括号配对把整段 @media {...} 剥掉，再对剩下的「选择器 { 声明 }」配对取值。
// 剥 @media 是有意为之：里面的隐藏是响应式设计意图（如 .rline .rname 窄屏隐藏），
// vanilla 与 React 两边一致，不该算缺陷。
//
// ⚠️ 这里刻意不用「逐行扫 + 累积选择器」的写法：第一版就是那样写的，选择器跨块不重置，
// 结果把 .credit-num/.badge/.footer 等 120 个类全报成「隐藏却没点亮」——一道会瞎报的闸门
// 比没有闸门更糟。改完必须看它输出的类清单是否只有真带 display:none 的那几个。
func baseHiddenClasses(css string) []string {
	body := stripMediaBlocks(css)
	re := regexp.MustCompile(`(?s)([^{}]+)\{([^{}]*)\}`)
	declRe := regexp.MustCompile(`(^|;)\s*display:\s*none\s*(;|$)`)
	var out []string
	for _, m := range re.FindAllStringSubmatch(body, -1) {
		if !declRe.MatchString(m[2]) {
			continue
		}
		for _, c := range regexp.MustCompile(`\.([A-Za-z][\w-]*)`).FindAllStringSubmatch(m[1], -1) {
			if c[1] != "hidden" && !containsStr(out, c[1]) {
				out = append(out, c[1])
			}
		}
	}
	return out
}

// stripMediaBlocks 去掉所有 @media / @supports 等**带花括号**的 at-rule 整块内容。
// ⚠️ 必须区分「带块的 at-rule」与「@import "..."; 这种语句型 at-rule」：后者没有 '{'，
// 若直接去找下一个 '{' 会把两个规则之间的正常内容整段误删，闸门就会漏报。
func stripMediaBlocks(css string) string {
	var b strings.Builder
	for i := 0; i < len(css); {
		if css[i] != '@' {
			b.WriteByte(css[i])
			i++
			continue
		}
		rest := css[i:]
		semi := strings.IndexByte(rest, ';')
		open := strings.IndexByte(rest, '{')
		close := strings.IndexByte(rest, '}')
		switch {
		case open < 0:
			// 后面再没有块了，原样保留剩余内容
			b.WriteString(rest)
			i = len(css)
		case semi >= 0 && semi < open:
			// 语句型 at-rule（@import / @charset 等）：跳到分号为止，继续正常解析
			b.WriteString(rest[:semi+1])
			i += semi + 1
		case close >= 0 && close < open:
			// 处于某个块内部的 '@'（如 @keyframes 的百分比里没有 '{' 在前）：原样输出该字符
			b.WriteByte('@')
			i++
		default:
			// 带块 at-rule：按花括号配对吞掉整块
			depth, j := 0, i+open
			for ; j < len(css); j++ {
				if css[j] == '{' {
					depth++
				} else if css[j] == '}' {
					depth--
					if depth == 0 {
						j++
						break
					}
				}
			}
			i = j
		}
	}
	return b.String()
}

func containsStr(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
