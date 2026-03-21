// Package worker processes commands received from the backend.
package worker

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
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
	sem      chan struct{} // concurrency limiter
	cancel   context.CancelFunc
	ctx      context.Context
	mu       sync.Mutex
	running  map[string]context.CancelFunc // command ID → cancel func
}

// New creates a Worker.
func New(cfg *config.Config, resultCh chan<- Result) *Worker {
	maxConc := cfg.MaxConcurrency
	if maxConc <= 0 {
		maxConc = 5
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Worker{
		cfg:      cfg,
		resultCh: resultCh,
		done:     make(chan struct{}),
		sem:      make(chan struct{}, maxConc),
		cancel:   cancel,
		ctx:      ctx,
		running:  make(map[string]context.CancelFunc),
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
			w.dispatch(cmd)
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
			w.dispatch(cmd)
		}
	}
}

// CancelCommand cancels a running command by ID.
func (w *Worker) CancelCommand(commandID string) bool {
	w.mu.Lock()
	cancelFn, ok := w.running[commandID]
	w.mu.Unlock()
	if ok {
		cancelFn()
		return true
	}
	return false
}

// dispatch acquires a semaphore slot and runs the command in a goroutine.
func (w *Worker) dispatch(cmd Command) {
	select {
	case w.sem <- struct{}{}:
	default:
		log.Warnf("Max concurrency reached, queuing command %s", config.SafeIDPrefix(cmd.ID))
		w.sem <- struct{}{} // block until slot available
	}

	cmdCtx, cmdCancel := context.WithCancel(w.ctx)
	w.mu.Lock()
	w.running[cmd.ID] = cmdCancel
	w.mu.Unlock()

	go func() {
		defer func() {
			<-w.sem // release slot
			w.mu.Lock()
			delete(w.running, cmd.ID)
			w.mu.Unlock()
			cmdCancel()
			if r := recover(); r != nil {
				log.Errorf("Panic in command %s: %v", config.SafeIDPrefix(cmd.ID), r)
				w.resultCh <- Result{
					CommandID: cmd.ID,
					Status:    "failed",
					Data:      map[string]interface{}{"error": fmt.Sprintf("internal panic: %v", r)},
				}
			}
		}()
		w.execute(cmdCtx, cmd)
	}()
}

