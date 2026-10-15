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
// 那么本包的 descendingTimePart / descendingTimePartPattern 就需要重新判读，
// 而不是默认继续生效。
func TestLiveGateStillRejectsRawHashSession(t *testing.T) {
	// 旧实现的实际产物（sha256 直出时间戳段，低 12 位 1c5 —— 窗口外）
	stale := "ses_3ae2ec8551c5AbCdEfGhIjKlMn"
	if !sessionShapePattern.MatchString(stale) {
		t.Fatalf("对照组形状不合法，测不出闸门: %q", stale)
	}
	if descendingTimePartPattern.MatchString(stale[4:16]) {
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

// TestLiveGateStillRejectsLegacyWire 活体对照（2026-10-15 新增）：2026-10-14 之前
// 那套 wire（/zen/v1 路径 + x-session-affinity 亲和头 + `req_` 形态回合 id）
// **仍须被拒**。这正是本包在 10-15 之前发出的形态，也是上游 master 至今仍在发的形态。
//
// 它要是变绿（200），说明上游把 10-15 的收紧撤了、或又换了判据，
// 那么 constants.go 的 DefaultBase / headered 需要重新判读，而不是默认继续生效。
func TestLiveGateStillRejectsLegacyWire(t *testing.T) {
	c := New()
	obj := map[string]any{
		"model":      "big-pickle",
		"max_tokens": 16,
		"messages":   []map[string]any{{"role": "user", "content": "reply with one word: ok"}},
	}
	ensureAgentShape(obj)
	out, _ := json.Marshal(obj)
	// 故意走旧基址（/zen/v1），且只发旧头族。
	req, err := http.NewRequest(http.MethodPost,
		"https://opencode.ai/zen/v1/chat/completions", bytes.NewReader(out))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	session := canonicalSessionID("live-legacy-control")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Authorization", "Bearer "+AnonymousKey)
	req.Header.Set("x-opencode-client", "cli")
	req.Header.Set("x-opencode-session", session)
	req.Header.Set("x-session-affinity", session) // 旧头族（10-15 起带了即 403）
	req.Header.Set("X-Session-Id", session)
	req.Header.Set("x-opencode-request", randomID("req", 16)) // 旧形态（req_+32hex）
	req.Header.Set("x-opencode-project", randomID("prj", 12))

	resp, err := c.HTTP.Do(req)
	if err != nil {
		t.Fatalf("传输层失败（先确认网络/代理可达 opencode.ai）: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("旧 wire 期望 403，实得 %d: %s —— 上游已撤/改了 10-15 的收紧，需重新判读 DefaultBase 与 headered",
			resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	if !strings.Contains(string(raw), "FreeTierError") {
		t.Fatalf("403 但不是 FreeTierError（可能是另一类故障）: %s", strings.TrimSpace(string(raw)))
	}
	t.Logf("闸门仍在：旧 wire（/zen/v1 + 亲和头 + req_ 回合 id）被拒 403 FreeTierError")
}
