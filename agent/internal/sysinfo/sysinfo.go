// Package sysinfo collects basic system information from the host.
package sysinfo

import (
	"net"
	"os"
	"runtime"
	"strings"

	"uac-ai-agent/internal/config"
)

// Info holds basic system identification data.
type Info struct {
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	IP       string `json:"ip"`
	Version  string `json:"version"`
}

// Collect gathers system info from the running host.
func Collect() Info {
	hostname, _ := os.Hostname()

	osInfo := runtime.GOOS + "/" + runtime.GOARCH
	if data, err := os.ReadFile("/etc/os-release"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			if strings.HasPrefix(line, "PRETTY_NAME=") {
				osInfo = strings.Trim(line[12:], "\"")
				break
			}
		}
	}

	return Info{
		Hostname: hostname,
		OS:       osInfo,
		IP:       primaryIP(),
		Version:  config.Version,
	}
}

func primaryIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
			return ipnet.IP.String()
		}
	}
	return ""
}
