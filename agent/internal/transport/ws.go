// Package transport — WebSocket-based real-time communication with the backend.
//
// WSTransport maintains a persistent WebSocket connection for instant
// command dispatch and result reporting.  It falls back to REST polling
// if the WebSocket server is unavailable.
package transport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	log "github.com/sirupsen/logrus"

	"uac-ai-agent/internal/config"
	"uac-ai-agent/internal/crypto"
	"uac-ai-agent/internal/sysinfo"
	"uac-ai-agent/internal/worker"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = 30 * time.Second
	maxMessageSize = 10 * 1024 * 1024 // 10 MB
)

// WSTransport provides a persistent WebSocket connection to the backend.
type WSTransport struct {
	cfg      *config.Config
	cmdCh    chan<- worker.Command
	resultCh <-chan worker.Result
	enc      *crypto.Engine
	rest     *Transport // fallback REST transport

	conn *websocket.Conn
	mu   sync.Mutex
	done chan struct{}
}

// NewWS creates a WebSocket transport with REST fallback.
func NewWS(cfg *config.Config, cmdCh chan<- worker.Command, resultCh <-chan worker.Result, enc *crypto.Engine) *WSTransport {
	return &WSTransport{
		cfg:      cfg,
		cmdCh:    cmdCh,
		resultCh: resultCh,
		enc:      enc,
		rest:     New(cfg, cmdCh, resultCh, enc),
		done:     make(chan struct{}),
	}
}

// Run connects to the WebSocket server and processes messages.
// Falls back to REST polling if WebSocket is unavailable.
func (ws *WSTransport) Run() {
	go ws.resultLoop()

	for {
		select {
		case <-ws.done:
			return
		default:
		}

		if err := ws.connect(); err != nil {
			log.Warnf("WebSocket connect failed: %v — falling back to REST", err)
			ws.restFallback()
			continue
		}

		log.Info("WebSocket connected")
		ws.sendAuth()
		ws.readLoop()

		// readLoop exited — connection lost, reconnect
		ws.mu.Lock()
		if ws.conn != nil {
			ws.conn.Close()
			ws.conn = nil
		}
		ws.mu.Unlock()

		log.Info("WebSocket disconnected, reconnecting in 5s...")
		select {
		case <-ws.done:
			return
		case <-time.After(5 * time.Second):
		}
	}
}

// Close shuts down the transport.
func (ws *WSTransport) Close() {
	close(ws.done)
	ws.mu.Lock()
	if ws.conn != nil {
		ws.conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		ws.conn.Close()
		ws.conn = nil
	}
	ws.mu.Unlock()
}

func (ws *WSTransport) connect() error {
	wsURL := ws.cfg.WSURL()
	if wsURL == "" {
		return fmt.Errorf("no WebSocket URL configured")
	}

	dialer := websocket.Dialer{
		TLSClientConfig:  ws.cfg.TLSConfig(),
		HandshakeTimeout: 15 * time.Second,
	}

	// Send API key via header instead of query parameter
	headers := http.Header{}
	headers.Set("X-Api-Key", ws.cfg.APIKey)

	conn, _, err := dialer.Dial(wsURL, headers)
	if err != nil {
		return err
	}

	conn.SetReadLimit(maxMessageSize)
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	ws.mu.Lock()
	ws.conn = conn
	ws.mu.Unlock()

	// Start ping ticker
	go ws.pingLoop()

	return nil
}

func (ws *WSTransport) sendAuth() {
	info := sysinfo.Collect()
	msg := map[string]interface{}{
		"type":        "auth",
		"agent_id":    ws.cfg.AgentID,
		"system_info": info,
	}
	ws.writeJSON(msg)
}