// Close stops the worker and cancels all running commands.
func (w *Worker) Close() {
	w.cancel()
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

func (w *Worker) execute(ctx context.Context, cmd Command) {
	log.Infof("Executing command %s (type=%s)", config.SafeIDPrefix(cmd.ID), cmd.Type)
	start := time.Now()

	var result Result
	switch cmd.Type {
	case "run_uac":
		result = w.runUAC(ctx, cmd)
	case "exec_command":
		result = w.execCommand(ctx, cmd)
	case "collect_file":
		result = w.collectFile(cmd)
	case "run_check":
		result = w.runCheck(ctx, cmd)
	case "collect_logs":
		result = w.collectLogs(ctx, cmd)
	case "hash_files":
		result = w.hashFiles(ctx, cmd)
	case "persistence_check":
		result = w.persistenceCheck(ctx, cmd)
	case "network_capture":
		result = w.networkCapture(ctx, cmd)
	case "filesystem_timeline":
		result = w.filesystemTimeline(ctx, cmd)
	case "docker_inspect":
		result = w.dockerInspect(ctx, cmd)
	case "yara_scan":
		result = w.yaraScan(ctx, cmd)
	case "memory_dump":
		result = w.memoryDump(ctx, cmd)
	case "shutdown":
		result = Result{CommandID: cmd.ID, Status: "completed", Data: map[string]interface{}{"message": "shutting down"}}
		w.resultCh <- result
		w.cleanup()
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
	log.Infof("Command %s finished (%s) in %v", config.SafeIDPrefix(cmd.ID), result.Status, elapsed)

	w.resultCh <- result
}

// ------------------------------------------------------------------ //
//   UAC runner
// ------------------------------------------------------------------ //

func (w *Worker) runUAC(ctx context.Context, cmd Command) Result {
	profile := w.cfg.UACProfile
	if p, ok := cmd.Payload["profile"].(string); ok && p != "" {
		profile = p
	}

	outputDir := filepath.Join(w.cfg.WorkDir, "uac-output", config.SafeIDPrefix(cmd.ID))
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
		cloneCmd := exec.CommandContext(ctx, "git", "clone", "--depth=1", "https://github.com/tclahr/uac", uacDir)
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
		// Pin to specific commit if configured
		if w.cfg.UACCommit != "" {
			checkoutCmd := exec.CommandContext(ctx, "git", "-C", uacDir, "checkout", w.cfg.UACCommit)
			if out, err := checkoutCmd.CombinedOutput(); err != nil {
				log.Warnf("Failed to checkout UAC commit %s: %v (%s)", w.cfg.UACCommit, err, string(out))
			}
		}
		log.Infof("UAC cloned successfully to %s", uacDir)
	}

	// Run UAC: ./uac -p <profile> <output_dir>
	args := []string{"-p", profile, outputDir}
	log.Infof("Running UAC: %s %s", w.cfg.UACBinaryPath, strings.Join(args, " "))

	var stdout, stderr bytes.Buffer
	uacCmd := exec.CommandContext(ctx, w.cfg.UACBinaryPath, args...)
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

func (w *Worker) execCommand(ctx context.Context, cmd Command) Result {
	shell, ok := cmd.Payload["command"].(string)
	if !ok || shell == "" {
		return Result{Status: "failed", Data: map[string]interface{}{"error": "missing 'command' in payload"}}
	}

	timeoutSec := 300 // default 5 minutes
	if t, ok := cmd.Payload["timeout"].(float64); ok && t > 0 {
		timeoutSec = int(t)
	}

	execCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSec)*time.Second)
	defer cancel()

	var stdout, stderr bytes.Buffer
	c := exec.CommandContext(execCtx, "/bin/sh", "-c", shell)
	c.Stdout = &stdout
	c.Stderr = &stderr
	c.Dir = w.cfg.WorkDir

	err := c.Run()
	if execCtx.Err() == context.DeadlineExceeded {
		return Result{
			Status: "failed",
			Data: map[string]interface{}{
				"error":  "command timed out",
				"stdout": stdout.String(),
				"stderr": stderr.String(),
			},
		}
	}
	if execCtx.Err() == context.Canceled {
		return Result{
			Status: "failed",
			Data: map[string]interface{}{
				"error":  "command cancelled",
				"stdout": stdout.String(),
				"stderr": stderr.String(),
			},
		}
	}

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
}

// ------------------------------------------------------------------ //
//   File collector
// ------------------------------------------------------------------ //

