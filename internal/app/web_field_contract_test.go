package app

// 面板 API 字段级契约闸门（前端 React 重构·阶段 0）
//
// 为什么只核对 endpoint 不够：契约测试能保证「React 没臆造端点」，但掉一个字段
// （credits_stale / unusable_credits / has_context）它是绿的 —— 而面板会静默少一列、
// 少一个「待刷新」标记，属最难被肉眼发现的那类回归。本文件把 UI 实际读取的字段
// 集锁成断言：Go 侧改名或删字段 ⇒ 红。
//
// 与 web_contract_test.go 的分工：那边管「有哪些端点」，这边管「端点里有哪些字段」。
// 见 docs/前端React重构架构计划.md §3（本文件是对 §3.1 的加强）。

import (
	"reflect"
	"sort"
	"strings"
	"testing"

	"wild-work/internal/ledger"
	"wild-work/internal/provider"
	"wild-work/internal/scheduler"
)

// collectJSONPaths 递归收集一个类型的 json 字段路径（点分，切片元素用 "[]" 前缀）。
// depth 限制在 3 层：够覆盖 State→compat 与 Stats→credit→entries，再深本项目没有。
func collectJSONPaths(t reflect.Type, prefix string, depth int, out map[string]bool) {
	if depth < 0 || t == nil {
		return
	}
	for t.Kind() == reflect.Ptr || t.Kind() == reflect.Slice || t.Kind() == reflect.Array {
		t = t.Elem()
	}
	if t.Kind() != reflect.Struct {
		return
	}
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		if f.PkgPath != "" { // 非导出字段不上 wire
			continue
		}
		tag := f.Tag.Get("json")
		if tag == "-" {
			continue
		}
		name := strings.Split(tag, ",")[0]
		if name == "" {
			name = f.Name // 无 tag 的匿名字段等场景
		}
		path := name
		if prefix != "" {
			path = prefix + "." + name
		}
		out[path] = true
		collectJSONPaths(f.Type, path, depth-1, out)
	}
}

