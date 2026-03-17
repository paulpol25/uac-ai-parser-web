// Package worker processes commands received from the backend.
package worker

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	log "github.com/sirupsen/logrus"

	"uac-ai-agent/internal/config"
)

// Result is sent back to the transport layer after a command completes.
type Result struct {
	CommandID string                 `json:"command_id"`
	Status    string                 `json:"status"` // "completed" or "failed"
	Data      map[string]interface{} `json:"data"`
	FilePath  string                 `json:"-"` // local path to upload (if any)
}

// Command represents a command received from the backend.
type Command struct {
	ID      string                 `json:"id"`
	Type    string                 `json:"type"`
	Payload map[string]interface{} `json:"payload"`
}

// Worker processes commands from a channel and emits results.
type Worker struct {
	cfg      *config.Config
	resultCh chan<- Result
	done     chan struct{}
}

// New creates a Worker.
func New(cfg *config.Config, resultCh chan<- Result) *Worker {
	return &Worker{
		cfg:      cfg,
		resultCh: resultCh,
		done:     make(chan struct{}),
	}
}

// Run reads raw JSON commands from cmdCh and dispatches them.
func (w *Worker) Run(cmdCh <-chan json.RawMessage) {
	for {
		select {
		case <-w.done:
			return
		case raw := <-cmdCh:
			var cmd Command
			if err := json.Unmarshal(raw, &cmd); err != nil {
				log.Errorf("Bad command JSON: %v", err)
				continue
			}
			go w.execute(cmd)
		}
	}
}

// RunTyped reads typed Command structs from cmdCh and dispatches them.
func (w *Worker) RunTyped(cmdCh <-chan Command) {
	for {
		select {
		case <-w.done:
			return
		case cmd := <-cmdCh:
			go w.execute(cmd)
		}
	}
}

// Close stops the worker.
func (w *Worker) Close() {
	close(w.done)
}

// cleanup removes the agent install directory and disables the systemd service.
func (w *Worker) cleanup() {
	installDir := filepath.Dir(w.cfg.WorkDir) // /opt/uac-ai-agent
	log.Infof("Cleaning up install directory: %s", installDir)

	// Disable systemd service (best-effort)
	disable := exec.Command("systemctl", "disable", "--now", "uac-ai-agent.service")
	if out, err := disable.CombinedOutput(); err != nil {
		log.Warnf("Failed to disable service: %v (%s)", err, string(out))
	}
	// Remove unit file
	os.Remove("/etc/systemd/system/uac-ai-agent.service")
	exec.Command("systemctl", "daemon-reload").Run()

	// Remove install directory
	if err := os.RemoveAll(installDir); err != nil {
		log.Warnf("Failed to remove %s: %v", installDir, err)
	} else {
		log.Infof("Removed %s", installDir)
	}
}

// ------------------------------------------------------------------ //

func (w *Worker) execute(cmd Command) {
	log.Infof("Executing command %s (type=%s)", cmd.ID[:8], cmd.Type)
	start := time.Now()

	var result Result
	switch cmd.Type {
	case "run_uac":
		result = w.runUAC(cmd)
	case "exec_command":
		result = w.execCommand(cmd)
	case "collect_file":
		result = w.collectFile(cmd)
	case "run_check":
		result = w.runCheck(cmd)
	case "shutdown":
		result = Result{CommandID: cmd.ID, Status: "completed", Data: map[string]interface{}{"message": "shutting down"}}
		w.resultCh <- result
		// Clean up install directory before signalling shutdown
		w.cleanup()
		// Signal shutdown
		p, _ := os.FindProcess(os.Getpid())
		p.Signal(os.Interrupt)
		return
	default:
		result = Result{
			CommandID: cmd.ID,
			Status:    "failed",
			Data:      map[string]interface{}{"error": fmt.Sprintf("unknown command type: %s", cmd.Type)},
		}
	}

	result.CommandID = cmd.ID
	elapsed := time.Since(start)
	if result.Data == nil {
		result.Data = map[string]interface{}{}
	}
	result.Data["elapsed_ms"] = elapsed.Milliseconds()
	log.Infof("Command %s finished (%s) in %v", cmd.ID[:8], result.Status, elapsed)

	w.resultCh <- result
}