func (w *Worker) collectFile(cmd Command) Result {
	path, ok := cmd.Payload["path"].(string)
	if !ok || path == "" {
		return Result{Status: "failed", Data: map[string]interface{}{"error": "missing 'path' in payload"}}
	}

	// Validate against allowed paths if configured
	if len(w.cfg.AllowedCollectPaths) > 0 {
		allowed := false
		absPath, _ := filepath.Abs(path)
		for _, prefix := range w.cfg.AllowedCollectPaths {
			absPrefix, _ := filepath.Abs(prefix)
			if strings.HasPrefix(absPath, absPrefix) {
				allowed = true
				break
			}
		}
		if !allowed {
			return Result{Status: "failed", Data: map[string]interface{}{
				"error": fmt.Sprintf("path %s is not in allowed collect paths", path),
			}}
		}
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

func (w *Worker) runCheck(ctx context.Context, cmd Command) Result {
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
		"history":     "for f in /root/.bash_history /home/*/.bash_history; do [ -f \"$f\" ] && echo \"=== $f ===\"  && tail -100 \"$f\"; done",
		"login_logs":  "last -50; lastlog 2>/dev/null | head -50",
		"open_files":  "lsof -nP 2>/dev/null | head -200",
		"dns_cache":   "cat /etc/hosts; systemd-resolve --statistics 2>/dev/null || resolvectl statistics 2>/dev/null",
		"firewall":    "iptables -L -n -v 2>/dev/null; nft list ruleset 2>/dev/null",
		"ssh_keys":    "find /home -name authorized_keys -o -name id_rsa.pub 2>/dev/null | head -20; cat /root/.ssh/authorized_keys 2>/dev/null",
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
	result := w.execCommand(ctx, fakeCmd)
	result.Data["check"] = checkName
	return result
}

// ------------------------------------------------------------------ //
//   New forensic commands
// ------------------------------------------------------------------ //

// collectLogs collects log files matching a glob pattern into a tar archive.
func (w *Worker) collectLogs(ctx context.Context, cmd Command) Result {
	pattern, _ := cmd.Payload["pattern"].(string)
	if pattern == "" {
		pattern = "/var/log/*.log"
	}
	maxFiles := 100
	if mf, ok := cmd.Payload["max_files"].(float64); ok && mf > 0 {
		maxFiles = int(mf)
	}

	archiveName := fmt.Sprintf("logs-%s.tar.gz", config.SafeIDPrefix(cmd.ID))
	archivePath := filepath.Join(w.cfg.WorkDir, archiveName)

	// Find matching files
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return Result{Status: "failed", Data: map[string]interface{}{"error": "invalid glob pattern: " + err.Error()}}
	}
	if len(matches) == 0 {
		return Result{Status: "completed", Data: map[string]interface{}{"message": "no files matched pattern", "pattern": pattern}}
	}
	if len(matches) > maxFiles {
		matches = matches[:maxFiles]
	}

	// Create tar.gz archive
	args := append([]string{"czf", archivePath, "--"}, matches...)
	tarCmd := exec.CommandContext(ctx, "tar", args...)
	var stderr bytes.Buffer
	tarCmd.Stderr = &stderr
	if err := tarCmd.Run(); err != nil {
		return Result{Status: "failed", Data: map[string]interface{}{
			"error":  "tar failed: " + err.Error(),
			"stderr": stderr.String(),
		}}
	}

	return Result{
		Status:   "completed",
		FilePath: archivePath,
		Data: map[string]interface{}{
			"archive":     archiveName,
			"pattern":     pattern,
			"files_count": len(matches),
		},
	}
}

// hashFiles recursively hashes all files in a directory.
func (w *Worker) hashFiles(ctx context.Context, cmd Command) Result {
	dir, _ := cmd.Payload["path"].(string)
	if dir == "" {
		return Result{Status: "failed", Data: map[string]interface{}{"error": "missing 'path' in payload"}}
	}
	maxFiles := 1000
	if mf, ok := cmd.Payload["max_files"].(float64); ok && mf > 0 {
		maxFiles = int(mf)
	}

	hashes := make(map[string]string)
	count := 0

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if count >= maxFiles {
			return filepath.SkipAll
		}
		f, err := os.Open(path)
		if err != nil {
			return nil // skip unreadable files
		}
		defer f.Close()

		h := sha256.New()
		if _, err := io.Copy(h, f); err != nil {
			return nil
		}
		hashes[path] = hex.EncodeToString(h.Sum(nil))
		count++
		return nil
	})

	if err != nil && ctx.Err() == nil {
		return Result{Status: "failed", Data: map[string]interface{}{"error": err.Error()}}
	}

	return Result{
		Status: "completed",
		Data: map[string]interface{}{
			"path":        dir,
			"hashes":      hashes,
			"files_count": count,
		},
	}
}

