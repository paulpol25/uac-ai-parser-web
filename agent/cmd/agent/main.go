// Package main is the entry point for the UAC-AI forensic collection agent.
//
// The agent runs on target Linux machines, communicates with the UAC-AI
// backend via WebSocket (preferred) or REST polling (fallback), executes
// forensic commands, and uploads results.
package main

import (
	"flag"
	"os"
	"os/signal"
	"syscall"

	"uac-ai-agent/internal/config"
	"uac-ai-agent/internal/crypto"
	"uac-ai-agent/internal/transport"
	"uac-ai-agent/internal/worker"

	log "github.com/sirupsen/logrus"
)

func main() {
	cfgPath := flag.String("config", "/opt/uac-ai-agent/agent.conf", "path to agent config file")
	flag.Parse()

	log.SetFormatter(&log.TextFormatter{FullTimestamp: true})

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	log.Infof("UAC-AI Agent %s starting (agent_id=%s)", config.Version, cfg.AgentID)

	// Encryption engine (optional — enabled if ENCRYPTION_KEY is set)
	enc, err := crypto.NewEngine(cfg.EncryptionKey)
	if err != nil {
		log.Fatalf("Failed to initialise encryption: %v", err)
	}
	if enc.Enabled() {
		log.Info("Payload encryption enabled (AES-256-GCM)")
	}

	// Command channel:  transport → worker
	cmdCh := make(chan worker.Command, 32)

	// Result channel:   worker → transport
	resultCh := make(chan worker.Result, 32)

	// Start worker
	wrk := worker.New(cfg, resultCh)
	go wrk.RunTyped(cmdCh)

	// Start transport — prefer WebSocket, fall back to REST
	if cfg.WSURL() != "" {
		log.Info("Using WebSocket transport (with REST fallback)")
		ws := transport.NewWS(cfg, cmdCh, resultCh, enc)
		go ws.Run()
		defer ws.Close()
	} else {
		log.Info("Using REST polling transport")
		tp := transport.New(cfg, cmdCh, resultCh, enc)
		go tp.Run()
		defer tp.Close()
	}

	// Wait for shutdown signal
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	log.Info("Shutting down...")
	wrk.Close()
}