// ------------------------------------------------------------------ //
//   UAC runner
// ------------------------------------------------------------------ //

func (w *Worker) runUAC(cmd Command) Result {
	profile := w.cfg.UACProfile
	if p, ok := cmd.Payload["profile"].(string); ok && p != "" {
		profile = p
	}

	outputDir := filepath.Join(w.cfg.WorkDir, "uac-output", cmd.ID[:8])
	if err := os.MkdirAll(outputDir, 0o700); err != nil {
		return Result{Status: "failed", Data: map[string]interface{}{"error": err.Error()}}
	}

	// Ensure the UAC repo is present — clone it if missing.
	uacDir := filepath.Dir(w.cfg.UACBinaryPath)
	if _, err := os.Stat(uacDir); os.IsNotExist(err) {
		log.Infof("UAC directory not found at %s — cloning from GitHub...", uacDir)
		if mkErr := os.MkdirAll(filepath.Dir(uacDir), 0o755); mkErr != nil {
			return Result{Status: "failed", Data: map[string]interface{}{"error": "failed to create parent dir: " + mkErr.Error()}}
		}
		var cloneOut, cloneErr bytes.Buffer
		cloneCmd := exec.Command("git", "clone", "--depth=1", "https://github.com/tclahr/uac", uacDir)
		cloneCmd.Stdout = &cloneOut
		cloneCmd.Stderr = &cloneErr
		if err := cloneCmd.Run(); err != nil {
			return Result{
				Status: "failed",
				Data: map[string]interface{}{
					"error":  "git clone failed: " + err.Error(),
					"stderr": cloneErr.String(),
				},
			}
		}
		log.Infof("UAC cloned successfully to %s", uacDir)
	}

	// Run UAC: ./uac -p <profile> <output_dir>
	args := []string{"-p", profile, outputDir}
	log.Infof("Running UAC: %s %s", w.cfg.UACBinaryPath, strings.Join(args, " "))

	var stdout, stderr bytes.Buffer
	uacCmd := exec.Command(w.cfg.UACBinaryPath, args...)
	uacCmd.Stdout = &stdout
	uacCmd.Stderr = &stderr
	uacCmd.Dir = uacDir

	if err := uacCmd.Run(); err != nil {
		return Result{
			Status: "failed",
			Data: map[string]interface{}{
				"error":  err.Error(),
				"stderr": stderr.String(),
				"stdout": stdout.String(),
			},
		}
	}

	// Find the output archive (tar.gz)
	archivePath := findArchive(outputDir)
	if archivePath == "" {
		return Result{
			Status: "completed",
			Data: map[string]interface{}{
				"message":    "UAC completed but no archive found",
				"output_dir": outputDir,
				"stdout":     stdout.String(),
			},
		}
	}

	return Result{
		Status:   "completed",
		FilePath: archivePath,
		Data: map[string]interface{}{
			"archive": filepath.Base(archivePath),
			"stdout":  stdout.String(),
			"profile": profile,
		},
	}
}

func findArchive(dir string) string {
	matches, _ := filepath.Glob(filepath.Join(dir, "*.tar.gz"))
	if len(matches) > 0 {
		return matches[0]
	}
	// Check subdirectories
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.IsDir() {
			if found := findArchive(filepath.Join(dir, e.Name())); found != "" {
				return found
			}
		}
	}
	return ""
}

// ------------------------------------------------------------------ //
//   Command executor
// ------------------------------------------------------------------ //