// persistenceCheck performs a comprehensive persistence mechanism scan.
func (w *Worker) persistenceCheck(ctx context.Context, cmd Command) Result {
	checks := []struct {
		name  string
		shell string
	}{
		{"crontabs", "for u in $(cut -d: -f1 /etc/passwd); do echo \"=== $u ===\"; crontab -l -u $u 2>/dev/null; done"},
		{"cron_dirs", "ls -la /etc/cron.d/ /etc/cron.daily/ /etc/cron.hourly/ /etc/cron.weekly/ /etc/cron.monthly/ 2>/dev/null"},
		{"systemd_services", "find /etc/systemd/system /run/systemd/system /usr/lib/systemd/system -name '*.service' -newer /var/log/syslog 2>/dev/null | head -50"},
		{"initd", "ls -la /etc/init.d/ 2>/dev/null"},
		{"rc_local", "cat /etc/rc.local 2>/dev/null"},
		{"bashrc_profiles", "cat /etc/profile /etc/bash.bashrc 2>/dev/null; for u in /home/*; do echo \"=== $u ===\"; cat $u/.bashrc $u/.profile $u/.bash_profile 2>/dev/null; done"},
		{"authorized_keys", "find / -name authorized_keys -type f 2>/dev/null | while read f; do echo \"=== $f ===\"; cat \"$f\"; done"},
		{"ld_preload", "cat /etc/ld.so.preload 2>/dev/null; echo '---'; env | grep -i ld_preload"},
		{"at_jobs", "atq 2>/dev/null; ls -la /var/spool/at/ 2>/dev/null"},
		{"kernel_modules", "lsmod; cat /etc/modules 2>/dev/null; cat /etc/modules-load.d/*.conf 2>/dev/null"},
		{"setuid_files", "find / -perm -4000 -type f 2>/dev/null | head -50"},
		{"docker_autostart", "docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null; ls /etc/docker/ 2>/dev/null"},
	}

	results := make(map[string]interface{})
	for _, chk := range checks {
		if ctx.Err() != nil {
			return Result{Status: "failed", Data: map[string]interface{}{"error": "cancelled"}}
		}
		execCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		var out bytes.Buffer
		c := exec.CommandContext(execCtx, "/bin/sh", "-c", chk.shell)
		c.Stdout = &out
		c.Stderr = &out
		c.Run() // best-effort
		cancel()
		results[chk.name] = out.String()
	}

	return Result{
		Status: "completed",
		Data: map[string]interface{}{
			"checks": results,
		},
	}
}

// networkCapture captures packets using tcpdump.
func (w *Worker) networkCapture(ctx context.Context, cmd Command) Result {
	duration := 30 // seconds
	if d, ok := cmd.Payload["duration"].(float64); ok && d > 0 {
		duration = int(d)
	}
	if duration > 300 {
		duration = 300 // cap at 5 minutes
	}
	iface, _ := cmd.Payload["interface"].(string)
	filter, _ := cmd.Payload["filter"].(string)

	pcapFile := filepath.Join(w.cfg.WorkDir, fmt.Sprintf("capture-%s.pcap", config.SafeIDPrefix(cmd.ID)))

	args := []string{"-c", fmt.Sprintf("timeout %d tcpdump -w %s -c 10000", duration, pcapFile)}
	if iface != "" {
		args[1] += " -i " + iface
	}
	if filter != "" {
		args[1] += " " + filter
	}

	execCtx, cancel := context.WithTimeout(ctx, time.Duration(duration+10)*time.Second)
	defer cancel()

	var stderr bytes.Buffer
	c := exec.CommandContext(execCtx, "/bin/sh", args...)
	c.Stderr = &stderr
	c.Run() // tcpdump exits on timeout

	info, err := os.Stat(pcapFile)
	if err != nil {
		return Result{Status: "failed", Data: map[string]interface{}{
			"error":  "no capture file produced",
			"stderr": stderr.String(),
		}}
	}

	return Result{
		Status:   "completed",
		FilePath: pcapFile,
		Data: map[string]interface{}{
			"pcap_file":    filepath.Base(pcapFile),
			"size":         info.Size(),
			"duration_sec": duration,
		},
	}
}

