package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// 降级链别名（R129）：三个接口共用同一套解析优先级
// （别名 → model_map 精确 → 通配 → default_channel）。

func TestRouterAliasPriority(t *testing.T) {
	rt := Router{
		Default:  "workbuddy",
		Map:      map[string]string{"gpt": "qoder/gmodel", "claude-*": "qoder/gmodel"},
		Channels: []string{"workbuddy", "qoder"},
		Aliases:  map[string]string{"gpt": "workbuddy/deepseek-v4.1-flash", "fast": "qoder/glm-5.3"},
	}
	cases := []struct{ in, want string }{
		{"gpt", "workbuddy/deepseek-v4.1-flash"}, // 别名优先于 model_map 精确
		{"fast", "qoder/glm-5.3"},                // 别名优先于 default_channel
		{"claude-x", "qoder/gmodel"},             // 未命中别名 → 通配照旧
		{"other", "workbuddy/other"},             // 未命中别名 → default 照旧
		{"qoder/glm-5.3", "qoder/glm-5.3"},       // 已带前缀不受别名表影响
	}
	for _, c := range cases {
		got, err := rt.Resolve(c.in)
		if err != nil {
			t.Fatalf("Resolve(%q): %v", c.in, err)
		}
		if got != c.want {
			t.Errorf("Resolve(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// 未配置别名时行为完全不变（零配置零开销）。
func TestRouterNoAliasUnchanged(t *testing.T) {
	rt := Router{Default: "workbuddy", Channels: []string{"workbuddy"}}
	if got, err := rt.Resolve("x"); err != nil || got != "workbuddy/x" {
		t.Fatalf("Resolve = %q, %v", got, err)
	}
}

// count_tokens 也必须认别名（否则会出现「Chat 能用、count_tokens 说不认识」）。
func TestCountTokensAcceptsAlias(t *testing.T) {
	inner := &scriptedHandler{}
	g := New(Config{Inner: inner, APIKey: "secret", Router: Router{
		Default:  "workbuddy",
		Channels: []string{"workbuddy", "qoder"},
		Aliases:  map[string]string{"gpt": "workbuddy/m"},
	}})
	mux := http.NewServeMux()
	g.Routes(mux)
	mux.Handle("/", inner)
	rec := post(mux, "/v1/messages/count_tokens",
		`{"model":"gpt","messages":[{"role":"user","content":"hi"}]}`)
	if rec.Code != 200 {
		t.Fatalf("别名在 count_tokens 上应被接受，实际 %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if n, _ := asInt(resp["input_tokens"]); n <= 0 {
		t.Errorf("input_tokens = %v", resp["input_tokens"])
	}
	// 未知模型仍报 400（解析不是无条件放行）
	rec = post(mux, "/v1/messages/count_tokens", `{"model":"","messages":[]}`)
	if rec.Code != 400 {
		t.Fatalf("空模型名应 400，实际 %d", rec.Code)
	}
	_ = httptest.NewRecorder
}
