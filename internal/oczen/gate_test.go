// gate_test.go 冻结 2026-10-15 实测的免费档闸门判据。
//
// 本渠道的闸门由**上游服务端**判定，本地跑不了端到端，判据只能来自
// 「单变量实测的 200/403 字面样本」。纪律（R23b / L13 的教训）：
// **期望值一律写字面量**——用被测函数反算期望值，测试与实现同错就永远绿，
// 而上一版 `TestCanonicalSessionID` 正是这样当了 bug 的护身符。
//
// 实测矩阵（2026-10-15 直连 opencode.ai，POST /chat/completions，
// 每项重复 3–8 次，结果稳定不抖；模型 big-pickle）：
//
//	/zen/v1/chat/completions + 其余全对           → 403 FreeTierError
//	/inference/v1/chat/completions + 其余全对     → 200
//	携带 x-session-affinity 或 X-Session-Id       → 403
//	x-opencode-request = "req_"+32hex             → 403
//	x-opencode-request = "msg_"+20 位随机 Base62   → 403
//	x-opencode-request = msg_<12位hex><14位Base62> → 200
//	User-Agent = "dsh/1.0"（无 opencode/ 记号）    → 403
//	User-Agent = "opencode/1.18.31"（带记号）      → 200
//	session 段为随机 hex（非铸造 descending）      → 403
//	tools：bash+read 各带非空 parameters           → 200
//	tools：bash+read 的 parameters 为空 properties → 403
//	tools：只声明 bash                             → 403
//	tools：只声明 read                             → 200
//	（2026-10-13 起沿用，同日复核）session 段末三位
//	  落在 0xFFF-counter（counter 1–40 实测接受）  → 200
package oczen

