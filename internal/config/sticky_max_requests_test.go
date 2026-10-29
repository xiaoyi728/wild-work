package config

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// 粘性路由轮换阈值可配（2026-10-28）：默认 50；缺字段/非法值回落默认；
// 非法值只 WARN，**不改写**用户配置文件。

func TestDefaultStickyMaxRequests(t *testing.T) {
	c := Default()
	if c.Server.StickyMaxRequests != DefaultStickyMaxRequests {
		t.Fatalf("默认 sticky_max_requests = %d, want %d", c.Server.StickyMaxRequests, DefaultStickyMaxRequests)
	}
	if err := c.normalize(); err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if c.Server.StickyMaxRequests != DefaultStickyMaxRequests {
		t.Fatalf("normalize 后 = %d", c.Server.StickyMaxRequests)
	}
}

func TestStickyMaxRequestsMissingKeepsDefault(t *testing.T) {
	t.Setenv("WILDWORK_API_KEY", "")
	dir := t.TempDir()
	fp := filepath.Join(dir, "config.json")
	before := []byte(`{"server":{"max_request_body_mb":128}}`)
	if err := os.WriteFile(fp, before, 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := Load(fp)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.Server.StickyMaxRequests != DefaultStickyMaxRequests {
		t.Fatalf("缺字段应取默认 %d，实际 %d", DefaultStickyMaxRequests, c.Server.StickyMaxRequests)
	}
	after, err := os.ReadFile(fp)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(after, before) {
		t.Fatalf("加载不得改写配置文件：\nbefore=%s\nafter=%s", before, after)
	}
}

func TestStickyMaxRequestsExplicitValue(t *testing.T) {
	t.Setenv("WILDWORK_API_KEY", "")
	dir := t.TempDir()
	fp := filepath.Join(dir, "config.json")
	if err := os.WriteFile(fp, []byte(`{"server":{"sticky_max_requests":7}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := Load(fp)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if c.Server.StickyMaxRequests != 7 {
		t.Fatalf("显式值应保留 7，实际 %d", c.Server.StickyMaxRequests)
	}
}

func TestStickyMaxRequestsInvalidFallsBack(t *testing.T) {
	for _, v := range []string{`0`, `-3`} {
		t.Setenv("WILDWORK_API_KEY", "")
		dir := t.TempDir()
		fp := filepath.Join(dir, "config.json")
		raw := []byte(`{"server":{"sticky_max_requests":` + v + `}}`)
		if err := os.WriteFile(fp, raw, 0o600); err != nil {
			t.Fatal(err)
		}
		c, err := Load(fp)
		if err != nil {
			t.Fatalf("Load(%s): %v", v, err)
		}
		if c.Server.StickyMaxRequests != DefaultStickyMaxRequests {
			t.Fatalf("非法值 %s 应回落 %d，实际 %d", v, DefaultStickyMaxRequests, c.Server.StickyMaxRequests)
		}
		after, _ := os.ReadFile(fp)
		if !bytes.Equal(after, raw) {
			t.Fatalf("非法值不得触发配置改写：%s", after)
		}
	}
}
