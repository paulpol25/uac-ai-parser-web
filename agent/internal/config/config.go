// Package config handles agent configuration loading and defaults.
package config

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

const Version = "0.2.0"

// Config holds all runtime configuration for the agent.
type Config struct {
	AgentID           string `json:"agent_id"`
	APIKey            string `json:"api_key"`
	BackendURL        string `json:"backend_url"`
	WSEndpoint        string `json:"ws_endpoint"`
	HeartbeatInterval int    `json:"heartbeat_interval"` // seconds
	UACProfile        string `json:"uac_profile"`
	UACBinaryPath     string `json:"uac_binary_path"`
	UACCommit         string `json:"uac_commit"` // pin UAC to a specific git commit hash
	WorkDir           string `json:"work_dir"`

	// Security
	EncryptionKey  string `json:"encryption_key"`   // base64-encoded AES-256 key for payload encryption
	TLSSkipVerify  bool   `json:"tls_skip_verify"`  // only for development/testing
	ServerCertPath string `json:"server_cert_path"` // optional path to CA cert for pinning

	// Performance
	MaxConcurrency int `json:"max_concurrency"` // max concurrent command goroutines (default 5)

	// Allowed paths for collect_file (empty = allow all)
	AllowedCollectPaths []string `json:"allowed_collect_paths"`
}

// Load reads configuration from a JSON file and returns a Config.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	cfg := &Config{
		WSEndpoint:        "/ws/agent",
		HeartbeatInterval: 30,
		UACProfile:        "ir_triage",
		UACBinaryPath:     "/opt/uac-ai-agent/uac/uac",
		WorkDir:           "/opt/uac-ai-agent/work",
		MaxConcurrency:    5,
	}

	if err := json.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if cfg.AgentID == "" || cfg.APIKey == "" || cfg.BackendURL == "" {
		return nil, fmt.Errorf("agent_id, api_key, and backend_url are required")
	}

	// Ensure work directory exists with restricted permissions
	if err := os.MkdirAll(cfg.WorkDir, 0o700); err != nil {
		return nil, fmt.Errorf("create work dir: %w", err)
	}

	return cfg, nil
}

// TLSConfig returns a *tls.Config suitable for the agent's HTTP/WS clients.
func (c *Config) TLSConfig() *tls.Config {
	tlsCfg := &tls.Config{
		MinVersion: tls.VersionTLS12,
	}

	if c.TLSSkipVerify {
		tlsCfg.InsecureSkipVerify = true
	}

	if c.ServerCertPath != "" {
		// Load a custom CA certificate for server verification / pinning
		certPool, err := loadCertPool(c.ServerCertPath)
		if err == nil && certPool != nil {
			tlsCfg.RootCAs = certPool
		}
	}

	return tlsCfg
}

// HTTPTransport returns a configured http.Transport with TLS settings.
func (c *Config) HTTPTransport() *http.Transport {
	return &http.Transport{
		TLSClientConfig:   c.TLSConfig(),
		MaxIdleConns:      10,
		IdleConnTimeout:   90 * time.Second,
		ForceAttemptHTTP2: true,
	}
}

// WSURL returns the full WebSocket URL for the agent connection.
// The API key is sent during the WS handshake via a custom header,
// NOT as a query parameter (to avoid logging in access logs).
func (c *Config) WSURL() string {
	scheme := "ws"
	base := c.BackendURL
	if len(base) > 5 && base[:5] == "https" {
		scheme = "wss"
		base = base[5:]
	} else if len(base) > 4 && base[:4] == "http" {
		base = base[4:]
	}
	return scheme + base + c.WSEndpoint
}

// APIURL returns a full REST API URL for the given path.
func (c *Config) APIURL(path string) string {
	return c.BackendURL + path
}

// SafeIDPrefix returns a safe prefix of an ID for logging (handles short IDs).
func SafeIDPrefix(id string) string {
	if len(id) >= 8 {
		return id[:8]
	}
	return id
}
