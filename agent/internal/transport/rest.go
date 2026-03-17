// Package transport implements REST-based communication with the backend.
//
// The agent polls /api/v1/agents/checkin at regular intervals to send
// heartbeats and receive pending commands.  Command results are POSTed
// to /api/v1/agents/report, and files to /api/v1/agents/upload.
package transport

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"time"

	log "github.com/sirupsen/logrus"

	"uac-ai-agent/internal/config"
	"uac-ai-agent/internal/sysinfo"
	"uac-ai-agent/internal/worker"
)

// Transport manages REST polling communication with the backend.
type Transport struct {
	cfg      *config.Config
	cmdCh    chan<- worker.Command
	resultCh <-chan worker.Result
	client   *http.Client
	done     chan struct{}
}

// New creates a Transport.
func New(cfg *config.Config, cmdCh chan<- worker.Command, resultCh <-chan worker.Result) *Transport {
	return &Transport{
		cfg:      cfg,
		cmdCh:    cmdCh,
		resultCh: resultCh,
		client:   &http.Client{Timeout: 30 * time.Second},
		done:     make(chan struct{}),
	}
}

// Run starts the polling loop and result sender.
func (t *Transport) Run() {
	go t.resultLoop()

	interval := time.Duration(t.cfg.HeartbeatInterval) * time.Second
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Immediate first checkin
	t.checkin()

	for {
		select {
		case <-t.done:
			return
		case <-ticker.C:
			t.checkin()
		}
	}
}

// Close stops the transport.
func (t *Transport) Close() {
	close(t.done)
}

// ------------------------------------------------------------------ //
//  Checkin — heartbeat + receive commands
// ------------------------------------------------------------------ //

func (t *Transport) checkin() {
	info := sysinfo.Collect()
	body, _ := json.Marshal(map[string]interface{}{
		"system_info": info,
	})

	url := t.cfg.APIURL("/api/v1/agents/checkin")
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		log.Errorf("Checkin request build: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Api-Key", t.cfg.APIKey)

	resp, err := t.client.Do(req)
	if err != nil {
		log.Errorf("Checkin HTTP: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		log.Errorf("Checkin failed (%d): %s", resp.StatusCode, string(respBody))
		return
	}

	var result struct {
		Commands []worker.Command `json:"commands"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		log.Errorf("Checkin decode: %v", err)
		return
	}

	for _, cmd := range result.Commands {
		log.Infof("Received command: %s (%s)", cmd.Type, cmd.ID[:8])
		t.cmdCh <- cmd
	}
}

// ------------------------------------------------------------------ //
//  Result loop — report command results and upload files
// ------------------------------------------------------------------ //

func (t *Transport) resultLoop() {
	for {
		select {
		case <-t.done:
			return
		case r := <-t.resultCh:
			t.reportResult(r)
			if r.FilePath != "" {
				t.uploadFile(r.FilePath, r.CommandID)
			}
		}
	}
}

func (t *Transport) reportResult(r worker.Result) {
	body, _ := json.Marshal(map[string]interface{}{
		"command_id": r.CommandID,
		"status":     r.Status,
		"result":     r.Data,
	})

	url := t.cfg.APIURL("/api/v1/agents/report")
	req, err := http.NewRequest("POST", url, bytes.NewReader(body))
	if err != nil {
		log.Errorf("Report request: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Api-Key", t.cfg.APIKey)

	resp, err := t.client.Do(req)
	if err != nil {
		log.Errorf("Report HTTP: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		log.Errorf("Report failed (%d): %s", resp.StatusCode, string(respBody))
		return
	}

	log.Infof("Reported result for command %s: %s", r.CommandID[:8], r.Status)
}

func (t *Transport) uploadFile(path string, commandID string) {
	const maxRetries = 3

	for attempt := 1; attempt <= maxRetries; attempt++ {
		err := t.tryUpload(path, commandID)
		if err == nil {
			return
		}
		log.Errorf("Upload attempt %d/%d failed: %v", attempt, maxRetries, err)
		if attempt < maxRetries {
			backoff := time.Duration(attempt*10) * time.Second
			log.Infof("Retrying upload in %v ...", backoff)
			time.Sleep(backoff)
		}
	}
	log.Errorf("Upload abandoned after %d attempts: %s", maxRetries, filepath.Base(path))
}

func (t *Transport) tryUpload(path string, commandID string) error {
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	// Include command_id so the backend can link the file to the command
	if commandID != "" {
		writer.WriteField("command_id", commandID)
	}

	part, err := writer.CreateFormFile("file", filepath.Base(path))
	if err != nil {
		return fmt.Errorf("create form file: %w", err)
	}
	if _, err := io.Copy(part, f); err != nil {
		return fmt.Errorf("copy to form: %w", err)
	}
	writer.Close()

	url := t.cfg.APIURL("/api/v1/agents/upload")
	req, err := http.NewRequest("POST", url, body)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("X-Api-Key", t.cfg.APIKey)

	uploadClient := &http.Client{Timeout: 30 * time.Minute}
	resp, err := uploadClient.Do(req)
	if err != nil {
		return fmt.Errorf("HTTP: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("server responded %d: %s", resp.StatusCode, string(respBody))
	}

	info, _ := os.Stat(path)
	size := int64(0)
	if info != nil {
		size = info.Size()
	}
	log.Infof("Uploaded %s (%d bytes, command %s)", filepath.Base(path), size, commandID[:8])
	return nil
}
