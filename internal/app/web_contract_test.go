package app

// 面板 API 契约闸门（前端 React 重构·阶段 0）
//
// 目的：Web UI 从 vanilla 迁到 Vite+React 期间，证明「没有功能被掉」。
// 两条断言方向不同，都需要：
//   正向  UI 调用的每条 /api/* 必须在 Go 侧存在 —— 防 React 侧臆造/漏实现端点。
//   反向  Go 侧存在但 UI 不调的必须恰为白名单 —— 上游合并新增端点时会红，
//         逼一次「这条要不要进面板」的显式决定（承认方式就是在白名单加一行）。
// 见 docs/前端React重构架构计划.md §3。

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// goPanelRouteRe 匹配 Go 1.22+ ServeMux 的「方法 + 路径」注册写法。
// internal/app 全包的注册都是硬编码字面量，不存在服务端拼路径的情况，
// 所以对编译后的 JS 产物做静态扫描是可靠的。
//
// `Handle(?:Func)?` 两种写法都要认：`/api/auth/login`、`/api/auth/logout` 是用
// `mux.Handle(pattern, csrf.Handler(http.HandlerFunc(...)))` 注册的（不鉴权的 POST 仍需
// 跨源保护，见 HandleAPI 里的说明）。只认 HandleFunc 会让这两条**静默脱离契约**——
// 实测：把它们改成 mux.Handle 后本测试立刻报「前端引用了 Go 未注册的端点」，
// 且路由计数从 33 掉到 31。
var goPanelRouteRe = regexp.MustCompile(`Handle(?:Func)?\("(GET|POST) (/api/[^"]+)"`)

// uiAPIRe 扫描前端源码/产物里的 /api/* 字面量。字符类刻意不含 '?'，
// 使 `/api/usage?days=${n}` 这类模板字面量自然截成 /api/usage。
var uiAPIRe = regexp.MustCompile(`/api/[A-Za-z0-9_\-./]+`)

// goOnlyPanelRoutes Go 有路由、面板无入口的现状集合。
// 这是现状事实，不是缺陷：重构时不得「顺手补上」，补属新功能。
var goOnlyPanelRoutes = map[string]bool{
	"GET /api/logs":  true,
	"POST /api/quit": true,
}

// uiSourceDirs 待扫描的前端来源 —— **只含真正在跑的 React 产物**。
//
// ⚠️ 2026-10-14 起不再扫 cmd/wild-work/web/（上游 vanilla 基准）。它是冻结在
// v2.5.4 的对照快照，既不 embed 也不被服务（L6 收尾后 React 已接管 /），
// 其端点引用只是历史事实：上游本轮删掉 /api/config/proxies 后，本闸门立刻对
// 一份死代码报了两条红。继续扫等于让「上游改了它对外的 API」变成每轮融合的
// 固定噪声，且噪声的严重性看起来和真缺陷一样。
// 活体契约由 web-app/（构建产物）承担 —— 它才是 exe 里真正服务的东西。
// vanilla 的快照价值仍由 TestDOMIdParity（id 集合差）与
// TestEmbeddedWebAppIsARealPanel（产物是不是真面板）承担，未受影响。
var uiSourceDirs = []struct {
	rel      string
	required bool
}{
	{filepath.Join("..", "..", "cmd", "wild-work", "web-app"), false},
}

// registeredPanelRoutes 从本包非测试 Go 源码里枚举所有已注册的 /api/* 路由（"METHOD path"）。
func registeredPanelRoutes(t *testing.T) []string {
	t.Helper()
	fis, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("读取包目录失败: %v", err)
	}
	seen := map[string]bool{}
	for _, fi := range fis {
		name := fi.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		b, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("读取 %s 失败: %v", name, err)
		}
		for _, m := range goPanelRouteRe.FindAllStringSubmatch(string(b), -1) {
			seen[m[1]+" "+m[2]] = true
		}
	}
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// uiCalledPaths 扫描一个前端目录，返回它引用的 /api/* 路径集合（不含方法）。
func uiCalledPaths(t *testing.T, dir string) map[string]string {
	t.Helper()
	paths := map[string]string{} // path -> 首个命中位置，便于报错时定位
	_ = filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		switch filepath.Ext(p) {
		case ".js", ".html", ".mjs", ".css":
		default:
			return nil
		}
		b, rerr := os.ReadFile(p)
		if rerr != nil {
			return nil
		}
		for _, m := range uiAPIRe.FindAllString(string(b), -1) {
			m = strings.TrimRight(m, "/")
			if m == "/api" || strings.HasPrefix(m, "/api/") {
				if _, ok := paths[m]; !ok {
					paths[m] = p
				}
			}
		}
		return nil
	})
	return paths
}

// readPackageSource 把本包所有非测试 Go 源码拼成一坨，供「内联 map 键是否存在」的
// 字面量扫描使用。返回的是原始文本，不做注释剥离 —— 宁误报不漏报。
func readPackageSource(t *testing.T) string {
	t.Helper()
	fis, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("读取包目录失败: %v", err)
	}
	var b strings.Builder
	for _, fi := range fis {
		name := fi.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		bs, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("读取 %s 失败: %v", name, err)
		}
		b.Write(bs)
	}
	return b.String()
}