func (ws *WSTransport) readLoop() {
	for {
		select {
		case <-ws.done:
			return
		default:
		}

		ws.mu.Lock()
		conn := ws.conn
		ws.mu.Unlock()
		if conn == nil {
			return
		}

		conn.SetReadDeadline(time.Now().Add(pongWait))
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Errorf("WebSocket read error: %v", err)
			}
			return
		}

		var envelope struct {
			Type     string          `json:"type"`
			Message  string          `json:"message,omitempty"`
			Commands json.RawMessage `json:"commands,omitempty"`
			Command  json.RawMessage `json:"command,omitempty"`
		}
		if err := json.Unmarshal(message, &envelope); err != nil {
			log.Errorf("WebSocket message decode: %v", err)
			continue
		}

		switch envelope.Type {
		case "commands":
			var cmds []worker.Command
			if err := json.Unmarshal(envelope.Commands, &cmds); err != nil {
				log.Errorf("Commands decode: %v", err)
				continue
			}
			for _, cmd := range cmds {
				log.Infof("WS received command: %s (%s)", cmd.Type, config.SafeIDPrefix(cmd.ID))
				ws.cmdCh <- cmd
			}
		case "command":
			var cmd worker.Command
			if err := json.Unmarshal(envelope.Command, &cmd); err != nil {
				log.Errorf("Command decode: %v", err)
				continue
			}
			log.Infof("WS received command: %s (%s)", cmd.Type, config.SafeIDPrefix(cmd.ID))
			ws.cmdCh <- cmd
		case "heartbeat_ack":
			// Server acknowledged heartbeat
		case "welcome", "auth_ok":
			log.Debugf("WS: %s", envelope.Type)
		case "error":
			log.Warnf("WS server error: %s", envelope.Message)
		default:
			log.Debugf("Unknown WS message type: %s", envelope.Type)
		}
	}
}

func (ws *WSTransport) pingLoop() {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-ws.done:
			return
		case <-ticker.C:
			ws.mu.Lock()
			conn := ws.conn
			ws.mu.Unlock()
			if conn == nil {
				return
			}
			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				log.Debugf("Ping failed: %v", err)
				return
			}
			// Also send heartbeat with system info
			info := sysinfo.Collect()
			ws.writeJSON(map[string]interface{}{
				"type":        "heartbeat",
				"system_info": info,
			})
		}
	}
}

func (ws *WSTransport) resultLoop() {
	for {
		select {
		case <-ws.done:
			return
		case r := <-ws.resultCh:
			payload := map[string]interface{}{
				"type":       "result",
				"command_id": r.CommandID,
				"status":     r.Status,
				"result":     r.Data,
			}

			// Encrypt if enabled
			if ws.enc.Enabled() {
				resultJSON, err := json.Marshal(r.Data)
				if err == nil {
					if envelope, err := ws.enc.Encrypt(resultJSON); err == nil {
						payload["result"] = nil
						payload["encrypted_result"] = envelope
					}
				}
			}

			if err := ws.writeJSON(payload); err != nil {
				log.Errorf("WS result send failed: %v — falling back to REST report", err)
				ws.rest.reportResult(r)
			}

			// File uploads still use REST
			if r.FilePath != "" {
				ws.rest.uploadFile(r.FilePath, r.CommandID)
			}
		}
	}
}

func (ws *WSTransport) writeJSON(v interface{}) error {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	if ws.conn == nil {
		return fmt.Errorf("no connection")
	}
	ws.conn.SetWriteDeadline(time.Now().Add(writeWait))
	return ws.conn.WriteJSON(v)
}

// restFallback runs REST polling for a limited duration before retrying WS.
func (ws *WSTransport) restFallback() {
	log.Info("Running REST fallback for 60s before retrying WebSocket...")

	// Use REST checkin in a loop for 60 seconds
	ticker := time.NewTicker(time.Duration(ws.cfg.HeartbeatInterval) * time.Second)
	defer ticker.Stop()
	timeout := time.After(60 * time.Second)

	ws.rest.checkin()
	for {
		select {
		case <-ws.done:
			return
		case <-timeout:
			return
		case <-ticker.C:
			ws.rest.checkin()
		}
	}
}