// assertRequired 断言 want 里每个字段路径都在 have 中存在。
func assertRequired(t *testing.T, endpoint string, have map[string]bool, want []string) {
	t.Helper()
	var missing []string
	for _, w := range want {
		if !have[w] {
			missing = append(missing, w)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		t.Errorf("%s 响应缺少面板依赖的字段 %v —— 面板对应功能会静默失效。"+
			"若确为有意改名，请同步更新 web/app.js 的取数处与本文件的依赖清单", endpoint, missing)
	}
}

func emitOf(v any) map[string]bool {
	out := map[string]bool{}
	collectJSONPaths(reflect.TypeOf(v), "", 3, out)
	return out
}

// uiWantsState：GET /api/state（及已登录时 GET /api/auth/state 同形状）面板实际读取的字段。
// 逐条对账自 web/app.js 渲染层（renderTopbar/renderAccounts/renderTimes/settings）与 pet.js。
var uiWantsState = []string{
	"version", "running", "listen_host", "listen_port", "lan_ip", "api_key",
	"accounts", "checkin_times", "next_checkin", "login_busy",
	"admin_pass_set", "auth_enabled", "auth_session", "auth_required",
	"autostart", "backup_proxy", "backup_proxy_active",
	"model_fallback", "oczen_api_key",
	// loop_guard 自 R50 起被 Settings.jsx 的「思考链防癫」开关读取。它必须进这张表：
	// 面板用的是 `state.loop_guard !== false`，Go 侧哪天漏发这个字段，读出来是 undefined，
	// 判据照样成立 ⇒ 开关恒显示「开」而实际配置可能是关 —— 静默的错，正是本闸门要拦的形态。
	"loop_guard",
	// body_log 自 L18 起被 Settings.jsx 的「请求体摘要」开关读取（Go 漏发 ⇒ 开关恒 off）。
	"body_log",
	// reasoning_efforts / custom_channels 自 v2.7.3（R63/R66）起被 Settings.jsx 读取
	// （思考强度编辑区与自定义渠道编辑区）。同理必须进表：Go 侧漏发时面板读出空对象，
	// 编辑区画成「未配置」而实际配置是别的 —— 静默的错。
	"reasoning_efforts", "custom_channels",
	"compat", "compat.default_channel", "compat.max_tokens_cap",
	"compat.model_map", "compat.channels",
	"accounts.uid", "accounts.group", "accounts.nickname", "accounts.disabled",
	"accounts.credits", "accounts.expiring_credits", "accounts.unusable_credits",
	"accounts.credits_stale", "accounts.credits_na",
	"accounts.cooling", "accounts.err_count", "accounts.reason",
	// L18：登录态失效徽标 / 重登、冷却相对时长、Token 计量标签。
	"accounts.session_dead", "accounts.session_dead_reason", "accounts.until_ts", "accounts.credits_unit",
	"accounts.last_checkin_at", "accounts.last_checkin_ok",
}

// 面板不读、React 类型里不必声明（Go 仍发，属对外兼容余量或内部自用，不算缺陷）：
//   State.keepalive_hours · AccountView.until / last_checkin_msg
//   ResourceItem.key（ledger 差分自用）· RefreshSummary.total / platforms（动态 key 大 map）
//   CheckinResult.uid / has_remain · feesModelRow.supports_tools
//   Stats.token.pt|ct|by_day.total · CreditStats.expire · RecentCredit.name
// 上面这份清单是 2026-09-30 对 web/app.js + web/pet.js 全文取数点穷举的结果，
// 2026-10-14 起改以 cmd/wild-work/webui/src（React 源码，活体面板）为准——
// 同一轮里 `proxies` 换成 `backup_proxy`/`model_fallback`（R57/R54）。
// 移植时按它砍类型定义；若某天面板开始消费其中一项，把它加进对应的 uiWants* 即可。

func TestStateFieldContract(t *testing.T) {
	have := emitOf(State{})
	assertRequired(t, "GET /api/state", have, uiWantsState)
	t.Logf("/api/state 面板依赖 %d 个字段路径", len(uiWantsState))
}

// TestFieldProbeMechanism 证明反射探针真的递归进了切片里的结构体。
// 若这条红了，说明上面所有字段级断言都是假绿灯 —— 探针失效比缺字段更危险。
func TestFieldProbeMechanism(t *testing.T) {
	have := emitOf(State{})
	for _, p := range []string{"accounts", "accounts.credits", "compat", "compat.model_map"} {
		if !have[p] {
			t.Errorf("探针未递归到 %q，字段级契约整体失效", p)
		}
	}
	if have["accounts.nonexistent_field_zzz"] {
		t.Error("探针过度匹配")
	}
	// 死重字段必须仍在 wire 上但不在依赖清单里 —— 两边都对不上说明清单漂了
	if have["keepalive_hours"] && contains(uiWantsState, "keepalive_hours") {
		t.Error("keepalive_hours 既被列为面板依赖又被记为不消费，清单自相矛盾")
	}
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func TestResourceDetailFieldContract(t *testing.T) {
	have := emitOf(provider.ResourceItem{})
	assertRequired(t, "POST /api/account/resource_detail 的 items[]", have, []string{
		"name", "total", "used", "remain", "usable", "expire_at",
	})
}

func TestCheckinFieldContract(t *testing.T) {
	have := emitOf(scheduler.CheckinResult{})
	assertRequired(t, "POST /api/account/checkin 及 checkin_all.results[]", have, []string{
		"ok", "msg", "remain", "retryable",
	})
}

func TestRefreshSummaryFieldContract(t *testing.T) {
	have := emitOf(RefreshSummary{})
	assertRequired(t, "POST /api/account/refresh_all", have, []string{
		"busy", "ok", "failed",
	})
}

func TestUsageFieldContract(t *testing.T) {
	have := emitOf(ledger.Stats{})
	assertRequired(t, "GET /api/usage", have, []string{
		"recorded_since",
		"token", "token.total", "token.requests",
		"token.by_day", "token.by_day.date", "token.by_day.by_channel",
		"token.by_model", "token.by_model.model", "token.by_model.channel",
		"token.by_model.requests", "token.by_model.pt", "token.by_model.ct",
		"credit", "credit.spend", "credit.earn",
		"credit.entries", "credit.entries.kind", "credit.entries.ts",
		"credit.entries.uid", "credit.entries.amount", "credit.entries.note",
		"credit.entries.channel", "credit.entries.balance",
		"credit.name_map",
		// disabled 由 handler 在 ledger 为 nil 时以内联 map 直接下发，不在 Stats 上，
		// 单独断言见 TestUsageDisabledKeyIsInline。
	})
}

// TestUsageDisabledKeyIsInline 锁住一个容易踩的坑：/api/usage 在记账关闭时返回的
// {disabled:true} 不是 Stats 的字段，而是 handler 内联 map。React 侧若只按
// Stats 生成类型会完全没有 disabled，用量页就无从显示「已关闭」。
func TestUsageDisabledKeyIsInline(t *testing.T) {
	src := readPackageSource(t)
	if !strings.Contains(src, `"disabled"`) {
		t.Error(`/api/usage 的内联响应里已扫不到 "disabled" 键，面板的「记账已关闭」分支会失效`)
	}
	if emitOf(ledger.Stats{})["disabled"] {
		t.Log("注：disabled 已上升为 Stats 字段，可改为纯反射断言")
	}
}

// TestFeesFieldContract 费率表 payload 是 map + feesChannel/feesModelRow 混拼，
// 反射覆盖不到 map 层，所以顶层键走源码字面量扫描、模型行走反射。
func TestFeesFieldContract(t *testing.T) {
	src := readPackageSource(t)
	for _, k := range []string{`"note"`, `"channels"`, `"disclaimer"`, `"cached_at"`, `"error"`} {
		if !strings.Contains(src, k) {
			t.Errorf("GET /api/fees 的顶层键 %s 在 Go 源码中已扫不到", k)
		}
	}
	have := emitOf(feesModelRow{})
	assertRequired(t, "GET /api/fees 的 channels[].models[]", have, []string{
		"model", "priced", "rate", "free", "note", "color",
		"has_context", "context_window", "max_tokens",
		"supports_images", "supports_reasoning",
	})
	if !emitOf(feesChannel{})["models"] || !emitOf(feesChannel{})["channel"] {
		t.Error("feesChannel 缺 channel/models 键，费率表分组渲染会塌")
	}
}

// TestInlineMapPayloadKeys 覆盖其余以内联 map 下发的响应（反射无路可走）。
// 采用源码字面量扫描是刻意取舍：宁可误报（字符串在注释里也算命「存在」），
// 也不漏报「键没了」—— 漏报的代价是面板静默掉功能。
func TestInlineMapPayloadKeys(t *testing.T) {
	src := readPackageSource(t)
	cases := []struct {
		endpoint string
		keys     []string
	}{
		{"GET /api/pulse", []string{`"requests"`, `"last_request_ms"`}},
		{"POST /api/auth/login", []string{`"session"`}},
		{"POST /api/login/start", []string{`"auth_url"`}},
		{"GET /api/login/glm_auto_status", []string{`"status"`, `"nickname"`, `"uid"`, `"error"`}},
		{"POST /api/config/oczen_test", []string{`"ok"`, `"status"`, `"body"`}},
		{"POST /api/account/resource_detail", []string{`"items"`, `"usable_remain"`, `"unusable_remain"`}},
		{"GET /api/auth/state", []string{`"auth_enabled"`, `"auth_session"`, `"auth_required"`}},
	}
	for _, c := range cases {
		for _, k := range c.keys {
			if !strings.Contains(src, k) {
				t.Errorf("%s 依赖的键 %s 在 internal/app 源码中已扫不到", c.endpoint, k)
			}
		}
	}
}