func (w *Worker) execCommand(cmd Command) Result {
	shell, ok := cmd.Payload["command"].(string)
	if !ok || shell == "" {
		return Result{Status: "failed", Data: map[string]interface{}{"error": "missing 'command' in payload"}}
	}

	timeoutSec := 300 // default 5 minutes
	if t, ok := cmd.Payload["timeout"].(float64); ok && t > 0 {
		timeoutSec = int(t)
	}

	var stdout, stderr bytes.Buffer
	c := exec.Command("/bin/sh", "-c", shell)
	c.Stdout = &stdout
	c.Stderr = &stderr
	c.Dir = w.cfg.WorkDir

	done := make(chan error, 1)
	go func() { done <- c.Run() }()

	select {
	case err := <-done:
		exitCode := 0
		if err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			} else {
				return Result{Status: "failed", Data: map[string]interface{}{"error": err.Error()}}
			}
		}
		return Result{
			Status: "completed",
			Data: map[string]interface{}{
				"stdout":    stdout.String(),
				"stderr":    stderr.String(),
				"exit_code": exitCode,
			},
		}
	case <-time.After(time.Duration(timeoutSec) * time.Second):
		c.Process.Kill()
		return Result{
			Status: "failed",
			Data: map[string]interface{}{
				"error":  "command timed out",
				"stdout": stdout.String(),
				"stderr": stderr.String(),
			},
		}
	}
}

// ------------------------------------------------------------------ //
//   File collector
// ------------------------------------------------------------------ //

func (w *Worker) collectFile(cmd Command) Result {
	path, ok := cmd.Payload["path"].(string)
	if !ok || path == "" {
		return Result{Status: "failed", Data: map[string]interface{}{"error": "missing 'path' in payload"}}
	}

	// Verify file exists and is a regular file
	info, err := os.Stat(path)
	if err != nil {
		return Result{Status: "failed", Data: map[string]interface{}{"error": err.Error()}}
	}
	if info.IsDir() {
		return Result{Status: "failed", Data: map[string]interface{}{"error": "path is a directory, use run_uac for bulk collection"}}
	}

	// Copy to work dir for upload
	dest := filepath.Join(w.cfg.WorkDir, "collected", filepath.Base(path))
	os.MkdirAll(filepath.Dir(dest), 0o700)

	src, err := os.Open(path)
	if err != nil {
		return Result{Status: "failed", Data: map[string]interface{}{"error": err.Error()}}
	}
	defer src.Close()

	dst, err := os.Create(dest)
	if err != nil {
		return Result{Status: "failed", Data: map[string]interface{}{"error": err.Error()}}
	}
	defer dst.Close()

	written, err := dst.ReadFrom(src)
	if err != nil {
		return Result{Status: "failed", Data: map[string]interface{}{"error": err.Error()}}
	}

	return Result{
		Status:   "completed",
		FilePath: dest,
		Data: map[string]interface{}{
			"original_path": path,
			"size":          written,
		},
	}
}

// ------------------------------------------------------------------ //
//   Forensic checks (quick triage)
// ------------------------------------------------------------------ //

func (w *Worker) runCheck(cmd Command) Result {
	checkName, _ := cmd.Payload["check"].(string)

	checks := map[string]string{
		"processes":   "ps auxf",
		"connections": "ss -tlnp",
		"users":       "cat /etc/passwd; last -25",
		"crontabs":    "for u in $(cut -d: -f1 /etc/passwd); do crontab -l -u $u 2>/dev/null && echo \"---$u---\"; done",
		"services":    "systemctl list-units --type=service --state=running --no-pager",
		"modules":     "lsmod",
		"mounts":      "mount; df -h",
		"env":         "env",
		"hosts":       "cat /etc/hosts; cat /etc/resolv.conf",
		"history":     "cat ~/.bash_history 2>/dev/null | tail -100",
	}

	shell, ok := checks[checkName]
	if !ok {
		available := make([]string, 0, len(checks))
		for k := range checks {
			available = append(available, k)
		}
		return Result{
			Status: "failed",
			Data: map[string]interface{}{
				"error":     fmt.Sprintf("unknown check: %s", checkName),
				"available": available,
			},
		}
	}

	// Reuse exec logic
	fakeCmd := Command{ID: cmd.ID, Payload: map[string]interface{}{"command": shell, "timeout": float64(60)}}
	result := w.execCommand(fakeCmd)
	result.Data["check"] = checkName
	return result
}
