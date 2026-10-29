package server

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"wild-work/internal/auth"
	"wild-work/internal/pool"
	"wild-work/internal/provider"
)

// refresh_failure_test.go：锁定「refresh 失败按错误语义分层」（R111 的另一半）。
//
// 旧实现把 refresh 失败一律当账号故障：网络/DNS 错误 → 冷却 10 分钟并换号（一次
// 网络抖动冷却整池）；401 → Pool.Disable 永久停用（把可自愈的会话失效钉成手动停用）。
// 正确语义：网络错误直接 502 不罚号；SessionDead 标 session_dead（重登自愈）；
// 其余账号级错误才冷却。

// refreshFailUpstream 复用 kindedUpstream 的对话行为，只把 RefreshToken 换成可配置错误。
type refreshFailUpstream struct {
	*kindedUpstream
	err error
}

func (u *refreshFailUpstream) RefreshToken(*auth.Auth) error { return u.err }

func newRefreshFailHandler(t *testing.T, refreshErr error) *Handler {
	t.Helper()
	p := pool.New(t.TempDir() + "/state.json")
	// ExpiresAt=1 ⇒ NeedsRefresh 恒真，请求路径必然先走 refresh。
	for _, uid := range []string{"rfa-A", "rfa-B"} {
		p.Add(&auth.Auth{Kind: "glm", AccessToken: "at", ExpiresAt: 1, UID: uid})
	}
	up := &refreshFailUpstream{
		kindedUpstream: &kindedUpstream{},
		err:            refreshErr,
	}
	return NewHandler(Config{
		Runtimes: map[provider.Kind]*Runtime{
			provider.GLM: {Kind: provider.GLM, Pool: p, Upstream: up},
		},
		SoftCooldown: time.Minute,
		ErrCooldown:  10 * time.Minute,
	})
}

// TestRefreshNetworkErrorNoPenalty 本机 DNS 故障：直接 502，账号不进冷却/停用/会话失效。
func TestRefreshNetworkErrorNoPenalty(t *testing.T) {
	h := newRefreshFailHandler(t, errors.New(`Post "https://api.example/token": dial tcp: lookup api.example: no such host`))
	rec := doChat(t, h, "glm/m")
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("网络类 refresh 失败应直接 502（不换号），实际 %d: %s", rec.Code, rec.Body.String())
	}
	p := h.cfg.Runtimes[provider.GLM].Pool
	for _, uid := range []string{"rfa-A", "rfa-B"} {
		st, ok := p.Status(uid)
		if !ok {
			t.Fatalf("账号 %s 不在池中", uid)
		}
		if st.Cooling || st.Disabled || st.SessionDead {
			t.Errorf("账号 %s 被网络故障惩罚了（cooling=%v disabled=%v session_dead=%v reason=%q）",
				uid, st.Cooling, st.Disabled, st.SessionDead, st.Reason)
		}
	}
}

// TestRefreshSessionDeadMarksNotDisables refresh 401：标 session_dead（可自愈），不永久停用。
func TestRefreshSessionDeadMarksNotDisables(t *testing.T) {
	h := newRefreshFailHandler(t, &provider.Error{Kind: provider.ErrSessionDead, Msg: "refresh token invalid"})
	doChat(t, h, "glm/m")
	p := h.cfg.Runtimes[provider.GLM].Pool
	marked := 0
	for _, uid := range []string{"rfa-A", "rfa-B"} {
		st, ok := p.Status(uid)
		if !ok {
			t.Fatalf("账号 %s 不在池中", uid)
		}
		if st.Disabled {
			t.Errorf("账号 %s 被永久停用 —— refresh 401 必须标 session_dead（重登后按 auth 文件 mtime 自愈）", uid)
		}
		if st.SessionDead {
			marked++
		}
	}
	if marked == 0 {
		t.Fatal("refresh 401 应至少标记一个账号 session_dead")
	}
}

// TestRefreshAccountErrorStillCools 其它账号级错误（如刷新接口 5xx）：仍按冷却处理并换号。
func TestRefreshAccountErrorStillCools(t *testing.T) {
	h := newRefreshFailHandler(t, errors.New("refresh endpoint returned 500"))
	doChat(t, h, "glm/m")
	p := h.cfg.Runtimes[provider.GLM].Pool
	cooled := 0
	for _, uid := range []string{"rfa-A", "rfa-B"} {
		if st, ok := p.Status(uid); ok && st.Cooling {
			cooled++
		}
	}
	if cooled == 0 {
		t.Fatal("非网络、非 SessionDead 的 refresh 失败仍应冷却账号（避免反复撞坏号）")
	}
}