// filesystemTimeline generates a MAC timeline of files.
func (w *Worker) filesystemTimeline(ctx context.Context, cmd Command) Result {
	dir, _ := cmd.Payload["path"].(string)
	if dir == "" {
		dir = "/"
	}
	maxDepth := 3
	if d, ok := cmd.Payload["max_depth"].(float64); ok && d > 0 {
		maxDepth = int(d)
	}

	timelineFile := filepath.Join(w.cfg.WorkDir, fmt.Sprintf("timeline-%s.csv", config.SafeIDPrefix(cmd.ID)))

	// Use find to generate bodyfile-style output
	shell := fmt.Sprintf(
		`find %s -maxdepth %d -printf '%%T+ %%M %%u %%g %%s %%p\n' 2>/dev/null | sort > %s`,
		dir, maxDepth, timelineFile,
	)

	execCtx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()

	var stderr bytes.Buffer
	c := exec.CommandContext(execCtx, "/bin/sh", "-c", shell)
	c.Stderr = &stderr
	if err := c.Run(); err != nil && execCtx.Err() == nil {
		return Result{Status: "failed", Data: map[string]interface{}{
			"error":  err.Error(),
			"stderr": stderr.String(),
		}}
	}

	info, _ := os.Stat(timelineFile)
	size := int64(0)
	if info != nil {
		size = info.Size()
	}

	return Result{
		Status:   "completed",
		FilePath: timelineFile,
		Data: map[string]interface{}{
			"timeline_file": filepath.Base(timelineFile),
			"path":          dir,
			"max_depth":     maxDepth,
			"size":          size,
		},
	}
}

// dockerInspect collects Docker container and image information.
func (w *Worker) dockerInspect(ctx context.Context, cmd Command) Result {
	commands := map[string]string{
		"containers":    "docker ps -a --format '{{json .}}' 2>/dev/null",
		"images":        "docker images --format '{{json .}}' 2>/dev/null",
		"networks":      "docker network ls --format '{{json .}}' 2>/dev/null",
		"volumes":       "docker volume ls --format '{{json .}}' 2>/dev/null",
		"running_stats": "docker stats --no-stream --format '{{json .}}' 2>/dev/null",
	}

	results := make(map[string]interface{})
	for name, shell := range commands {
		if ctx.Err() != nil {
			break
		}
		execCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		var out bytes.Buffer
		c := exec.CommandContext(execCtx, "/bin/sh", "-c", shell)
		c.Stdout = &out
		c.Run()
		cancel()
		results[name] = out.String()
	}

	return Result{
		Status: "completed",
		Data:   map[string]interface{}{"docker": results},
	}
}

