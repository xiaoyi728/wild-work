package server

import (
	"net/http"
	"testing"

	"wild-work/internal/provider"
)

// upstream_fault_no_account_penalty_test.go：锁定「上游侧故障不得惩罚健康账号」。
//
// 2026-10-18 实测事故（上游 lobsterai）：上游对某类请求回 500，ErrServer 可轮换
// ⇒ 一次客户端请求打 3 个账号各 +1 errCount，而 err_threshold 默认 3 ⇒ 重试一次
// 就把三个健康账号全冷却 10 分钟、整条渠道 503。账号本身完全健康。
//
// 修法（2026-10-20 摘取上游 v2.9.2）：5xx 默认不计数，只有渠道显式声明
// CountServerErrorAsAccountFault 才计入。轮转语义不变。

// TestServerErrorDoesNotCountAsAccountError 5xx 不得累计账号错误计数。
func TestServerErrorDoesNotCountAsAccountError(t *testing.T) {
	up := &kindedUpstream{
		status: http.StatusInternalServerError,
		kind:   provider.ErrServer,
		body:   `{"code":500,"message":"服务器内部错误","data":null}`,
	}
	h := newRotateTestHandler(t, up, "srv-")
	p := h.cfg.Runtimes[provider.GLM].Pool

	for i := 0; i < 3; i++ {
		doChat(t, h, "glm/m")
	}

	for _, uid := range []string{"srv-A", "srv-B"} {
		st, ok := p.Status(uid)
		if !ok {
			t.Fatalf("账号 %s 不在池中", uid)
		}
		if st.Cooling {
			t.Errorf("账号 %s 因上游 5xx 被冷却（reason=%q until=%v）—— 5xx 是服务端故障，不该记到客户端凭据头上", uid, st.Reason, st.Until)
		}
	}
}

// TestServerErrorCountsWhenExplicitlyRequested 逃生门：渠道显式声明后仍可计入。
// 防止未来把「默认不计」误改成「永远不计」——真有渠道用 5xx 表达账号级封禁时，
// 开关必须仍然有效。
func TestServerErrorCountsWhenExplicitlyRequested(t *testing.T) {
	up := &kindedUpstream{
		status: http.StatusInternalServerError,
		kind:   provider.ErrServer,
		body:   `{"code":500,"message":"服务器内部错误"}`,
	}
	h := newRotateTestHandler(t, up, "srvx-")
	h.cfg.Runtimes[provider.GLM].CountServerErrorAsAccountFault = true
	p := h.cfg.Runtimes[provider.GLM].Pool

	// 每次请求会轮转两个账号（各 +1）；err_threshold=3 ⇒ 第 3 次请求后两个账号都达阈值。
	for i := 0; i < 3; i++ {
		doChat(t, h, "glm/m")
	}

	cooled := false
	for _, uid := range []string{"srvx-A", "srvx-B"} {
		if st, ok := p.Status(uid); ok && st.Cooling {
			cooled = true
		}
	}
	if !cooled {
		t.Fatal("显式开启 CountServerErrorAsAccountFault 后，5xx 应累计错误并在达阈值时冷却账号")
	}
}

// TestModelBlockedCoolsOnlyThatModel 「模型不存在」是 (账号,模型) 级负缓存避让，
// 不得冻结整个账号（上游 v2.9.2 修正）。
func TestModelBlockedCoolsOnlyThatModel(t *testing.T) {
	up := &kindedUpstream{
		status: http.StatusNotFound,
		kind:   provider.ErrModelBlocked,
		body:   `{"error":{"message":"Invalid model."}}`,
	}
	h := newRotateTestHandler(t, up, "mb-")
	p := h.cfg.Runtimes[provider.GLM].Pool

	doChat(t, h, "glm/m")

	for _, uid := range []string{"mb-A", "mb-B"} {
		st, ok := p.Status(uid)
		if !ok {
			t.Fatalf("账号 %s 不在池中", uid)
		}
		if st.Cooling {
			t.Errorf("账号 %s 被整号冷却（reason=%q）—— ErrModelBlocked 只应冻结该模型", uid, st.Reason)
		}
	}
}
