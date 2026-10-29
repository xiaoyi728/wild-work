package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"wild-work/internal/auth"
	"wild-work/internal/pool"
	"wild-work/internal/provider"
)

// 模型目录换号重试（R133）：目录是渠道维度的，「拉不到」不等于「渠道没有模型」，
// 必须换下一个账号重试；只有全部候选失败才进负缓存。

type catalogUpstream struct {
	*kindedUpstream
	mu    sync.Mutex
	calls []string
	// catalog 按 uid 返回目录；nil/空 = 该账号拉不到。
	catalog map[string][]provider.ModelInfo
	fail    map[string]bool
}

func (u *catalogUpstream) FetchModels(a *auth.Auth) ([]provider.ModelInfo, error) {
	u.mu.Lock()
	u.calls = append(u.calls, a.UID)
	u.mu.Unlock()
	if u.fail[a.UID] {
		return nil, nil
	}
	return u.catalog[a.UID], nil
}

func newCatalogHandler(t *testing.T, up *catalogUpstream) *Handler {
	t.Helper()
	p := pool.New("")
	p.Add(&auth.Auth{Kind: "glm", AccessToken: "at-A", ExpiresAt: time.Now().Add(time.Hour).Unix(), UID: "A"})
	p.Add(&auth.Auth{Kind: "glm", AccessToken: "at-B", ExpiresAt: time.Now().Add(time.Hour).Unix(), UID: "B"})
	// A 余额更高 ⇒ 首挑确定性（map 遍历无序，靠 credits 排序）
	p.SetCreditDetail("A", 1000, 0, 0, time.Time{})
	p.SetCreditDetail("B", 500, 0, 0, time.Time{})
	rt := &Runtime{Kind: provider.GLM, Pool: p, Upstream: up}
	return NewHandler(Config{Runtimes: map[provider.Kind]*Runtime{provider.GLM: rt}})
}

func listModels(t *testing.T, h *Handler) []string {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/v1/models", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("/v1/models status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("解析 /v1/models: %v", err)
	}
	out := make([]string, 0, len(body.Data))
	for _, d := range body.Data {
		out = append(out, d.ID)
	}
	return out
}

func TestModelsFetchRotatesBadAccount(t *testing.T) {
	up := &catalogUpstream{
		kindedUpstream: &kindedUpstream{},
		fail:           map[string]bool{"A": true}, // A 有号但拉不到目录
		catalog:        map[string][]provider.ModelInfo{"B": {{ID: "m1"}, {ID: "m2"}}},
	}
	h := newCatalogHandler(t, up)
	got := listModels(t, h)
	want := map[string]bool{"glm/m1": true, "glm/m2": true}
	for _, id := range got {
		if !want[id] {
			t.Errorf("意外的模型 %q（%v）", id, got)
		}
	}
	if len(got) != 2 {
		t.Fatalf("应拿到 B 的两个模型，实际 %v", got)
	}
	up.mu.Lock()
	n := len(up.calls)
	calls := append([]string{}, up.calls...)
	up.mu.Unlock()
	if n < 2 {
		t.Fatalf("A 拉不到时必须换号重试，实际只调了 %d 次（%v）", n, calls)
	}
	if calls[0] != "A" {
		t.Fatalf("首挑应为 A（余额更高），实际 %v", calls)
	}
}

func TestModelsFetchAllAccountsFailEntersNegativeCache(t *testing.T) {
	up := &catalogUpstream{
		kindedUpstream: &kindedUpstream{},
		fail:           map[string]bool{"A": true, "B": true},
	}
	h := newCatalogHandler(t, up)
	if got := listModels(t, h); len(got) != 0 {
		t.Fatalf("所有账号都拉不到时模型面应为空，实际 %v", got)
	}
	up.mu.Lock()
	first := len(up.calls)
	up.mu.Unlock()
	if first != 2 {
		t.Fatalf("两个账号都应被尝试，实际 %d 次", first)
	}
	// 负缓存期内不得再打上游（5 分钟）
	listModels(t, h)
	up.mu.Lock()
	second := len(up.calls)
	up.mu.Unlock()
	if second != first {
		t.Fatalf("失败负缓存期内不应再次探测上游：%d → %d", first, second)
	}
}