// downloadFile fetches a URL to a local file, using the agent's API key for auth.
func (w *Worker) downloadFile(ctx context.Context, url, destPath string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Api-Key", w.cfg.APIKey)

	client := &http.Client{Transport: w.cfg.HTTPTransport(), Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	f, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = io.Copy(f, resp.Body)
	return err
}

// yaraScan runs YARA rules against a target path.
func (w *Worker) yaraScan(ctx context.Context, cmd Command) Result {
	rulesPath, _ := cmd.Payload["rules_path"].(string)
	targetPath, _ := cmd.Payload["target_path"].(string)
	if targetPath == "" {
		targetPath = "/tmp"
	}

	// Download managed rules from backend if rules_url is provided
	if rulesPath == "" {
		rulesURL, _ := cmd.Payload["rules_url"].(string)
		if rulesURL == "" {
			// Default: try to download combined rules from backend
			rulesURL = strings.TrimRight(w.cfg.BackendURL, "/") + "/api/v1/yara-rules/combined"
		}

		tmpRules := filepath.Join(w.cfg.WorkDir, fmt.Sprintf("yara-rules-%s.yar", config.SafeIDPrefix(cmd.ID)))
		if err := w.downloadFile(ctx, rulesURL, tmpRules); err != nil {
			return Result{Status: "failed", Data: map[string]interface{}{
				"error": fmt.Sprintf("failed to download rules from %s: %v", rulesURL, err),
			}}
		}
		defer os.Remove(tmpRules)
		rulesPath = tmpRules
	}

	execCtx, cancel := context.WithTimeout(ctx, 300*time.Second)
	defer cancel()

	// Ensure yara binary is available
	if _, err := exec.LookPath("yara"); err != nil {
		log.Info("yara not found in PATH, attempting to install...")
		installCtx, instCancel := context.WithTimeout(ctx, 120*time.Second)
		defer instCancel()
		installCmd := exec.CommandContext(installCtx, "/bin/sh", "-c",
			"apt-get update -qq && apt-get install -qq -y yara 2>/dev/null || yum install -y yara 2>/dev/null || apk add --no-cache yara 2>/dev/null")
		if installErr := installCmd.Run(); installErr != nil {
			return Result{Status: "failed", Data: map[string]interface{}{
				"error": "yara binary not found in $PATH and automatic installation failed. Please install yara on the target system (e.g. apt-get install yara).",
			}}
		}
	}

	var stdout, stderr bytes.Buffer
	c := exec.CommandContext(execCtx, "yara", "-r", "-s", rulesPath, targetPath)
	c.Stdout = &stdout
	c.Stderr = &stderr
	err := c.Run()

	if err != nil && execCtx.Err() == nil {
		// yara returns exit code 1 for no matches, which is fine
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 1 {
			return Result{
				Status: "completed",
				Data: map[string]interface{}{
					"matches":     stdout.String(),
					"match_count": 0,
					"target_path": targetPath,
				},
			}
		}
		return Result{Status: "failed", Data: map[string]interface{}{
			"error":  err.Error(),
			"stderr": stderr.String(),
		}}
	}

	matchCount := strings.Count(stdout.String(), "\n")
	return Result{
		Status: "completed",
		Data: map[string]interface{}{
			"matches":     stdout.String(),
			"match_count": matchCount,
			"target_path": targetPath,
		},
	}
}

// memoryDump creates a memory dump of a process or uses avml for full system.
func (w *Worker) memoryDump(ctx context.Context, cmd Command) Result {
	pid, _ := cmd.Payload["pid"].(float64)
	dumpFile := filepath.Join(w.cfg.WorkDir, fmt.Sprintf("memdump-%s.raw", config.SafeIDPrefix(cmd.ID)))

	execCtx, cancel := context.WithTimeout(ctx, 300*time.Second)
	defer cancel()

	var shell string
	if pid > 0 {
		// Process-level memory dump via /proc
		procMem := fmt.Sprintf("/proc/%d/maps", int(pid))
		if _, err := os.Stat(procMem); err != nil {
			return Result{Status: "failed", Data: map[string]interface{}{"error": fmt.Sprintf("process %d not found", int(pid))}}
		}
		shell = fmt.Sprintf("cat /proc/%d/maps > %s.maps; cp /proc/%d/mem %s 2>/dev/null || gcore -o %s %d 2>/dev/null",
			int(pid), dumpFile, int(pid), dumpFile, dumpFile, int(pid))
	} else {
		// Full memory dump via avml (if available) or /proc/kcore
		shell = fmt.Sprintf("if command -v avml >/dev/null 2>&1; then avml %s; elif [ -r /proc/kcore ]; then dd if=/proc/kcore of=%s bs=1M count=256 2>/dev/null; else echo 'No memory dump tool available. Install avml or ensure /proc/kcore is readable.' >&2; exit 1; fi", dumpFile, dumpFile)
	}

	var stderr bytes.Buffer
	c := exec.CommandContext(execCtx, "/bin/sh", "-c", shell)
	c.Stderr = &stderr
	if err := c.Run(); err != nil {
		return Result{Status: "failed", Data: map[string]interface{}{
			"error":  err.Error(),
			"stderr": stderr.String(),
		}}
	}

	info, _ := os.Stat(dumpFile)
	if info == nil || info.Size() == 0 {
		return Result{Status: "failed", Data: map[string]interface{}{
			"error":  "dump file is empty or missing",
			"stderr": stderr.String(),
		}}
	}

	return Result{
		Status:   "completed",
		FilePath: dumpFile,
		Data: map[string]interface{}{
			"dump_file": filepath.Base(dumpFile),
			"size":      info.Size(),
			"pid":       int(pid),
		},
	}
}
