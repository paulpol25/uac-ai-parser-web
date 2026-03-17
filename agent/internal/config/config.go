// Package config handles agent configuration loading and defaults.
package config

import (
	"encoding/json"
	"fmt"
	"os"
)

const Version = "0.1.0"

// Config holds all runtime configuration for the agent.
type Config struct {
	AgentID           string `json:"agent_id"`
	APIKey            string `json:"api_key"`
	BackendURL        string `json:"backend_url"`
	WSEndpoint        string `json:"ws_endpoint"`
	HeartbeatInterval int    `json:"heartbeat_interval"` // seconds
	UACProfile        string `json:"uac_profile"`
	UACBinaryPath     string `json:"uac_binary_path"`
	WorkDir           string `json:"work_dir"`
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
	}

	if err := json.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	if cfg.AgentID == "" || cfg.APIKey == "" || cfg.BackendURL == "" {
		return nil, fmt.Errorf("agent_id, api_key, and backend_url are required")
	}

	// Ensure work directory exists
	if err := os.MkdirAll(cfg.WorkDir, 0o700); err != nil {
		return nil, fmt.Errorf("create work dir: %w", err)
	}

	return cfg, nil
}

// WSURL returns the full WebSocket URL for the agent connection.
func (c *Config) WSURL() string {
	scheme := "ws"
	base := c.BackendURL
	if len(base) > 5 && base[:5] == "https" {
		scheme = "wss"
		base = base[5:]
	} else if len(base) > 4 && base[:4] == "http" {
		base = base[4:]
	}
	return scheme + base + c.WSEndpoint + "?api_key=" + c.APIKey
}

// APIURL returns a full REST API URL for the given path.
func (c *Config) APIURL(path string) string {
	return c.BackendURL + path
}
