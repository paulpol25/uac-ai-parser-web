# Build
.PHONY: build build-linux build-all clean

VERSION := 0.2.0
LDFLAGS := -ldflags="-s -w -X uac-ai-agent/internal/config.Version=$(VERSION)"

build:
	go build $(LDFLAGS) -o bin/uac-agent ./cmd/agent

build-linux:
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o bin/uac-agent-linux-amd64 ./cmd/agent
	GOOS=linux GOARCH=arm64 go build $(LDFLAGS) -o bin/uac-agent-linux-arm64 ./cmd/agent

build-all: build-linux

clean:
	rm -rf bin/
