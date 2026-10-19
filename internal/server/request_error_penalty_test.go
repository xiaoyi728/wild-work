package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"wild-work/internal/provider"
)

// 本文件锁定「请求级错误不得惩罚账号」：
//   - ErrClient 跟着请求体走，换号必然同样拒收 ⇒ 只轮转、不累计 errCount；
//   - ErrImageInvalid / ErrBadParams 的 ErrKind 注释早已写明请求级，handler 曾漏掉
//     这两个 case 落入 default 做 NoteError（客户端坏请求能把健康账号冷却）。

func postChat(t *testing.T, h *Handler) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions",
		strings.NewReader(`{"model":"glm/m","messages":[{"role":"user","content":"hi"}]}`))
	h.ServeHTTP(rec, req)
	return rec
}

func assertNoPenalty(t *testing.T, h *Handler, uids ...string) {
	t.Helper()
	for _, uid := range uids {
		st, ok := h.cfg.Runtimes[provider.GLM].Pool.Status(uid)
		if !ok {
			t.Fatalf("账号 %s 不存在", uid)
		}
		if st.Cooling {
			t.Errorf("账号 %s 被请求级错误冷却（reason=%s）", uid, st.Reason)
		}
		if st.ErrCount != 0 {
			t.Errorf("账号 %s 累计了 %d 次错误计数（请求级错误不得罚号）", uid, st.ErrCount)
		}
	}
}

// TestErrClientRotatesWithoutErrorCount ErrClient 仍轮转（兼容同模型不同账号权益差异），
// 但候选耗尽后不得把错误记到账号头上。
func TestErrClientRotatesWithoutErrorCount(t *testing.T) {
	up := &kindedUpstream{status: http.StatusBadRequest, kind: provider.ErrClient, body: `{"code":11148}`}
	h := newRotateTestHandler(t, up, "U")

	rec := postChat(t, h)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("候选耗尽应透传上游 400，实际 %d body=%s", rec.Code, rec.Body.String())
	}
	if got := len(up.calls); got < 2 {
		t.Errorf("ErrClient 应轮转到其它账号（调用 %d 次），否则同模型不同权益场景会退化", got)
	}
	assertNoPenalty(t, h, "UA", "UB")
}

// TestImageInvalidAndBadParamsTransparent 请求级错误原文透传、不轮转、不计错。
func TestImageInvalidAndBadParamsTransparent(t *testing.T) {
	for _, tc := range []struct {
		name string
		kind provider.ErrKind
	}{
		{"image_invalid", provider.ErrImageInvalid},
		{"bad_params", provider.ErrBadParams},
	} {
		t.Run(tc.name, func(t *testing.T) {
			up := &kindedUpstream{status: http.StatusBadRequest, kind: tc.kind, body: `{"msg":"bad request"}`}
			h := newRotateTestHandler(t, up, "U")

			rec := postChat(t, h)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("应透传上游 400，实际 %d body=%s", rec.Code, rec.Body.String())
			}
			if got := len(up.calls); got != 1 {
				t.Errorf("请求级错误不应轮转，实际调用 %d 次", got)
			}
			if !strings.Contains(rec.Body.String(), "bad request") {
				t.Errorf("应透传上游原文，body=%s", rec.Body.String())
			}
			assertNoPenalty(t, h, "UA", "UB")
		})
	}
}