import (
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

// TestDefaultBaseIsInferencePath 对话端点须在 /inference/v1 下：
// /zen/v1 即便请求与官方客户端逐字相同也 403（2026-10-15 实测）。
// 模型目录不受影响（两个前缀都仍 200），故本断言只锁聊天基址。
func TestDefaultBaseIsInferencePath(t *testing.T) {
	const want = "https://opencode.ai/inference/v1"
	if DefaultBase != want {
		t.Fatalf("DefaultBase = %q; want %q（/zen/v1 自 2026-10-15 起对话恒 403）", DefaultBase, want)
	}
}

// TestHeaderedDropsAffinityHeaders 亲和头族必须**不发**。
// 2026-09 的实测是「缺它们降低被识别为官方客户端的概率」，2026-10-15 反转成
// 「带了就 403」——故这条测试锁的是反转后的语义，回退到旧行为即失败。
func TestHeaderedDropsAffinityHeaders(t *testing.T) {
	c := NewWithBase("http://127.0.0.1:1")
	req, err := http.NewRequest(http.MethodPost, "http://127.0.0.1:1/chat/completions", nil)
	if err != nil {
		t.Fatal(err)
	}
	c.headered(req, "ses_fffffffffffeRSGHFb8Eo12DHv")

	for _, k := range []string{"x-session-affinity", "X-Session-Id"} {
		if got := req.Header.Get(k); got != "" {
			t.Errorf("%s 必须不发（2026-10-15 起带了即 403），实得 %q", k, got)
		}
	}
}

// TestHeaderedSendsCanonicalSessionHeaders 规范会话头：x-opencode-session 与
// x-opencode-session-id 同值，且 x-opencode-request 是铸造形状。
func TestHeaderedSendsCanonicalSessionHeaders(t *testing.T) {
	c := NewWithBase("http://127.0.0.1:1")
	req, _ := http.NewRequest(http.MethodPost, "http://127.0.0.1:1/chat/completions", nil)
	c.headered(req, "ses_fffffffffffeRSGHFb8Eo12DHv")

	if got := req.Header.Get("x-opencode-session-id"); got != "ses_fffffffffffeRSGHFb8Eo12DHv" {
		t.Errorf("x-opencode-session-id 须与 x-opencode-session 同值，实得 %q", got)
	}
	if got := req.Header.Get("x-opencode-project"); got != "global" {
		t.Errorf("x-opencode-project 应为真实客户端的 global，实得 %q", got)
	}
	if !strings.Contains(req.Header.Get("User-Agent"), "opencode/") {
		t.Errorf("User-Agent 须含 opencode/ 记号（无记号实测 403）：%q", req.Header.Get("User-Agent"))
	}
	if got := req.Header.Get("x-opencode-request"); !requestIDPattern.MatchString(got) {
		t.Errorf("x-opencode-request 须是 msg_<12位hex><14位Base62>（实测 req_/随机串一律 403），实得 %q", got)
	}
}

// TestMintRequestIDShape 铸造的回合 id 外形与字面样本一致。
// 字面样本取自 2026-10-15 实测被接受的那一发（仅作形状对照，不作等值断言——
// 时间戳段随调用时刻变化）。
func TestMintRequestIDShape(t *testing.T) {
	accepted := "msg_ec11af293001FDOgBox6LIG2rh" // 实测 200 的同形状样本（尾部为占位）
	if !requestIDPattern.MatchString(accepted) {
		t.Fatalf("判据把实测被接受的形状判成不合法：%q", accepted)
	}
	rejected := []string{
		"req_" + strings.Repeat("a", 32),   // 旧实现：前缀错
		"msg_" + strings.Repeat("Z", 20),   // 长度错
		"msg_" + strings.Repeat("g", 12) + strings.Repeat("a", 14), // 段内非 hex（g）
	}
	for _, r := range rejected {
		if requestIDPattern.MatchString(r) {
			t.Errorf("判据把实测被拒的形状判成合法：%q", r)
		}
	}
	for i := 0; i < 32; i++ {
		got := mintRequestID()
		if !requestIDPattern.MatchString(got) {
			t.Fatalf("mintRequestID 产出非铸造形状：%q", got)
		}
	}
}

// TestToolFingerprintRequiresNonEmptySchema 免费档要求 bash 与 read 都声明，
// 且各自 parameters 至少一个 property（空 properties 被拒）。
// 无论客户端带了什么，ensureAgentShape 之后的出站体必须满足该指纹。
// （实测的反常项如实记录：只声明 bash 也 403，只声明 read 却 200——
// 故「两个都补」是唯一稳妥的写法，不要按「只补缺失的那个」优化。）
func TestToolFingerprintRequiresNonEmptySchema(t *testing.T) {
	inputs := []struct {
		name  string
		tools []string // 出站体里预置的桩工具
	}{
		{"空 tools（纯聊天）", nil},
		{"只带 bash", []string{"bash"}},
		{"只带 read", []string{"read"}},
		{"两个都带", []string{"bash", "read"}},
	}
	for _, in := range inputs {
		obj := map[string]any{"stream": true, "messages": []any{map[string]any{"role": "user", "content": "hi"}}}
		if in.tools != nil {
			anyTools := make([]any, 0, len(in.tools))
			for _, n := range in.tools {
				anyTools = append(anyTools, stubTool(n))
			}
			obj["tools"] = anyTools
		}
		ensureAgentShape(obj)

		have := toolNames(obj)
		for _, n := range []string{"bash", "read"} {
			if !have[n] {
				t.Errorf("%s：出站体缺 %s 桩工具（实测缺一即 403）", in.name, n)
			}
		}
		// 每个桩工具的 parameters 必须至少一个 property（空 properties 实测 403）。
		for _, raw := range obj["tools"].([]any) {
			fn := raw.(map[string]any)["function"].(map[string]any)
			params, _ := fn["parameters"].(map[string]any)
			props, _ := params["properties"].(map[string]any)
			if len(props) == 0 {
				t.Errorf("%s：桩工具 %v 的 parameters 无 property（实测空 properties 被拒）", in.name, fn["name"])
			}
		}
	}
}

// TestSessionGateLiteralSamples 会话段判据必须能分辨实测 200 与实测 403 的字面样本。
// 表驱动、期望值字面量：防止把判据改成「形状对就放行」这类永绿写法。
func TestSessionGateLiteralSamples(t *testing.T) {
	cases := []struct {
		signal string
		want   bool // 是否落在被判据放行的铸造窗口
		note   string
	}{
		{"ses_fffffffffffeRSGHFb8Eo12DHv", true, "2026-10-15 实测 200（counter=1，末三位 ffe）"},
		{"ses_ec11af293ffeFDOgBox6LIG2rh", true, "2026-10-15 实测 200（真实时间戳 + counter=1）"},
		{"ses_ffffffffffd8ZJ0Ph2lMRN7j97", true, "2026-10-13 实测 200（counter=40，末三位 fd8）"},
		{"ses_q9TeuBRoira46w5Rm4yneoKXxg", false, "2026-10-15 实测 403（随机 hex 段）"},
		{"ses_000000000ffeEEHYPYQpBSiDTm", true, "2026-10-13 实测 200（时间戳 0，只校验 counter 窗口）"},
	}
	for _, c := range cases {
		// 已被判据认可的样本必须原样透传（保 prompt cache 亲和）；
		// 未被认可的必须被重铸成同一形状。
		got := canonicalSessionID(c.signal)
		recognized := got == c.signal
		if recognized != c.want {
			t.Errorf("canonicalSessionID(%q) 是否透传 = %v; want %v（%s）",
				c.signal, recognized, c.want, c.note)
		}
		if !sessionShapePattern.MatchString(got) {
			t.Errorf("canonicalSessionID(%q) 产出非官方外形: %q", c.signal, got)
		}
		if got != c.signal && !descendingTimePartPattern.MatchString(got[4:16]) {
			t.Errorf("重铸结果的时间戳段不在铸造窗口内: %q", got)
		}
	}
}

// TestChatStreamSendsGateCleanWire 端到端锁「发往上游的请求满足全部五道闸门」。
// 独立于 TestChatStreamRequestShape：那条只管形状齐套，这条管**不该有的有没有**。
func TestChatStreamSendsGateCleanWire(t *testing.T) {
	var gotH http.Header
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotH = r.Header.Clone()
		gotPath = r.URL.Path
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	c := NewWithBase(srv.URL)
	rc, status, _, err := c.ChatStream(AnonymousAuth(),
		[]byte(`{"model":"big-pickle","messages":[{"role":"user","content":"hi"}]}`))
	if err != nil || status != 200 {
		t.Fatalf("ChatStream 失败: status=%d err=%v", status, err)
	}
	defer rc.Close()

	if gotPath != "/chat/completions" {
		t.Errorf("路径 %q", gotPath)
	}
	for _, k := range []string{"x-session-affinity", "X-Session-Id"} {
		if v := gotH.Get(k); v != "" {
			t.Errorf("%s 必须不发（带了即 403），实得 %q", k, v)
		}
	}
	if got := gotH.Get("x-opencode-session"); !strings.HasPrefix(got, "ses_") {
		t.Errorf("x-opencode-session 非规范会话形状: %q", got)
	}
	if got := gotH.Get("x-opencode-session-id"); got != gotH.Get("x-opencode-session") {
		t.Errorf("x-opencode-session-id 须与会话同值: %q vs %q", got, gotH.Get("x-opencode-session"))
	}
	if !requestIDPattern.MatchString(gotH.Get("x-opencode-request")) {
		t.Errorf("x-opencode-request 非铸造形状: %q", gotH.Get("x-opencode-request"))
	}
	if !strings.Contains(gotH.Get("User-Agent"), "opencode/") {
		t.Errorf("User-Agent 缺 opencode/ 记号: %q", gotH.Get("User-Agent"))
	}
}

// requestIDPatternMirror 仅用于断言「判据不是照着实现抄的」：独立写一份正则，
// 两者必须一致（写法不同的同义表达会让下面的对照失效，故两处都列出来对账）。
var requestIDPatternMirror = regexp.MustCompile(`^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$`)

func TestRequestIDPatternMirror(t *testing.T) {
	if requestIDPattern.String() != requestIDPatternMirror.String() {
		t.Fatalf("判据与镜像不一致：%q vs %q", requestIDPattern, requestIDPatternMirror)
	}
}