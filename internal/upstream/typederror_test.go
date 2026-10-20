package upstream

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"wild-work/internal/auth"
)

// typederror_test.go 锁定 R79：目录/费率接口遇 HTTP ≥400 必须返回**类型化** *Error。
//
// 为什么必须锁死：上层 RefreshPricing 的 401 自愈（refresh + 重试，不变量 19）
// 全靠 errors.As 取分类。这两个接口原来返回裸 fmt.Errorf（`models api status 401: …`），
// errors.As 恒 false ⇒ 401 自愈在模型面与费率面**永远不可能生效**：本地 expiresAt
// 仍在未来而上游已拒绝时（token 在别处被轮换 / 上游临时吊销），目录与费率只能一直陈旧。
//
// 2026-10-20 摘取上游 v2.9.1 R79（本仓此前只做了 WorkBuddyAI 自己的 client）。

// TestFetchModelsPricingReturnTypedError 两条路径都必须返回 *upstream.Error。
func TestFetchModelsPricingReturnTypedError(t *testing.T) {
	mk := func(status int, body string) *Client {
		return testClient(func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: status,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(body)),
			}, nil
		})
	}
	a := &auth.Auth{AccessToken: "at", UID: "u1"}

	cases := []struct {
		name   string
		status int
		body   string
		want   ErrKind
	}{
		{"models 401", http.StatusUnauthorized, `{"code":12153,"msg":"Offline user session not found"}`, ErrSessionDead},
		{"models 500", http.StatusInternalServerError, `boom`, ErrServer},
		{"pricing 401", http.StatusUnauthorized, `{"code":12153,"msg":"Offline user session not found"}`, ErrSessionDead},
		{"pricing 500", http.StatusInternalServerError, `boom`, ErrServer},
	}
	for _, tc := range cases {
		c := mk(tc.status, tc.body)
		var err error
		if strings.HasPrefix(tc.name, "models") {
			_, err = c.FetchModels(a)
		} else {
			_, err = c.FetchModelPricing(a)
		}
		if err == nil {
			t.Fatalf("%s：应返回错误", tc.name)
		}
		var ue *Error
		if !errors.As(err, &ue) {
			t.Fatalf("%s：必须返回 *upstream.Error（否则上层自愈拿不到分类），实得 %T: %v", tc.name, err, err)
		}
		if ue.Kind != tc.want {
			t.Fatalf("%s：kind=%v want %v", tc.name, ue.Kind, tc.want)
		}
		if ue.Status != tc.status {
			t.Fatalf("%s：status=%d want %d", tc.name, ue.Status, tc.status)
		}
	}
}
