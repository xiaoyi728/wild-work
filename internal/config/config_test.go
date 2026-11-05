package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefault(t *testing.T) {
	c := Default()
	if c.Listen.Addr() != "127.0.0.1:7863" {
		t.Errorf("listen=%s", c.Listen.Addr())
	}
	if c.APIKey != "CyWorkAPI" {
		t.Errorf("api_key=%q", c.APIKey)
	}
	if err := c.normalize(); err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if c.HardCreditDur.Hours() != 12 {
		t.Errorf("hard=%v", c.HardCreditDur)
	}
}

func TestListenParsing(t *testing.T) {
	cases := []struct {
		in   string
		addr string
	}{
		{":9999", ":9999"},
		{"127.0.0.1:9999", "127.0.0.1:9999"},
		{"9999", ":9999"},
		{"0.0.0.0:7863", "0.0.0.0:7863"},
	}
	for _, c := range cases {
		l, err := ParseListen(c.in)
		if err != nil {
			t.Errorf("ParseListen(%q): %v", c.in, err)
			continue
		}
		if got := l.Addr(); got != c.addr {
			t.Errorf("ParseListen(%q).Addr()=%s want %s", c.in, got, c.addr)
		}
	}
	if _, err := ParseListen(":notaport"); err == nil {
		t.Error("want error for bad port")
	}
}

func TestLoadFile(t *testing.T) {
	dir := t.TempDir()
	fp := filepath.Join(dir, "c.json")
	os.WriteFile(fp, []byte(`{"listen":"127.0.0.1:9999","api_key":"k","region":"cn"}`), 0o600)
	c, err := Load(fp)
	if err != nil {
		t.Fatal(err)
	}
	if c.Listen.Addr() != "127.0.0.1:9999" || c.APIKey != "k" {
		t.Errorf("c=%+v", c)
	}
}

func TestLoadFileObjectListen(t *testing.T) {
	dir := t.TempDir()
	fp := filepath.Join(dir, "c.json")
	os.WriteFile(fp, []byte(`{"listen":{"host":"192.168.1.2","port":8000}}`), 0o600)
	c, err := Load(fp)
	if err != nil {
		t.Fatal(err)
	}
	if c.Listen.Addr() != "192.168.1.2:8000" {
		t.Errorf("addr=%s", c.Listen.Addr())
	}
}

func TestSaveRoundtrip(t *testing.T) {
	dir := t.TempDir()
	fp := filepath.Join(dir, "sub", "c.json")
	c := Default()
	c.Listen.Host = "127.0.0.1"
	c.Schedule.CheckinHours = []int{8, 20}
	if err := Save(c, fp); err != nil {
		t.Fatal(err)
	}
	c2, err := Load(fp)
	if err != nil {
		t.Fatal(err)
	}
	if c2.Listen.Addr() != "127.0.0.1:7863" {
		t.Errorf("addr=%s", c2.Listen.Addr())
	}
	if len(c2.Schedule.CheckinHours) != 2 || c2.Schedule.CheckinHours[0] != 8 {
		t.Errorf("hours=%v", c2.Schedule.CheckinHours)
	}
}

func TestEnvOverride(t *testing.T) {
	t.Setenv("WILDWORK_LISTEN", ":7777")
	t.Setenv("WILDWORK_API_KEY", "envkey")
	c, err := Load("")
	if err != nil {
		t.Fatal(err)
	}
	if c.Listen.Addr() != ":7777" || c.APIKey != "envkey" {
		t.Errorf("c=%+v", c)
	}
}