// TestPanelAPIRouteContract 双向核对面板路由集合。
func TestPanelAPIRouteContract(t *testing.T) {
	routes := registeredPanelRoutes(t)
	if len(routes) == 0 {
		t.Fatal("未扫到任何 /api/* 路由，正则或注册方式已变，闸门本身失效")
	}

	byPath := map[string]string{} // path -> "METHOD path"
	for _, r := range routes {
		p := strings.SplitN(r, " ", 2)[1]
		if prev, ok := byPath[p]; ok {
			t.Errorf("同一路径注册了多次: %q 与 %q", prev, r)
		}
		byPath[p] = r
	}

	called := map[string]bool{} // path -> 被任一前端来源引用
	for _, src := range uiSourceDirs {
		if _, err := os.Stat(src.rel); err != nil {
			if src.required {
				t.Fatalf("必需的前端目录缺失 %s: %v", src.rel, err)
			}
			t.Logf("跳过不存在的前端来源: %s", src.rel)
			continue
		}
		for p, where := range uiCalledPaths(t, src.rel) {
			if _, ok := byPath[p]; !ok {
				t.Errorf("前端引用了 Go 未注册的端点 %q（出自 %s）", p, where)
			}
			called[p] = true
		}
	}

	var unexpected []string
	for p, full := range byPath {
		if !called[p] && !goOnlyPanelRoutes[full] {
			unexpected = append(unexpected, full)
		}
	}
	sort.Strings(unexpected)
	if len(unexpected) > 0 {
		t.Errorf("以下 Go 路由无任何前端引用且不在白名单 —— 若确属「有意不上面板」，"+
			"把 \"METHOD /path\" 加进 goOnlyPanelRoutes；若属漏实现，请补前端调用：%v", unexpected)
	}
	for full := range goOnlyPanelRoutes {
		if _, ok := byPath[strings.SplitN(full, " ", 2)[1]]; !ok {
			t.Errorf("白名单条目 %q 在 Go 侧已不存在，应从 goOnlyPanelRoutes 删除", full)
		}
	}
	t.Logf("Go 注册 %d 条 /api/* 路由，前端引用 %d 条，有意不上面板 %d 条",
		len(routes), len(called), len(goOnlyPanelRoutes))
}

// TestContractGateDetectsViolations 自检闸门本身：一个永不报警的绿灯等于没有保护。
// 用临时目录构造两类违规，确认扫描器都能抓到。
func TestContractGateDetectsViolations(t *testing.T) {
	dir := t.TempDir()
	// 模板字面量必须截成路径（/api/usage?days=${n} 是面板里唯一的动态 query）
	content := "await fetch(\"/api/state\");\n" +
		"await api(\"/api/definitely_not_registered\", {});\n" +
		"const u = await api(`/api/usage?days=${n}`);\n"
	if err := os.WriteFile(filepath.Join(dir, "chunk.js"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	got := uiCalledPaths(t, dir)
	for _, want := range []string{"/api/state", "/api/usage", "/api/definitely_not_registered"} {
		if _, ok := got[want]; !ok {
			t.Errorf("扫描器漏抓 %q，实际得 %v", want, keys(got))
		}
	}
	if _, ok := got["/api/usage?days=${n}"]; ok {
		t.Error("query 未被剥离，白名单将无法对上")
	}

	routes := registeredPanelRoutes(t)
	byPath := map[string]bool{}
	for _, r := range routes {
		byPath[strings.SplitN(r, " ", 2)[1]] = true
	}
	if byPath["/api/definitely_not_registered"] {
		t.Fatal("用例前提失效：该路径不应存在于 Go 侧")
	}
	if !byPath["/api/state"] {
		t.Fatal("扫描器/注册表失效：/api/state 应当存在")
	}
}

func keys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// TestEmbeddedWebAppHasNoNodeModules 守 D1 生死线：
// webui/(React 源码，含 node_modules) 与 web-app/(embed 目标) 必须分开。
// 若工程被建错目录，//go:embed all:web-app 会把 88 MB 依赖打进 exe。
func TestEmbeddedWebAppHasNoNodeModules(t *testing.T) {
	dir := filepath.Join("..", "..", "cmd", "wild-work", "web-app")
	if _, err := os.Stat(dir); err != nil {
		t.Skip("web-app/ 尚未产出（阶段 1 之前）")
	}
	var hits []string
	_ = filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() && d.Name() == "node_modules" {
			hits = append(hits, p)
			return filepath.SkipDir
		}
		return nil
	})
	if len(hits) > 0 {
		t.Errorf("embed 目录内发现 node_modules，会被打进二进制: %v "+
			"—— React 工程必须建在 cmd/wild-work/webui/，产物输出到 web-app/", hits)
	}
}

