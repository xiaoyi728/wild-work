package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"wild-work/internal/auth"
	"wild-work/internal/config"
	"wild-work/internal/pool"
	"wild-work/internal/provider"
)

// 降级链别名（R129）：别名只解析「进来的模型名」——路由、容量判定、降级链、
// 记账、档位注入全部按主力模型走；响应 model 仍回填客户端请求名（别名）。

type captureUpstream struct {
	*kindedUpstream
	mu   sync.Mutex
	body []byte
}

func (u *captureUpstream) ChatStream(a *auth.Auth, body []byte) (io.ReadCloser, int, []byte, error) {
	u.mu.Lock()
	u.body = append([]byte{}, body...)
	u.mu.Unlock()
	return io.NopCloser(strings.NewReader("data: [DONE]\n\n")), http.StatusOK, nil, nil
}

func (u *captureUpstream) FetchModels(*auth.Auth) ([]provider.ModelInfo, error) {
	return []provider.ModelInfo{{ID: "m", SupportsTools: true, ReasoningEfforts: []string{"low", "high"}}}, nil
}

func newAliasHandler(t *testing.T) (*Handler, *captureUpstream) {
	t.Helper()
	p := pool.New("")
	p.Add(&auth.Auth{Kind: "glm", AccessToken: "at", ExpiresAt: time.Now().Add(time.Hour).Unix(), UID: "A"})
	up := &captureUpstream{kindedUpstream: &kindedUpstream{}}
	rt := &Runtime{Kind: provider.GLM, Pool: p, Upstream: up,
		StaticModels: []provider.ModelInfo{{ID: "m", SupportsTools: true, ReasoningEfforts: []string{"low", "high"}}}}
	h := NewHandler(Config{
		Runtimes: map[provider.Kind]*Runtime{provider.GLM: rt},
		ModelFallbacks: []config.ModelFallbackRule{
			{Name: "gpt", From: "glm/m", To: []string{"glm/m2"}},
		},
		ReasoningEfforts: map[string]string{"glm/m": "high"},
	})
	return h, up
}

func TestChatResolvesAliasAtEntry(t *testing.T) {
	h, up := newAliasHandler(t)
	body := `{"model":"gpt","stream":false,"messages":[{"role":"user","content":"hi"}]}`
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("别名请求应成功，实际 %d: %s", rec.Code, rec.Body.String())
	}
	up.mu.Lock()
	sent := append([]byte{}, up.body...)
	up.mu.Unlock()
	var got map[string]any
	if err := json.Unmarshal(sent, &got); err != nil {
		t.Fatalf("上游 body 非 JSON: %v", err)
	}
	if got["model"] != "m" {
		t.Fatalf("上游收到的 model 应为主力模型的渠道内 ID m，实际 %v", got["model"])
	}
	if got["reasoning_effort"] != "high" {
		t.Fatalf("档位注入应按**主力模型**的键命中（glm/m → high），实际 %v", got["reasoning_effort"])
	}
}

func TestModelsListsAliasEntry(t *testing.T) {
	h, _ := newAliasHandler(t)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/models", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("/v1/models status=%d", rec.Code)
	}
	var body struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	var alias, real bool
	for _, d := range body.Data {
		switch d["id"] {
		case "gpt":
			alias = true
			if d["alias"] != "glm/m" {
				t.Errorf("别名条目 alias 字段应为主力全路径，实际 %v", d["alias"])
			}
			if d["supports_tools"] != true {
				t.Error("别名条目应逐字段继承主力模型能力（supports_tools）")
			}
		case "glm/m":
			real = true
		}
	}
	if !alias || !real {
		t.Fatalf("应同时列出别名与真实模型（alias=%v real=%v）：%+v", alias, real, body.Data)
	}
	if body.Data[0]["id"] != "gpt" {
		t.Errorf("别名条目应排在真实模型之前，首条 = %v", body.Data[0]["id"])
	}
}

// 主力模型不在目录里 ⇒ 别名条目不出现（不凭空造条目）。
func TestModelsOmitsAliasWhenTargetUnknown(t *testing.T) {
	p := pool.New("")
	p.Add(&auth.Auth{Kind: "glm", AccessToken: "at", ExpiresAt: time.Now().Add(time.Hour).Unix(), UID: "A"})
	rt := &Runtime{Kind: provider.GLM, Pool: p, Upstream: &kindedUpstream{},
		StaticModels: []provider.ModelInfo{{ID: "m"}}}
	h := NewHandler(Config{
		Runtimes: map[provider.Kind]*Runtime{provider.GLM: rt},
		ModelFallbacks: []config.ModelFallbackRule{
			{Name: "ghost", From: "glm/nope", To: []string{"glm/m"}},
		},
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/models", nil))
	if strings.Contains(rec.Body.String(), `"ghost"`) {
		t.Fatalf("主力模型不在目录时不得列出别名条目：%s", rec.Body.String())
	}
}

// 未命中别名时行为不变（零配置/零命中零开销）。
func TestChatWithoutAliasUnchanged(t *testing.T) {
	h, up := newAliasHandler(t)
	body := `{"model":"glm/m","stream":false,"messages":[{"role":"user","content":"hi"}]}`
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("直接请求主力模型应成功，实际 %d", rec.Code)
	}
	up.mu.Lock()
	sent := string(up.body)
	up.mu.Unlock()
	if !strings.Contains(sent, `"model":"m"`) {
		t.Fatalf("上游 body 的 model 应保持渠道内 ID：%s", sent)
	}
}