func TestClockTimes(t *testing.T) {
	got, err := ParseClockTimes([]string{"21:30", "09:05", "09:05"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != 9*60+5 || got[1] != 21*60+30 {
		t.Fatalf("minutes=%v", got)
	}
	if _, err := ParseClockTimes([]string{"24:00"}); err == nil {
		t.Fatal("want invalid time error")
	}
	if got := FormatClockTimes(got); got[0] != "09:05" || got[1] != "21:30" {
		t.Fatalf("times=%v", got)
	}
}

func TestLoadLegacyCheckinHours(t *testing.T) {
	dir := t.TempDir()
	fp := filepath.Join(dir, "c.json")
	os.WriteFile(fp, []byte(`{"schedule":{"checkin_hours":[8,20]}}`), 0o600)
	c, err := Load(fp)
	if err != nil {
		t.Fatal(err)
	}
	if got := c.Schedule.CheckinTimes; len(got) != 2 || got[0] != "08:00" || got[1] != "20:00" {
		t.Fatalf("times=%v", got)
	}
}

func TestLoadMinuteCheckinTimes(t *testing.T) {
	dir := t.TempDir()
	fp := filepath.Join(dir, "c.json")
	os.WriteFile(fp, []byte(`{"schedule":{"checkin_times":["09:05","21:30"]}}`), 0o600)
	c, err := Load(fp)
	if err != nil {
		t.Fatal(err)
	}
	if got := c.Schedule.CheckinTimes; len(got) != 2 || got[0] != "09:05" || got[1] != "21:30" {
		t.Fatalf("times=%v", got)
	}
}

func TestAdminPasswordAndLoopback(t *testing.T) {
	dir := t.TempDir()
	fp := filepath.Join(dir, "c.json")
	// 旧配置（无 admin_password）必须能加载，且默认空 = 面板不鉴权
	os.WriteFile(fp, []byte(`{"listen":"127.0.0.1:9999"}`), 0o600)
	c, err := Load(fp)
	if err != nil {
		t.Fatal(err)
	}
	if c.AdminPass != "" {
		t.Errorf("缺省 admin_password 应为空，实际 %q", c.AdminPass)
	}
	// 新字段可读
	os.WriteFile(fp, []byte(`{"listen":{"host":"0.0.0.0","port":8000},"admin_password":"pw12345678"}`), 0o600)
	if c, err = Load(fp); err != nil {
		t.Fatal(err)
	} else if c.AdminPass != "pw12345678" {
		t.Errorf("admin_password=%q", c.AdminPass)
	}
	// env 覆盖
	t.Setenv("WILDWORK_ADMIN_PASSWORD", "env-pw")
	if c, err = Load(fp); err != nil || c.AdminPass != "env-pw" {
		t.Errorf("env override 失败：%v %q", err, c.AdminPass)
	}
	// IsLoopback
	for host, want := range map[string]bool{"127.0.0.1": true, "localhost": true, "::1": true, "0.0.0.0": false, "": false, "192.168.1.9": false} {
		if got := (Listen{Host: host}).IsLoopback(); got != want {
			t.Errorf("IsLoopback(%q)=%v want %v", host, got, want)
		}
	}
}

func TestBadDuration(t *testing.T) {
	dir := t.TempDir()
	fp := filepath.Join(dir, "c.json")
	os.WriteFile(fp, []byte(`{"cooldown":{"hard_credit":"not-a-duration"}}`), 0o600)
	if _, err := Load(fp); err == nil {
		t.Fatal("want error for bad duration")
	}
}

// TestExpiringDaysNormalize 临期展示口径只接受 1/2/7（R112b），非法值在内存回退
// 默认 1 天，且**加载时不写盘**（与 sticky_max_requests 同一纪律）。
func TestExpiringDaysNormalize(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want int
	}{
		{"缺字段落默认", `{}`, DefaultExpiringDays},
		{"显式1日", `{"schedule":{"expiring_days":1}}`, 1},
		{"显式2日", `{"schedule":{"expiring_days":2}}`, 2},
		{"显式7日", `{"schedule":{"expiring_days":7}}`, 7},
		{"非法3回退", `{"schedule":{"expiring_days":3}}`, DefaultExpiringDays},
		{"非法0回退", `{"schedule":{"expiring_days":0}}`, DefaultExpiringDays},
		{"非法负数回退", `{"schedule":{"expiring_days":-1}}`, DefaultExpiringDays},
		{"非法30回退", `{"schedule":{"expiring_days":30}}`, DefaultExpiringDays},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cfg := loadWith(t, c.in)
			if cfg.Schedule.ExpiringDays != c.want {
				t.Errorf("expiring_days = %d, want %d", cfg.Schedule.ExpiringDays, c.want)
			}
		})
	}
}

// TestIsExpiringDays 面板下拉框的合法集合。
func TestIsExpiringDays(t *testing.T) {
	for _, d := range []int{1, 2, 7} {
		if !IsExpiringDays(d) {
			t.Errorf("IsExpiringDays(%d) = false, want true", d)
		}
	}
	for _, d := range []int{0, 3, 4, 5, 6, 8, 30, -1} {
		if IsExpiringDays(d) {
			t.Errorf("IsExpiringDays(%d) = true, want false", d)
		}
	}
}

// TestDefaultExpiringDaysIsOne 默认口径必须与运行统计「今日到期」列同源。
func TestDefaultExpiringDaysIsOne(t *testing.T) {
	if got := Default().Schedule.ExpiringDays; got != DefaultExpiringDays {
		t.Errorf("Default().Schedule.ExpiringDays = %d, want %d", got, DefaultExpiringDays)
	}
}
