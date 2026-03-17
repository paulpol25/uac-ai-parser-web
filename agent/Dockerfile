FROM golang:1.22-alpine AS builder

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /uac-agent ./cmd/agent

# ---

FROM alpine:3.19

RUN apk add --no-cache ca-certificates bash curl

COPY --from=builder /uac-agent /usr/local/bin/uac-agent

ENTRYPOINT ["uac-agent"]