// TestDOMIdParity 把 FEATURES.md 的「114 个 DOM id 一个都不能少」变成机器判据。
//
// 为什么比人工勾清单可靠：人工核对只能证明"我看过的部分没漏"，
// 而移植最怕的正是没看的那部分。这里直接做集合差，漏一个就报具体 id。
//
// 集合语义刻意宽松一侧：vanilla 有而 React 无 ⇒ 报错（功能掉了）；
// React 有而 vanilla 无 ⇒ 仅提示（新增节点，需确认不是重名）。
// domIdIntentionallyRemoved 有意移除的 vanilla DOM id —— 属「功能按决议下线」，
// 不是移植漏项。每个条目都要写清是哪条决议、以及替代物是什么。
var domIdIntentionallyRemoved = map[string]string{
	// D3 签核：echarts 改 npm 按需引入，CDN <script> 必须消失（无 SRI 隐患随之消除）。
	"echartsCdn": "echarts 改 npm 按需引入",
	// R57：渠道级上游代理（每渠道一行输入）整块下线，收敛为**全局单一备用上游通道**
	// （`backupProxyInput` + `backupProxyState`）。代理列表本身已不存在，故本 id 无对应物——
	// 注意冻结的 vanilla 基准仍留着旧 DOM（它按 L11/L12 不再与上游同步）。
	"proxyList": "渠道上游代理按 R57 下线，改单一备用上游通道",
	// R112：临期阈值不再是路由参数（选号改「最早到期时刻」，面板临期额度固定 1 天），
	// 设置项整块下线——上游 v2.9.4 同样删除。
	"selExpiring": "R112 取消临期阈值配置，选号改最早到期时刻",
}

func TestDOMIdParity(t *testing.T) {
	vanilla := readRepoFile(t, filepath.Join("cmd", "wild-work", "web", "index.html"))
	reactSrc := readReactSources(t)

	lost := []string{}
	for _, id := range htmlIDs(vanilla) {
		if _, ok := domIdIntentionallyRemoved[id]; ok {
			continue
		}
		if !strings.Contains(reactSrc, `id="`+id+`"`) {
			lost = append(lost, id)
		}
	}
	if len(lost) > 0 {
		sort.Strings(lost)
		t.Errorf("React 侧缺少 vanilla 已有的 DOM id %d 个：%v —— 对应功能可能未移植，"+
			"对照 cmd/wild-work/webui/FEATURES.md 第 1 节", len(lost), lost)
	}

	var extra []string
	known := map[string]bool{}
	for _, id := range htmlIDs(vanilla) {
		known[id] = true
	}
	for _, id := range htmlIDs(reactSrc) {
		if !known[id] {
			extra = append(extra, id)
		}
	}
	if len(extra) > 0 {
		sort.Strings(extra)
		t.Logf("注：React 侧新增 vanilla 没有的 id %v（creditTip 属正常：vanilla 是运行期 createElement）", extra)
	}
	// 豁免表反向自证：条目必须真在 vanilla 里存在，否则它是一条遮盖别的东西的死白名单
	// （与 goOnlyPanelRoutes 的反向检查同款纪律）。
	for id := range domIdIntentionallyRemoved {
		if !known[id] {
			t.Errorf("DOM id 豁免条目 %q 在 vanilla 里并不存在，应从 domIdIntentionallyRemoved 删除", id)
		}
	}
	t.Logf("DOM id 对账通过：vanilla %d 个 id 中 %d 个有意移除（见 domIdIntentionallyRemoved），其余全部落地",
		len(htmlIDs(vanilla)), countIntentionallyRemoved(htmlIDs(vanilla)))
}

// countIntentionallyRemoved 数出 vanilla 里落在豁免表中的 id 个数（供日志口径，勿写死 −1）。
func countIntentionallyRemoved(ids []string) int {
	n := 0
	for _, id := range ids {
		if _, ok := domIdIntentionallyRemoved[id]; ok {
			n++
		}
	}
	return n
}

// readRepoFile 读仓库根下的文件（路径相对仓库根，不是相对包目录）。
func readRepoFile(t *testing.T, rel string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", rel))
	if err != nil {
		t.Skipf("文件不存在: %v", err)
	}
	return string(b)
}

// readReactSources 拼出 webui/src 下所有 jsx/js/css 文本，供 id / 端点扫描。
// 跳过 styles/ —— 那目录是从 vanilla 逐字复制的视觉层，纳入会自我印证。
func readReactSources(t *testing.T) string {
	t.Helper()
	root := filepath.Join("..", "..", "cmd", "wild-work", "webui", "src")
	var b strings.Builder
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if strings.Contains(p, string(os.PathSeparator)+"styles"+string(os.PathSeparator)) {
			return nil
		}
		switch filepath.Ext(p) {
		case ".jsx", ".js":
		default:
			return nil
		}
		bs, rerr := os.ReadFile(p)
		if rerr != nil {
			return nil
		}
		b.Write(bs)
		return nil
	})
	return b.String()
}

var htmlIDRe = regexp.MustCompile(`id="([A-Za-z][A-Za-z0-9_]*)"`)

func htmlIDs(s string) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range htmlIDRe.FindAllStringSubmatch(s, -1) {
		if !seen[m[1]] {
			seen[m[1]] = true
			out = append(out, m[1])
		}
	}
	return out
}
