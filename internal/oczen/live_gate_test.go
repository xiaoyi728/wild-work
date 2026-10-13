//go:build live

// live_gate_test.go 对真实 opencode.ai/zen 验证免费档闸门在我们当前请求形态下确实通过。
//
// 加它的原因就是 2026-10-13 那次故障：单测全绿、会话头形状全对、功能全无。
// mock 只能证明「实现自洽」，证明不了上游还认我们这个 id 布局。
//
//	go test -tags live ./internal/oczen/ -run TestLive -v
//
// 匿名凭证是常量，无需任何凭据即可跑；请求量每次一条。
package oczen

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

// liveChat 用指定会话头打一次真实对话，返回状态码与响应片段。
func liveChat(t *testing.T, session string) (int, string) {
	t.Helper()
	c := New()
	obj := map[string]any{
		"model":      "big-pickle",
		"max_tokens": 16,
		"messages":   []map[string]any{{"role": "user", "content": "reply with one word: ok"}},
	}
	ensureAgentShape(obj)
	out, err := json.Marshal(obj)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost, c.base()+"/chat/completions", bytes.NewReader(out))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	c.headered(req, session)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		t.Fatalf("传输层失败（先确认网络/代理可达 opencode.ai）: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
	return resp.StatusCode, string(raw)
}

// TestLiveMintedSessionAccepted 我们铸造的会话 id 必须被上游接受，且真的出流。
func TestLiveMintedSessionAccepted(t *testing.T) {
	c := New()
	body, _ := json.Marshal(map[string]any{
		"model":    "big-pickle",
		"messages": []map[string]any{{"role": "user", "content": "reply with one word: ok"}},
	})
	r, status, raw, err := c.ChatStream(AnonymousAuth(), body)
	if err != nil {
		t.Fatalf("ChatStream: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("上游 %d（非 200）: %s", status, strings.TrimSpace(string(raw)))
	}
	defer r.Close()
	// 200 但零帧同样算失效，所以要把流读出来。
	deadline := time.Now().Add(90 * time.Second)
	buf := make([]byte, 4096)
	read := 0
	for time.Now().Before(deadline) {
		n, err := r.Read(buf)
		read += n
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("读流中断（已读 %d 字节）: %v", read, err)
		}
		if read >= 512 {
			break
		}
	}
	if read == 0 {
		t.Fatal("HTTP 200 但流里零字节")
	}
	t.Logf("实盘通过：会话 %s 读到 %d 字节 SSE", canonicalSessionID("live-seed"), read)
}

// TestLiveGateStillRejectsRawHashSession 活体对照：上游 2026-10-13 起加的位不变量
// **仍在生效**——形状合法但低 12 位是随机摘要值时仍须 403。
//
// 这条要是变红（变成 200），说明上游把闸门撤了或改了判据，
// 那么本包的 descendingTimePart / gateTimePartPattern 就需要重新判读，
// 而不是默认继续生效。
func TestLiveGateStillRejectsRawHashSession(t *testing.T) {
	// 旧实现的实际产物（sha256 直出时间戳段，低 12 位 1c5 —— 窗口外）
	stale := "ses_3ae2ec8551c5AbCdEfGhIjKlMn"
	if !officialSessionPattern.MatchString(stale) {
		t.Fatalf("对照组形状不合法，测不出闸门: %q", stale)
	}
	if gateTimePartPattern.MatchString(stale[4:16]) {
		t.Fatalf("对照组已落在接受窗口内，测不出闸门: %q", stale)
	}
	status, raw := liveChat(t, stale)
	if status != http.StatusForbidden {
		t.Fatalf("对照组期望 403，实得 %d: %s —— 上游闸门已变，需重新判读 descendingTimePart",
			status, strings.TrimSpace(raw))
	}
	if !strings.Contains(raw, "FreeTierError") {
		t.Fatalf("403 但不是 FreeTierError（可能是另一类故障）: %s", strings.TrimSpace(raw))
	}
	t.Logf("闸门仍在：旧形态会话头被拒 403 FreeTierError")
}
