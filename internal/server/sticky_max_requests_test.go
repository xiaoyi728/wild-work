package server

import (
	"net/http"
	"testing"
	"time"

	"wild-work/internal/auth"
	"wild-work/internal/config"
	"wild-work/internal/pool"
	"wild-work/internal/provider"
)

// 粘性路由轮换阈值来自 Handler 配置（config.server.sticky_max_requests），
// 不是包内硬编码的 50（R127）。

func TestStickyMaxRequestsFromConfig(t *testing.T) {
	p := pool.New("")
	p.Add(&auth.Auth{UID: "A", AccessToken: "at-A", ExpiresAt: time.Now().Add(time.Hour).Unix()})
	p.Add(&auth.Auth{UID: "B", AccessToken: "at-B", ExpiresAt: time.Now().Add(time.Hour).Unix()})
	p.SetCreditDetail("A", 1000, 0, 0, time.Time{})
	p.SetCreditDetail("B", 500, 0, 0, time.Time{})
	up := &kindedUpstream{}
	up.succeed = func(string) bool { return true }
	rt := &Runtime{Kind: provider.GLM, Pool: p, Upstream: up}
	h := NewHandler(Config{
		Runtimes:          map[provider.Kind]*Runtime{provider.GLM: rt},
		StickyMaxRequests: 2,
	})

	if got := h.pickWithSticky(rt, "m"); got == nil || got.UID != "A" {
		t.Fatalf("首次应选余额更高的 A，实际 %+v", got)
	}
	if st := h.StickySnapshot()["glm"]; st.UID != "A" || st.Max != 2 {
		t.Fatalf("粘性记录应使用配置阈值 2，实际 %+v", st)
	}

	for i := 0; i < 2; i++ {
		rec := doChat(t, h, "glm/m")
		if rec.Code != http.StatusOK {
			t.Fatalf("第 %d 次请求应成功，实际 status=%d body=%s", i+1, rec.Code, rec.Body.String())
		}
	}
	h.stickyMu.RLock()
	count := h.sticky[rt.Kind.String()].reqCount
	h.stickyMu.RUnlock()
	if count != 2 {
		t.Fatalf("连续成功 2 次后粘性计数应为 2，实际 %d", count)
	}
	if got := h.pickWithSticky(rt, "m"); got == nil {
		t.Fatal("阈值耗尽后应重新选号")
	}
	if st := h.StickySnapshot()["glm"]; st.Max != 2 || st.Count != 0 {
		t.Fatalf("阈值耗尽后应重建计数并继续用配置阈值 2，实际 %+v", st)
	}
}

func TestStickyMaxRequestsDefaultForLegacyHandlerCall(t *testing.T) {
	h := NewHandler(Config{})
	if h.cfg.StickyMaxRequests != config.DefaultStickyMaxRequests {
		t.Fatalf("未注入时应回落默认 %d，实际 %d",
			config.DefaultStickyMaxRequests, h.cfg.StickyMaxRequests)
	}
}
